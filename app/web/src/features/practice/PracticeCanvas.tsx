import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import {
  Drum,
  FastForward,
  Music2,
  Pause,
  Play,
  Repeat,
  Rewind,
  RotateCcw,
  Timer,
  Volume2,
  VolumeX,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import {
  audioTrackPositionSeconds,
  barDurationSeconds,
  barIndexForSeconds,
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
  isMusicMuted,
  linearGainToDb,
  musicVolume,
  playDrumScore,
  setMusicMuted,
  setMusicVolume,
  toggleDrumlessPreset,
  type AudioTrackPool,
  type ChannelKey,
  type ChannelState,
  type DrumVoiceMap,
  type LoopBars,
  type Metronome,
  type MixerState,
  type PlaybackHandle,
  type TrackPlayer,
} from '../../audio'
import { fetchPracticeSetting, saveMixerSetting, songAudioUrl } from '../../api/songs'
import type { DrumPiece, DrumScore, Hand } from '../../score/types'
import { createLaneRenderer, type LaneRenderer } from '../../render/laneRenderer'
import { KitIllustration } from '../../render/KitIllustration'

// 연습 화면의 레인+킷 렌더러 + BPM 변경·A-B 루프(T2-4, REQ-04) 컨트롤을 실제로
// 돌려보는 데모 컴포넌트. 라이브러리 연동(T2-5)은 범위 밖(work/T2-4/plan.md §범위).

/** REQ-04 "카운트인: 재생 전 1마디" — 진행바 계산(아래 rAF 루프)과 실제 재생
 * 호출(handlePlay)이 같은 값을 써야 하므로 상수로 공유한다. */
const COUNT_IN_BARS = 1

// T3-3(REQ-04, work/T3-3/plan.md §5) — 느슨한 값(최종 확정 아님, 실기기 QA로
// 조정 가능). ±30ms처럼 빡빡하게 두면 T0-5가 실측한 "고정 지연처럼 보이는
// 어긋남"을 매번 다시 감지해 끊어 재생하는(stutter) 역효과를 낼 위험이 있어,
// "루프 경계 같은 큰 점프"만 잡고 고정 지연 수준은 상시 보정하지 않게 한다.
const TRACK_RESYNC_INTERVAL_MS = 750
const TRACK_RESYNC_THRESHOLD_SECONDS = 0.1

// 2026-10-25(의뢰인 요청) — "노트가 떨어지는 크기는 고정"(아래 <canvas> 참고).
// T3-11 게이트 피드백 3차(2026-10-25, 의뢰인 "폭을 조금 더 줄여도 될거 같아") —
// 520 → 400으로 축소. 추정치라 intent/07-open-questions.md Q-29 갱신.
const PRACTICE_LANE_MAX_WIDTH_PX = 400

// T3-4(REQ-05) — 믹서 UI에 쓸 채널 표시 이름. 2026-10-27(의뢰인 요청) —
// 아이콘으로 바꾸면서도 label은 그대로 남겨 title/aria-label(스크린리더,
// 호버 툴팁)로 쓴다 — 아이콘만으로는 "신스 드럼"처럼 뜻이 안 통하는 채널이
// 있어 접근성·설명 둘 다 이 문자열이 책임진다.
const CHANNEL_LABELS: Record<ChannelKey, string> = {
  stem_drums: '드럼(원곡)',
  stem_bass: '베이스',
  stem_vocals: '보컬',
  // T3-4 게이트 피드백 3차(2026-10-25) — "기타 악기"가 "기타(guitar)"로
  // 오해될 수 있다는 의뢰인 지적 반영. "기타"는 원래 "그 외(etc.)"의 뜻 —
  // Demucs 4-스템 분리는 드럼/베이스/보컬/그 외(멜로디 악기 전부 포함, 더
  // 세분화 불가)로만 나뉜다는 걸 명확히 하려고 "그 외 악기"로 바꿈.
  stem_other: '그 외 악기',
  // 2026-10-27(의뢰인 요청) — 아이콘만으론 "신스 드럼"이 뭔지 모를 수 있다는
  // 지적에, 풀어쓴 설명을 title에 쓸 수 있게 라벨 자체에 괄호 설명을 덧붙임
  // (너무 길면 안 된다고 하셨으니 "자동 채보 기반"처럼 짧게).
  synth_drums: '신스 드럼(자동 채보 기반)',
  metronome: '메트로놈',
}

// T3-4 게이트 피드백 3차(2026-10-25) — 믹서에 개별 행으로 그리는 채널.
// stem_bass/stem_vocals/stem_other는 "음악(전체)" 한 행으로 묶여 렌더링되므로
// 여기선 제외(아래 MixerRow 목록에서 stem_drums 바로 다음에 수동으로 끼워 넣음).
const MIXER_ROW_KEYS: ChannelKey[] = ['stem_drums', 'synth_drums', 'metronome']

// 2026-10-27(의뢰인 요청) — 채널 이름 글자 대신 아이콘. "원곡 드럼"과
// "신스 드럼"은 둘 다 드럼이라 같은 아이콘을 쓰면 구분이 안 되므로 원곡은
// Drum(실제 녹음), 신스는 Waves(합성/자동 생성 느낌)로 의도적으로 다른
// 아이콘을 골랐다.
const MIXER_ROW_ICONS: Record<ChannelKey, LucideIcon> = {
  stem_drums: Drum,
  stem_bass: Music2,
  stem_vocals: Music2,
  stem_other: Music2,
  synth_drums: Waves,
  metronome: Timer,
}

interface MixerRowProps {
  label: string
  icon: LucideIcon
  volume: number
  muted: boolean
  onVolumeChange: (volume: number) => void
  onMutedChange: (muted: boolean) => void
}

/** T3-4 믹서 한 행(채널 1개 또는 묶음) — 피드백 3차에서 "음악(전체)" 묶음
 * 행을 추가하며 기존 CHANNEL_KEYS.map() 안에 있던 JSX를 재사용 가능하게 뺌.
 * T3-8(2026-10-25, 의뢰인 요청) — 솔로(S) 버튼 제거("필요없다").
 * 2026-10-27(의뢰인 요청) — 글자 라벨 대신 아이콘(title로 설명 유지),
 * 슬라이더는 얇은 트랙 + 긴 타원 손잡이(index.css .mixer-slider), M
 * 체크박스는 Mute 버튼으로(켜짐/꺼짐 시각을 아이콘·색으로 다르게). */
function MixerRow({ label, icon: Icon, volume, muted, onVolumeChange, onMutedChange }: MixerRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        opacity: muted ? 0.5 : 1,
        borderRadius: 4,
        padding: '2px 4px',
      }}
    >
      <span title={label} style={{ width: 28, display: 'flex', justifyContent: 'center' }}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <input
        type="range"
        className="mixer-slider"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
        aria-label={label}
      />
      <span style={{ width: 36, textAlign: 'right' }}>{Math.round(volume * 100)}%</span>
      <button
        type="button"
        className={muted ? 'mute-btn mute-btn--active' : 'mute-btn'}
        title={muted ? `${label} 음소거 해제` : `${label} 음소거`}
        onClick={() => onMutedChange(!muted)}
      >
        {muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
        Mute
      </button>
    </div>
  )
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

/** 폰 세로 화면 판별 — intent/04-ui-ux.md §3 "폰 세로 = 레인만(킷은 축소 아이콘)".
 * 폭<높이(세로 방향) AND 폭이 좁음(태블릿보다 작음)을 기준으로 함 — 구체 임계값은
 * work/T2-3/plan.md §가정, qa-evidence/T2-3/result.md에서 실기기로 재확인 예정. */
function usePortraitPhoneLayout(): boolean {
  const [isPortraitPhone, setIsPortraitPhone] = useState(
    () => window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px) and (orientation: portrait)')
    const onChange = () => setIsPortraitPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isPortraitPhone
}

export interface PracticeCanvasProps {
  score: DrumScore
  barsVisible?: number
  /** T3-3(REQ-04) — 분리된 오디오 트랙 재생에 필요. `songId`/`availableAudioKinds`
   * 둘 다 있고 `score.audioOffsetMs===0`일 때만 오디오 트랙을 튼다
   * (work/T3-3/plan.md §범위경계 — 비0이면 이 재생 세션은 MIDI만, T3-5 범위). */
  songId?: number
  availableAudioKinds?: string[]
}

