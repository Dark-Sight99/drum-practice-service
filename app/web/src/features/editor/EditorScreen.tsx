import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { FastForward, Pause, Play, Redo2, Rewind, RotateCcw, Undo2 } from 'lucide-react'
import { Spinner } from '../../components/Spinner'
import { Modal } from '../../components/Modal'
import type { DrumNote, DrumPiece, DrumScore, Hand } from '../../score/types'
import { alternateHandsByTick, validateDrumScore } from '../../score'
import { saveSongDrumScore, songAudioUrl, type SongSummary } from '../../api/songs'
import { fetchMixerSetting, saveMixerSetting } from '../../api/auth'
import { ApiError } from '../../api/client'
import {
  audioTrackPositionSeconds,
  barIndexForTick,
  CHANNEL_KEYS,
  createAudioTrackPool,
  createDrumVoices,
  createMetronome,
  createTrackPlayer,
  defaultMixerState,
  disposeDrumVoices,
  effectiveGain,
  getMasterClock,
  metronomeGainToDb,
  musicVolume,
  playDrumScore,
  setMusicVolume,
  ticksPerBar,
  ticksToSeconds,
  type AudioTrackPool,
  type ChannelKey,
  type ChannelState,
  type DrumVoiceMap,
  type Metronome,
  type MixerState,
  type PlaybackHandle,
  type TrackPlayer,
} from '../../audio'
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
  type EditHistory,
} from './editHistory'
import {
  EDITOR_ROWS,
  editorRowIndexForPiece,
  tickToBeatLabel,
  ticksPerGridUnit,
  type GridUnit,
} from './grid'
import { VELOCITY_TIERS, velocityTierOf, type VelocityTier } from './velocity'

const HAND_LABEL: Record<Exclude<Hand, null>, string> = { R: '오른손', L: '왼손', RF: '오른발', LF: '왼발' }

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  synth_drums: '신스 드럼',
  metronome: '메트로놈',
  stem_drums: '원곡 드럼',
  stem_bass: '베이스',
  stem_vocals: '보컬',
  stem_other: '그 외',
}

// 2026-10-29(의뢰인 요청) — "편집시에도 음악을 들으면서". 처음엔 신스
// 드럼+메트로놈만 재생하도록 범위를 좁혔었는데, 의뢰인 재지적("편집화면에서
// 오히려 신스드럼보다 원곡 음원이 더 중요한거 아니야? 원곡을 듣고 고쳐야지
// 신스드럼은 이미 노트대로 드럼을 치는데 그거듣고 편집을 할 수 있는게
// 없지")이 맞아 원곡 분리 음원(스템)까지 재생하도록 확장했다.
//
// practice 화면(PracticeCanvas.tsx)의 스템 재생은 scorePlayer.ts의
// playDrumScore()에 tracks를 넘겨 내부적으로 transport.schedule()이
// tracks.playFrom()을 "곡 시작 시각"에 예약하게 하는데, 이 화면처럼 재생을
// 시작하자마자 임의 위치로 점프하면 그 예약된 콜백이 점프 전에 이미
// 커밋됐는지 불확실했다 — **실제로 Tone.js 15.1.22를 브라우저에서 직접
// 실행해 확인**(2026-10-29, CLAUDE.md §2 "기억에 의존한 API 사용 금지"):
// transport.schedule(cb, 0) 후 transport.start() 바로 다음 줄(같은 동기
// 구간, await 없음)에서 transport.seconds를 점프시키면 그 콜백은 **전혀
// 발화하지 않는다**(2초 대기 후에도 fired=false로 직접 측정). 그래서
// scorePlayer.ts에 tracks를 넘기는 설계였다면 원곡 음원이 아예 안 들렸을
// 것 — 아래처럼 **scorePlayer.ts에는 tracks를 아예 안 넘기고**(노트/
// 메트로놈 스케줄링만 맡김) 커서 위치로 점프한 **뒤에 직접**
// `tracks.playFrom()`을 호출하는 지금 방식이 맞는 선택이었음을 실측으로
// 확인했다.
//
// 다만 이 직접 호출 방식은 Tone.js의 정밀한 Web Audio 클록이 아니라 평범한
// HTMLMediaElement.play()라 시작 시점이 신스 드럼(Tone.js 노트)만큼
// 정확하진 않다(Codex 모드A 지적, 반영) — handleSeek()(PracticeCanvas.tsx)도
// 같은 특성이지만 그쪽은 재생 "중" 리싱크(tracks.resync(), 아래 TRACK_RESYNC_*
// 상수)가 매 750ms 계속 교정해주는 반면 이 화면은 처음엔 그 교정이 빠져
// 있었다 — 아래 startRaf()의 리싱크 호출로 추가해 시작 오차·재생 중
// 누적 드리프트 둘 다 PracticeCanvas.tsx와 같은 수준으로 바로잡는다.
export interface EditorScreenProps {
  song: SongSummary
  initialScore: DrumScore
  onSaved: () => void
  onCancel: () => void
  /** 2026-10-29(의뢰인 요청) — "연주 페이지에서 편집 버튼을 누르면 편집하는
   * 페이지의 해당 부분으로 바로 이동해서 편집 바로 할 수 있게". 재생은
   * 자동으로 시작하지 않음(의뢰인이 명시: "연주페이지에서 재생되는동안
   * 편집페이지에서도 동일하게 재생되고 있으면 안됨") — 위치만 맞춰두고
   * 멈춰 있는 상태로 진입. */
  initialPositionTicks?: number
  /** 2026-10-29(의뢰인 요청) — "편집하고나서 연습화면으로 돌아가서 다시 그
   * 부분부터 치고싶은데 돌아갈 수 있는 버튼 및 기능이 없는거 같다". 연주
   * 화면의 "악보 편집하기"로 들어왔을 때만(App.tsx가 결정) 전달되며, 지금
   * 커서(틱) 위치를 그대로 넘긴다. 저장 여부와 무관 — "← 라이브러리"
   * (onCancel)와 같은 원칙으로 저장하지 않은 변경은 버리고 이동한다. */
  onBackToPractice?: (positionTicks: number) => void
}

interface EditableNote extends DrumNote {
  _editorId: number
}

interface EditorState {
  version: 1
  meta: DrumScore['meta']
  ppq: number
  audioOffsetMs: number
  notes: EditableNote[]
}

function toEditorState(score: DrumScore): EditorState {
  return {
    version: 1,
    meta: { ...score.meta },
    ppq: score.ppq,
    audioOffsetMs: score.audioOffsetMs,
    notes: score.notes.map((note, i) => ({ ...note, _editorId: i })),
  }
}

function toDrumScore(state: EditorState): DrumScore {
  return {
    version: 1,
    meta: state.meta,
    ppq: state.ppq,
    audioOffsetMs: state.audioOffsetMs,
    notes: state.notes.map(({ _editorId: _unused, ...note }) => note),
  }
}

function readPieceColor(piece: DrumPiece): string {
  const varName =
    piece === 'hihat_closed' || piece === 'hihat_open'
      ? '--piece-hihat'
      : piece === 'tom_high'
        ? '--piece-tom1'
        : piece === 'tom_mid'
          ? '--piece-tom2'
          : piece === 'tom_floor'
            ? '--piece-floortom'
            : `--piece-${piece}`
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#fff'
}

/** PracticeCanvas.tsx의 formatMmSs와 같은 포맷(분:초, 초는 2자리) — 이
 * 화면도 음원이 몇 시간씩 가지 않아 시간 단위는 범위 밖. */
function formatMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const PX_PER_GRID_UNIT = 24
const ROW_HEIGHT = 36
const NOTE_SIZE = 16
// 그리드가 가로로 스크롤돼도 행 레이블(HH/SN/KK 등)이 항상 보여야 한다 — 악보를
// 못 읽는 사용자가 의지하는 유일한 행 식별 수단이라, 스크롤로 사라지면 어느 행을
// 편집 중인지 알 수 없게 된다(수동 QA 중 발견: 레이블이 음표와 같은 스크롤 영역에
// absolute로 떠 있어 오른쪽으로 스크롤하면 전부 사라졌었음). 레이블 전용 고정
// 거터를 따로 두고 음표 타임라인은 그 오른쪽부터 시작하게 분리한다.
const ROW_LABEL_WIDTH = 64
// 재생 위치를 스크롤로 맞출 때, 그 위치를 화면 맨 왼쪽(레이블 바로 옆)에 딱
// 붙이지 않고 약간 더 보이게 두는 여유 폭 — 마운트 시 1회 스크롤(아래
// initialPositionTicks effect)과 재생 중 자동 추적(T3-75, startRaf) 둘 다
// 같은 값을 써서 "재생 위치가 화면의 같은 자리에 있다"는 인상을 유지한다.
const PLAYHEAD_SCROLL_LEAD_PX = 80

// PracticeCanvas.tsx의 같은 상수와 같은 값 — 원곡 음원(HTMLMediaElement)이
// Tone.js의 Web Audio 클록만큼 정밀하지 않아 생기는 오차를 저빈도로
// 바로잡는다(T3-3, work/T3-3/plan.md §5).
const TRACK_RESYNC_INTERVAL_MS = 750
const TRACK_RESYNC_THRESHOLD_SECONDS = 0.1

