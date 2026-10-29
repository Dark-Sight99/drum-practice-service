import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Pause, Play, Redo2, Undo2 } from 'lucide-react'
import { Spinner } from '../../components/Spinner'
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
  playDrumScore,
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
import { EDITOR_ROWS, editorRowIndexForPiece, snapTick, ticksPerGridUnit, type GridUnit } from './grid'
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
  // 편집 경로(노트 추가·이동·삭제·손 지정·BPM/박자표 등)가 결국 이
  // 함수 하나를 거치므로, 여기 한 곳만 막으면 저장 중엔 전부 막힌다.
  function commit(next: EditorState) {
    if (isSaving) return
    setHistory((h) => pushHistory(h, next))
  }

  const totalBars = useMemo(() => {
    const lastTick = Math.max(0, ...state.notes.map((n) => n.tick))
    return barIndexForTick(lastTick, meta.timeSignature, ppq) + 1 + 2 // 여유 2마디
  }, [state.notes, meta.timeSignature, ppq])

  const unitTicks = ticksPerGridUnit(gridUnit, ppq)
  const barTicks = ticksPerBar(meta.timeSignature, ppq)
  const totalTicks = totalBars * barTicks
  const gridWidthPx = ROW_LABEL_WIDTH + (totalTicks / unitTicks) * PX_PER_GRID_UNIT

  function tickToPx(tick: number): number {
    return ROW_LABEL_WIDTH + (tick / unitTicks) * PX_PER_GRID_UNIT
  }

  function pxToSnappedTick(px: number): number {
    return Math.max(
      0,
      snapTick(Math.round(((px - ROW_LABEL_WIDTH) / PX_PER_GRID_UNIT) * unitTicks), gridUnit, ppq),
    )
  }

  // --- 재생(2026-10-29 의뢰인 요청) ---------------------------------------
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSeconds, setCurrentSeconds] = useState(() =>
    ticksToSeconds(initialPositionTicks ?? 0, ppq, meta.bpm),
  )
  const [cursorTicks, setCursorTicks] = useState(initialPositionTicks ?? 0)
  const cursorTicksRef = useRef(cursorTicks)
  useEffect(() => {
    cursorTicksRef.current = cursorTicks
  }, [cursorTicks])

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

  // 계정 전체 공유 믹서(의뢰인 요청 "믹서 동일하게 사용") — practice 화면과
  // 같은 `/auth/me/mixer-setting`을 그대로 쓴다. practice의 채널별 편집-추적·
  // 저장 직렬화 같은 정교한 경합 방지(PracticeCanvas.tsx 참고)는 이 화면
  // 세션이 짧고 단순해 생략 — 단순 디바운스 저장으로 충분하다고 판단.
  useEffect(() => {
    let cancelled = false
    fetchMixerSetting()
      .then(({ volumes }) => {
        if (cancelled || !volumes || mixerEditedRef.current) return
        const merged = defaultMixerState()
        for (const key of CHANNEL_KEYS) if (volumes[key]) merged[key] = volumes[key]
        setMixerStateRaw(merged)
      })
      .catch(() => {
        // 못 불러와도 기본값으로 계속 — practice 화면 로드 실패와 같은 원칙.
      })
    return () => {
      cancelled = true
    }
  }, [])

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
  useEffect(() => {
    return () => {
      if (mixerSaveTimerRef.current) {
        clearTimeout(mixerSaveTimerRef.current)
        void saveMixerSetting(mixerStateRef.current)
      }
    }
  }, [])

  // 2026-10-29(의뢰인 요청 — "원곡을 듣고 고쳐야지") — 원곡 분리 음원(스템)
  // 로딩. PracticeCanvas.tsx의 같은 효과와 같은 가드(audioOffsetMs===0,
  // 스템 종류 1개 이상)를 쓰되, 이 화면은 song이 바뀌지 않아(마운트 1회)
  // "곡 전환" 관련 복잡도는 없다.
  // useMemo로 참조를 안정시킴 — song.available_audio_kinds는 이 화면에서
  // 안 바뀌지만, .filter()가 매 렌더 새 배열을 만들면 아래 effect들의
  // 의존성 배열에 넣었을 때 매번 다시 돌게 된다.
  const stemKinds = useMemo(
    () => song.available_audio_kinds.filter((k) => k !== 'original') as ChannelKey[],
    [song.available_audio_kinds],
  )
  const canUseAudioTracks = initialScore.audioOffsetMs === 0 && stemKinds.length > 0
  const audioTrackPoolRef = useRef<AudioTrackPool | null>(null)
  const [audioTracksLoading, setAudioTracksLoading] = useState(canUseAudioTracks)
  const [audioTracksAvailable, setAudioTracksAvailable] = useState(false)
  // 재생 시작 시점에 audioOffsetMs=0인 원본 BPM을 "오디오 파일의 실제
  // 속도 기준"으로 고정(initialScore 기준 — 세션 중 meta.bpm을 편집해도
  // 음원 파일 자체의 길이·속도는 그대로이므로). scorePlayer.ts가
  // playbackRate = playbackBpm/score.meta.bpm을 쓰는 것과 같은 원칙 —
  // 지금 편집 중인 meta.bpm을 "연습 속도"처럼, 로딩 시점 BPM을 "원곡
  // 속도"처럼 다룬다.
  const initialBpmRef = useRef(initialScore.meta.bpm)

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

  // 재생 중 믹서가 바뀌면 즉시 반영(practice 화면과 같은 원칙).
  useEffect(() => {
    const voicesSession = voicesSessionRef.current
    if (voicesSession) voicesSession.synthGain.gain.value = effectiveGain(mixerState.synth_drums)
    const session = playbackSessionRef.current
    if (session) {
      session.metronome.setVolume(metronomeGainToDb(effectiveGain(mixerState.metronome)))
      if (session.tracks) {
        for (const key of stemKinds) {
          session.tracks.setChannelGain(key, effectiveGain(mixerState[key]))
        }
      }
    }
  }, [mixerState, stemKinds])

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
      // 60fps 그대로 setState하면 노트가 많을 때 매 프레임 전체 그리드가
      // 다시 렌더돼 버벅일 수 있어(PracticeCanvas.tsx가 재생 위치를 React
      // state 대신 DOM ref에 직접 쓰는 것과 같은 이유), 초당 약 10회로
      // 줄인다 — 시간 표시·재생 위치선은 이 정도로도 충분히 매끄럽다.
      const seconds = clock.getPositionSeconds()
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
        const latest = stateRef.current
        const playbackRate = latest.meta.bpm / initialBpmRef.current
        const expectedSongPositionSeconds = audioTrackPositionSeconds(seconds, 0, playbackRate)
        session.tracks.resync(expectedSongPositionSeconds, TRACK_RESYNC_THRESHOLD_SECONDS)
      }
      rafIdRef.current = requestAnimationFrame(loop)
    }
    rafIdRef.current = requestAnimationFrame(loop)
  }

  function secondsToTicks(seconds: number): number {
    return Math.max(0, Math.round(seconds * (meta.bpm / 60) * ppq))
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
      synthGain = new Tone.Gain(effectiveGain(mixerStateRef.current.synth_drums)).connect(limiter)
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
    })
    playbackSessionRef.current = { handle, metronome, tracks }

    const clock = getMasterClock()
    // scorePlayer.ts는 항상 0초부터 스케줄하고 시작한다(count-in 없이도
    // "곡 시작"은 0초) — 재생 시작 직후 바로 지금 커서 위치로 점프한다.
    // 이미 지난 노트의 schedule() 콜백은 그 시각을 넘어서면 자동으로
    // 스킵되는 Tone.js 표준 동작이라(실제 설치된 Transport 소스 기준) 안전.
    const positionSeconds = ticksToSeconds(cursorTicksRef.current, latestState.ppq, latestState.meta.bpm)
    clock.setPositionSeconds(positionSeconds)
    if (tracks) {
      // "원곡 속도" 대비 "지금 편집 중인 BPM"의 비율 — PracticeCanvas.tsx의
      // playbackRate = playbackBpm/score.meta.bpm과 같은 식(위 initialBpmRef
      // 코멘트 참고). audioOffsetMs===0일 때만 tracks가 있으므로 곡 시작
      // 기준점(songStartSeconds)은 항상 0.
      const playbackRate = latestState.meta.bpm / initialBpmRef.current
      tracks.playFrom(audioTrackPositionSeconds(positionSeconds, 0, playbackRate), playbackRate)
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
    gridScrollRef.current.scrollLeft = Math.max(0, targetPx - ROW_LABEL_WIDTH - 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRowClick(e: React.MouseEvent<HTMLDivElement>, piece: DrumPiece) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relativeX = e.clientX - rect.left + e.currentTarget.scrollLeft
    if (relativeX < ROW_LABEL_WIDTH) return // 고정 레이블 거터 클릭은 무시
    const tick = pxToSnappedTick(relativeX)
    const id = nextIdRef.current++
    const newNote: EditableNote = {
      _editorId: id,
      tick,
      piece,
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

  const selectedNote =
    selectedIds.size === 1 ? (state.notes.find((n) => selectedIds.has(n._editorId)) ?? null) : null
  const selectedMulti = useMemo(
    () =>
      selectedIds.size >= 2
        ? state.notes.filter((n) => selectedIds.has(n._editorId)).sort((a, b) => a.tick - b.tick)
        : [],
    [selectedIds, state.notes],
  )

  function updateSelectedNote(patch: Partial<DrumNote>) {
    if (selectedNote === null) return
    commit({
      ...state,
      notes: state.notes.map((n) =>
        n._editorId === selectedNote._editorId ? { ...n, ...patch } : n,
      ),
    })
  }

  function deleteSelectedNote() {
    if (selectedNote === null) return
    commit({ ...state, notes: state.notes.filter((n) => n._editorId !== selectedNote._editorId) })
    setSelectedIds(new Set())
  }

  function setSelectedHand(hand: Hand) {
    updateSelectedNote({ hand, handSource: hand === null ? undefined : 'user' })
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

  function moveSelected(deltaTicks: number, deltaRows: number) {
    if (selectedNote === null) return
    // ppq가 격자 분할 수로 나누어떨어지지 않으면 unitTicks 자체가 정수가 아닐 수
    // 있어(Codex 모드A 지적, grid.ts의 snapTick 주석 참고) 더한 뒤 다시 격자에
    // 스냅해 항상 정수·격자정렬 틱을 보장한다.
    const nextTick = snapTick(Math.max(0, selectedNote.tick + deltaTicks), gridUnit, ppq)
    const rowIdx = editorRowIndexForPiece(selectedNote.piece)
    const nextRowIdx = Math.min(EDITOR_ROWS.length - 1, Math.max(0, rowIdx + deltaRows))
    updateSelectedNote({ tick: nextTick, piece: EDITOR_ROWS[nextRowIdx].piece })
  }

  function setSelectedVelocityTier(tier: VelocityTier) {
    updateSelectedNote({ velocity: VELOCITY_TIERS[tier] })
  }

  // Codex 모드C C-004: 그리드 컨테이너 자체(tabIndex=0)에만 바인딩 — 이벤트가
  // 여기까지 올라왔다는 건 포커스가 BPM/박자표 입력창 등 바깥 요소가 아니라
  // 그리드 안에 있다는 뜻이라, 별도의 "input이면 무시" 분기 없이도 바깥 요소의
  // 키보드 동작(타이핑, 버튼 Enter/Space)을 건드리지 않는다.
  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (selectedNote === null) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveSelected(-unitTicks, 0)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveSelected(unitTicks, 0)
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

  async function handleSave() {
    const score = toDrumScore(state)
    const validation = validateDrumScore(score)
    if (!validation.valid) {
      setSaveError(`악보 데이터가 올바르지 않습니다: ${validation.errors.join(', ')}`)
      return
    }
    setSaveError(null)
    setIsSaving(true)
    try {
      await saveSongDrumScore(song.id, score)
      lastSavedStateRef.current = state
      onSaved()
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '저장에 실패했습니다')
    } finally {
      setIsSaving(false)
    }
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
        <button onClick={onCancel}>← 라이브러리</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          BPM
          {/* PracticeCanvas.tsx의 BPM 입력과 같은 원칙 — "재생 시작 시점의
           * BPM으로 이미 스케줄돼 있어, 재생 중 바꿔도 지금 재생엔 반영
           * 안 됨(다음 재생부터 적용)" — 혼란을 막기 위해 재생 중엔 잠금.
           * 재생 위치 표시(초→틱 환산)가 재생 중 내내 같은 BPM을 가정하는
           * 전제이기도 하다. */}
          <input
            type="number"
            min={1}
            value={meta.bpm}
            onChange={(e) => commit({ ...state, meta: { ...meta, bpm: Number(e.target.value) } })}
            disabled={isPlaying}
            style={{ width: 64 }}
          />
        </label>
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
          onClick={() => void handleSave()}
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
        <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.9em' }}>
          {formatMmSs(currentSeconds)}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
          {audioTracksAvailable
            ? '원곡 음원 + 신스 드럼을 함께 재생합니다.'
            : canUseAudioTracks
              ? audioTracksLoading
                ? '원곡 음원을 불러오는 중…'
                : '원곡 음원을 불러오지 못해 신스 드럼만 재생됩니다.'
              : '이 곡은 음원 분리가 안 돼 있어 신스 드럼만 재생됩니다.'}
        </span>
        {playbackError && (
          <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.85em' }}>
            {playbackError}
          </span>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginLeft: 'auto' }}>
          {(audioTracksAvailable
            ? (['synth_drums', 'metronome', ...stemKinds] as const)
            : (['synth_drums', 'metronome'] as const)
          ).map((key) => (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: '0.85em' }}
            >
              {CHANNEL_LABEL[key]}
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(mixerState[key].volume * 100)}
                onChange={(e) => updateChannel(key, { volume: Number(e.target.value) / 100 })}
                style={{ width: 80 }}
              />
            </label>
          ))}
        </div>
      </div>

      {selectedNote && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span>
            선택됨: {EDITOR_ROWS[editorRowIndexForPiece(selectedNote.piece)]?.label} · 틱{' '}
            {selectedNote.tick} · 셈여림 {velocityTierOf(selectedNote.velocity)} · 손:{' '}
            {selectedNote.hand
              ? `${HAND_LABEL[selectedNote.hand]}${selectedNote.handSource === 'user' ? '(지정)' : '(추천)'}`
              : '미지정'}
          </span>
          <button onClick={() => setSelectedVelocityTier('soft')}>약</button>
          <button onClick={() => setSelectedVelocityTier('mid')}>중</button>
          <button onClick={() => setSelectedVelocityTier('strong')}>강</button>
          <button onClick={() => setSelectedHand('R')}>R</button>
          <button onClick={() => setSelectedHand('L')}>L</button>
          <button onClick={() => setSelectedHand('RF')}>RF</button>
          <button onClick={() => setSelectedHand('LF')}>LF</button>
          <button onClick={() => setSelectedHand(null)}>손 지우기</button>
          <button onClick={deleteSelectedNote}>삭제</button>
        </div>
      )}

      {selectedMulti.length >= 2 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span>선택: {selectedMulti.length}개 노트</span>
          <button onClick={() => applyAlternateHands('R')}>RLRL 교대</button>
          <button onClick={() => applyAlternateHands('L')}>LRLR 교대</button>
        </div>
      )}

      {saveError && <p style={{ color: 'var(--danger)' }}>{saveError}</p>}

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
            key={row.piece}
            data-testid={`editor-row-${row.piece}`}
            onClick={(e) => handleRowClick(e, row.piece)}
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
                zIndex: 1,
              }}
            >
              {row.label}
            </span>
            {state.notes
              .filter((n) => n.piece === row.piece)
              .map((note) => {
                const isSelected = selectedIds.has(note._editorId)
                return (
                  <button
                    key={note._editorId}
                    aria-label={`${row.label} 노트, 틱 ${note.tick}${note.hand ? ` ${HAND_LABEL[note.hand]}${note.handSource === 'user' ? '(지정)' : '(추천)'}` : ''}${isSelected ? ' (선택됨)' : ''}`}
                    onClick={(e) => handleNoteClick(e, note._editorId)}
                    style={{
                      position: 'absolute',
                      left: tickToPx(note.tick) - NOTE_SIZE / 2,
                      top: (ROW_HEIGHT - NOTE_SIZE) / 2,
                      width: NOTE_SIZE,
                      height: NOTE_SIZE,
                      borderRadius: '50%',
                      border: isSelected ? '2px solid var(--warning)' : '1px solid var(--border)',
                      background: readPieceColor(note.piece),
                      padding: 0,
                      cursor: 'pointer',
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
        {/* 2026-10-29(의뢰인 요청) — 재생 위치선. 그리드 콘텐츠와 같은 스크롤
         * 영역 안에 절대 위치시켜, 가로 스크롤 시 노트와 같이 움직인다. */}
        <div
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