export function PracticeCanvas({
  score,
  // 2026-10-26(의뢰인 피드백) — 기본값 2마디는 노트가 자주 겹쳐 보여 읽기
  // 어렵다는 재지적. T3-2 게이트 피드백 1차(실제 음원 QA)에서 이미 "1마디로
  // 하면 개별 타격이 또렷이 분리된다"고 확인된 적이 있어, 그 결론대로 기본값을
  // 1로 바꿈(조절 가능한 컨트롤 자체는 그대로 유지 — intent/04-ui-ux.md 참고).
  barsVisible: initialBarsVisible = 1,
  songId,
  availableAudioKinds = [],
}: PracticeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LaneRenderer | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [activeHandByPiece, setActiveHandByPiece] = useState<ReadonlyMap<DrumPiece, Hand>>(new Map())
  const [isPlaying, setIsPlaying] = useState(false)
  // T3-6(REQ-04) — "일시정지": isPlaying과 별개 상태(최소 침습, 3상태 union으로
  // 안 바꿈). isPlaying && isPaused가 동시에 true인 경우는 없음(전이는 아래
  // handlePause/handlePlay/stopPlayback 세 곳에서만 일어나고 전부 동기적으로
  // 완결됨 — work/T3-6/plan.md §4 "전이 원자성").
  const [isPaused, setIsPaused] = useState(false)
  // T3-13 모드A 지적(Medium) — 재생/일시정지를 토글 버튼 하나로 합치면서
  // 버튼에 disabled가 전혀 없어졌는데, handlePlay()의 "새 세션" 경로는
  // voices/트랙 로딩 등 비동기 구간이 있어 그 사이 토글을 연타하면
  // stopPlayback()→새 세션 생성이 여러 번 겹쳐 돌 수 있음(세션 id 가드로
  // 재생 자체가 깨지진 않지만 불필요하게 반복 — Web Audio 그래프까지 다시
  // 만드는 낭비, 체감 버벅임 유발 가능). ref는 handlePlay() 재진입을 리렌더
  // 전에 즉시 막기 위함(동기 가드), state는 버튼 disabled 표시용.
  const isStartingRef = useRef(false)
  const [isStarting, setIsStarting] = useState(false)
  const isPortraitPhone = usePortraitPhoneLayout()
  // 재생 중인 핸들·보이스를 들고 있다가 정지/언마운트 시 반드시 정리한다 —
  // 안 그러면 Transport에 예약된 이벤트가 남아 있다가 재생을 다시 시작했을 때
  // 이미 폐기된(또는 아직 로드 전인) 버퍼로 Player.start()를 호출해 실제로
  // "buffer is either not set or not loaded" 예외가 나는 것을 실제 브라우저로
  // 재현 확인함(work/T2-3/plan.md, qa-evidence/T2-3/result.md).
  const playbackRef = useRef<{
    handle: PlaybackHandle
    voices: DrumVoiceMap
    tracks: TrackPlayer | null
    // T3-4(REQ-05) — 신스 드럼 9종이 공용으로 거치는 게인(한 값으로 전체
    // 조절). Metronome은 이번에 처음 재생 흐름에 연결됨(work/T3-4/plan.md §1).
    synthGain: Tone.Gain
    // T3-7 모드A 1라운드 지적(리스크) — 킥(+9dB 보정)과 스네어(원래부터
    // 피크 거의 0dB)처럼 서로 다른 신스 드럼 원샷이 정확히 같은 순간
    // 겹치면 합산 파형이 0dBFS를 넘어 디지털 클리핑(찢어지는 소리)이 날
    // 수 있음. synthGain 바로 뒤에 리미터를 둬 그 위험을 크게 줄인다
    // (실제 설치된 Tone.js Limiter.js 소스 확인 — Compressor를 ratio 20·
    // attack 3ms·release 10ms로 감싼 전용 컴포넌트). 2라운드 지적(리스크)
    // 반영 — lookahead 버퍼가 없는 WebAudio DynamicsCompressorNode
    // 기반이라 "0dBFS를 절대 안 넘는다"는 수학적 보장은 아님(아래 생성
    // 지점 주석에 한계·마스터 판단 근거 상세 기록).
    limiter: Tone.Limiter
    metronome: Metronome
  } | null>(null)
  // Codex 모드A C-001(재현됨): 렌더 루프가 재생 여부와 무관하게 매 프레임
  // activePieces를 계산해서, 정지 중(마스터 클록 위치가 고정된 상태)에도
  // 그 고정 위치 근처에 노트가 있으면 킷이 계속 켜진 채로 남아있을 수 있었음
  // (예: 재생 전 초기 위치 0초에 틱 0 노트가 있으면 처음부터 켜진 채로 보임).
  // isPlaying을 ref로도 들고 있어 루프 안에서 "재생 중일 때만" 점등을 계산한다.
  const isPlayingRef = useRef(false)

  // --- BPM(REQ-04: 원곡 대비 50%~150%) ---
  const minBpm = Math.max(1, Math.round(score.meta.bpm * 0.5))
  const maxBpm = Math.round(score.meta.bpm * 1.5)
  const [playbackBpm, setPlaybackBpm] = useState(score.meta.bpm)
  // rAF 루프(아래)는 리렌더를 거치지 않고 매 프레임 최신 BPM을 읽어야 해서 ref로도
  // 들고 있는다 — oxlint react(refs)가 렌더 중 ref 쓰기를 금지해 effect에서 동기화.
  const playbackBpmRef = useRef(playbackBpm)
  useEffect(() => {
    playbackBpmRef.current = playbackBpm
  }, [playbackBpm])
  const bpmPercent = Math.round((playbackBpm / score.meta.bpm) * 100)

  // T3-16-feedback-6(네트워크, 2026-10-26, work/T3-16-feedback-6/plan.md) —
  // T3-16-feedback-3(단순 fetch() 프리페치)을 적용한 뒤에도 맥 네트워크
  // 탭으로 재확인해보니, 그 fetch() 캐시를 실제 `<audio>` 재생 엘리먼트가
  // 전혀 재사용하지 않고 재생할 때마다 처음부터 다시 받고 있었음(Q-35) —
  // 미디어 엘리먼트가 일반 fetch() 캐시와 별도 경로를 쓰는 것으로 추정.
  // 그래서 fetch() 프리페치 대신 **재생에 실제로 쓰일 그 `<audio>` 엘리먼트
  // 자체**를 화면 진입 시점에 미리 만들어(`preload="auto"`) 연습 화면이
  // 떠 있는 동안 재사용한다 — `handlePlay()`가 매번 새로 만들고
  // `stopPlayback()`이 매번 버리던 걸(이전엔 `createTrackPlayer()`/`dispose()`)
  // 풀(`AudioTrackPool`)로 소유권을 옮겨, 재생→리셋→재생을 반복해도 같은
  // 엘리먼트를 계속 씀 — 모드C 3라운드 검수 완료(엘리먼트당
  // createMediaElementSource() 1회 제약, 비동기 prime() 경쟁 상태, 정리 중
  // 예외 격리 등 반영).
  //
  // T3-16-feedback-7(네트워크, 2026-10-26, work/T3-16-feedback-7/plan.md,
  // 모드C 검수 완료) — T3-16-feedback-6 이후에도, 재생이 아직 버퍼링 안 된
  // 지점을 넘어서는 순간엔 여전히 끊길 여지가 있었음(의뢰인 재측정) —
  // `createAudioTrackPool()`이 이제 파일 전체를 미리 다 받은 뒤(비동기)에만
  // 풀을 돌려준다. 그 로딩이 끝날 때까지 재생 버튼을 막는다
  // (`audioTracksLoading`). 모드C 지적(C-002/C-004) 반영 — 곡을 빠르게 바꾸면
  // (이펙트가 cleanup된 뒤 이전 곡의 fetch가 늦게 끝남) `cancelled` 플래그로
  // 막되, 이 플래그는 이펙트 호출마다 새로 만드는 지역 변수라 "이전 곡"과
  // "현재 곡"의 상태를 자동으로 분리한다(다른 곡의 로딩 상태를 잘못 false로
  // 내리는 일이 없음) — ref 대입뿐 아니라 `setAudioTracksLoading` 호출도
  // 전부 이 가드 뒤에서만 한다.
  const audioTrackPoolRef = useRef<AudioTrackPool | null>(null)
  const [audioTracksLoading, setAudioTracksLoading] = useState(false)
  const availableAudioKindsKey = availableAudioKinds.join(',')
  useEffect(() => {
    audioTrackPoolRef.current = null
    // 직전 곡 이펙트가 로딩 중(true)으로 남겨뒀을 수 있어 매 호출마다 일단
    // false로 리셋 — 아래에서 실제로 비동기 작업을 시작할 때만 다시 true로
    // 올린다(이 리셋이 없으면 이전 곡 로딩 중 곡을 바꿨는데 새 곡이 바로
    // 아래 early return에 걸리는 경우 로딩 표시가 영원히 안 꺼짐).
    setAudioTracksLoading(false)
    if (songId === undefined) return
    const stemKinds = availableAudioKinds.filter((kind) => kind !== 'original')
    if (stemKinds.length === 0) return // MIDI-only 곡 등 — 만들 트랙 자체가 없음
    let cancelled = false
    setAudioTracksLoading(true)
    createAudioTrackPool(stemKinds.map((kind) => ({ kind, url: songAudioUrl(songId, kind) })))
      .then((pool) => {
        if (cancelled) {
          // 이미 다른 곡으로 넘어갔거나 화면을 떠남 — 이 결과는 안 쓰고
          // 바로 파괴(모드C 지적 C-002).
          pool.destroy()
          return
        }
        audioTrackPoolRef.current = pool
        setAudioTracksLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        // 모드C 3라운드(T3-16-feedback-6) 지적 패턴 재사용 — 조용히 포기,
        // handlePlay()가 보는 "풀이 없음"은 기존 canUseAudioTracks=false
        // (MIDI-only 등) 경로와 같은 모양이라 신스만 재생되는 폴백으로
        // 자연스럽게 이어짐. 다만 로딩 상태는 실패해도 반드시 풀어야
        // 재생 버튼이 영원히 "불러오는 중"에 안 멈춘다(모드C 지적 C-003).
        // eslint-disable-next-line no-console
        console.error('오디오 트랙 풀 생성 실패 — 이 세션은 신스 드럼만 재생됩니다', err)
        setAudioTracksLoading(false)
      })
    return () => {
      cancelled = true
      audioTrackPoolRef.current?.destroy()
      audioTrackPoolRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, availableAudioKindsKey])

  function clampBpm(value: number): number {
    if (Number.isNaN(value)) return playbackBpm
    return Math.min(maxBpm, Math.max(minBpm, Math.round(value)))
  }

  // 모바일 실사용 피드백(2026-10-25) — 숫자칸 값을 그대로 setState+clamp하면,
  // 지우는 순간(빈 문자열 → Number('')===0) 즉시 최솟값으로 되돌아가 버려서
  // "1을 지우고 3을 입력"이 "13"이 되는 버그가 있었다(최솟값이 0 초과인 모든
  // 숫자칸 공통 문제). 포커스 중엔 별도의 문자열 draft로 자유롭게 입력받고,
  // 포커스를 벗어날 때만 실제 상태로 커밋(clamp)한다 — 포커스 중이 아닐 땐
  // draft를 렌더링 중에 playbackBpm에서 바로 파생시켜(oxlint
  // react(set-state-in-effect) 권장대로 effect로 동기화하지 않음) 슬라이더
  // 등 다른 경로로 바뀐 값도 항상 반영되게 한다. BPM·루프 시작·루프 끝 3곳
  // 모두 같은 패턴.
  const [isEditingBpm, setIsEditingBpm] = useState(false)
  const [bpmDraft, setBpmDraft] = useState('')
  const bpmFieldValue = isEditingBpm ? bpmDraft : String(playbackBpm)

  // --- 보이는 마디 수(T3-2 게이트 피드백 1차 — 04-ui-ux.md "낙하 속도") ---
  // layout.ts의 pixelsPerSecond()가 보이는 마디 수와 무관하게 BPM이 수식에서
  // 상쇄되는 구조라(퀵 재생 BPM을 낮춰도 노트 사이 "픽셀 간격"은 안 바뀜),
  // 빠른 곡에서 짧은 간격으로 몰린 타격(예: 16분음표 런)이 화면에서 뭉쳐
  // 보이는 문제는 BPM이 아니라 이 값으로만 풀린다 — 의뢰인이 직접 겪은 문제라
  // 재생 중에도 즉시 바꿀 수 있게 둔다(BPM/루프와 달리 Transport 스케줄에
  // 영향 없는 순수 렌더링 파라미터이므로 재생 중 잠글 이유가 없음).
  const [barsVisible, setBarsVisible] = useState(initialBarsVisible)

  // --- A-B 루프(REQ-04, 마디 단위, 1-기준으로 표시·내부는 0-기준) ---
  const totalBars = useMemo(() => {
    const lastTick = Math.max(0, ...score.notes.map((n) => n.tick))
    return barIndexForTick(lastTick, score.meta.timeSignature, score.ppq) + 1
  }, [score])
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [loopStartBar1, setLoopStartBar1] = useState(1)
  const [loopEndBar1, setLoopEndBar1] = useState(Math.min(totalBars, 4))
  // 2026-10-27(의뢰인 요청) — "여기서 시작"/"여기까지" 두 버튼 + A-B 루프
  // 체크박스를 버튼 하나로 통합: idle("루프 시작") → 누르면 시작점을 찍고
  // start-marked("여기까지")로 → 누르면 끝점을 찍고(markLoopPointFromCurrentPosition가
  // 이 시점에 loopEnabled도 true로 켬) active("루프 진행중")로 → 누르면 루프를
  // 끄고 다시 idle로. loopEnabled 자체는 그대로 Transport 쪽 로직(위 live-reapply
  // effect 등)이 쓰므로 안 건드림 — 이 phase는 버튼 라벨/아이콘 전환 전용.
  const [loopPhase, setLoopPhase] = useState<'idle' | 'start-marked' | 'active'>('idle')

  // 위 BPM과 같은 이유(모바일 피드백) — 루프 시작/끝 숫자칸도 포커스 중에만
  // draft, 아닐 땐 렌더링 중 파생.
  const [isEditingLoopStart, setIsEditingLoopStart] = useState(false)
  const [loopStartDraft, setLoopStartDraft] = useState('')
  const loopStartFieldValue = isEditingLoopStart ? loopStartDraft : String(loopStartBar1)
  const [isEditingLoopEnd, setIsEditingLoopEnd] = useState(false)
  const [loopEndDraft, setLoopEndDraft] = useState('')
  const loopEndFieldValue = isEditingLoopEnd ? loopEndDraft : String(loopEndBar1)

  function clampLoopStart(value: number): number {
    if (Number.isNaN(value)) return loopStartBar1
    return Math.min(totalBars, Math.max(1, Math.round(value)))
  }
  function clampLoopEnd(value: number): number {
    if (Number.isNaN(value)) return loopEndBar1
    return Math.min(totalBars, Math.max(1, Math.round(value)))
  }

  // rAF 루프(아래)가 리렌더 없이 매 프레임 최신 루프 설정을 읽도록 ref로도
  // 들고 있는다(playbackBpmRef와 같은 이유 — oxlint react(refs)).
  const loopRef = useRef<LoopBars | null>(null)
  useEffect(() => {
    loopRef.current = loopEnabled ? { startBar: loopStartBar1 - 1, endBar: loopEndBar1 } : null
  }, [loopEnabled, loopStartBar1, loopEndBar1])

  // T3-9(REQ-04) — "곡이 끝나는 절대 위치"(카운트인 + 마지막 노트 + 안전
  // 여유, clock.getPositionSeconds()와 같은 좌표계) — handlePlay()가 자동
  // 정지 타이머를 걸 때, handleSeek()이 seek 후 그 타이머를 다시 계산할
  // 때, 아래 루프 상태 반영 effect가 전부 쓴다. 공식을 한 곳으로 모아
  // 서로 다른 값을 쓰는 불일치를 막는다(work/T3-9/plan.md §7). useCallback
  // 으로 감싸 아래 effect의 의존성 배열에 안전하게 넣을 수 있게 함(안
  // 감싸면 매 렌더 새 함수라 effect가 불필요하게 매번 재실행됨).
  const songEndPositionSeconds = useCallback((): number => {
    const countInSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpm)
    const lastTick = Math.max(0, ...score.notes.map((n) => n.tick))
    const lastNoteSeconds = (lastTick / score.ppq) * (60 / playbackBpm)
    const safetyMarginSeconds = 4 // 크래시/라이드 등 길게 울리는 샘플이 다 끝날 시간
    return countInSeconds + lastNoteSeconds + safetyMarginSeconds
  }, [score, playbackBpm])

  // T3-9(REQ-04) 모드C 1라운드 C-001 반영 — 루프 설정이 바뀌어도
  // playDrumScore()는 재생 시작 시점에 딱 한 번만 transport.setLoopPoints()/
  // transport.loop를 걸기 때문에, 이미 돌고 있는 세션에는 반영이 안 됐다.
  // "여기서 시작/여기까지"(아래 markLoopPointFromCurrentPosition)처럼
  // 재생 중에도 쓸 수 있는 조작이 생긴 이상, 루프 상태 변경은 항상 살아있는
  // 세션에 즉시 반영돼야 한다 — 재생 중 믹서 상태 반영(위)과 같은 패턴,
  // playbackRef.current 존재 여부로만 게이트(work/T3-9/plan.md §6, Transport의
  // 루프 경계 판정이 매 틱 그 순간 값을 읽는다는 걸 실제 설치된 Tone.js
  // 소스로 확인한 근거 — plan.md §1).
  useEffect(() => {
    const session = playbackRef.current
    if (!session) return
    const clock = getMasterClock()
    if (!loopEnabled) {
      clock.setLoopEnabled(false)
      // 모드A 지적(Medium) 반영 — 루프가 꺼진(또는 아직 한 번도 안 켜진)
      // 상태인데 자동 정지 타이머가 없다면(null) 다시 세운다. 대칭을 맞추기
      // 위함 — handlePlay()가 재생을 "루프 없이" 시작하면 이미 타이머가
      // 걸려있을 테니 보통은 이 분기가 아무 일도 안 함(이미 null이 아님).
      if (autoStopRemainingMsRef.current === null) {
        const remainingMs = Math.max(0, (songEndPositionSeconds() - clock.getPositionSeconds()) * 1000)
        autoStopRemainingMsRef.current = remainingMs
        if (!isPaused) {
          autoStopScheduledAtRef.current = performance.now()
          const handle = session.handle
          autoStopTimerIdRef.current = setTimeout(() => {
            if (playbackRef.current?.handle === handle) stopPlayback()
          }, remainingMs)
        }
      }
      return
    }
    // 모드A 지적(Medium) 반영 — 루프가 켜지면(예: 재생 중 "여기까지"로
    // 마킹) handlePlay()가 애초에 루프로 시작했을 때와 같은 규칙을 적용:
    // 자동 정지 타이머 자체를 없앤다(work/T2-4/plan.md §설계 "루프 중엔
    // 사용자가 직접 정지할 때까지 반복"). 안 그러면 루프를 막 시작했는데
    // 전체 곡 길이 기준으로 걸려있던 기존 타이머가 루프 도중 재생을
    // 끊어버릴 수 있었음.
    if (autoStopTimerIdRef.current !== null) clearTimeout(autoStopTimerIdRef.current)
    autoStopTimerIdRef.current = null
    autoStopRemainingMsRef.current = null
    const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpm)
    const songStartSeconds = barSeconds * COUNT_IN_BARS
    clock.setLoopPoints(
      songStartSeconds + barSeconds * (loopStartBar1 - 1),
      songStartSeconds + barSeconds * loopEndBar1,
    )
    clock.setLoopEnabled(true)
  }, [
    loopEnabled,
    loopStartBar1,
    loopEndBar1,
    playbackBpm,
    score.meta.timeSignature,
    isPaused,
    songEndPositionSeconds,
  ])

  // --- T3-4(REQ-05) 믹서: 볼륨/음소거/솔로 — work/T3-4/plan.md ---
  const [mixerState, setMixerState] = useState<MixerState>(defaultMixerState())
  const mixerStateRef = useRef(mixerState)
  useEffect(() => {
    mixerStateRef.current = mixerState
  }, [mixerState])

  // 2026-10-27(의뢰인 요청) — "원곡 드럼 끄기로 신스 드럼이 돌아올 때 무조건
  // 100%라 너무 크게 들린다" 지적 — 신스 드럼이 0이 아니었던 마지막 볼륨을
  // 기억해뒀다가(사용자가 직접 슬라이더로 맞춘 값이든, 복원으로 돌아온
  // 값이든) applyDrumlessPreset에서 그 값으로 복원한다. 0일 때는 갱신 안
  // 함(끌 때마다 0을 "마지막 값"으로 기억하면 복원이 항상 0이 돼 의미가
  // 없어짐).
  const lastSynthDrumsVolumeRef = useRef(mixerState.synth_drums.volume || 1)
  useEffect(() => {
    if (mixerState.synth_drums.volume > 0) {
      lastSynthDrumsVolumeRef.current = mixerState.synth_drums.volume
    }
  }, [mixerState.synth_drums.volume])

  // T3-4 모드A 1라운드 지적(High) — 불러오기(GET)가 아직 끝나기 전에
  // 사용자가 믹서를 직접 조작하면, 뒤늦게 도착하는 GET 응답이 그 조작을
  // 덮어써버릴 수 있었다. 사용자가 한 번이라도 조작했으면 그 이후의 GET
  // 응답은 무시한다 — 사용자의 지금 조작이 항상 이긴다(그 상태는 어차피
  // 아래 저장 로직이 알아서 서버에 반영함).
  const userHasEditedMixerRef = useRef(false)

  // 마운트 시(=곡 진입 시, 이 컴포넌트는 곡이 바뀌면 통째로 다시 마운트됨)
  // 저장된 설정을 불러온다 — §4.
  useEffect(() => {
    if (songId === undefined) return
    let cancelled = false
    fetchPracticeSetting(songId)
      .then(({ volumes }) => {
        if (cancelled || userHasEditedMixerRef.current) return
        if (!volumes) {
          setMixerState(defaultMixerState())
          return
        }
        // 모드C 1라운드 C-006 — 알 수 없는/누락된 채널 키는 방어적으로
        // 기본값으로 채움(저장 형식이 나중에 바뀌어도 안 깨지게).
        const merged = defaultMixerState()
        for (const key of CHANNEL_KEYS) {
          if (volumes[key]) merged[key] = volumes[key]
        }
        setMixerState(merged)
      })
      .catch(() => {
        if (!cancelled && !userHasEditedMixerRef.current) setMixerState(defaultMixerState())
      })
    return () => {
      cancelled = true
    }
  }, [songId])

  // 저장 요청 직렬화(모드C 2라운드 지적 반영) — 한 곡에 대해 이 탭에서 PUT이
  // 클라이언트가 인지하는 한 항상 1개씩만 뜨도록: 진행 중이면 새로 안 보내고
  // 플래그만 세우고, 끝나면 그 시점의 최신 상태로 한 번만 더 보낸다. 모호한
  // 네트워크 실패 시의 좁은 순서 역전 잔존 위험은 마스터가 수용한 한계(§마스터
  // 최종 판단).
  const savingRef = useRef(false)
  const pendingSaveRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function doSaveMixer(targetSongId: number) {
    if (savingRef.current) {
      pendingSaveRef.current = true
      return
    }
    savingRef.current = true
    try {
      await saveMixerSetting(targetSongId, mixerStateRef.current)
    } catch {
      // 실패해도 조용히 넘어감 — 다음 변경 때 다시 저장 시도됨, 믹서 설정
      // 하나가 잠깐 이전 값으로 남는 정도라 치명적이지 않음.
    } finally {
      savingRef.current = false
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false
        await doSaveMixer(targetSongId)
      }
    }
  }

  function scheduleMixerSave() {
    if (songId === undefined) return
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void doSaveMixer(songId)
    }, 400)
  }

  // 언마운트·곡 전환 시 대기 중인 디바운스를 즉시 flush(모드C 1라운드 C-002).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        if (songId !== undefined) void doSaveMixer(songId)
      }
    }
  }, [songId])

  function updateChannel(key: ChannelKey, patch: Partial<ChannelState>) {
    userHasEditedMixerRef.current = true
    setMixerState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    scheduleMixerSave()
  }

  function applyDrumlessPreset() {
    userHasEditedMixerRef.current = true
    setMixerState((prev) => toggleDrumlessPreset(prev, lastSynthDrumsVolumeRef.current))
    scheduleMixerSave()
  }

  // T3-4 게이트 피드백 3차(2026-10-25, 의뢰인 요청) — "원곡 음악이 드럼보다
  // 너무 크다"는 지적에, 베이스·보컬·기타 악기(stem_bass/stem_vocals/
  // stem_other) 3채널을 UI에서 슬라이더·M 하나로 묶어 조작한다(T3-8에서
  // 솔로 제거돼 S는 없음). 저장되는 데이터 구조는 그대로(mixer.ts의
  // setMusicVolume/setMusicMuted가 3채널에 같은 값을 쓸 뿐) — 백엔드·
  // effectiveGain() 전부 무수정.
  function updateMusicVolume(volume: number) {
    userHasEditedMixerRef.current = true
    setMixerState((prev) => setMusicVolume(prev, volume))
    scheduleMixerSave()
  }

  function updateMusicMuted(muted: boolean) {
    userHasEditedMixerRef.current = true
    setMixerState((prev) => setMusicMuted(prev, muted))
    scheduleMixerSave()
  }

  // 재생 중 믹서 상태가 바뀌면 즉시 반영(REQ-05 "조작 즉시 반영" — BPM/루프와
  // 달리 재생 중에도 잠그지 않음). playbackRef.current 존재 여부로만 게이트해
  // handlePlay() 셋업 중의 경쟁을 원천 차단(모드C 1라운드 C-004).
  useEffect(() => {
    const session = playbackRef.current
    if (!session) return
    for (const key of CHANNEL_KEYS) {
      const gain = effectiveGain(mixerState[key])
      if (key === 'synth_drums') {
        session.synthGain.gain.value = gain
      } else if (key === 'metronome') {
        session.metronome.setVolume(linearGainToDb(gain))
      } else {
        session.tracks?.setChannelGain(key, gain)
      }
    }
  }, [mixerState])

  useEffect(() => {
    if (!canvasRef.current) return
    rendererRef.current = createLaneRenderer(canvasRef.current, {
      pieceColor: readPieceColor,
      laneBorderColor: getComputedStyle(document.documentElement)
        .getPropertyValue('--border')
        .trim(),
      laneBarColor: getComputedStyle(document.documentElement)
        .getPropertyValue('--lane-bar')
        .trim(),
      laneBeatColor: getComputedStyle(document.documentElement)
        .getPropertyValue('--lane-beat')
        .trim(),
      hitLineColor: getComputedStyle(document.documentElement)
        .getPropertyValue('--hit-line')
        .trim(),
      stickingTextColor: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
      laneHeaderBackgroundColor: getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim(),
      hitWindowSeconds: 0.06,
    })
  }, [])

  // T3-16(성능, 2026-10-26) — 의뢰인이 Safari 실기기 프로파일러로 T3-15 수정
  // 후에도 GC가 여전히 보인다고 재확인 — 원래 이 "바뀐 것만 반영" 체크
  // 자체가(배열 스프레드+map+sort+join으로 매 프레임 문자열을 새로 만듦)
  // 가비지를 만들고 있었음. 직전 Map을 그대로 들고 있다가 크기+항목을 직접
  // 비교(할당 없음)하는 방식으로 교체.
  const lastActiveMapRef = useRef<ReadonlyMap<DrumPiece, Hand>>(new Map())
  // 2026-10-27(의뢰인 요청) — "진행바가 계단식으로 찬다"는 지적. 바로 위
  // activeHandByPiece와 같은 이유로 예전엔 정수 %로 반올림해 값이 "실제로"
  // 바뀔 때만 setState했었다(매 프레임 setState하면 리렌더가 쌓여 T2-3/
  // T3-16에서 측정한 모바일 fps 저하가 재발함) — 그런데 그 최적화 자체가
  // "1%가 오르는 데 걸리는 몇 초 동안 멈춰있다가 한 번에 점프"하는 모양을
  // 만든 원인이었다(1% 미만의 변화는 아예 반영 안 됨). 이 값은 "바뀔 때만"이
  // 아니라 매 프레임의 실제 값을 그대로 보여줘야 부드러우므로 같은 최적화를
  // 쓸 수 없다 — 대신 React state를 거치지 않고 이 바를 가리키는 ref에
  // style.height를 매 프레임 직접 쓴다(한 엘리먼트의 한 CSS 속성만 바뀌는
  // DOM 쓰기라 VDOM diff·리렌더 없음 — 오히려 기존 setState보다 가벼움).
  const progressBarRef = useRef<HTMLDivElement>(null)
  // T3-3(REQ-04) — 오디오 트랙 리싱크 폴링 스로틀(위 TRACK_RESYNC_INTERVAL_MS).
  const lastTrackResyncAtRef = useRef(0)

  // T3-14(2026-10-25, 의뢰인 피드백 "모바일에서 노트 내려오는게 렉 걸린 것처럼
  // 버벅인다") — 원인 진단용 임시 FPS 계측. 영상을 ffmpeg로 프레임 분석해
  // "1초 뒤부터 몇 프레임 멈췄다가 한번에 건너뛰는" 패턴을 확인했으나, Claude가
  // 접근 가능한 브라우저로는 실제 모바일 CPU를 재현할 수 없어 원인을 추측하지
  // 않고 실기기에서 직접 재는 쪽을 택함. 1초에 한 번만 setState(그 자체가 매
  // 프레임 리렌더를 유발하지 않도록 — 계측 코드가 측정 대상을 오염시키면 안
  // 됨). 원인 특정 후 제거 예정(영구 기능 아님).
  const fpsFrameCountRef = useRef(0)
  const fpsWindowStartRef = useRef(performance.now())
  const [fpsDisplay, setFpsDisplay] = useState<number | null>(null)

  useEffect(() => {
    function loop() {
      // T3-14 FPS 계측(진단용 임시) — 이 loop() 자체가 매 애니메이션 프레임
      // 호출되므로, 호출 횟수를 1초 단위로 세면 실제 브라우저 프레임레이트.
      fpsFrameCountRef.current += 1
      const fpsNow = performance.now()
      if (fpsNow - fpsWindowStartRef.current >= 1000) {
        setFpsDisplay(
          Math.round((fpsFrameCountRef.current * 1000) / (fpsNow - fpsWindowStartRef.current)),
        )
        fpsFrameCountRef.current = 0
        fpsWindowStartRef.current = fpsNow
      }

      const clock = getMasterClock()
      const renderer = rendererRef.current
      const positionSeconds = clock.getPositionSeconds()
      // T2-8(Phase 2 게이트 피드백) — scorePlayer.ts가 노트 소리를
      // songStartSeconds(카운트인 길이)만큼 늦춰 스케줄링하므로, 화면도 같은
      // 기준으로 그려야 판정선 통과 시점과 소리가 맞는다.
      const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpmRef.current)
      const songStartSeconds = barSeconds * COUNT_IN_BARS
      // T3-3(REQ-04, work/T3-3/plan.md §5) — 저빈도 리싱크. 매 프레임이 아니라
      // TRACK_RESYNC_INTERVAL_MS마다만 확인(60fps로 매번 돌리면 아래 Date.now()
      // 호출 자체는 가볍지만, 의도적으로 "느슨한 폴링"이라는 설계를 코드로도
      // 분명히 하기 위해 스로틀 자체를 생략하지 않음).
      const tracks = playbackRef.current?.tracks
      if (isPlayingRef.current && tracks) {
        const now = Date.now()
        if (now - lastTrackResyncAtRef.current >= TRACK_RESYNC_INTERVAL_MS) {
          lastTrackResyncAtRef.current = now
          const playbackRate = playbackBpmRef.current / score.meta.bpm
          const expectedSongPositionSeconds = audioTrackPositionSeconds(
            positionSeconds,
            songStartSeconds,
            playbackRate,
          )
          tracks.resync(expectedSongPositionSeconds, TRACK_RESYNC_THRESHOLD_SECONDS)
        }
      }
      if (renderer) {
        // R/L 표시 제거(2026-10-25, 의뢰인 피드백 "안 맞는 게 너무 많아서") — 자동
        // 추천 손 배정 자체가 부정확해 레인/킷 어느 쪽도 더 이상 표시하지 않음.
        const rendered = renderer.render(
          score,
          positionSeconds,
          songStartSeconds,
          barsVisible,
          playbackBpmRef.current,
          false,
        )
        // 정지 중에는 마스터 클록 위치가 고정돼 있어, 그 고정 위치 근처에 노트가
        // 있으면 계속 "히트"로 잡혀 킷이 켜진 채 남는다 — 재생 중일 때만 점등
        // 계산을 반영한다(Codex 모드A C-001).
        const active: ReadonlyMap<DrumPiece, Hand> = isPlayingRef.current
          ? rendered.activeHandByPiece
          : new Map()
        // 성능: 대부분의 프레임은 활성 피스가 없거나 직전 프레임과 동일함(판정선
        // 근처에 노트가 있을 때만 바뀜) — 매 프레임 새 Map으로 setState하면
        // KitIllustration이 매 프레임(최대 60회/초) 리렌더되며, 실제 측정해보니
        // 평균 fps가 30fps로 떨어지는 걸 확인(REQ-06 목표 60fps 미달). 내용이
        // 실제로 바뀔 때만 setState하도록 바꿔 불필요한 리렌더를 없앤다
        // (qa-evidence/T2-3/result.md §fps 측정).
        let activeChanged = active.size !== lastActiveMapRef.current.size
        if (!activeChanged) {
          for (const [piece, hand] of active) {
            if (lastActiveMapRef.current.get(piece) !== hand) {
              activeChanged = true
              break
            }
          }
        }
        if (activeChanged) {
          lastActiveMapRef.current = active
          setActiveHandByPiece(active)
        }
      }
      // 마디 진행바 — activePieces와 같은 이유로, 정수 % 단위로 반올림해 실제로
      // 바뀔 때만 setState한다(그렇지 않으면 이 역시 매 프레임 리렌더를 유발해
      // T2-3에서 발견한 fps 저하가 재발함).
      //
      // Codex 모드A C-001(재현됨): 루프 중에도 "곡 전체 대비 진행률"로 계산하면,
      // 루프 구간이 긴 곡의 일부(예: 32마디 중 2마디)일 때 진행바가 한쪽 끝
      // 근처의 좁은 구간 안에서만 아주 조금 움직여 사실상 멈춘 것처럼 보임
      // (루프가 꺼져 있을 때만 "곡 전체 대비"가 의미 있는 지표). 루프 중엔 루프
      // 구간 자체를 0~100%로 삼아 "그 구간 안에서 어디까지 왔는지"를 보여준다.
      // barSeconds/songStartSeconds는 위에서 렌더러 호출용으로 이미 계산해 재사용.
      const activeLoop = loopRef.current
      let rawPercent = 0
      if (isPlayingRef.current) {
        if (activeLoop) {
          const loopStartSeconds = songStartSeconds + barSeconds * activeLoop.startBar
          const loopEndSeconds = songStartSeconds + barSeconds * activeLoop.endBar
          const loopDurationSeconds = loopEndSeconds - loopStartSeconds
          rawPercent =
            loopDurationSeconds > 0
              ? ((positionSeconds - loopStartSeconds) / loopDurationSeconds) * 100
              : 0
        } else {
          const songElapsedSeconds = positionSeconds - songStartSeconds
          rawPercent = totalBars > 0 ? (songElapsedSeconds / (barSeconds * totalBars)) * 100 : 0
        }
      }
      const clampedPercent = Math.min(100, Math.max(0, rawPercent))
      if (progressBarRef.current) {
        progressBarRef.current.style.height = `${clampedPercent}%`
      }
      rafIdRef.current = requestAnimationFrame(loop)
    }
    rafIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [score, barsVisible, totalBars])

  // T3-4 모드A 1라운드 지적(High) — handlePlay()의 비동기 셋업 구간(아래
  // await들 사이)에는 아직 playbackRef.current가 없어, 그 틈에 정지를
  // 누르거나 재생을 다시 누르면 지금 막 만들어지는 세션을 아무도 취소·정리
  // 못 했다. 매 handlePlay()/stopPlayback() 호출마다 세대 번호를 올려,
  // 셋업 중간중간 "내가 아직 최신 세션인지" 확인하게 한다.
  const playSessionIdRef = useRef(0)

  // T3-6(REQ-04) — 자동 정지 타이머의 "일시정지 중 흐른 시간"을 빼기 위한
  // 기준. performance.now()(단조 증가, Date.now()와 달리 시스템 시각 변경에
  // 안 틀어짐)를 쓴다. autoStopRemainingMsRef가 null이면 "이 세션엔 타이머
  // 자체가 없음"(루프 모드 — handlePlay() 끝에서 안 걺, work/T3-6/plan.md §4).
  const autoStopTimerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoStopRemainingMsRef = useRef<number | null>(null)
  const autoStopScheduledAtRef = useRef<number | null>(null)

  function pauseAutoStopTimer() {
    if (autoStopRemainingMsRef.current === null) return // 루프 모드 — 타이머 자체가 없음
    if (autoStopTimerIdRef.current !== null) clearTimeout(autoStopTimerIdRef.current)
    const elapsed = performance.now() - (autoStopScheduledAtRef.current ?? performance.now())
    autoStopRemainingMsRef.current = Math.max(0, autoStopRemainingMsRef.current - elapsed)
    autoStopTimerIdRef.current = null
  }

  function resumeAutoStopTimer(fn: () => void) {
    if (autoStopRemainingMsRef.current === null) return // 루프 모드
    autoStopScheduledAtRef.current = performance.now()
    autoStopTimerIdRef.current = setTimeout(fn, autoStopRemainingMsRef.current)
  }

  function stopPlayback() {
    playSessionIdRef.current += 1 // 진행 중인 handlePlay() 셋업이 있으면 무효화
    // 정지 버튼·자동 정지 자신·언마운트 cleanup이 전부 이 함수를 공유하므로,
    // 여기서 한 번에 리셋해야 모든 경로에 자동으로 적용된다.
    if (autoStopTimerIdRef.current !== null) clearTimeout(autoStopTimerIdRef.current)
    autoStopTimerIdRef.current = null
    autoStopRemainingMsRef.current = null
    autoStopScheduledAtRef.current = null
    setIsPaused(false)
    if (!playbackRef.current) return
    playbackRef.current.handle.stop()
    disposeDrumVoices(playbackRef.current.voices)
    // T3-4(REQ-05, work/T3-4/plan.md §3) — 공용 게인은 반드시
    // disposeDrumVoices() 다음에 지운다: 그 안에서 지금 울리고 있는 모든
    // Player를 먼저 끊은 뒤라, "아직 연결된 Player가 있는데 다운스트림
    // Gain부터 지워 끊기는" 경우가 없다. Player.dispose()는 이 Gain 자체를
    // 안 지우므로 명시적으로 여기서 지워야 함(안 하면 재생할 때마다 누적 leak).
    playbackRef.current.synthGain.dispose()
    // T3-7 — 리미터는 synthGain보다 더 다운스트림이라 같은 이유로 그 다음에
    // 지운다(이미 끊긴 뒤라 안전).
    playbackRef.current.limiter.dispose()
    playbackRef.current.metronome.dispose()
    // T3-16-feedback-6 — 예전엔 TrackPlayer가 재생 1회당 1개 수명이라 여기서
    // dispose()로 <audio> 엘리먼트까지 버렸음(work/T3-3/plan.md §4). 이제
    // 엘리먼트는 풀(AudioTrackPool)이 화면 수명 동안 들고 있으므로, 여기선
    // 이번 세션만 정리(일시정지+위치 0으로)하고 엘리먼트는 그대로 둬 다음
    // 재생이 재사용하게 한다 — work/T3-16-feedback-6/plan.md.
    playbackRef.current.tracks?.reset()
    playbackRef.current = null
    isPlayingRef.current = false
    lastActiveMapRef.current = new Map()
    lastProgressKeyRef.current = -1
    setActiveHandByPiece(new Map())
    setProgressPercent(0)
    setIsPlaying(false)
  }

  // T3-6(REQ-04) — "⏸ 일시정지". 모드C 3라운드 C-001 반영: 시작하자마자
  // playbackRef.current가 살아있는지부터 확인 — 그 사이(예: 자동 정지)에
  // 세션이 이미 끝났으면 아무 상태도 안 바꾸고 조용히 끝낸다(work/T3-6/
  // plan.md §4 "전이 원자성"). 살아있으면 Transport pause + 이미 커밋된
  // 원샷 정지(§3) + 분리 트랙 pause + 자동 정지 타이머 일시정지까지 전부
  // 동기적으로 완결한다.
  function handlePause() {
    if (!playbackRef.current) return
    playbackRef.current.handle.pause()
    playbackRef.current.metronome.stopRinging()
    pauseAutoStopTimer()
    isPlayingRef.current = false
    setIsPlaying(false)
    setIsPaused(true)
  }

  async function handlePlay() {
    // T3-13 모드A 지적(Medium) — "새 세션" 경로가 비동기로 도는 동안 토글을
    // 연타해도 재진입 안 하게 즉시 막는다(리렌더로 버튼이 disabled되기 전에도
    // 막아야 해서 ref로 동기 체크 — state만 쓰면 같은 틱에 두 번째 호출이
    // 들어올 때 아직 반영 전일 수 있음).
    if (isStartingRef.current) return
    // T3-6(REQ-04) — 일시정지 중이면 "처음부터 새 세션" 로직(아래의 모든
    // await·stopPlayback() 호출)을 전부 건너뛰고 재개만 한다. 반드시 첫
    // await보다 먼저, 완전히 동기적으로 끝나야 자동 정지 타이머와의 경쟁이
    // 안전하다(work/T3-6/plan.md §4). 방어적으로 playbackRef.current가 이미
    // 사라진 경우(이론상 도달 안 해야 함)도 가드.
    if (isPaused) {
      const session = playbackRef.current
      if (!session) {
        setIsPaused(false)
        return
      }
      session.handle.resume()
      // 기존 자동 정지 타이머와 같은 handle 아이덴티티 가드 재사용(새 세대
      // 토큰 없이 — work/T3-6/plan.md §4).
      resumeAutoStopTimer(() => {
        if (playbackRef.current?.handle === session.handle) stopPlayback()
      })
      isPlayingRef.current = true
      setIsPlaying(true)
      setIsPaused(false)
      return
    }
    isStartingRef.current = true
    setIsStarting(true)
    stopPlayback() // 혹시 이전 재생이 안 끝났으면 먼저 정리(이중 재생 방지) — playSessionIdRef도 여기서 올라감
    const mySessionId = playSessionIdRef.current
    // T3-3(REQ-04) — audioOffsetMs!==0이면 오디오 트랙 자체를 만들지 않는다
    // (work/T3-3/plan.md §범위경계 — 가드를 적용하는 단일 지점. scorePlayer.ts에
    // tracks를 안 넘기면 최초 재생·루프 재진입 전부 기존 MIDI-only 경로를
    // 그대로 타므로 별도 분기가 더 필요 없음). prime()의 각 트랙 play()+pause()
    // 호출은 아래 await 이전에 동기적으로 시작돼야 모바일 제스처 체인이
    // 보존된다(§3·§6) — 그래서 Promise 자체는 여기서 바로 만들고, 기다리는
    // 건 voices 로딩과 동시에 진행한다.
    // work/T3-3/plan.md §범위경계 — "original"(분리 전 원본)은 스템 합과 중복
    // 재생되므로 T3-3은 스템 4종만 다룬다(원본 선택 UI는 T3-4). 백엔드의
    // available_audio_kinds는 범용 목록(이후 T3-4가 "원본"도 쓸 수 있게)이라
    // 프런트 쪽에서 걸러낸다.
    const stemKinds = availableAudioKinds.filter((kind) => kind !== 'original')
    // T3-16-feedback-6 — 풀이 준비돼 있어야(위 useEffect가 비동기로 만들지
    // 않으므로 보통 화면 진입 직후 바로 준비됨) 실제로 트랙을 쓸 수 있다.
    // 풀이 아직 없으면(드물게: 생성 실패, 또는 렌더 직후 effect가 아직
    // 안 돈 경우) 기존처럼 신스만 재생되는 경로로 자연 폴백.
    const canUseAudioTracks =
      songId !== undefined &&
      score.audioOffsetMs === 0 &&
      stemKinds.length > 0 &&
      audioTrackPoolRef.current !== null

    // T3-4 모드A 1라운드 지적(High/Medium) — 아래 셋업 구간에서 (a) stop()/
    // 다른 handlePlay()가 끼어들거나(세션 id가 바뀜) (b) 생성 자체가 실패하면,
    // 그때까지 만든 리소스(트랙·Gain·voices·메트로놈)를 전부 정리하고
    // 중단한다 — 안 그러면 취소된 세션의 오디오가 계속 돌거나 리소스가 샌다.
    // T3-13 모드A 2라운드 지적(Medium) — `tracks`를 `createTrackPlayer()`
    // 호출과 함께 `const`로 선언하면, 그 호출 자체가 던질 때(예: Web Audio
    // 그래프 생성 실패) `tracks` 바인딩이 아예 안 만들어져 `cleanupAbortedSetup`
    // 안의 `tracks?.dispose()`가 TDZ 참조 에러를 낸다 — `let`으로 미리
    // `null` 선언해두고 try 안에서 대입(아래 synthGain 등과 같은 패턴).
    let tracks: TrackPlayer | null = null
    let synthGain: Tone.Gain | undefined
    let limiter: Tone.Limiter | undefined
    let voices: DrumVoiceMap | undefined
    let metronome: Metronome | undefined
    // T3-13 모드A 2라운드 수정 중 발견·수정(실제 실행으로 재현, 자체 QA) —
    // `loop`도 try 안에서만 선언하면, try 밖(아래 "루프면 자동 정지 타이머
    // 안 걺" 분기)에서 더 이상 못 봐서 `ReferenceError`가 났음. tracks 등과
    // 같은 패턴으로 바깥에 선언.
    let loop: LoopBars | undefined
    // T3-13 모드A 3라운드 지적 — `handle`도 같은 문제(아래 자동 정지
    // `setTimeout` 콜백이 try 밖에서 `handle`을 참조). 이번엔 `npx tsc
    // --noEmit`(인자 없이, 프로젝트 레퍼런스라 사실상 빈 파일만 체크)가
    // 못 잡아 Codex가 `-p tsconfig.app.json`으로 직접 돌려서야 발견됨 —
    // 이후로는 반드시 `-p tsconfig.app.json`(또는 `npm run build`의
    // `tsc -b`)으로 타입체크한다.
    let handle: PlaybackHandle | undefined
    function cleanupAbortedSetup(): void {
      tracks?.reset()
      synthGain?.dispose()
      limiter?.dispose()
      if (voices) disposeDrumVoices(voices)
      metronome?.dispose()
      // T3-13 모드A 지적 — 이 함수는 취소/실패로 끝나는 모든 경로(세션 id
      // 불일치 2곳 + catch)에서 공통으로 불리므로, 여기 한 곳에서만 풀어도
      // "새 세션" 경로의 모든 비정상 종료를 커버함.
      isStartingRef.current = false
      setIsStarting(false)
    }

    try {
      // T3-13 모드A 2라운드 지적 — 이 호출이 try 밖에 있으면 여기서 던질 때
      // isStarting 플래그가 영영 안 풀려 재생 버튼이 계속 비활성 상태로
      // 멈춘다(원래 버그보다 더 나쁜 회귀) — try 안으로 이동.
      tracks =
        canUseAudioTracks && audioTrackPoolRef.current
          ? createTrackPlayer(audioTrackPoolRef.current)
          : null
      const primePromise = tracks?.prime()
      // T3-4(REQ-05, work/T3-4/plan.md §3) — 신스 드럼 9종이 공용으로 거치는
      // Gain(linear 게인, Tone.Gain 기본 단위가 "gain" — 실제 설치된 Tone.js
      // 소스로 확인) 하나를 만들어 destination에 연결해두고 넘긴다 — 이걸로
      // "신스 드럼 전체" 볼륨을 한 번에 조절할 수 있다.
      // T3-7 모드A 1라운드 지적(리스크) — synthGain과 destination 사이에
      // 리미터를 끼워 넣어, 여러 피스가 동시에 울려 합산 파형이 0dBFS를
      // 넘을 위험을 크게 줄인다(예: +9dB 보정된 킥과 피크가 이미 -0.2dB인
      // 스네어가 겹침). 임계값 -1dB.
      // T3-7 모드A 2라운드 지적(리스크, 과장 표현 수정) — 실제 설치된
      // Limiter.js 소스를 보면 내부가 Compressor(ratio=20·attack=3ms·
      // release=10ms)를 감싼 것일 뿐, lookahead 버퍼가 없는 WebAudio
      // DynamicsCompressorNode 기반이라 "0dBFS를 절대 안 넘는다"는 수학적
      // 보장은 아님 — 아주 가파른 타격 초입 몇 ms 동안은 감쇠가 아직 덜
      // 걸린 채로 순간적으로 넘칠 가능성이 이론상 남아있다(사람이 알아챌
      // 만한 지속 클리핑이 아니라 수 ms짜리 찰나의 초과). lookahead가 있는
      // 진짜 브릭월 리미터는 Tone.js에 없고 직접 구현하려면 지연 버퍼링이
      // 필요해 이 연습 앱 규모에 비해 과한 작업이라 채택 안 함 — 업계에서도
      // 빠른 컴프레서 기반 리미터를 "충분히 좋은" 실용적 보호로 쓰는 게
      // 표준이라 이 수준에서 받아들임(마스터 판단, qa-evidence/T3-7/
      // result.md에 근거 기록). 참고로 단일 타격 대부분(피크 -3dB 이하)은
      // 거의 안 건드리고, 스네어(-0.2dB)만 솔로여도 아주 미세하게(0.2dB
      // 수준, 체감 불가) 반응 — "전혀 안 건드림"은 아님.
      limiter = new Tone.Limiter(-1).connect(Tone.getDestination())
      synthGain = new Tone.Gain(1).connect(limiter)
      voices = await createDrumVoices(synthGain)
      if (playSessionIdRef.current !== mySessionId) {
        cleanupAbortedSetup()
        return
      }
      // 메트로놈은 이번에 처음 재생 흐름에 연결됨(§범위경계 — T2-4가 믹서로
      // 미뤄뒀던 부분).
      metronome = createMetronome({ timeSignature: score.meta.timeSignature })
      if (primePromise) await primePromise
      if (playSessionIdRef.current !== mySessionId) {
        cleanupAbortedSetup()
        return
      }
      // T3-13 모드A 2라운드 지적 — playDrumScore()/playbackRef.current 대입도
      // 같은 이유로 try 안으로 이동(여기서 던지면 isStarting이 안 풀리는
      // 문제가 똑같이 생김). voices는 바로 위에서 성공적으로 대입됐으므로
      // 이 시점엔 항상 값이 있음(DrumVoiceMap | undefined가 아님).
      loop = loopEnabled
        ? { startBar: loopStartBar1 - 1, endBar: loopEndBar1 }
        : undefined
      handle = playDrumScore(score, voices, {
        countInBars: COUNT_IN_BARS,
        playbackBpm,
        loop,
        tracks: tracks ?? undefined,
        // 2026-10-27(의뢰인 요청) — 카운트인 클릭이 믹서 "메트로놈" 채널 설정과
        // 무관하게 항상 고정 음량으로 울려 "음악은 작은데 그 소리만 크다"는
        // 불편의 원인이었다 — 재생 시작 시점의 메트로놈 게인을 그대로 넘겨
        // 아래(재생 중 본체 메트로놈에 적용하는 것)와 같은 기준을 쓰게 한다.
        countInVolumeDb: linearGainToDb(effectiveGain(mixerStateRef.current.metronome)),
      })
      playbackRef.current = { handle, voices, tracks, synthGain, limiter, metronome }
      isStartingRef.current = false
      setIsStarting(false)
    } catch (err) {
      cleanupAbortedSetup()
      throw err
    }

    // 방금 만든 세션에 지금 믹서 상태를 바로 적용(처음부터 맞게 시작 —
    // work/T3-4/plan.md §4, "handlePlay()가 세션을 만들 때는 그 시점의
    // mixerStateRef.current를 그대로 읽어 처음부터 맞게 구성").
    for (const key of CHANNEL_KEYS) {
      const gain = effectiveGain(mixerStateRef.current[key])
      if (key === 'synth_drums') {
        synthGain.gain.value = gain
      } else if (key === 'metronome') {
        metronome.setVolume(linearGainToDb(gain))
      } else {
        tracks?.setChannelGain(key, gain)
      }
    }
    isPlayingRef.current = true
    setIsPlaying(true)
    // 루프가 켜져 있으면 사용자가 직접 정지할 때까지 계속 반복돼야 하므로
    // 자동 정지 타이머를 걸지 않는다(work/T2-4/plan.md §설계).
    if (loop) return
    // 재생 종료(마지막 노트 이후) 자동 정지 — 정확한 종료 이벤트 연결은 범위 밖,
    // 데모용 최소 구현(work/T2-3/plan.md). playDrumScore가 카운트인만큼 모든
    // 노트 시각을 뒤로 미루는데 처음엔 그걸 안 더해서, 마지막 노트가 아직 Transport에
    // 예약돼 있는 도중에 타이머가 먼저 발동해 disposeDrumVoices가 버퍼를 지워버리는
    // 경쟁 상태를 실제 브라우저로 재현함("buffer is either not set or not loaded"
    // 예외) — qa-evidence/T2-3/result.md. 카운트인 길이를 더하고 여유도 넉넉히 둠.
    const totalMs = songEndPositionSeconds() * 1000
    // T3-6(REQ-04) — 일시정지 중 흐른 시간을 나중에 뺄 수 있게 ref로 들고
    // 있는다(work/T3-6/plan.md §4). 기준 시계는 performance.now().
    autoStopRemainingMsRef.current = totalMs
    autoStopScheduledAtRef.current = performance.now()
    autoStopTimerIdRef.current = setTimeout(() => {
      if (playbackRef.current?.handle === handle) stopPlayback()
    }, totalMs)
  }

  // T3-9(REQ-04, 의뢰인 피드백) — 재생 위치를 ±초 이동. 재생 중·일시정지
  // 중 둘 다 가능(work/T3-9/plan.md §1 — Transport.seconds는 Tone.js가
  // 공식 지원하는 즉시 점프, 재생 상태와 무관). 곡 범위([0, 곡 끝]) 밖으로
  // 못 나가게 클램프.
  function handleSeek(deltaSeconds: number) {
    const session = playbackRef.current
    if (!session) return
    const clock = getMasterClock()
    const current = clock.getPositionSeconds()
    const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpm)
    const songStartSeconds = barSeconds * COUNT_IN_BARS
    // 모드A 지적(High) 반영 — 예전엔 "총 마디 수" 기준(totalBars, 마지막
    // 노트가 속한 마디의 끝)으로 클램프했는데, 이건 자동 정지 타이머가 쓰는
    // songEndPositionSeconds()(마지막 노트 시각 + 4초 여유)와 다른 기준이라
    // 마지막 노트가 마디 초반에 있으면 그 사이 구간으로 seek했을 때 자동
    // 정지 타이머가 남은 시간을 0으로 계산해 즉시 재생을 끊어버릴 수 있었음
    // — 두 곳이 같은 기준(songEndPositionSeconds())을 쓰도록 통일.
    const songEndSeconds = songEndPositionSeconds()
    const target = Math.min(songEndSeconds, Math.max(0, current + deltaSeconds))
    clock.setPositionSeconds(target)
    const tracks = session.tracks
    if (tracks) {
      const playbackRate = playbackBpm / score.meta.bpm
      const positionInTrackSeconds = audioTrackPositionSeconds(target, songStartSeconds, playbackRate)
      // 모드C 3라운드 C-008 반영 — 일시정지 중엔 재생을 시작하면 안 되므로
      // seekTo()(위치만 이동)를, 재생 중엔 기존 playFrom()(위치 이동 + 재생)을.
      if (isPaused) {
        tracks.seekTo(positionInTrackSeconds, playbackRate)
      } else {
        tracks.playFrom(positionInTrackSeconds, playbackRate)
      }
    }
    // 모드C 1·2라운드 반영(§7) — 자동 정지 타이머를 새 위치 기준으로
    // 재계산. 루프 모드면 애초에 타이머가 없음(null) — 그대로 둠.
    if (autoStopRemainingMsRef.current !== null) {
      if (autoStopTimerIdRef.current !== null) clearTimeout(autoStopTimerIdRef.current)
      autoStopTimerIdRef.current = null
      const remainingMs = Math.max(0, (songEndPositionSeconds() - target) * 1000)
      autoStopRemainingMsRef.current = remainingMs
      if (isPaused) {
        // 모드C 2라운드 C-007 반영 — 일시정지 중엔 실시간으로 안 흐르므로
        // 여기서 타이머를 걸지 않는다(pauseAutoStopTimer()와 같은 "값만
        // 저장" 상태로 귀결 — 다음 재개 때 resumeAutoStopTimer()가 이
        // 값을 그대로 써서 정상 작동).
      } else {
        autoStopScheduledAtRef.current = performance.now()
        const handle = session.handle
        autoStopTimerIdRef.current = setTimeout(() => {
          if (playbackRef.current?.handle === handle) stopPlayback()
        }, remainingMs)
      }
    }
  }

  // T3-9(REQ-04, 의뢰인 피드백) — "여기서 시작"/"여기까지": 악보 없이
  // 귀로만 들으며 A-B 루프를 지정할 수 있게, 지금 재생 위치를 가장 가까운
  // 마디로 변환해 바로 loopStartBar1/loopEndBar1에 반영한다. 숫자 입력칸과
  // 달리 재생 중에도 활성(work/T3-9/plan.md §5) — 듣다가 바로 누르는 게
  // 기능의 목적이라 잠그면 성립이 안 됨.
  // 모드A 지적(필수, 반영) — playbackRef.current가 없으면(재생 핸들이 아직
  // 없거나 그 사이 사라진 경우) 조용히 아무 것도 안 하고 리턴하는데, 호출
  // 쪽(아래 handleLoopButtonClick)이 성공 여부를 안 보고 무조건 loopPhase를
  // 다음 단계로 넘기면 "여기까지"를 눌렀을 때 UI는 active(루프 진행중,
  // 구간 입력칸 노출)인데 실제 loopEnabled는 꺼진 채로 어긋날 수 있었다 —
  // 버튼 disabled 조건(아래)이 보통은 이 이른 리턴을 막아주지만, 그 전제가
  // 깨지는 경우까지 대비해 성공 여부를 반환하고 호출 쪽이 그걸 확인한다.
  function markLoopPointFromCurrentPosition(which: 'start' | 'end'): boolean {
    if (!playbackRef.current) return false
    const clock = getMasterClock()
    const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpm)
    const songStartSeconds = barSeconds * COUNT_IN_BARS
    const barIndex0 = barIndexForSeconds(clock.getPositionSeconds(), songStartSeconds, barSeconds)
    const bar1 = Math.min(totalBars, barIndex0 + 1) // 1-기준, totalBars로 클램프
    if (which === 'start') {
      setLoopStartBar1(bar1)
      if (bar1 >= loopEndBar1) setLoopEndBar1(Math.min(totalBars, bar1 + 1)) // 기존 blur 핸들러와 같은 규칙
    } else {
      setLoopEndBar1(bar1)
      if (bar1 <= loopStartBar1) setLoopStartBar1(Math.max(1, bar1 - 1))
      // "여기까지"는 구간 지정을 완료하는 동작이라 바로 루프를 켠다
      // (work/T3-9/plan.md §가정·한계 — 의뢰인이 명시 요청한 건 아니지만
      // 두 지점을 다 찍은 순간이 "이제 반복해줘"라는 의도로 해석).
      setLoopEnabled(true)
    }
    return true
  }

  // 2026-10-27(의뢰인 요청) — 통합 루프 버튼의 3단계 전환. 마커 설정이 실제로
  // 성공했을 때만(위 함수의 반환값) 단계를 넘긴다 — 실패(이른 리턴)했는데도
  // 단계만 넘어가면 버튼 표시(UI)와 실제 loopEnabled가 어긋나는 버그가 됨
  // (모드A 지적, 위 코멘트 참고).
  function handleLoopButtonClick() {
    if (loopPhase === 'idle') {
      if (markLoopPointFromCurrentPosition('start')) setLoopPhase('start-marked')
    } else if (loopPhase === 'start-marked') {
      if (markLoopPointFromCurrentPosition('end')) setLoopPhase('active') // 내부에서 loopEnabled도 true로 켬
    } else {
      setLoopEnabled(false)
      setLoopPhase('idle')
    }
  }

  function handleStop() {
    stopPlayback()
  }

  // 컴포넌트가 사라질 때(곡 전환, 화면 이탈)도 재생 중이었다면 정리.
  useEffect(() => stopPlayback, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* 2026-10-27 의뢰인 요청 — "보이는 마디 수" 옆에 BPM·루프 버튼도 같이
       * 둔다(전부 재생과 관련된 설정이니 한 줄에). 재생 컨트롤(10초전/재생/
       * 10초후/리셋)만 레인 아래, 가운데 정렬로 따로 둔다(표준 미디어
       * 플레이어처럼). 레이아웃만 바뀌고 동작은 그대로라 위험 작업 아님
       * (T3-4 게이트 피드백 1차와 같은 기준). */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          보이는 마디 수
          {/* REQ-04 "낙하 속도" — 값이 작을수록 노트 사이 간격이 넓어짐(빠른
           * 곡의 촘촘한 타격을 구분하기 쉬워짐). 순수 렌더링 설정이라 BPM/루프와
           * 달리 재생 중에도 바꿀 수 있게 둔다. */}
          <select
            value={barsVisible}
            onChange={(e) => setBarsVisible(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          BPM
          {/* 재생 시작 시점의 BPM/루프 설정으로 Transport가 이미 스케줄돼 있어,
           * 재생 중 바꿔도 지금 재생엔 반영 안 됨(다음 재생부터 적용) — 혼란을
           * 막기 위해 재생 중엔 잠금(Codex 모드B 권장 C-002). */}
          <input
            type="range"
            min={minBpm}
            max={maxBpm}
            value={playbackBpm}
            onChange={(e) => setPlaybackBpm(clampBpm(Number(e.target.value)))}
            disabled={isPlaying || isPaused}
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
            // 의뢰인 피드백(2026-10-25) — 엔터를 눌러도 바로 반영되게. blur()를
            // 호출해 위 onBlur의 커밋 로직을 그대로 재사용(로직 중복 없음).
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            disabled={isPlaying || isPaused}
            style={{ width: 56 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>
            (원곡 {score.meta.bpm}, {bpmPercent}%)
          </span>
        </label>

        {/* 2026-10-27(의뢰인 요청) — "여기서 시작"/"여기까지" 버튼 + A-B 루프
         * 체크박스 3개를 버튼 하나로 통합. idle("⟲ 루프 시작") → 누르면
         * 시작점을 찍고 start-marked("⟲ 여기까지")로 → 누르면 끝점을 찍으며
         * 루프가 켜지고 active("⟲ 루프 진행중")로 → 누르면 루프가 꺼지고 다시
         * idle로(마이크로 인터랙션 — 전역 button 호버/전환이 이미 200ms라
         * 상태 전환마다 배경색이 부드럽게 바뀜). active 단계만 재생 중이
         * 아니어도 항상 눌러서 끌 수 있다(기존 체크박스가 그랬던 것과 동일 —
         * "루프를 그만 걸고 싶다"는 재생 상태와 무관해야 함). */}
        <button
          type="button"
          onClick={handleLoopButtonClick}
          disabled={loopPhase !== 'active' && !isPlaying && !isPaused}
          style={
            loopPhase === 'active'
              ? { background: 'var(--warning)', borderColor: 'var(--warning)', color: 'var(--bg)' }
              : undefined
          }
        >
          <Repeat size={16} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {loopPhase === 'idle' ? '루프 시작' : loopPhase === 'start-marked' ? '여기까지' : '루프 진행중'}
        </button>
        {loopPhase === 'active' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>마디</span>
            <input
              type="number"
              min={1}
              max={totalBars}
              value={loopStartFieldValue}
              onFocus={() => {
                setLoopStartDraft(String(loopStartBar1))
                setIsEditingLoopStart(true)
              }}
              onChange={(e) => setLoopStartDraft(e.target.value)}
              onBlur={(e) => {
                const next = clampLoopStart(Number(e.target.value))
                setLoopStartBar1(next)
                if (next >= loopEndBar1) setLoopEndBar1(Math.min(totalBars, next + 1))
                setIsEditingLoopStart(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              disabled={isPlaying || isPaused}
              style={{ width: 48 }}
            />
            <span>~</span>
            <input
              type="number"
              min={1}
              max={totalBars}
              value={loopEndFieldValue}
              onFocus={() => {
                setLoopEndDraft(String(loopEndBar1))
                setIsEditingLoopEnd(true)
              }}
              onChange={(e) => setLoopEndDraft(e.target.value)}
              onBlur={(e) => {
                const next = clampLoopEnd(Number(e.target.value))
                setLoopEndBar1(next)
                if (next <= loopStartBar1) setLoopStartBar1(Math.max(1, next - 1))
                setIsEditingLoopEnd(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              disabled={isPlaying || isPaused}
              style={{ width: 48 }}
            />
          </div>
        )}
        {loopPhase === 'active' && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
            ⟲ 마디 {loopStartBar1}~{loopEndBar1} 반복 중 — 레인 오른쪽 진행바는 이 구간 안에서의 위치
          </span>
        )}
      </div>

      {/* 레인 폭 고정(2026-10-25, 의뢰인 요청) — "화면을 넓게 쓰더라도 노트가
       * 떨어지는 크기는 고정하고 그 외 여백은 배경으로 채우고 싶다"는 요청.
       * `maxWidth`로 좁은 화면(모바일)에서는 기존처럼 꽉 채우고, 넓은
       * 화면에서는 그 이상 넓어지지 않고 중앙 정렬 + 좌우는 `<main>`의
       * 배경색(--bg)이 그대로 보이게 둔다(laneRenderer.ts가 매 프레임
       * canvas.clientWidth를 읽어 내부 해상도를 맞추므로 렌더러 쪽 변경
       * 불필요). 구체 px 값(추정치, intent/07-open-questions.md Q-29)은
       * 위 상수 선언부 참고. T3-11 게이트 피드백 3차(2026-10-25, 의뢰인
       * "레인도 외곽을 선으로 감싸서 레인크기를 보고 싶어...") — 캔버스
       * 폭을 줄이고 나니 좌우 여백과 레인 배경이 같은 색이라 경계가 안
       * 보였음. 노트 halo(밝은 대비색)와 달리 이건 "크기가 어디서
       * 끝나는지"만 보여주면 되므로 이미 쓰던 차분한 `--border` 색으로 테두리.
       * 2026-10-27(의뢰인 요청) — 진행바를 레인 아래 가로 막대에서 레인
       * 오른쪽의 세로 막대로 옮긴다. 레인+진행바를 한 플렉스 행으로 묶고
       * 그 행 전체를 가운데 정렬(캔버스 단독으로 margin:auto 하던 걸,
       * 바로 옆에 진행바가 붙으므로 둘을 같이 중앙에 놓도록 바꿈). 기능은
       * 그대로 — 0%일 때 바닥, 100%일 때 꼭대기까지 찬다(실제 height는
       * 위 progressBarRef가 매 프레임 직접 씀 — 아래 style엔 일부러
       * height를 안 둔다: 여기 두면 다른 이유로 리렌더될 때마다 React가
       * ref가 써둔 값을 이 값으로 되돌려버린다). */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          maxWidth: PRACTICE_LANE_MAX_WIDTH_PX + 20,
          margin: '0 auto',
        }}
      >
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              height: 400,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
            }}
          />
          {/* T3-14(진단용 임시, 원인 특정되면 제거) — 실기기 FPS를 화면에 바로
           * 보여줘 영상 녹화 없이도 숫자로 바로 보고 가능하게. */}
          {fpsDisplay !== null && (
            <div
              style={{
                position: 'absolute',
                top: 4,
                left: 4,
                padding: '2px 6px',
                background: 'rgba(0,0,0,0.6)',
                color: fpsDisplay >= 50 ? 'var(--success)' : fpsDisplay >= 30 ? 'var(--warning)' : 'var(--danger)',
                fontSize: '0.8em',
                fontFamily: 'monospace',
                borderRadius: 4,
                pointerEvents: 'none',
              }}
            >
              FPS: {fpsDisplay}
            </div>
          )}
        </div>
        <div
          style={{
            width: 14,
            flexShrink: 0,
            position: 'relative',
            borderRadius: 7,
            background: 'var(--surface-2)',
            overflow: 'hidden',
          }}
        >
          <div
            ref={progressBarRef}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: loopEnabled ? 'var(--warning)' : 'var(--accent)',
            }}
          />
        </div>
      </div>

      {/* 2026-10-27 의뢰인 요청 — 재생 컨트롤(10초전/재생/10초후/리셋)을
       * 레인 아래, 가운데 정렬로. 버튼을 딱딱한 사각형 대신 둥근 아이콘
       * (도형)으로(index.css .transport-btn) — 재생/일시정지는 더 크고
       * 포인트색으로 채워 중심을 잡는다(이미지 레퍼런스 스타일). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
        }}
      >
        {/* T3-13(2026-10-25, 의뢰인 요청 — 이미지 첨부) — 재생/일시정지를
         * 토글 버튼 하나로 합치고(표준 미디어 플레이어 패턴), 양옆에 ±10초
         * 탐색 버튼을 둔다. "정지"는 "리셋"으로 이름만 바꿔(동작은 기존
         * handleStop 그대로 — 처음으로 되돌아감) 옆에 유지. 토글 버튼은
         * 정지/일시정지 상태면 handlePlay()(새 세션 시작, 또는 isPaused
         * 분기로 재개), 재생 중이면 handlePause() — 기존 로직 무변경, 버튼
         * 묶음만 재구성. "▶ 재생" 쪽만 `isStarting`일 때 비활성화(모드A
         * 지적 — handlePlay()의 새 세션 경로가 비동기라 연타하면 세션
         * 생성이 겹쳐 돈다, 위 isStartingRef 선언부 참고). T3-16-feedback-7 —
         * `audioTracksLoading`도 같이 막음(오디오 스템 전체 다운로드가 아직
         * 안 끝남). 일시정지→재개 경로는 이미 한 번 성공적으로 시작된
         * 세션이라 그 시점엔 로딩이 이미 끝나 있었을 수밖에 없어 안전. */}
        <button
          type="button"
          className="transport-btn"
          style={{ width: 44, height: 44 }}
          title="10초 되감기"
          aria-label="10초 되감기"
          onClick={() => handleSeek(-10)}
          disabled={!isPlaying && !isPaused}
        >
          <Rewind size={20} aria-hidden="true" />
        </button>
        {isPlaying ? (
          <button
            type="button"
            className="transport-btn transport-btn--play"
            style={{ width: 64, height: 64 }}
            title="일시정지"
            aria-label="일시정지"
            onClick={handlePause}
          >
            <Pause size={28} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="transport-btn transport-btn--play"
            style={{ width: 64, height: 64 }}
            title={audioTracksLoading ? '음원 불러오는 중…' : '재생'}
            aria-label={audioTracksLoading ? '음원 불러오는 중' : '재생'}
            onClick={handlePlay}
            disabled={isStarting || audioTracksLoading}
          >
            <Play size={28} aria-hidden="true" style={{ marginLeft: 2 }} />
          </button>
        )}
        <button
          type="button"
          className="transport-btn"
          style={{ width: 44, height: 44 }}
          title="10초 빨리감기"
          aria-label="10초 빨리감기"
          onClick={() => handleSeek(10)}
          disabled={!isPlaying && !isPaused}
        >
          <FastForward size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transport-btn"
          style={{ width: 44, height: 44 }}
          title="처음으로 리셋"
          aria-label="처음으로 리셋"
          onClick={handleStop}
          disabled={!isPlaying && !isPaused}
        >
          <RotateCcw size={20} aria-hidden="true" />
        </button>
      </div>

      {/* T3-4 게이트 피드백 1차(2026-10-25) — 믹서를 페이지 맨 아래 단독 블록
       * 대신 드럼킷 그림 옆 빈 공간에 둔다. 넓은 화면에서 킷 그림이 320px로
       * 고정폭이라 그 오른쪽이 항상 비어 있던 걸 의뢰인이 직접 지적 —
       * `intent/04-ui-ux.md` §3 와이어프레임의 "믹서 열기" 의도(하단에 큰
       * 블록으로 항상 펼쳐두지 않음)에도 더 가까워짐. 세로 폰은 킷을 320px
       * 그대로 두면 너무 커 믹서가 한참 아래로 밀리므로 레이아웃만 세로로
       * 바꿔 믹서가 캔버스+킷 아래 전체 폭으로 내려온다 — 레이아웃만 바뀌고
       * 동작은 그대로라 위험 작업 아님(T3-2-feedback-1 "보이는 마디 수"와
       * 같은 기준).
       * T3-11(2026-10-25, 의뢰인 피드백 "폰 세로에서 드럼킷이 안 보여") —
       * 원래 `intent/04-ui-ux.md` §3 반응형 규칙이 "폰 세로 = 레인만(킷은
       * 축소 아이콘)"이었는데, 구현(T2-3~T3-4)은 "축소 아이콘"을 빠뜨리고
       * 아예 숨겨버렸던 것을 뒤늦게 발견 — `!isPortraitPhone` 조건을 없애고
       * 항상 그리되, 세로 폰에서는 폭만 축소(아래 160px, 넓은 화면의 320px
       * 대비)해 문서가 원래 의도했던 "축소 아이콘"에 가깝게 맞춘다. */}
      <div
        style={{
          display: 'flex',
          flexDirection: isPortraitPhone ? 'column' : 'row',
          gap: 'var(--space-4)',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ maxWidth: isPortraitPhone ? 160 : 320 }}>
          <KitIllustration
            activeHandByPiece={activeHandByPiece}
            showSticking={false}
            pieceColor={readPieceColor}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <strong>믹서</strong>
            <button onClick={applyDrumlessPreset}>
              🥁 원곡 드럼 {mixerState.stem_drums.volume === 0 ? '켜기' : '끄기'}
            </button>
          </div>
          {/* T3-4 게이트 피드백 2차(2026-10-25) — M 체크박스를 눌러도 화면에서
           * 티가 잘 안 난다는 지적 → 약어 뜻을 바로 아래에 적어두고, 아래 각
           * 채널 행에서 음소거 중이면 흐리게 해 즉시 눈에 띄게 한다.
           * T3-8(2026-10-25, 의뢰인 요청) — 솔로(S) 버튼은 제거("필요없다"). */}
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>M = 음소거</span>
          {MIXER_ROW_KEYS.map((key) => {
            const channel = mixerState[key]
            const rows = [
              <MixerRow
                key={key}
                label={CHANNEL_LABELS[key]}
                icon={MIXER_ROW_ICONS[key]}
                volume={channel.volume}
                muted={channel.muted}
                onVolumeChange={(volume) => updateChannel(key, { volume })}
                onMutedChange={(muted) => updateChannel(key, { muted })}
              />,
            ]
            // T3-4 게이트 피드백 3차(2026-10-25, 의뢰인 요청) — "원곡 음악이
            // 드럼보다 너무 크다"는 지적에, 베이스·보컬·기타 악기 3채널을
            // 원래 위치(드럼(원곡) 바로 다음)에 슬라이더·M 하나로 묶어
            // 보여준다. 저장 구조는 그대로(mixer.ts의 setMusicVolume 등이
            // 3채널에 같은 값을 쓸 뿐) — 순수 UI 묶음.
            if (key === 'stem_drums') {
              rows.push(
                <MixerRow
                  key="music"
                  label="음악(베이스·보컬·그 외)"
                  icon={Music2}
                  volume={musicVolume(mixerState)}
                  muted={isMusicMuted(mixerState)}
                  onVolumeChange={updateMusicVolume}
                  onMutedChange={updateMusicMuted}
                />,
              )
            }
            return rows
          })}
        </div>
      </div>
    </div>
  )
}