export function EditorScreen({
  song,
  initialScore,
  onSaved,
  onCancel,
  initialPositionTicks,
  onBackToPractice,
}: EditorScreenProps) {
  const [history, setHistory] = useState<EditHistory<EditorState>>(() =>
    createHistory(toEditorState(initialScore)),
  )
  const [gridUnit, setGridUnit] = useState<GridUnit>('8n')
  // REQ-12 "여러 노트 선택 후 RLRL/LRLR 교대 일괄 적용" — 단일 선택(이동·셈여림·
  // 삭제·손 1개 지정용)은 size===1일 때만 의미를 갖고, 다중 선택(size>=2)은
  // 교대 일괄 적용에만 쓴다(work/T2-7/plan.md §설계 2, 범위 확장 안 함).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const nextIdRef = useRef(initialScore.notes.length)

  // 2026-10-29(의뢰인 요청 — "생성된 노트를 드래그 해서 옮길수도 없다보니까
  // 편집이 굉장히 어렵던데") — 노트를 마우스로 눌러 가로(시간축)로 드래그해
  // 옮길 수 있게 한다. 세로(행/피스) 이동은 기존 화살표 위/아래 키로도 이미
  // 가능해(moveSelected) 드래그는 가로 이동만으로 범위를 좁힌다 — 그래야
  // 드래그 중 미리보기(dragPreview)가 "자기 행 안에서만 위치가 바뀐다"는
  // 단순한 가정으로 렌더링될 수 있다(행이 바뀌면 다른 행의 필터된 목록으로
  // 옮겨 그려야 해서 훨씬 복잡해짐).
  const [dragPreview, setDragPreview] = useState<{ noteId: number; tick: number } | null>(null)
  const dragPreviewRef = useRef<{ noteId: number; tick: number } | null>(null)
  // Codex 모드A 지적(반영) — 드래그가 진행 중인 동안 또 다른 mousedown으로
  // 두 번째 드래그가 겹쳐 시작되는 걸 막는다(둘 다 같은 dragPreviewRef를
  // 써서 서로 덮어쓰는 문제 방지 — handleNoteMouseDown 코멘트 참고).
  const activeDragRef = useRef(false)
  // Codex 모드A 지적(필수, 반영) — mousedown이 노트에서 시작했는데 mouseup이
  // (드래그로 옮겨서) 노트 밖 — 즉 행 배경 — 에서 끝나면, 브라우저가 그 뒤에
  // 합성하는 click 이벤트는 mousedown·mouseup 타깃의 가장 가까운 공통 조상
  // (노트의 부모인 행 자체!)에서 발생한다(UI Events 스펙) — 그러면 행의
  // onClick(handleRowClick)이 그 자리에 새 노트를 또 만들어버린다. 드래그가
  // 있었으면 그 뒤에 올 수 있는 단 한 번의 click만 소비해 무시한다.
  const justDraggedRef = useRef(false)

  const state = history.present
  const { meta, ppq } = state

  // 2026-10-29(의뢰인 요청) — "저장버튼은 실제 변경하지 않았을 땐 비활성화
  // 했다가 변경값이 있을때만 저장버튼 활성화". undo/redo는 history 배열 안의
  // 기존 객체 참조를 그대로 옮길 뿐 새로 만들지 않는다(editHistory.ts) —
  // 그래서 "저장된 시점의 state 객체 참조"와 지금 참조를 비교하기만 해도
  // 정확히 "그때 그 상태로 되돌아왔는지"까지 판정된다(값 비교 불필요,
  // undo로 저장 시점까지 돌아오면 자동으로 dirty=false가 됨).
  const lastSavedStateRef = useRef(state)
  const isDirty = state !== lastSavedStateRef.current

  // Codex 모드A 2차 지적(필수, 반영) — 저장 요청이 오가는 동안에도 편집이
  // 막혀있지 않아서, handleSave()가 캡처한 state로 PUT을 보내는 사이
  // 사용자가 노트를 더 바꾸면 그 추가 편집은 서버에 저장되지 않은 채
  // onSaved()가 호출돼 화면을 떠나버릴 수 있었다(조용한 데이터 유실). 모든
  // 편집 경로(노트 추가·이동·삭제·손 지정·박자표 등)가 결국 이
  // 함수 하나를 거치므로, 여기 한 곳만 막으면 저장 중엔 전부 막힌다.
  // (2026-10-29부터 BPM은 이 목록에서 빠졌다 — playbackBpm은 commit()을
  // 거치지 않는 별도 state라 meta.bpm은 이제 어떤 경로로도 안 바뀐다.)
  function commit(next: EditorState) {
    if (isSaving) return
    setHistory((h) => pushHistory(h, next))
  }

  const totalBars = useMemo(() => {
    const lastTick = Math.max(0, ...state.notes.map((n) => n.tick))
    return barIndexForTick(lastTick, meta.timeSignature, ppq) + 1 + 2 // 여유 2마디
  }, [state.notes, meta.timeSignature, ppq])

  const unitTicks = ticksPerGridUnit(gridUnit, ppq)
  // 2026-10-30(T3-79, 의뢰인 요청 — "16격자인데 1/4씩 움직이는거 같다,
  // 어느 격자에서든 키보드 이동 최소 단위를 1/16으로 해달라") — 화살표
  // 이동은 지금까지 화면에 보이는 "격자"(unitTicks, 4분/8분/16분/셋잇단
  // 중 선택)와 같은 간격으로 움직였다. 격자(보기용 확대 배율·스냅
  // 허용오차)와 화살표 이동 간격을 분리한다.
  //
  // T3-79 1차 구현은 "16분음표 한 칸"(ppq/4)으로 고정했는데, 의뢰인이
  // 재지적 — "여전히 1/4박씩 움직이는거 같다"(의뢰인이 말하는 "1/16"은
  // 음악 용어의 16분음표(온음표의 1/16=한 박의 1/4)가 아니라, **"한 박을
  // 16칸으로 쪼갠 것"**을 뜻했음. 확인 질문 결과 "지금 간격의 절반, 한
  // 박에 8칸"으로 확정 — ppq/8(음악 용어로는 32분음표 한 칸)로 수정.
  const keyboardNudgeTicks = ppq / 8
  const barTicks = ticksPerBar(meta.timeSignature, ppq)
  const totalTicks = totalBars * barTicks
  const gridWidthPx = ROW_LABEL_WIDTH + (totalTicks / unitTicks) * PX_PER_GRID_UNIT

  function tickToPx(tick: number): number {
    return ROW_LABEL_WIDTH + (tick / unitTicks) * PX_PER_GRID_UNIT
  }

  // 2026-10-29(의뢰인 요청 — "sn와 mt와 같은 위치에 노트를 찍고싶었는데
  // 원하는 위치에 노트는 찍을 수 없었다... 드래그로 옮겨서 위치라도
  // 맞추려 했지만 그럴 수 없었다") — 당시 클릭·드래그의 스냅 계산 자체
  // (아래 pxToTick/handleNoteMouseDown의 mousemove 처리 — 그땐 격자에
  // 스냅했음, 지금은 자유 배치로 바뀜)는 다시 확인해도 틀린 데가 없었다.
  // 그 시점의 실제 원인은 **격자선이 화면에 전혀 안 그려져 있어서**
  // (`EDITOR_ROWS.map()`이 만드는 각 행은 그냥 단색 배경일 뿐 세로선이
  // 없음) — 사용자가 어디를 클릭해야 어느 틱에 스냅될지, 기존 노트와
  // 같은 세로줄인지 눈으로 전혀 확인할 수 없었던 것(캡처 화면으로 직접
  // 확인 — 점들만 떠 있고 세로 기준선이 아예 안 보임). 세로 격자선(지금
  // "격자" 선택 단위마다 1개)과 마디 경계선(더 또렷하게)을 그려 추가한다.
  const gridLineTicks = useMemo(() => {
    const ticks: number[] = []
    for (let t = 0; t <= totalTicks; t += unitTicks) ticks.push(t)
    return ticks
  }, [totalTicks, unitTicks])

  const barLineTicks = useMemo(() => {
    const ticks: number[] = []
    for (let t = 0; t <= totalTicks; t += barTicks) ticks.push(t)
    return ticks
  }, [totalTicks, barTicks])

  // 2026-10-29(의뢰인 재지적 — "실선 사이가 한마디잖아. 그럼 그 안에
  // 덜선명한 선 한줄이 얼만큼의 박자인지도 잘 모르겠어") — 마디 경계선
  // (더 또렷)과 격자 단위 선(옅음) 둘뿐이라, 격자를 8분·16분 등으로
  // 세분화하면 "박"(4분음표) 자리가 어느 옅은 선인지 구분할 길이 없었다.
  // 박 경계마다 중간 밝기 선 + 몇 박째인지 숫자를 추가로 그려 "선 하나가
  // 몇 박 간격인지"를 格자 자체에서 바로 읽을 수 있게 한다. ppq가 바로
  // "4분음표(1박) 1개의 틱 수"라는 정의 그 자체라(audio/timing.ts의
  // ticksPerBar = beatsPerBar(ts,4) × ppq, beatsPerBar(ts,4) × ppq ÷
  // beatsPerBar(ts,4) = ppq로 약분됨) 박 간격은 박자표와 무관하게 항상
  // ppq틱 — 별도 계산 없이 그대로 쓴다.
  const beatTicks = ppq
  const beatLines = useMemo(() => {
    const lines: { tick: number; beatInBar: number; isBarStart: boolean }[] = []
    for (let t = 0; t <= totalTicks; t += beatTicks) {
      const beatInBar = Math.round((t % barTicks) / beatTicks) + 1
      lines.push({ tick: t, beatInBar, isBarStart: t % barTicks === 0 })
    }
    return lines
  }, [totalTicks, beatTicks, barTicks])

  // 2026-10-29(의뢰인 재지적, 스크린샷 첨부) — "원하는(빨간) 위치 대신 그
  // 왼쪽 격자의 노트가 찍힌다. 드래그해도 다음 격자로 넘어가 버린다" —
  // 실제 브라우저로 클릭 좌표별 결과 틱을 하나하나 찍어 확인한 결과,
  // 계산 자체(반올림)는 틀리지 않았다 — 격자선에서 정확히 ±12px(한 칸의
  // 절반)까지는 그 선으로, 넘어가면 다음 선으로 반올림되는 교과서적인
  // "가장 가까운 선" 스냅이었다. 문제는 그게 사람이 기대하는 방식이
  // 아니었다는 것 — 눈에 보이는 "칸" 안 아무 데나 클릭하면 그 칸으로
  // 들어가길 기대하는데(칸의 오른쪽 절반을 클릭하면 반올림 때문에 다음
  // 칸 선으로 넘어가 버림), 이건 대부분의 DAW/피아노롤 편집기가 쓰는
  // "칸 기준"(바닥 함수) 스냅과 다르다 — 그래서 바닥 함수로 바꿨었는데,
  // 의뢰인이 이후에도 재차 "격자 선에만 찍힌다"고 재지적(스크린샷 — 빨간
  // 지점이 격자선이 아닌 자리였음)하면서, 직접 확인한 결과 **격자에 전혀
  // 안 맞고 클릭·드래그한 정확한 픽셀 위치에 그대로 놓이길** 원한다고
  // 확정(2026-10-29, 대화로 확인) — 스냅 자체를 끈다. 격자선은 그대로
  // 두되(보기용 기준선 — 몇 분음표 간격인지 눈대중하는 용도) 더는 클릭·
  // 드래그 결과를 그 선에 붙이지 않는다. (snapTick()/floorSnapTick 둘 다
  // 더는 안 쓰여 지운다 — 화살표 키 이동(moveSelected)은 격자 단위로
  // "몇 칸 이동" 개념이라 여전히 격자에 맞는 게 자연스러워 그대로 둠,
  // grid.ts의 snapTick()은 그쪽에서 계속 씀.)
  function pxToTick(px: number): number {
    return Math.max(0, Math.round(((px - ROW_LABEL_WIDTH) / PX_PER_GRID_UNIT) * unitTicks))
  }

  // --- 재생(2026-10-29 의뢰인 요청) ---------------------------------------
  // --- 재생 속도(2026-10-29 의뢰인 요청 — "편집기에서 bpm을 건들 수 없었으면
  // 좋겠어... 조절만할 수 있게하고 그게 원본값에 영향을 주지않도록") ---
  // meta.bpm(업로드 시점 원곡 BPM)은 이제 이 화면에서 아예 편집할 수 없다 —
  // PracticeCanvas.tsx의 playbackBpm(REQ-04, 원곡 대비 50~150%)과 완전히 같은
  // 패턴으로, 저장되지 않는 "연습 속도"만 조절한다. handleSave()는 여전히
  // state.meta를 그대로 저장하므로 playbackBpm은 commit()/toDrumScore()를
  // 전혀 거치지 않는다 — 라이브러리에 적힌 BPM(song.original_bpm)은 이제
  // 어떤 경로로도 바뀔 일이 없다.
  const minBpm = Math.max(1, Math.round(meta.bpm * 0.5))
  const maxBpm = Math.round(meta.bpm * 1.5)
  const [playbackBpm, setPlaybackBpm] = useState(meta.bpm)
  // 아래 rAF 루프·handlePlay()의 await 이후 구간이 리렌더 없이 최신 값을
  // 읽어야 해서 ref로도 들고 있는다(stateRef와 같은 이유, PracticeCanvas.tsx의
  // playbackBpmRef와 동일 패턴). 재생 중엔 이 값이 바뀌지 않도록 아래 입력들을
  // disabled={isPlaying}로 잠가둔다(PracticeCanvas.tsx와 같은 이유 — 이미
  // 스케줄된 Transport에 재생 중 반영이 안 돼 혼란을 줄 수 있음).
  const playbackBpmRef = useRef(playbackBpm)
  useEffect(() => {
    playbackBpmRef.current = playbackBpm
  }, [playbackBpm])

  function clampBpm(value: number): number {
    if (Number.isNaN(value)) return playbackBpm
    return Math.min(maxBpm, Math.max(minBpm, Math.round(value)))
  }

  // PracticeCanvas.tsx의 같은 BPM 입력과 같은 이유(§bpmFieldValue 주석 참고) —
  // 포커스 중엔 자유 입력을 받는 draft로, 포커스가 아닐 땐 playbackBpm에서
  // 바로 파생시켜 슬라이더로 바뀐 값도 항상 반영되게 한다.
  const [isEditingBpm, setIsEditingBpm] = useState(false)
  const [bpmDraft, setBpmDraft] = useState('')
  const bpmFieldValue = isEditingBpm ? bpmDraft : String(playbackBpm)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSeconds, setCurrentSeconds] = useState(() =>
    ticksToSeconds(initialPositionTicks ?? 0, ppq, playbackBpm),
  )
  const [cursorTicks, setCursorTicks] = useState(initialPositionTicks ?? 0)
  const cursorTicksRef = useRef(cursorTicks)
  useEffect(() => {
    cursorTicksRef.current = cursorTicks
  }, [cursorTicks])
  // 2026-10-29(T3-76, 모드A 2차 지적 C-002 반영) — handleNoteMouseDown의
  // handleMouseUp은 mousedown 시점에 만들어진 클로저라, 그 안에서 isPlaying을
  // 그냥 읽으면 드래그 시작 당시(항상 false — 재생 중엔 노트 버튼 자체가
  // disabled라 드래그가 시작될 수 없음)의 값에 멈춰있다. 드래그 도중(마우스
  // 버튼을 누른 채) 재생이 시작되는 극단적 경우(키보드 단축키 등)에도
  // mouseup 시점의 "지금" 값을 읽어야 커밋을 막을 수 있어, ref로 최신값을
  // 따로 든다(cursorTicksRef와 같은 패턴).
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  // 자체 재검토(Codex 4차 승인 뒤, 5차는 Codex 사용량 한도로 실행 못 함 —
  // 아래 "남은 작업" 참고) — handlePlay()는 createDrumVoices() 비동기 대기
  // 중(특히 이번 세션 첫 재생 때, 샘플 로딩 동안) state 클로저를 그대로 쓰면,
  // 그 사이 사용자가 노트를 편집해도 반영 안 된 옛 상태로 재생될 수 있다.
  // ref로 최신값을 따로 들고 있다가 await 이후엔 이 ref를 읽는다
  // (cursorTicksRef와 같은 패턴).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const [mixerState, setMixerStateRaw] = useState<MixerState>(defaultMixerState())
  const mixerStateRef = useRef(mixerState)
  useEffect(() => {
    mixerStateRef.current = mixerState
  }, [mixerState])

  // Codex 모드A 지적(Medium, 반영) — GET 응답이 늦게 오는 사이 사용자가
  // 먼저 슬라이더를 움직이면, 응답이 도착했을 때 그 조작값을 통째로
  // 덮어써 잃어버릴 수 있었다(이미 예약된 저장 타이머가 그 뒤 서버 옛
  // 값을 다시 저장해버릴 위험까지). PracticeCanvas.tsx의
  // userEditedChannelsRef와 같은 원칙을 가볍게 적용 — 사용자가 한 번이라도
  // 건드리면 그 뒤로는 GET 응답을 더 이상 반영하지 않는다(이 화면은 채널
  // 2개뿐이라 채널별 세밀한 병합까진 필요 없다고 판단).
  const mixerEditedRef = useRef(false)

  // 2026-10-29(의뢰인 요청) — "연주화면에서 가상드럼을 켜고있었더라도 (드럼
  // 원곡으로) 소리를 맞춰줘. 가상드럼소리가 80이었으면 편집페이지에선
  // 원곡드럼소리가 80으로". 계정 전체 공유 믹서 설정(위 주석)에는 손대지
  // 않는다(의뢰인 확인 — "편집 중에만 적용, 저장 안 함": 연습 화면으로
  // 돌아가면 가상드럼 80이 그대로 들려야 함) — 이 화면 안에서만 "드럼원곡"
  // 슬라이더의 표시값·실제 재생 게인을 아래로 바꿔 보여주는 세션 전용
  // 오버레이. 드럼원곡·가상드럼 둘 중 하나라도 사용자가 직접 슬라이더를
  // 움직이면 해제(그 뒤로는 평소처럼 둘 다 독립적으로 동작·저장됨).
  // 2026-10-29 재지적("신스드럼은 소리0으로 고정해달라고 했는데 반영이
  // 안된거 같다") — 처음엔 "원곡 드럼이 이미 0일 때만" 켜도록 조건을
  // 좁혔었는데, 테스트를 거치며 계정에 저장된 원곡 드럼 값이 정확히 0이
  // 아닌 채로 남아있을 수 있어(예: 이전 세션에서 슬라이더를 만져 저장된
  // 경우) 그 조건 때문에 전혀 안 켜지는 일이 있었다 — 의뢰인 요청은
  // 처음부터 조건 없는 규칙이었다("가상드럼을 켜고있었더라도"가 바로 그
  // 뜻) — 원곡 드럼 트랙 자체만 있으면(hasStemDrumsTrack) 무조건 켠다.
  const [drumOverrideActive, setDrumOverrideActive] = useState(false)
  const [drumOverrideVolume, setDrumOverrideVolume] = useState(0)

  const mixerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function updateChannel(key: ChannelKey, patch: Partial<ChannelState>) {
    mixerEditedRef.current = true
    setMixerStateRaw((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } }
      if (mixerSaveTimerRef.current) clearTimeout(mixerSaveTimerRef.current)
      mixerSaveTimerRef.current = setTimeout(() => void saveMixerSetting(next), 500)
      return next
    })
  }

  // 2026-10-29(의뢰인 요청) — "편집에서도 연습화면의 필터처럼, 드럼원곡·음악·
  // 가상드럼·메트로놈 4개만". PracticeCanvas.tsx와 완전히 같은 로직
  // (mixer.ts의 setMusicVolume — stem_bass/vocals/other 3채널을 항상 같은
  // 값으로 묶어 저장) 재사용 — 저장되는 데이터 구조·effectiveGain() 전부
  // 그대로, 두 화면이 보여주는 "채널 개수"만 통일된다.
  function updateMusicVolume(volume: number) {
    mixerEditedRef.current = true
    setMixerStateRaw((prev) => {
      const next = setMusicVolume(prev, volume)
      if (mixerSaveTimerRef.current) clearTimeout(mixerSaveTimerRef.current)
      mixerSaveTimerRef.current = setTimeout(() => void saveMixerSetting(next), 500)
      return next
    })
  }
  useEffect(() => {
    return () => {
      if (mixerSaveTimerRef.current) {
        clearTimeout(mixerSaveTimerRef.current)
        void saveMixerSetting(mixerStateRef.current)
      }
    }
  }, [])

  // 2026-10-29(의뢰인 요청 — "원곡을 듣고 고쳐야지") — 원곡 분리 음원(스템)
  // 로딩. PracticeCanvas.tsx의 같은 효과와 같은 가드(스템 종류 1개 이상 —
  // T3-72부터 audioOffsetMs 값과 무관, 아래 canUseAudioTracks 참고)를
  // 쓰되, 이 화면은 song이 바뀌지 않아(마운트 1회) "곡 전환" 관련
  // 복잡도는 없다.
  // useMemo로 참조를 안정시킴 — song.available_audio_kinds는 이 화면에서
  // 안 바뀌지만, .filter()가 매 렌더 새 배열을 만들면 아래 effect들의
  // 의존성 배열에 넣었을 때 매번 다시 돌게 된다.
  const stemKinds = useMemo(
    () => song.available_audio_kinds.filter((k) => k !== 'original') as ChannelKey[],
    [song.available_audio_kinds],
  )
  // 2026-10-29(T3-72, REQ-02, Q-43) — audioOffsetMs===0 가드를 뺐다(PracticeCanvas.tsx와
  // 같은 이유 — 이제 그 값이 0이 아니어도 아래 audioTrackPositionSeconds
  // 호출부가 올바르게 반영한다).
  const canUseAudioTracks = stemKinds.length > 0

  // 계정 전체 공유 믹서(의뢰인 요청 "믹서 동일하게 사용") — practice 화면과
  // 같은 `/auth/me/mixer-setting`을 그대로 쓴다. practice의 채널별 편집-추적·
  // 저장 직렬화 같은 정교한 경합 방지(PracticeCanvas.tsx 참고)는 이 화면
  // 세션이 짧고 단순해 생략 — 단순 디바운스 저장으로 충분하다고 판단.
  // (stemKinds·canUseAudioTracks가 선언된 바로 다음에 둔다 — 아래 드럼원곡
  // 오버레이 계산이 그 값들을 참조한다.)
  useEffect(() => {
    let cancelled = false
    fetchMixerSetting()
      .then(({ volumes }) => {
        if (cancelled || !volumes || mixerEditedRef.current) return
        const merged = defaultMixerState()
        for (const key of CHANNEL_KEYS) if (volumes[key]) merged[key] = volumes[key]
        setMixerStateRaw(merged)
        // "가상드럼을 켜고있었더라도" 무조건 켠다 — 연습 화면에서 원곡 드럼이
        // 이미 어떤 값으로 설정돼 있었든(이전 세션에서 슬라이더를 만져
        // 저장된 값 등) 상관없이, 편집 화면에서는 항상 신스 드럼의 지금
        // 음량을 "드럼원곡" 쪽으로 빌려와 그 소리로 대체한다. 이 곡에 실제로
        // 쓸 수 있는 원곡 드럼 트랙이 없으면(이 곡은 음원 분리가 안 됐거나
        // 드럼만 빠져있는 경우)만 켜지 않는다 — 대체할 소리가 없는데 신스만
        // 무음 처리하면 편집 중 드럼이 완전히 안 들리는 회귀가 생긴다.
        const hasStemDrumsTrack = canUseAudioTracks && stemKinds.includes('stem_drums')
        if (hasStemDrumsTrack) {
          setDrumOverrideActive(true)
          setDrumOverrideVolume(merged.synth_drums.volume)
        }
      })
      .catch(() => {
        // 못 불러와도 기본값으로 계속 — practice 화면 로드 실패와 같은 원칙.
      })
    return () => {
      cancelled = true
    }
    // stemKinds·canUseAudioTracks 둘 다 이 화면 안에서 song이 안 바뀌어
    // 사실상 고정값이라(위 stemKinds useMemo 주석과 같은 근거), 의존성
    // 배열에 넣어도 정직하게(eslint-disable 없이) 마운트 1회만 실행된다.
  }, [canUseAudioTracks, stemKinds])

  const audioTrackPoolRef = useRef<AudioTrackPool | null>(null)
  const [audioTracksLoading, setAudioTracksLoading] = useState(canUseAudioTracks)
  const [audioTracksAvailable, setAudioTracksAvailable] = useState(false)
  useEffect(() => {
    if (!canUseAudioTracks) return
    let cancelled = false
    createAudioTrackPool(stemKinds.map((kind) => ({ kind, url: songAudioUrl(song.id, kind) })))
      .then((pool) => {
        if (cancelled) {
          pool.destroy()
          return
        }
        audioTrackPoolRef.current = pool
        setAudioTracksAvailable(true)
        setAudioTracksLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        // PracticeCanvas.tsx의 같은 상황과 같은 폴백 — 조용히 포기하고
        // 신스 드럼만 재생되는 경로로 넘어간다(원곡 음원 없이도 편집 자체는
        // 계속할 수 있어야 함).
        // eslint-disable-next-line no-console
        console.error('편집 화면 원곡 음원 로딩 실패 — 신스 드럼만 재생됩니다', err)
        setAudioTracksLoading(false)
      })
    return () => {
      cancelled = true
      audioTrackPoolRef.current?.destroy()
      audioTrackPoolRef.current = null
    }
    // song.id·canUseAudioTracks·stemKinds 전부 이 화면 안에서 안 바뀌는
    // 값이라(song이 교체되지 않음, stemKinds는 위에서 useMemo로 고정) 의존성
    // 배열에 넣어도 사실상 마운트 1회만 실행된다 — eslint-disable 없이도
    // 정직하게 규칙을 지킬 수 있어 그렇게 둔다.
  }, [canUseAudioTracks, song.id, stemKinds])

  // 신스 드럼 음색(샘플 로딩)은 한 번만 만들어 재생/일시정지를 반복할 때마다
  // 재사용 — 매번 다시 만들면 비용도 크고 소리가 잠깐 끊길 수 있다.
  const voicesSessionRef = useRef<{
    voices: DrumVoiceMap
    synthGain: Tone.Gain
    limiter: Tone.Limiter
  } | null>(null)
  // 재생 핸들·메트로놈·트랙 플레이어는 재생을 누를 때마다 새로 만든다(편집
  // 중 노트·BPM·박자표가 바뀔 수 있어 "다시 재생"은 항상 최신 state를
  // 반영해야 함).
  const playbackSessionRef = useRef<{
    handle: PlaybackHandle
    metronome: Metronome
    tracks: TrackPlayer | null
  } | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const lastRafUpdateRef = useRef(0)
  const lastTrackResyncAtRef = useRef(0)
  // 2026-10-29(의뢰인 요청) — 재생 위치선을 아래 10회/초 state 갱신보다 더
  // 자주(매 프레임) 움직이기 위한 DOM 직접 접근 — PracticeCanvas.tsx의
  // progressBarRef와 같은 이유.
  const playheadRef = useRef<HTMLDivElement | null>(null)

  // drumOverrideActive는 "마운트 시점 믹서 값으로 봐서 켜도 되는 상황"일
  // 뿐 — 실제로 원곡 드럼을 대체 재생할 수 있으려면 그 트랙이 진짜로
  // 로딩까지 끝나 있어야 한다(audioTracksAvailable). 이 둘을 안 묶으면,
  // 트랙이 아직 로딩 중이거나 결국 로딩에 실패했을 때도 신스 드럼만
  // 무음 처리돼 드럼이 완전히 안 들리는 회귀가 생긴다.
  const drumOverrideEngaged = drumOverrideActive && audioTracksAvailable

  // 재생 중 믹서가 바뀌면 즉시 반영(practice 화면과 같은 원칙). 드럼원곡
  // 오버레이가 적용 중이면 신스 드럼은 실제로는 무음 처리하고(저장된
  // synth_drums 값은 그대로 둔 채), 원곡 드럼은 그 빌려온 음량으로 —
  // 실제로 들리는 소리만 바뀔 뿐 저장되는 mixerState는 전혀 안 건드린다.
  useEffect(() => {
    const synthGainValue = drumOverrideEngaged ? 0 : effectiveGain(mixerState.synth_drums)
    const voicesSession = voicesSessionRef.current
    if (voicesSession) voicesSession.synthGain.gain.value = synthGainValue
    const session = playbackSessionRef.current
    if (session) {
      session.metronome.setVolume(metronomeGainToDb(effectiveGain(mixerState.metronome)))
      if (session.tracks) {
        for (const key of stemKinds) {
          const gain =
            key === 'stem_drums' && drumOverrideEngaged
              ? drumOverrideVolume
              : effectiveGain(mixerState[key])
          session.tracks.setChannelGain(key, gain)
        }
      }
    }
  }, [mixerState, stemKinds, drumOverrideEngaged, drumOverrideVolume])

  function stopRaf() {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
  }

  function startRaf() {
    const clock = getMasterClock()
    lastRafUpdateRef.current = 0
    lastTrackResyncAtRef.current = 0
    function loop(ts: number) {
      // 60fps 그대로 setState하면 노트가 많을 때 매 프레임 전체 그리드이
      // 다시 렌더돼 버벅일 수 있어, 시간 표시·선택/편집 로직이 쓰는
      // cursorTicks state는 초당 약 10회로만 갱신한다. 2026-10-29(의뢰인
      // 지적 "재생 위치선이 끊겨 보여서 눈이 피로하다") — 위치선 자체는
      // 아래에서 PracticeCanvas.tsx의 progressBarRef와 같은 방식(ref에
      // style.left 직접 쓰기, state·리렌더 없음)으로 매 프레임 갱신해
      // 기술적 한계가 아니라 그려지는 방식만 바꿔 해결했다.
      const seconds = clock.getPositionSeconds()
      const playheadPx = tickToPx(secondsToTicks(seconds))
      if (playheadRef.current) {
        playheadRef.current.style.left = `${playheadPx}px`
      }
      // 2026-10-29(T3-75, 의뢰인 요청) — 연습 화면(PracticeCanvas.tsx)은
      // "지금"이 항상 화면의 고정된 자리에 있고 그 주변만 보여주는데, 편집
      // 화면은 재생 중에도 보던 자리가 그대로라 재생 위치선만 화면 위를
      // 가로질러 지나갔다(의뢰인이 두 화면을 비교하며 지적). 마운트 시
      // 1회만 스크롤하던 위 initialPositionTicks effect와 똑같은 식을
      // 매 프레임 재적용해, 재생 중엔 재생 위치가 항상 화면의 같은 자리
      // (레이블 바로 다음 + PLAYHEAD_SCROLL_LEAD_PX)에 있도록 스크롤을
      // 같이 따라가게 한다. state를 안 거치고 ref로 직접 scrollLeft만
      // 바꾸므로 리렌더가 없다(위 playheadRef와 같은 이유). 정지·일시정지
      // 중에는 이 루프 자체가 안 돌아서(stopRaf) 사용자가 보던 자리를
      // 멋대로 옮기지 않는다 — 기존 "편집 중엔 스크롤 안 건드림" 원칙 유지.
      if (gridScrollRef.current) {
        gridScrollRef.current.scrollLeft = Math.max(
          0,
          playheadPx - ROW_LABEL_WIDTH - PLAYHEAD_SCROLL_LEAD_PX,
        )
      }
      if (ts - lastRafUpdateRef.current > 100) {
        lastRafUpdateRef.current = ts
        setCurrentSeconds(seconds)
        setCursorTicks(secondsToTicks(seconds))
      }
      // Codex 지적(필수, 반영) — 원곡 음원(HTMLMediaElement)은 Tone.js의
      // Web Audio 클록만큼 정밀하게 시작되지 않는다(직접 측정 확인 —
      // 아래 "자체 재검토" 참고). PracticeCanvas.tsx와 같은 저빈도
      // 리싱크(TRACK_RESYNC_INTERVAL_MS마다 확인)로 시작 시점 오차뿐
      // 아니라 재생 중 누적될 수 있는 드리프트까지 계속 바로잡는다.
      const session = playbackSessionRef.current
      if (session?.tracks && ts - lastTrackResyncAtRef.current > TRACK_RESYNC_INTERVAL_MS) {
        lastTrackResyncAtRef.current = ts
        // meta.bpm은 이제 이 화면에서 편집할 수 없어(위 playbackBpm 주석 참고)
        // 항상 "원곡 BPM"이다 — PracticeCanvas.tsx의 같은 리싱크 계산과 동일.
        const playbackRate = playbackBpmRef.current / stateRef.current.meta.bpm
        // T3-72(Q-43) — 네 번째 인자(오프셋)만 추가, 두 번째 인자가 계속
        // 리터럴 0인 이유는 아래 handlePlay()의 같은 호출부 코멘트 참고.
        const expectedSongPositionSeconds = audioTrackPositionSeconds(
          seconds,
          0,
          playbackRate,
          stateRef.current.audioOffsetMs / 1000,
        )
        session.tracks.resync(expectedSongPositionSeconds, TRACK_RESYNC_THRESHOLD_SECONDS)
      }
      rafIdRef.current = requestAnimationFrame(loop)
    }
    rafIdRef.current = requestAnimationFrame(loop)
  }

  function secondsToTicks(seconds: number): number {
    return Math.max(0, Math.round(seconds * (playbackBpm / 60) * ppq))
  }

  // Codex 모드A 지적(필수, 반영) — createDrumVoices()가 비동기라 (1) 재생
  // 버튼을 빠르게 두 번 누르면 voicesSessionRef가 아직 null인 채로 생성이
  // 두 번 겹쳐 시작돼 하나가 유실(dispose 안 됨, 메모리 누수)되고, (2) 생성이
  // 끝나기 전에 화면을 떠나면(언마운트) 뒤늦게 끝난 생성 결과가 아무도
  // 정리 안 한 채 남거나, 심하면 이미 사라진 컴포넌트를 위해 재생을 시작할
  // 수 있었다. 재진입 가드(isStartingVoicesRef)와 언마운트 플래그
  // (isMountedRef)로 막고, 샘플 로딩 실패도 처리한다.
  const isStartingVoicesRef = useRef(false)
  const isMountedRef = useRef(true)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  async function ensureVoicesSession(): Promise<{
    voices: DrumVoiceMap
    synthGain: Tone.Gain
    limiter: Tone.Limiter
  } | null> {
    if (voicesSessionRef.current) return voicesSessionRef.current
    if (isStartingVoicesRef.current) return null // 이미 다른 호출이 생성 중
    isStartingVoicesRef.current = true
    // Codex 모드A 2차 지적(권장, 반영) — Limiter/Gain 생성·connect 자체가
    // 던질 가능성까지 같은 catch가 잡도록 try 블록 안으로 옮긴다(원래는
    // try 밖이라 여기서 던지면 아무도 안 잡는 처리되지 않은 예외가 됐음).
    let limiter: Tone.Limiter | undefined
    let synthGain: Tone.Gain | undefined
    try {
      limiter = new Tone.Limiter(-1).connect(Tone.getDestination())
      // Codex 모드A 지적(필수, 반영) — 드럼원곡 오버레이(위 drumOverrideEngaged)가
      // 이미 켜져 있는 상태에서 처음 재생을 누르면, 아래 믹서-재생 동기화
      // effect는 voicesSessionRef(ref라 effect 재실행을 안 유발)가 막 채워진
      // 것만으로는 다시 안 돌아 생성 시점 게인이 그대로 남는다 — 생성 시점에
      // 바로 오버레이를 반영해야 "처음 재생"부터 신스가 겹쳐 들리지 않는다.
      synthGain = new Tone.Gain(
        drumOverrideEngaged ? 0 : effectiveGain(mixerStateRef.current.synth_drums),
      ).connect(limiter)
      const voices = await createDrumVoices(synthGain)
      if (!isMountedRef.current) {
        // 로딩이 끝나기 전에 화면을 떠남 — 방금 만든 리소스를 그대로 정리.
        disposeDrumVoices(voices)
        synthGain.dispose()
        limiter.dispose()
        return null
      }
      const session = { voices, synthGain, limiter }
      voicesSessionRef.current = session
      return session
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('신스 드럼 음색 로딩 실패', err)
      synthGain?.dispose()
      limiter?.dispose()
      if (isMountedRef.current) setPlaybackError('재생 음색을 불러오지 못했습니다')
      return null
    } finally {
      isStartingVoicesRef.current = false
    }
  }

  async function handlePlay() {
    setPlaybackError(null)
    // 트랙 언락(prime)은 사용자 제스처 체인이 살아있는 지금(동기 호출
    // 시작 지점) 바로 걸어둔다 — PracticeCanvas.tsx의 handlePlay()와 같은
    // 이유(모바일 자동재생 정책, work/T3-16-feedback-6/plan.md). 음색
    // 로딩(ensureVoicesSession)과 동시에 진행되게 await는 나중에.
    const tracks = audioTrackPoolRef.current ? createTrackPlayer(audioTrackPoolRef.current) : null
    const primePromise = tracks?.prime()

    const voicesSession = await ensureVoicesSession()
    if (primePromise) await primePromise
    if (!voicesSession || !isMountedRef.current) return

    // await 이후엔 이 함수가 호출될 당시(클로저)의 state가 아니라 ref로
    // 최신값을 읽는다 — 첫 재생이라 샘플 로딩을 기다리는 사이 사용자가
    // 노트·BPM을 편집했을 수 있다(위 stateRef 코멘트 참고).
    const latestState = stateRef.current
    const latestScore = toDrumScore(latestState)

    playbackSessionRef.current?.handle.stop()
    playbackSessionRef.current?.metronome.dispose()
    const metronome = createMetronome({ timeSignature: latestState.meta.timeSignature })
    metronome.setVolume(metronomeGainToDb(effectiveGain(mixerStateRef.current.metronome)))
    // tracks는 일부러 안 넘긴다 — 파일 맨 위 주석 참고(handleSeek()와 같은
    // "위치부터 옮기고 직접 playFrom()" 패턴을 쓰기 위함).
    const handle = playDrumScore(latestScore, voicesSession.voices, {
      // 편집 중 임의 위치부터 듣는 용도라 카운트인은 불필요(처음부터 들을
      // 땐 0초부터라 어차피 카운트인이 의미 없고, 중간부터면 더더욱).
      countInBars: 0,
      countInVolumeDb: metronomeGainToDb(effectiveGain(mixerStateRef.current.metronome)),
      // 2026-10-29(의뢰인 요청) — 연습 속도(playbackBpm)만큼 노트도 같이
      // 빨라지거나 느려져야 스템과 안 어긋난다(scorePlayer.ts는 이 옵션이
      // 없으면 latestScore.meta.bpm, 즉 원곡 속도로 고정 스케줄해버림).
      playbackBpm: playbackBpmRef.current,
    })
    playbackSessionRef.current = { handle, metronome, tracks }

    const clock = getMasterClock()
    // scorePlayer.ts는 항상 0초부터 스케줄하고 시작한다(count-in 없이도
    // "곡 시작"은 0초) — 재생 시작 직후 바로 지금 커서 위치로 점프한다.
    // 이미 지난 노트의 schedule() 콜백은 그 시각을 넘어서면 자동으로
    // 스킵되는 Tone.js 표준 동작이라(실제 설치된 Transport 소스 기준) 안전.
    // ticksToSeconds도 노트 스케줄과 같은 playbackBpm 기준이어야 위치가 맞다.
    const positionSeconds = ticksToSeconds(
      cursorTicksRef.current,
      latestState.ppq,
      playbackBpmRef.current,
    )
    clock.setPositionSeconds(positionSeconds)
    if (tracks) {
      // "원곡 속도"(meta.bpm, 더는 편집 불가) 대비 "지금 연습 속도"의 비율 —
      // PracticeCanvas.tsx의 playbackRate = playbackBpm/score.meta.bpm과 같은 식.
      // 2026-10-29(T3-72 Codex 모드C 2차 지적 반영 — 이전 주석의 "audioOffsetMs===0
      // 일 때만 tracks가 있어 기준점이 항상 0"이라는 근거는 틀렸다. 진짜
      // 이유는 EditorScreen이 playDrumScore()에 countInBars: 0을 넘겨서다
      // (위 playDrumScore 호출부 참고, audioOffsetMs 값과 무관하게 항상
      // 성립) — computePlaybackSchedule()의 songStartSeconds = barSeconds *
      // countInBars이므로 countInBars=0이면 songStartSeconds는 항상 0.
      const playbackRate = playbackBpmRef.current / latestState.meta.bpm
      tracks.playFrom(
        audioTrackPositionSeconds(positionSeconds, 0, playbackRate, latestState.audioOffsetMs / 1000),
        playbackRate,
      )
    }
    setIsPlaying(true)
    startRaf()
  }

  function handlePause() {
    playbackSessionRef.current?.handle.pause()
    playbackSessionRef.current?.tracks?.pause()
    stopRaf()
    const seconds = getMasterClock().getPositionSeconds()
    setCurrentSeconds(seconds)
    setCursorTicks(secondsToTicks(seconds))
    setIsPlaying(false)
  }

  // 2026-10-29(의뢰인 요청) — "편집할때 음악을 앞으로 뒤로 이동이 안되서
  // 다시듣고싶을 때 어떻게 할 방법이 없다" — PracticeCanvas.tsx의 handleSeek()
  // ±10초 버튼과 같은 패턴. 재생 중이 아닐 때도 눌러서 커서(cursorTicks)만
  // 옮겨둘 수 있게 하면(다음 "재생" 때 그 위치부터 시작) 더 유용하므로,
  // PracticeCanvas.tsx와 달리 isPlaying/isPaused로 막지 않고 항상 활성화.
  function handleSeek(deltaSeconds: number) {
    const current = isPlaying ? getMasterClock().getPositionSeconds() : currentSeconds
    const maxSeconds = ticksToSeconds(totalTicks, ppq, playbackBpm)
    const target = Math.min(maxSeconds, Math.max(0, current + deltaSeconds))
    setCurrentSeconds(target)
    setCursorTicks(secondsToTicks(target))
    if (isPlaying) {
      const clock = getMasterClock()
      clock.setPositionSeconds(target)
      const session = playbackSessionRef.current
      if (session?.tracks) {
        // handlePlay()의 같은 위치 점프 블록과 같은 식 — playbackRate 계산 근거도 동일.
        const playbackRate = playbackBpmRef.current / stateRef.current.meta.bpm
        session.tracks.playFrom(
          audioTrackPositionSeconds(target, 0, playbackRate, stateRef.current.audioOffsetMs / 1000),
          playbackRate,
        )
      }
    }
  }

  // 언마운트 시 오디오 리소스 정리.
  useEffect(() => {
    // Codex 모드A 2차 지적(필수, 반영) — React StrictMode(개발 모드)는
    // 마운트 직후 이 effect를 "실행→정리→다시 실행"으로 한 번 더 돌린다.
    // cleanup에서만 false로 내리고 여기서 다시 true로 안 올리면, 그 뒤
    // 진짜로 화면에 떠 있는 동안에도 isMountedRef가 영원히 false로 남아
    // "재생"을 눌러도 ensureVoicesSession()이 매번 언마운트로 오판해
    // 아무것도 안 하는 채로 조용히 끝나버린다(StrictMode에서만 재현).
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      stopRaf()
      playbackSessionRef.current?.handle.stop()
      playbackSessionRef.current?.metronome.dispose()
      if (voicesSessionRef.current) {
        disposeDrumVoices(voicesSessionRef.current.voices)
        voicesSessionRef.current.synthGain.dispose()
        voicesSessionRef.current.limiter.dispose()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2026-10-29(의뢰인 요청) — "연주페이지에서 편집버튼을 누르면 그때 지금
  // 위치를 파악하고 해당 위치로 이동시켜줘야함". 마운트 시 1회만 — 그
  // 이후(편집 중 재생 등)의 cursorTicks 변화로 다시 스크롤하면 사용자가
  // 보고 있던 자리를 멋대로 옮기게 된다.
  const gridScrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (initialPositionTicks === undefined || !gridScrollRef.current) return
    const targetPx = tickToPx(initialPositionTicks)
    gridScrollRef.current.scrollLeft = Math.max(0, targetPx - ROW_LABEL_WIDTH - PLAYHEAD_SCROLL_LEAD_PX)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRowClick(e: React.MouseEvent<HTMLDivElement>, pieces: readonly DrumPiece[]) {
    // 2026-10-29(T3-76, 의뢰인 요청) — 재생 중엔 그리드가 재생 위치를 따라
    // 계속 스크롤되므로(T3-75), 그 와중에 클릭으로 노트를 추가하면 클릭한
    // 화면 좌표와 실제 가리키는 틱이 어긋나기 쉽다. 노트 버튼 자체도
    // disabled={isPlaying}로 드래그·선택을 막았으니(아래), 새 노트 추가도
    // 같은 이유로 재생 중엔 막는다.
    if (isPlaying) return
    if (justDraggedRef.current) {
      // 방금 끝난 드래그가 노트 밖에서 mouseup해 합성된 click — 위
      // justDraggedRef 코멘트 참고. 새 노트를 만들지 않고 소비만 한다.
      justDraggedRef.current = false
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const relativeX = e.clientX - rect.left + e.currentTarget.scrollLeft
    if (relativeX < ROW_LABEL_WIDTH) return // 고정 레이블 거터 클릭은 무시
    const rawTick = pxToTick(relativeX)
    // 2026-10-30(T3-77, 의뢰인 요청 — "hh랑 mt을 같이 쳐야 하는데 어느
    // 위치에 찍어야 동시에 소리가 나는지 모르겠다") — 클릭으로 뽑은 틱을
    // 그대로 쓰면, 화면을 보고 아무리 정확히 클릭해도 픽셀 단위 오차가 틱
    // 단위로 남아 "같이 치려던" 기존 노트(다른 행)와 실제로는 몇 틱 어긋난
    // 채 저장된다 — 들어보면 미묘하게 안 맞는 원인. 클릭 지점에서 가장
    // 가까운 기존 노트(행 무관)가 지금 격자 한 칸의 절반 이내에 있으면,
    // 그 노트의 "진짜" 틱(절대 격자가 아니라 실제 검출된 값)에 그대로
    // 맞춰 찍는다 — 그래야 "동시에" 치는 게 보장되고, 그 뒤 화살표로
    // 1/16씩 옮기면(아래 moveSelected, 더는 절대 격자로 안 돌아감) 그
    // 실제 기준에서 정확히 상대 이동한다.
    const snapToleranceTicks = unitTicks / 2
    let nearestNote: EditableNote | null = null
    let nearestDist = Infinity
    for (const n of state.notes) {
      const d = Math.abs(n.tick - rawTick)
      if (d < nearestDist) {
        nearestDist = d
        nearestNote = n
      }
    }
    const tick = nearestNote && nearestDist <= snapToleranceTicks ? nearestNote.tick : rawTick
    const id = nextIdRef.current++
    const newNote: EditableNote = {
      _editorId: id,
      tick,
      // 2026-10-29(의뢰인 요청 — HH 닫힘/열림을 한 행으로 합침) — 새 노트는
      // 그 행의 "기본" 피스로 만든다(HH 행은 닫힘이 기본 — 실제로 더 자주
      // 쓰이는 타격). 열림으로 바꾸려면 선택 후 아래 "닫힘/열림" 버튼.
      piece: pieces[0],
      velocity: VELOCITY_TIERS.mid,
      hand: null,
    }
    commit({ ...state, notes: [...state.notes, newNote] })
    setSelectedIds(new Set([id]))
  }

  function handleNoteClick(e: React.MouseEvent, editorId: number) {
    e.stopPropagation()
    const isToggle = e.ctrlKey || e.metaKey
    if (!isToggle) {
      setSelectedIds(new Set([editorId]))
      return
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(editorId)) next.delete(editorId)
      else next.add(editorId)
      return next
    })
  }

  // 2026-10-29(의뢰인 재지적, 실사용 — "드래그했을 때 노트가 이동하는게
  // 아니라 복사가 되는데?") — 예전엔 mousedown에서 state(isDragging)만
  // true로 바꾸고, 그 state를 의존성으로 하는 별도 useEffect에서 실제
  // window 리스너(mousemove/mouseup)를 달았다. 리액트가 state 변경을
  // 반영해 그 effect를 실제로 실행하기까지는 한 틱(커밋 이후) 걸리는데,
  // 그 **짧은 틈 사이에 mousemove·mouseup이 먼저 도착하면**(실제 마우스로
  // 빠르게 드래그하거나, 자동화 도구로 빠르게 좌표를 옮길 때 실제 브라우저
  // 자동화로 재현·확인) 아무 리스너도 없어 드래그 자체가 통째로 무시됐다
  // — mouseup 시점에 미리보기가 시작값 그대로라 커밋이 안 되고(노트는
  // 제자리), 뒤이어 브라우저가 합성하는 click만 handleRowClick을 통해
  // 그 자리에 새 노트를 하나 더 만들어 "이동이 아니라 복사"처럼 보였다.
  // mousedown 핸들러 **안에서 바로**(같은 동기 구간, state·effect를
  // 거치지 않고) 리스너를 달면 이 틈 자체가 사라진다.
  function handleNoteMouseDown(e: React.MouseEvent<HTMLButtonElement>, note: EditableNote) {
    e.stopPropagation()
    // Ctrl/Cmd+클릭은 다중 선택 토글 전용(기존 onClick이 처리) — 드래그를
    // 같이 시작하면 "토글하려고 눌렀는데 옮겨짐"이 되므로 건너뛴다.
    // Codex 모드A 지적(반영) — 왼쪽 버튼(e.button===0)이 아니면(오른쪽
    // 클릭 메뉴 등) 드래그를 시작하지 않는다. 그리고 이미 드래그가
    // 진행 중인데(예: 왼쪽 버튼을 누른 채로 다른 노트에 또 mousedown이
    // 들어오는 비정상 입력 — 멀티터치·펜 입력 등) 또 시작하면, 두 드래그의
    // window 리스너가 동시에 같은 dragPreviewRef를 써서 서로 덮어쓰다가
    // 먼저 끝나는 쪽이 나중 드래그의 미리보기 값으로 잘못 커밋하고,
    // 나중 드래그는 커밋할 미리보기를 잃어버릴 수 있었다 — 활성 드래그가
    // 있으면 새로 시작하지 않는다.
    if (e.ctrlKey || e.metaKey || isSaving || e.button !== 0 || activeDragRef.current) return
    // 브라우저 기본 동작(텍스트 선택 드래그 등)이 우리 드래그와 겹쳐 보이는
    // 걸 막는 방어적 조치 — 노트 버튼엔 셀렉트할 텍스트가 없지만, 빠르게
    // 드래그할 때 인접 요소까지 끌리는 드래그 셀렉션이 생기지 않게.
    //
    // 2026-10-30(T3-78, 의뢰인 요청 — "노트생성하고 다른거 만지다(실행취소,
    // 격자바꾸기 등) 그 노트 다시 클릭 후 키보드 누르면 안 움직인다") —
    // 바로 위 preventDefault()가 "텍스트 드래그 선택 방지"에는 필요하지만,
    // 부작용으로 **브라우저가 클릭 시 이 버튼에 포커스를 주는 기본 동작도
    // 같이 막아버린다**(mousedown의 preventDefault는 포커스 이동 자체를
    // 취소시킴 — 실제로 document.activeElement를 찍어 직접 확인). 그래서
    // 클릭 직전에 포커스가 다른 곳(격자 드롭다운, 실행취소 버튼 등)에
    // 있었다면, 노트를 클릭해 선택해도 포커스는 그 다른 곳에 그대로 남고
    // 화살표 키(handleGridKeyDown, 그리드 컨테이너의 키보드 이벤트)가 전혀
    // 안 와서 안 움직이는 것처럼 보였다. 새 노트를 빈 칸 클릭으로 만들 때는
    // (handleRowClick, mousedown 핸들러 없음 — preventDefault를 안 함)
    // 포커스 없는 자식을 클릭하면 브라우저가 알아서 가장 가까운 포커스
    // 가능한 조상(그리드 컨테이너, tabIndex=0)으로 포커스를 넘겨줘서 이
    // 문제가 없었다 — 기존 노트를 다시 클릭하는 경로에서만 재현됐다.
    // preventDefault로 사라진 포커스를 명시적으로 되돌려준다.
    e.preventDefault()
    e.currentTarget.focus()
    activeDragRef.current = true
    setSelectedIds(new Set([note._editorId]))
    const drag = { noteId: note._editorId, startClientX: e.clientX, startTick: note.tick }
    dragPreviewRef.current = { noteId: note._editorId, tick: note.tick }
    setDragPreview(dragPreviewRef.current)

    function handleMouseMove(ev: MouseEvent) {
      const deltaPx = ev.clientX - drag.startClientX
      const deltaTicks = (deltaPx / PX_PER_GRID_UNIT) * unitTicks
      // 위 pxToTick과 같은 이유 — 클릭과 드래그가 서로 다른 규칙을 쓰면
      // 더 헷갈리므로 반드시 같은 방식(격자 무시, 정수 틱으로만 반올림)을 쓴다.
      const nextTick = Math.max(0, Math.round(drag.startTick + deltaTicks))
      const preview = { noteId: drag.noteId, tick: nextTick }
      dragPreviewRef.current = preview
      setDragPreview(preview)
    }
    function handleMouseUp() {
      activeDragRef.current = false
      const preview = dragPreviewRef.current
      dragPreviewRef.current = null
      setDragPreview(null)
      // 2026-10-29(T3-76, 모드A 2차 지적 C-002) — 드래그 도중 재생이 시작된
      // 극단적인 경우, 재생 중 커밋을 막는다(위 isPlayingRef 코멘트 참고).
      // 미리보기만 버리고 실제 노트는 안 옮긴다 — "재생 중 편집 잠금"과
      // 일관되게, 시작 당시엔 허용됐던 드래그라도 끝날 때 재생 중이면 무효.
      if (!isPlayingRef.current && preview && preview.tick !== drag.startTick) {
        commit({
          ...state,
          notes: state.notes.map((n) =>
            n._editorId === drag.noteId ? { ...n, tick: preview.tick } : n,
          ),
        })
      }
      // Codex 모드A 지적(필수, 반영) — mousedown이 노트에서 시작했는데
      // mouseup이(드래그로 옮겨서) 노트 밖(행 배경)에서 끝나면, 브라우저가
      // 그 뒤에 합성하는 click 이벤트는 mousedown·mouseup 타깃의 가장
      // 가까운 공통 조상(노트의 부모인 행 자체!)에서 발생한다(UI Events
      // 스펙) — 그러면 행의 onClick(handleRowClick)이 그 자리에 새 노트를
      // 또 만들어버린다. 드래그가 있었으면 그 뒤에 올 수 있는 단 한 번의
      // click만 소비해 무시한다 — click이 전혀 안 오는 경로(그리드 밖에서
      // mouseup 등)까지 대비해 다음 매크로태스크에서 한 번 더 안전하게
      // 꺼준다(click은 mouseup과 같은 틱에 동기적으로 합성되므로 이
      // 타임아웃보다 항상 먼저 처리된다).
      justDraggedRef.current = true
      setTimeout(() => {
        justDraggedRef.current = false
      }, 0)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const selectedNote =
    selectedIds.size === 1 ? (state.notes.find((n) => selectedIds.has(n._editorId)) ?? null) : null
  // 2026-10-29(의뢰인 요청) — 드래그로 노트를 옮기는 동안에도 "선택됨" 패널의
  // 마디/박 표시가 실시간으로 바뀌어야 "지금 몇 박 간격인지" 감을 잡는 데
  // 쓸모가 있다 — 아래 노트 렌더링의 isBeingDragged/displayTick과 같은 패턴
  // (state.notes의 커밋된 tick은 mouseup 때까지 그대로라, 그것만 읽으면
  // 드래그 중엔 얼어붙은 값을 보여주게 된다).
  const selectedDisplayTick =
    selectedNote && dragPreview?.noteId === selectedNote._editorId
      ? dragPreview.tick
      : selectedNote?.tick
  const selectedMulti = useMemo(
    () =>
      selectedIds.size >= 2
        ? state.notes.filter((n) => selectedIds.has(n._editorId)).sort((a, b) => a.tick - b.tick)
        : [],
    [selectedIds, state.notes],
  )

  function updateSelectedNote(patch: Partial<DrumNote>) {
    if (selectedNote === null) return
    const updated = { ...selectedNote, ...patch }
    // 2026-10-29(의뢰인 요청 — "실제 바뀐건 없는데 저장버튼은 활성화가
    // 되어있더라") — 이 함수가 셈여림(약/중/강)·손(R/L/RF/LF)·화살표 키
    // 이동(moveSelected)의 공통 경로다. 이미 선택된 값과 같은 셈여림
    // 버튼을 다시 누르거나, 화살표 키로 더 못 가는 경계(틱 0 등)에서
    // 계속 누르면 값은 그대로인데도 commit()이 "새로운" 객체를 만들어
    // 밀어넣어 저장 버튼이 켜졌다 — 실제로 값이 하나라도 달라질 때만
    // commit한다.
    if (
      updated.tick === selectedNote.tick &&
      updated.piece === selectedNote.piece &&
      updated.velocity === selectedNote.velocity &&
      updated.hand === selectedNote.hand &&
      updated.handSource === selectedNote.handSource
    ) {
      return
    }
    commit({
      ...state,
      notes: state.notes.map((n) => (n._editorId === selectedNote._editorId ? updated : n)),
    })
  }

  function deleteSelectedNote() {
    if (selectedNote === null) return
    commit({ ...state, notes: state.notes.filter((n) => n._editorId !== selectedNote._editorId) })
    setSelectedIds(new Set())
  }

  function applyAlternateHands(batchStartHand: 'R' | 'L') {
    if (selectedMulti.length < 2) return
    const updated = alternateHandsByTick(selectedMulti, batchStartHand)
    const byId = new Map(updated.map((n, i) => [selectedMulti[i]._editorId, n]))
    commit({
      ...state,
      notes: state.notes.map((n) => {
        const replacement = byId.get(n._editorId)
        return replacement ? { ...n, hand: replacement.hand, handSource: replacement.handSource } : n
      }),
    })
  }

  // 2026-10-30(T3-77, 모드A 지적) — moveSelected()의 반복 반올림 오차 누적을
  // 막으려고 "화살표 이동을 시작한 기준 틱 + 그 뒤 누른 횟수"를 따로 든다
  // (아래 moveSelected 코멘트 참고). T3-79부터 화살표 이동 간격이 항상
  // keyboardNudgeTicks(16분음표 고정)라 격자 설정(gridUnit)과 무관해져,
  // 더는 anchor에 gridUnit을 같이 안 둬도 된다(어차피 안 바뀜).
  const moveAnchorRef = useRef<{
    noteId: number
    anchorTick: number
    steps: number
  } | null>(null)

  function moveSelected(deltaTicks: number, deltaRows: number) {
    if (selectedNote === null) return
    // 2026-10-30(T3-77, 의뢰인 요청) — 예전엔 snapTick()으로 "0틱 기준 절대
    // 격자"에 매번 다시 맞췄다. 그런데 실제 채보된 노트(HH 등)는 AI가 검출한
    // 진짜 타이밍이라 그 절대 격자와 몇 틱(T3-72/Q-43) 어긋나 있는 게 정상이다
    // — 그 노트 옆에 새 노트를 만들어 화살표로 "1/16박 뒤"로 옮기면, 절대
    // 격자에 다시 스냅되면서 기준 노트의 실제(살짝 어긋난) 위치가 아니라
    // "이론상 깨끗한" 위치로 끌려가 버려, 실제로 들어보면 둘이 안 맞는
    // 문제가 있었음(의뢰인이 직접 재생해보고 발견). 절대 격자로 되돌리지
    // 않고 **지금 틱에서 그대로 더한 값**을 쓴다 — 노트가 새 노트 추가 시
    // 가까운 기존 노트의 실제 틱에 자동으로 맞춰지면(아래 handleRowClick),
    // 그 뒤 화살표 이동은 그 실제 기준에서 정확히 1/16박씩 상대 이동한다.
    //
    // Codex 모드A 지적(필수, 반영) — unitTicks가 정수가 아닌 경우(예:
    // ppq=100의 8분음표 셋잇단 격자, unitTicks=33.333…) 매번 "이미 반올림된
    // 틱"에 33.333…을 더해 다시 반올림하면, 각 단계의 반올림 오차가
    // 누적돼(round(round(x)+33.333) 반복) 여러 번 누르면 실제 "출발점 +
    // N*격자폭"에서 점점 멀어진다(직접 재현: 30번 누르면 10틱 차이) — 이동을
    // 시작한 "기준 틱"과 그 뒤 누른 횟수(정수)를 따로 기억해뒀다가, 매번
    // "기준 틱 + 누른 횟수*격자폭"을 한 번만 반올림한다. 다른 노트 선택·
    // 드래그 등으로 틱이 이 추적과 다르게 바뀌면(moveAnchorRef가 예상하는
    // 값과 실제 selectedNote.tick이 다르면) 그 순간의 실제 틱을 새 기준으로
    // 다시 잡는다.
    //
    // Codex 모드A 2차 지적(필수, 반영) — 틱 0 근처에서 "요청한 이동이 0
    // 미만으로 클램프됐는지"를 유효성 검사에서도 똑같이 클램프해서 비교하면,
    // 클램프로 실제 못 움직인 걸 "정상 진행"으로 착각해버린다(예: 틱 0에서
    // ←를 눌러 steps=-1 기록, 클램프로 실제 틱은 0 그대로 → 그 다음 →를
    // 누르면 steps가 -1→0이 돼 틱이 또 0에 머물고, 사용자가 기대한 "오른쪽
    // 으로 한 칸"이 조용히 사라짐). 클램프가 실제로 일어난(반올림한 원시
    // 값이 음수였던) 순간엔 그 자리를 새 기준점(steps=0)으로 다시 잡아,
    // 다음 이동이 "지금 실제로 있는 자리"에서 정확히 출발하게 한다 —
    // 유효성 검사도 클램프 없는 원시 예측값으로 비교해 같은 착시가
    // 재발하지 않게 한다. gridUnit도 같이 비교해(2차 지적 C-002) 격자
    // 설정이 바뀐 경우 반올림 결과가 우연히 같아도 무조건 새로 잡는다.
    let nextTick: number
    if (deltaTicks === 0) {
      nextTick = selectedNote.tick
    } else {
      const anchor = moveAnchorRef.current
      const anchorStillValid =
        anchor !== null &&
        anchor.noteId === selectedNote._editorId &&
        Math.round(anchor.anchorTick + anchor.steps * keyboardNudgeTicks) === selectedNote.tick
      const base = anchorStillValid
        ? anchor
        : { noteId: selectedNote._editorId, anchorTick: selectedNote.tick, steps: 0 }
      const steps = base.steps + deltaTicks / keyboardNudgeTicks
      const rawNextTick = Math.round(base.anchorTick + steps * keyboardNudgeTicks)
      nextTick = Math.max(0, rawNextTick)
      moveAnchorRef.current =
        rawNextTick === nextTick
          ? { noteId: selectedNote._editorId, anchorTick: base.anchorTick, steps }
          : { noteId: selectedNote._editorId, anchorTick: nextTick, steps: 0 }
    }
    const rowIdx = editorRowIndexForPiece(selectedNote.piece)
    const nextRowIdx = Math.min(EDITOR_ROWS.length - 1, Math.max(0, rowIdx + deltaRows))
    // 지금 행 그대로 머물면(deltaRows===0, 가로 이동만) 피스는 안 바뀐다 —
    // HH 행이 닫힘/열림 둘을 공유하므로 그대로 두지 않으면 가로로만 옮겨도
    // 매번 "기본값"(닫힘)으로 되돌아가 버린다. 실제로 다른 행으로 넘어갈
    // 때만 그 행의 기본 피스를 쓴다.
    const nextPiece =
      nextRowIdx === rowIdx ? selectedNote.piece : EDITOR_ROWS[nextRowIdx].pieces[0]
    updateSelectedNote({ tick: nextTick, piece: nextPiece })
  }

  function setSelectedVelocityTier(tier: VelocityTier) {
    updateSelectedNote({ velocity: VELOCITY_TIERS[tier] })
  }

  // Codex 모드C C-004: 그리드 컨테이너 자체(tabIndex=0)에만 바인딩 — 이벤트가
  // 여기까지 올라왔다는 건 포커스가 BPM/박자표 입력창 등 바깥 요소가 아니라
  // 그리드 안에 있다는 뜻이라, 별도의 "input이면 무시" 분기 없이도 바깥 요소의
  // 키보드 동작(타이핑, 버튼 Enter/Space)을 건드리지 않는다.
  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // 2026-10-29(T3-76, 의뢰인 요청) — 화살표 키 이동·Delete/Backspace 삭제·
    // 숫자 키 셈여림 단축키 전부 선택된 노트를 그리드 버튼(disabled={isPlaying})
    // 없이도 직접 바꾸는 경로라, 재생 중엔 똑같이 막아야 "편집 잠금"이
    // 완전해진다.
    if (isPlaying) return
    if (selectedNote === null) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveSelected(-keyboardNudgeTicks, 0)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveSelected(keyboardNudgeTicks, 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelected(0, -1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelected(0, 1)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelectedNote()
    } else if (e.key === '1') {
      setSelectedVelocityTier('soft')
    } else if (e.key === '2') {
      setSelectedVelocityTier('mid')
    } else if (e.key === '3') {
      setSelectedVelocityTier('strong')
    }
  }

  // 2026-10-29(의뢰인 요청 — "저장버튼 누르지 않고 라이브러리나 연습화면으로
  // 이동을 시도할 때 변경내용을 저장할 것인지 확인하는 모달이 나오면
  // 좋겠다") — "나가기 확인" 모달의 저장 선택지도 이 함수를 그대로 써야
  // 하는데, 기존엔 성공하면 곧장 onSaved()(→ 항상 라이브러리로 이동)를
  // 불러 "연습 화면으로 나가려다 저장"한 경우에도 라이브러리로 잘못
  // 보내게 된다. 저장 성공 여부만 boolean으로 돌려주고, 어디로 갈지는
  // 호출한 쪽(툴바의 "저장" 버튼은 그대로 onSaved, 나가기 모달은 원래
  // 가려던 곳)이 결정한다.
  async function handleSave(): Promise<boolean> {
    const score = toDrumScore(state)
    const validation = validateDrumScore(score)
    if (!validation.valid) {
      setSaveError(`악보 데이터가 올바르지 않습니다: ${validation.errors.join(', ')}`)
      return false
    }
    setSaveError(null)
    setIsSaving(true)
    try {
      await saveSongDrumScore(song.id, score)
      lastSavedStateRef.current = state
      return true
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '저장에 실패했습니다')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // 2026-10-29(의뢰인 요청) — 저장하지 않은 변경사항(isDirty)이 있는 채로
  // "← 라이브러리"·"← 연습 화면"을 누르면 임의로 버리지 않고 먼저 묻는다.
  // 변경이 없으면(흔한 경우) 기존처럼 바로 이동 — 모달이 매번 뜨면 오히려
  // 방해가 된다.
  type PendingNav = { kind: 'cancel' } | { kind: 'practice'; positionTicks: number }
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null)

  function navigateNow(nav: PendingNav) {
    if (nav.kind === 'cancel') onCancel()
    else onBackToPractice?.(nav.positionTicks)
  }

  function requestLeave(nav: PendingNav) {
    if (isDirty) setPendingNav(nav)
    else navigateNow(nav)
  }

  async function handleSaveThenLeave() {
    const nav = pendingNav
    const ok = await handleSave()
    // 실패하면(검증 오류·서버 오류) 모달을 닫고 화면에 남는다 — 기존 "저장"
    // 버튼과 같은 자리(하단)에 saveError가 그대로 보이고, isDirty도 그대로라
    // 다시 저장을 시도하거나 "저장 안 함"으로 포기할 수 있다.
    setPendingNav(null)
    if (ok && nav) navigateNow(nav)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <button onClick={() => requestLeave({ kind: 'cancel' })}>← 라이브러리</button>
        {onBackToPractice && (
          <button
            onClick={() =>
              requestLeave({ kind: 'practice', positionTicks: cursorTicksRef.current })
            }
          >
            ← 연습 화면
          </button>
        )}
        {/* 2026-10-29(의뢰인 요청) — "편집기에서 bpm을 건들 수 없었으면
         * 좋겠어... 라이브러리에 bpm은 우리가 업로드했을 때의 원본값이
         * 적히도록". 원곡 BPM은 이제 여기서 조절할 수 없고(읽기 전용
         * 표시), 재생 속도 조절은 아래 "재생" 영역의 별도 슬라이더로
         * 옮겼다(PracticeCanvas.tsx와 같은 위치·패턴). */}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
          원곡 BPM {meta.bpm}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          박자표
          <input
            type="number"
            min={1}
            value={meta.timeSignature[0]}
            onChange={(e) =>
              commit({
                ...state,
                meta: {
                  ...meta,
                  timeSignature: [Number(e.target.value), meta.timeSignature[1]],
                },
              })
            }
            disabled={isPlaying}
            style={{ width: 48 }}
          />
          /
          <input
            type="number"
            min={1}
            value={meta.timeSignature[1]}
            onChange={(e) =>
              commit({
                ...state,
                meta: {
                  ...meta,
                  timeSignature: [meta.timeSignature[0], Number(e.target.value)],
                },
              })
            }
            disabled={isPlaying}
            style={{ width: 48 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          격자
          <select value={gridUnit} onChange={(e) => setGridUnit(e.target.value as GridUnit)}>
            <option value="4n">4분</option>
            <option value="8n">8분</option>
            <option value="16n">16분</option>
            <option value="8nt">셋잇단(8분)</option>
          </select>
        </label>
        <button
          onClick={() => setHistory((h) => undo(h))}
          // Codex 모드A 3차 지적(필수, 반영) — commit()의 "저장 중엔 편집
          // 금지" 가드는 실행취소/다시실행처럼 setHistory()를 직접 부르는
          // 경로는 안 거쳐 못 막았다 — 여기도 같이 막는다.
          disabled={!canUndo(history) || isSaving}
          aria-label="실행취소"
          title="실행취소"
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => setHistory((h) => redo(h))}
          disabled={!canRedo(history) || isSaving}
          aria-label="다시실행"
          title="다시실행"
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => void handleSave().then((ok) => ok && onSaved())}
          disabled={isSaving || !isDirty}
          title={!isDirty && !isSaving ? '변경한 내용이 없습니다' : undefined}
        >
          {isSaving ? '저장 중…' : '저장'}
        </button>
      </div>

      {/* 2026-10-29(의뢰인 요청) — "편집시에도 음악을 들으면서 할 수 있을까" */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-3)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-control)',
          padding: 'var(--space-2) var(--space-3)',
        }}
      >
        <button
          onClick={() => handleSeek(-10)}
          aria-label="10초 뒤로"
          title="10초 뒤로"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Rewind size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => void (isPlaying ? handlePause() : handlePlay())}
          // T3-16-feedback-7(PracticeCanvas.tsx)과 같은 보호장치 — 원곡
          // 음원이 아직 다 안 받아졌는데 재생을 누르면 끊김 재현 이력 있음.
          disabled={!isPlaying && audioTracksLoading}
          aria-label={isPlaying ? '일시정지' : audioTracksLoading ? '원곡 음원 불러오는 중' : '재생'}
          title={isPlaying ? '일시정지' : audioTracksLoading ? '원곡 음원 불러오는 중…' : '재생'}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {!isPlaying && audioTracksLoading ? (
            <Spinner size={16} />
          ) : isPlaying ? (
            <Pause size={16} aria-hidden="true" fill="currentColor" />
          ) : (
            <Play size={16} aria-hidden="true" fill="currentColor" />
          )}
        </button>
        <button
          onClick={() => handleSeek(10)}
          aria-label="10초 앞으로"
          title="10초 앞으로"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <FastForward size={16} aria-hidden="true" />
        </button>
        <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.9em' }}>
          {formatMmSs(currentSeconds)}
        </span>
        {/* 2026-10-29(의뢰인 요청) — "원곡 음원 + 신스 드럼을 함께 재생합니다
         * 이런 말은 필요없어" — 정상 동작 중엔 안내문 없이 조용히, 실제로
         * 뭔가 평소와 다를 때(로딩 중·실패·분리 자체가 없음)만 이유를 보여준다. */}
        {!audioTracksAvailable && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            {canUseAudioTracks
              ? audioTracksLoading
                ? '원곡 음원을 불러오는 중…'
                : '원곡 음원을 불러오지 못해 신스 드럼만 재생됩니다.'
              : '이 곡은 음원 분리가 안 돼 있어 신스 드럼만 재생됩니다.'}
          </span>
        )}
        {playbackError && (
          <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.85em' }}>
            {playbackError}
          </span>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* 2026-10-29(의뢰인 요청) — "속도를 bpm을 바꿔서 표기해줘" —
           * 표시되는 값 자체가 이미 BPM 숫자라 라벨도 PracticeCanvas.tsx와
           * 똑같이 "BPM"으로(그동안은 "속도"라는 추상적인 말이라 숫자가
           * 무슨 단위인지 헷갈릴 수 있었음). */}
          BPM
          {/* PracticeCanvas.tsx의 BPM(연습 속도) 입력과 완전히 같은 패턴 —
           * 재생 시작 시점에 이미 스케줄돼 있어 재생 중 바꿔도 지금
           * 재생엔 반영 안 됨(다음 재생부터 적용) — 혼란을 막기 위해
           * 재생 중엔 잠금. */}
          <input
            type="range"
            className="mixer-slider"
            min={minBpm}
            max={maxBpm}
            value={playbackBpm}
            onChange={(e) => setPlaybackBpm(clampBpm(Number(e.target.value)))}
            disabled={isPlaying}
          />
          <input
            type="number"
            min={minBpm}
            max={maxBpm}
            value={bpmFieldValue}
            onFocus={() => {
              setBpmDraft(String(playbackBpm))
              setIsEditingBpm(true)
            }}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={(e) => {
              setPlaybackBpm(clampBpm(Number(e.target.value)))
              setIsEditingBpm(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            disabled={isPlaying}
            style={{ width: 56 }}
          />
          <button
            type="button"
            className="settings-trigger"
            onClick={() => {
              setPlaybackBpm(meta.bpm)
              setIsEditingBpm(false)
            }}
            disabled={isPlaying}
            aria-label={`원곡 BPM(${meta.bpm})으로 재설정`}
            title={`원곡 BPM(${meta.bpm})으로 재설정`}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginLeft: 'auto' }}>
          {(audioTracksAvailable
            ? (['stem_drums', 'music', 'synth_drums', 'metronome'] as const)
            : (['synth_drums', 'metronome'] as const)
          ).map((key) => {
            const label = key === 'music' ? '음악(베이스·보컬·그 외)' : CHANNEL_LABEL[key]
            const volume =
              key === 'music'
                ? musicVolume(mixerState)
                : key === 'stem_drums' && drumOverrideEngaged
                  ? drumOverrideVolume
                  : key === 'synth_drums' && drumOverrideEngaged
                    ? 0
                    : mixerState[key].volume
            return (
              <label
                key={key}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: '0.85em' }}
                title={
                  (key === 'stem_drums' || key === 'synth_drums') && drumOverrideEngaged
                    ? '연습 화면에서 듣던 드럼 음량에 맞춰 보여줌(저장 안 됨) — 직접 조절하면 해제'
                    : undefined
                }
              >
                {label}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(e) => {
                    const next = Number(e.target.value) / 100
                    // 드럼원곡·신스 드럼 둘 중 하나라도 직접 건드리면 위
                    // 오버레이 해제 — 그 뒤로는 평소처럼 저장되는 실제 값만 씀.
                    if (key === 'stem_drums' || key === 'synth_drums') setDrumOverrideActive(false)
                    if (key === 'music') updateMusicVolume(next)
                    else updateChannel(key, { volume: next })
                  }}
                  style={{ width: 80 }}
                />
              </label>
            )
          })}
        </div>
      </div>

      {/* 2026-10-29(의뢰인 확인 — "네, 그리드가 안 밀리게 고쳐주세요") — 노트를
       * 선택할 때마다 이 패널이 나타나면서 그리드 전체가 아래로 밀렸다(실측
       * 100px 안팎). "클릭해서 노트를 놓고 바로 그 자리를 드래그로 고치려는"
       * 실제 사용 패턴에서, 화면이 훅 밀리는 순간을 사람이 못 따라가 드래그
       * 시작점이 엉뚱한 자리를 잡을 수 있었다 — minHeight로 항상 공간을
       * 미리 예약해 그리드 위치를 선택 여부와 무관하게 고정한다. 값은 가장
       * 넓은 경우(HH 선택 시 닫힘/열림 버튼 2개 추가 — 줄바꿈될 수 있는
       * 폭)를 실제로 띄워 측정한 높이(86px)에 여유를 두고 반올림한 값 —
       * (처음엔 선택 패널과 똑같은 내용을 안 보이게 숨겨 자동으로 공간을
       * 재는 방식을 시도했는데, 숨긴 쪽 텍스트가 테스트의 getByText와
       * 겹쳐 "여러 개 찾음" 에러가 나서 더 단순한 고정값으로 바꿨다). */}
      <div style={{ minHeight: 96 }}>
        {selectedNote && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <span>
              선택됨: {EDITOR_ROWS[editorRowIndexForPiece(selectedNote.piece)]?.label} ·{' '}
              {tickToBeatLabel(selectedDisplayTick ?? selectedNote.tick, meta.timeSignature, ppq, gridUnit)}{' '}
              (틱 {selectedDisplayTick}) · 셈여림 {velocityTierOf(selectedNote.velocity)} · 손:{' '}
              {selectedNote.hand
                ? `${HAND_LABEL[selectedNote.hand]}${selectedNote.handSource === 'user' ? '(지정)' : '(추천)'}`
                : '미지정'}
            </span>
            {/* 2026-10-29(T3-76, 의뢰인 요청 — "재생 중엔 편집 자체를
             * 잠그자") — 재생 시작 전에 이미 선택돼 있던 노트라면 그리드의
             * disabled={isPlaying}(노트 버튼 자체)를 거치지 않고 바로 이
             * 패널 버튼들로 수정·삭제할 수 있었다 — 그리드만 잠그고 이
             * 패널을 빠뜨리면 "재생 중엔 편집 잠금"이 반쪽짜리가 된다.
             * 아래 버튼 전부 isPlaying일 때 같이 잠근다. */}
            <button disabled={isPlaying} onClick={() => setSelectedVelocityTier('soft')}>
              약
            </button>
            <button disabled={isPlaying} onClick={() => setSelectedVelocityTier('mid')}>
              중
            </button>
            <button disabled={isPlaying} onClick={() => setSelectedVelocityTier('strong')}>
              강
            </button>
            {/* 2026-10-29(의뢰인 요청) — HH 닫힘/열림을 한 행으로 합치면서
             * (grid.ts 참고) 행만으로는 더 이상 구분이 안 되니, 선택된
             * 노트가 HH일 때 여기서 직접 전환할 수 있게 둔다. */}
            {(selectedNote.piece === 'hihat_closed' || selectedNote.piece === 'hihat_open') && (
              <>
                <button
                  onClick={() => updateSelectedNote({ piece: 'hihat_closed' })}
                  aria-pressed={selectedNote.piece === 'hihat_closed'}
                  disabled={isPlaying || selectedNote.piece === 'hihat_closed'}
                >
                  닫힘
                </button>
                <button
                  onClick={() => updateSelectedNote({ piece: 'hihat_open' })}
                  aria-pressed={selectedNote.piece === 'hihat_open'}
                  disabled={isPlaying || selectedNote.piece === 'hihat_open'}
                >
                  열림
                </button>
              </>
            )}
            {/* 2026-10-30(T3-81, 의뢰인 요청) — 손/발 지정 버튼(R/L/RF/LF/
             * 손 지우기) 제거. "손: {표시}" 텍스트(자동 추천값 포함)는
             * 그대로 두고 수동 변경 버튼만 뺀다. */}
            <button disabled={isPlaying} onClick={deleteSelectedNote}>
              삭제
            </button>
          </div>
        )}
      </div>

      {selectedMulti.length >= 2 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span>선택: {selectedMulti.length}개 노트</span>
          {/* 2026-10-29(T3-76, 모드A 2차 지적 C-001 반영) — 다중 선택 패널도
           * commit()으로 노트를 바꾸는 경로라 단일 선택 패널과 똑같이 잠근다. */}
          <button disabled={isPlaying} onClick={() => applyAlternateHands('R')}>
            RLRL 교대
          </button>
          <button disabled={isPlaying} onClick={() => applyAlternateHands('L')}>
            LRLR 교대
          </button>
        </div>
      )}

      {saveError && <p style={{ color: 'var(--danger)' }}>{saveError}</p>}

      <Modal
        open={pendingNav !== null}
        // Codex 모드A 지적(필수, 반영) — 모달 안 버튼 3개는 isSaving일 때
        // 비활성화되지만, Modal 자신의 onClose(배경 클릭·Esc)는 그 가드를
        // 안 거친다. "저장" 진행 중에 Esc를 누르면 모달은 닫혀서 취소한
        // 것처럼 보이지만, handleSaveThenLeave는 이미 그 시점의 nav를
        // 붙잡고 있어 저장이 성공하면 그대로 이동해버린다(취소했다고
        // 생각한 사용자가 갑자기 다른 화면으로 넘어감). 저장 중엔 배경
        // 클릭·Esc 모두 무시한다.
        onClose={() => {
          if (isSaving) return
          setPendingNav(null)
        }}
        title="저장하지 않은 변경사항"
      >
        <p>편집한 내용을 저장하지 않았습니다. 저장할까요?</p>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-4)',
          }}
        >
          <button onClick={() => setPendingNav(null)} disabled={isSaving}>
            취소
          </button>
          <button
            onClick={() => {
              const nav = pendingNav
              setPendingNav(null)
              if (nav) navigateNow(nav)
            }}
            disabled={isSaving}
          >
            저장 안 함
          </button>
          <button onClick={() => void handleSaveThenLeave()} disabled={isSaving}>
            {isSaving ? '저장 중…' : '저장'}
          </button>
        </div>
      </Modal>

      <div
        ref={gridScrollRef}
        role="application"
        aria-label="드럼 편집 그리드"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        style={{
          position: 'relative',
          overflowX: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-control)',
        }}
      >
        {EDITOR_ROWS.map((row) => (
          <div
            key={row.label}
            data-testid={`editor-row-${row.pieces[0]}`}
            onClick={(e) => handleRowClick(e, row.pieces)}
            style={{
              position: 'relative',
              height: ROW_HEIGHT,
              width: gridWidthPx,
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                position: 'sticky',
                left: 0,
                display: 'inline-block',
                width: ROW_LABEL_WIDTH,
                height: ROW_HEIGHT,
                lineHeight: `${ROW_HEIGHT}px`,
                paddingLeft: 4,
                background: 'var(--surface)',
                color: 'var(--text-muted)',
                fontSize: '0.8em',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                // Codex 모드A 지적(권장, 반영) — 노트 버튼에 준 zIndex: 2
                // (아래 코멘트)보다 라벨이 낮으면 겹칠 때 라벨이 가려질 수
                // 있다. 라벨을 항상 가장 위로.
                zIndex: 3,
              }}
            >
              {row.label}
            </span>
            {state.notes
              .filter((n) => row.pieces.includes(n.piece))
              .map((note) => {
                const isSelected = selectedIds.has(note._editorId)
                // 2026-10-29(의뢰인 요청) — HH 닫힘/열림이 이제 한 행을
                // 공유하므로(grid.ts 참고), PracticeCanvas.tsx가 같은 레인
                // 안에서 모양(채움/고리)으로 구분하는 것과 같은 원리로 열림은
                // 속을 비운 고리로 그려 닫힘과 구분한다.
                const isHihatOpen = note.piece === 'hihat_open'
                const pieceColor = readPieceColor(note.piece)
                const isBeingDragged = dragPreview?.noteId === note._editorId
                const displayTick = isBeingDragged ? dragPreview.tick : note.tick
                return (
                  <button
                    key={note._editorId}
                    aria-label={`${row.label} 노트, 틱 ${note.tick}${note.hand ? ` ${HAND_LABEL[note.hand]}${note.handSource === 'user' ? '(지정)' : '(추천)'}` : ''}${isSelected ? ' (선택됨)' : ''}`}
                    // 2026-10-29(T3-76, 의뢰인 요청 — "재생 중엔 편집 자체를
                    // 잠그자") — 재생 중엔 그리드가 계속 스크롤돼(T3-75) 클릭
                    // 선택·드래그 이동 모두 마우스 아래 좌표가 계속 바뀌어
                    // 혼란스럽다. 재생 중엔 노트 버튼 자체를 비활성화해 클릭
                    // (선택)·mousedown(드래그 시작) 둘 다 막는다.
                    disabled={isPlaying}
                    onClick={(e) => handleNoteClick(e, note._editorId)}
                    onMouseDown={(e) => handleNoteMouseDown(e, note)}
                    style={{
                      position: 'absolute',
                      // 2026-10-29(T3-74, 의뢰인 요청) — 연습 화면(laneRenderer.ts)은
                      // 노트 도형을 "정확한 박자 위치 = 도형의 판정 쪽 모서리"에
                      // 맞춰 그린다(아래로 떨어지는 방향이라 하단 모서리, 모드A
                      // 지적 반영분 — shapeBottomExtent 참고). 편집 화면은 그동안
                      // "정확한 위치 = 도형 정중앙"으로 그려서, 두 화면에서 같은
                      // 노트를 비교하면 도형 폭의 절반(8px)만큼 더 벌어져 보였다
                      // (의뢰인이 두 화면을 나란히 비교하며 직접 발견). 편집 화면의
                      // 시간축(왼쪽→오른쪽)에서 "이른 시간 쪽 모서리"는 왼쪽이므로,
                      // 연습 화면과 같은 기준으로 맞추려면 왼쪽 모서리를 정확한
                      // 위치에 맞춘다(중앙 정렬 제거) — tickToPx(0)이 항상
                      // ROW_LABEL_WIDTH 이상이라 틱 0 노트가 음수 위치로 라벨
                      // 영역을 침범하던 문제도 같이 없어짐.
                      left: tickToPx(displayTick),
                      top: (ROW_HEIGHT - NOTE_SIZE) / 2,
                      width: NOTE_SIZE,
                      height: NOTE_SIZE,
                      // 2026-10-29(T3-73, 의뢰인 요청) — 연습 화면(laneRenderer.ts의
                      // 'rounded-rect' 도형, 모서리 반지름 4)과 모양을 맞춰 두
                      // 화면에서 같은 노트가 같은 인상으로 보이게 한다. 원(50%)은
                      // 중심점이 격자선과 조금만 어긋나도 "선에서 벗어난" 인상을
                      // 주기 쉬운데, 네모는 변이 그대로 보여 덜 그렇다.
                      borderRadius: 4,
                      border: isSelected
                        ? '2px solid var(--warning)'
                        : isHihatOpen
                          ? `2px solid ${pieceColor}`
                          : '1px solid var(--border)',
                      background: isHihatOpen ? 'transparent' : pieceColor,
                      padding: 0,
                      cursor: isBeingDragged ? 'grabbing' : 'grab',
                      opacity: isBeingDragged ? 0.7 : 1,
                      // 아래 격자선·재생 위치선이 DOM 순서상 모든 행보다
                      // 뒤에 그려져 z-index 없이는 노트 위를 덮어버린다 —
                      // 노트가 항상 위에 보이도록 명시적으로 올림.
                      zIndex: 2,
                    }}
                  >
                    {note.hand && (
                      <span
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: -12,
                          transform: 'translateX(-50%)',
                          fontSize: '0.6em',
                          color: 'var(--text)',
                          opacity: note.handSource === 'user' ? 1 : 0.5,
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {note.hand}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        ))}
        {/* 2026-10-29(의뢰인 요청 — "원하는 위치에 노트를 찍을 수 없었다") —
         * 세로 격자선. 각 행이 단색 배경뿐이라 클릭·드래그가 어디에 스냅될지
         * 전혀 안 보였던 게 원인이었다(스냅 계산 자체는 문제없음) — 지금
         * "격자" 단위마다 옅은 선, 마디 경계마다 더 또렷한 선을 그려 기존
         * 노트와 같은 세로줄인지 눈으로 바로 비교할 수 있게 한다.
         * pointerEvents:none이라 클릭은 그대로 아래 행에 전달된다. */}
        {gridLineTicks.map((t) => (
          <div
            key={`grid-${t}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: tickToPx(t),
              width: 1,
              background: 'var(--border)',
              opacity: 0.5,
              pointerEvents: 'none',
            }}
          />
        ))}
        {/* 2026-10-29(의뢰인 재지적 — "실선 사이가 한마디잖아. 그럼 그 안에
         * 덜선명한 선 한줄이 얼만큼의 박자인지도 잘 모르겠어") — 격자 단위
         * 선(옅음)·마디 경계선(또렷함) 둘로는 "박"(4분음표) 자리가 어느
         * 옅은 선인지 구분이 안 됐다. 박 경계마다 그 중간 밝기 선과 몇
         * 박째인지 숫자를 추가로 그린다(마디 시작 자리엔 바로 아래
         * barLineTicks가 더 또렷한 선을 겹쳐 그리므로 숫자만 "1"로 같이
         * 보여주고 선은 중복해서 안 그림). */}
        {beatLines.map(({ tick: t, beatInBar, isBarStart }) => (
          <Fragment key={`beat-${t}`}>
            {!isBarStart && (
              <div
                aria-hidden="true"
                data-testid="beat-line"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: tickToPx(t),
                  width: 1,
                  background: 'var(--text-muted)',
                  opacity: 0.6,
                  pointerEvents: 'none',
                }}
              />
            )}
            <span
              aria-hidden="true"
              data-testid="beat-label"
              style={{
                position: 'absolute',
                top: 2,
                left: tickToPx(t) + 3,
                fontSize: '0.65em',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            >
              {beatInBar}
            </span>
          </Fragment>
        ))}
        {barLineTicks.map((t) => (
          <div
            key={`bar-${t}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: tickToPx(t),
              width: 1,
              background: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
        ))}
        {/* 2026-10-29(의뢰인 요청) — 재생 위치선. 그리드 콘텐츠와 같은 스크롤
         * 영역 안에 절대 위치시켜, 가로 스크롤 시 노트와 같이 움직인다.
         * left는 cursorTicks state로도 계산해 두되(멈춰있을 때·첫 렌더용,
         * 아래 값과 항상 같음), 재생 중엔 startRaf()의 rAF 루프가 playheadRef
         * 에 매 프레임 직접 덮어써 더 자주 갱신한다 — "끊겨 보여 눈이
         * 피로하다"는 지적(2026-10-29) 원인은 cursorTicks state 자체가
         * 초당 10회로 스로틀돼 있어서였다(그리드 전체가 다시 그려지는
         * 비용을 아끼려던 의도적 절충, 위 startRaf() 코멘트 참고) — 기술적
         * 한계가 아니라, PracticeCanvas.tsx의 progressBarRef·timeDisplayRef와
         * 같은 방식(React state를 건너뛰고 ref에 직접 style을 쓰면 VDOM
         * diff·리렌더 없음)으로 이 선 하나만 60fps로 올릴 수 있었다. */}
        <div
          ref={playheadRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: tickToPx(cursorTicks),
            width: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}
