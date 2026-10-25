import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import {
  audioTrackPositionSeconds,
  barDurationSeconds,
  barIndexForTick,
  CHANNEL_KEYS,
  createDrumVoices,
  createMetronome,
  createTrackPlayer,
  defaultMixerState,
  disposeDrumVoices,
  effectiveGain,
  getMasterClock,
  isMusicMuted,
  isMusicSolo,
  linearGainToDb,
  musicVolume,
  playDrumScore,
  setMusicMuted,
  setMusicSolo,
  setMusicVolume,
  toggleDrumlessPreset,
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
import { DEFAULT_START_HAND, recommendSticking } from '../../score/sticking'
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

// T3-4(REQ-05) — 믹서 UI에 쓸 채널 표시 이름.
const CHANNEL_LABELS: Record<ChannelKey, string> = {
  stem_drums: '드럼(원곡)',
  stem_bass: '베이스',
  stem_vocals: '보컬',
  stem_other: '기타 악기',
  synth_drums: '신스 드럼',
  metronome: '메트로놈',
}

// T3-4 게이트 피드백 3차(2026-10-25) — 믹서에 개별 행으로 그리는 채널.
// stem_bass/stem_vocals/stem_other는 "음악(전체)" 한 행으로 묶여 렌더링되므로
// 여기선 제외(아래 MixerRow 목록에서 stem_drums 바로 다음에 수동으로 끼워 넣음).
const MIXER_ROW_KEYS: ChannelKey[] = ['stem_drums', 'synth_drums', 'metronome']

interface MixerRowProps {
  label: string
  volume: number
  muted: boolean
  solo: boolean
  onVolumeChange: (volume: number) => void
  onMutedChange: (muted: boolean) => void
  onSoloChange: (solo: boolean) => void
}

/** T3-4 믹서 한 행(채널 1개 또는 묶음) — 피드백 3차에서 "음악(전체)" 묶음
 * 행을 추가하며 기존 CHANNEL_KEYS.map() 안에 있던 JSX를 재사용 가능하게 뺌. */
function MixerRow({
  label,
  volume,
  muted,
  solo,
  onVolumeChange,
  onMutedChange,
  onSoloChange,
}: MixerRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        opacity: muted ? 0.5 : 1,
        border: solo ? '1px solid var(--accent)' : '1px solid transparent',
        borderRadius: 4,
        padding: '2px 4px',
      }}
    >
      <span style={{ width: 90 }}>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
        style={{ width: 120 }}
      />
      <span style={{ width: 36, textAlign: 'right' }}>{Math.round(volume * 100)}%</span>
      <label title="음소거" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <input type="checkbox" checked={muted} onChange={(e) => onMutedChange(e.target.checked)} />
        M
      </label>
      <label
        title="솔로 — 이 채널만 들림"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
      >
        <input type="checkbox" checked={solo} onChange={(e) => onSoloChange(e.target.checked)} />
        S
      </label>
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
  barsVisible: initialBarsVisible = 2,
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
  // REQ-12 "상단 바에 R/L 표시 켜기/끄기" — 기본 켜짐(의뢰인이 요청한 핵심 학습
  // 포인트라, 찾아서 켜야 하는 숨김 옵션보다는 기본 노출이 맞다고 판단).
  const [showSticking, setShowSticking] = useState(true)
  const showStickingRef = useRef(showSticking)
  useEffect(() => {
    showStickingRef.current = showSticking
  }, [showSticking])
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

  // --- T3-4(REQ-05) 믹서: 볼륨/음소거/솔로 — work/T3-4/plan.md ---
  const [mixerState, setMixerState] = useState<MixerState>(defaultMixerState())
  const mixerStateRef = useRef(mixerState)
  useEffect(() => {
    mixerStateRef.current = mixerState
  }, [mixerState])

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
    setMixerState((prev) => toggleDrumlessPreset(prev))
    scheduleMixerSave()
  }

  // T3-4 게이트 피드백 3차(2026-10-25, 의뢰인 요청) — "원곡 음악이 드럼보다
  // 너무 크다"는 지적에, 베이스·보컬·기타 악기(stem_bass/stem_vocals/
  // stem_other) 3채널을 UI에서 슬라이더·M·S 하나로 묶어 조작한다. 저장되는
  // 데이터 구조는 그대로(mixer.ts의 setMusicVolume/setMusicMuted/setMusicSolo가
  // 3채널에 같은 값을 쓸 뿐) — 백엔드·effectiveGain() 전부 무수정.
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

  function updateMusicSolo(solo: boolean) {
    userHasEditedMixerRef.current = true
    setMixerState((prev) => setMusicSolo(prev, solo))
    scheduleMixerSave()
  }

  // 재생 중 믹서 상태가 바뀌면 즉시 반영(REQ-05 "조작 즉시 반영" — BPM/루프와
  // 달리 재생 중에도 잠그지 않음). playbackRef.current 존재 여부로만 게이트해
  // handlePlay() 셋업 중의 경쟁을 원천 차단(모드C 1라운드 C-004).
  useEffect(() => {
    const session = playbackRef.current
    if (!session) return
    for (const key of CHANNEL_KEYS) {
      const gain = effectiveGain(mixerState[key], mixerState)
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

  const lastActiveKeyRef = useRef('')
  const [progressPercent, setProgressPercent] = useState(0)
  const lastProgressKeyRef = useRef(-1)
  // T3-3(REQ-04) — 오디오 트랙 리싱크 폴링 스로틀(위 TRACK_RESYNC_INTERVAL_MS).
  const lastTrackResyncAtRef = useRef(0)

  // REQ-12 — 손 정보가 없는(또는 일부만 지정된) 곡도 연습 화면에서 바로 R/L을
  // 볼 수 있게, 저장 없이 그 자리에서 자동 추천을 계산해 보여준다(편집기에서
  // "자동 추천 재적용"을 눌러야만 보이던 기존 흐름의 보완 — Phase 2 게이트
  // 피드백). 재생(`playDrumScore`)은 hand/handSource를 전혀 읽지 않으므로 원본
  // `score`를 그대로 쓰고, 이 계산 결과는 화면 표시 전용.
  const displayScore = useMemo<DrumScore>(
    () => ({ ...score, notes: recommendSticking(score.notes, score.ppq, DEFAULT_START_HAND) }),
    [score],
  )

  useEffect(() => {
    function loop() {
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
        const rendered = renderer.render(
          displayScore,
          positionSeconds,
          songStartSeconds,
          barsVisible,
          playbackBpmRef.current,
          showStickingRef.current,
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
        const key = [...active.entries()]
          .map(([piece, hand]) => `${piece}:${hand ?? ''}`)
          .sort()
          .join(',')
        if (key !== lastActiveKeyRef.current) {
          lastActiveKeyRef.current = key
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
      const nextPercent = Math.min(100, Math.max(0, Math.round(rawPercent)))
      if (nextPercent !== lastProgressKeyRef.current) {
        lastProgressKeyRef.current = nextPercent
        setProgressPercent(nextPercent)
      }
      rafIdRef.current = requestAnimationFrame(loop)
    }
    rafIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [score, displayScore, barsVisible, totalBars])

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
    playbackRef.current.metronome.dispose()
    // T3-3(REQ-04) — TrackPlayer는 재생 1회당 1개 수명(work/T3-3/plan.md §4
    // 생명주기) — DrumVoiceMap과 똑같이 여기서 버려야 다음 handlePlay()가 새
    // 인스턴스를 만들 때 이전 <audio> 엘리먼트가 남아 겹치지 않는다.
    playbackRef.current.tracks?.dispose()
    playbackRef.current = null
    isPlayingRef.current = false
    lastActiveKeyRef.current = ''
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
    const canUseAudioTracks =
      songId !== undefined && score.audioOffsetMs === 0 && stemKinds.length > 0
    const tracks = canUseAudioTracks
      ? createTrackPlayer(stemKinds.map((kind) => ({ kind, url: songAudioUrl(songId, kind) })))
      : null

    // T3-4 모드A 1라운드 지적(High/Medium) — 아래 셋업 구간에서 (a) stop()/
    // 다른 handlePlay()가 끼어들거나(세션 id가 바뀜) (b) 생성 자체가 실패하면,
    // 그때까지 만든 리소스(트랙·Gain·voices·메트로놈)를 전부 정리하고
    // 중단한다 — 안 그러면 취소된 세션의 오디오가 계속 돌거나 리소스가 샌다.
    let synthGain: Tone.Gain | undefined
    let voices: DrumVoiceMap | undefined
    let metronome: Metronome | undefined
    function cleanupAbortedSetup(): void {
      tracks?.dispose()
      synthGain?.dispose()
      if (voices) disposeDrumVoices(voices)
      metronome?.dispose()
    }

    try {
      const primePromise = tracks?.prime()
      // T3-4(REQ-05, work/T3-4/plan.md §3) — 신스 드럼 9종이 공용으로 거치는
      // Gain(linear 게인, Tone.Gain 기본 단위가 "gain" — 실제 설치된 Tone.js
      // 소스로 확인) 하나를 만들어 destination에 연결해두고 넘긴다 — 이걸로
      // "신스 드럼 전체" 볼륨을 한 번에 조절할 수 있다.
      synthGain = new Tone.Gain(1).connect(Tone.getDestination())
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
    } catch (err) {
      cleanupAbortedSetup()
      throw err
    }

    const loop: LoopBars | undefined = loopEnabled
      ? { startBar: loopStartBar1 - 1, endBar: loopEndBar1 }
      : undefined
    const handle = playDrumScore(score, voices, {
      countInBars: COUNT_IN_BARS,
      playbackBpm,
      loop,
      tracks: tracks ?? undefined,
    })
    playbackRef.current = { handle, voices, tracks, synthGain, metronome }
    // 방금 만든 세션에 지금 믹서 상태를 바로 적용(처음부터 맞게 시작 —
    // work/T3-4/plan.md §4, "handlePlay()가 세션을 만들 때는 그 시점의
    // mixerStateRef.current를 그대로 읽어 처음부터 맞게 구성").
    for (const key of CHANNEL_KEYS) {
      const gain = effectiveGain(mixerStateRef.current[key], mixerStateRef.current)
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
    const countInSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpm)
    const lastTick = Math.max(0, ...score.notes.map((n) => n.tick))
    const lastNoteSeconds = (lastTick / score.ppq) * (60 / playbackBpm)
    const safetyMarginSeconds = 4 // 크래시/라이드 등 길게 울리는 샘플이 다 끝날 시간
    const totalMs = (countInSeconds + lastNoteSeconds + safetyMarginSeconds) * 1000
    // T3-6(REQ-04) — 일시정지 중 흐른 시간을 나중에 뺄 수 있게 ref로 들고
    // 있는다(work/T3-6/plan.md §4). 기준 시계는 performance.now().
    autoStopRemainingMsRef.current = totalMs
    autoStopScheduledAtRef.current = performance.now()
    autoStopTimerIdRef.current = setTimeout(() => {
      if (playbackRef.current?.handle === handle) stopPlayback()
    }, totalMs)
  }

  function handleStop() {
    stopPlayback()
  }

  // 컴포넌트가 사라질 때(곡 전환, 화면 이탈)도 재생 중이었다면 정리.
  useEffect(() => stopPlayback, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={handlePlay} disabled={isPlaying}>
            ▶ 재생
          </button>
          <button onClick={handlePause} disabled={!isPlaying}>
            ⏸ 일시정지
          </button>
          <button onClick={handleStop} disabled={!isPlaying && !isPaused}>
            ⏹ 정지
          </button>
        </div>

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
          <input
            type="checkbox"
            checked={loopEnabled}
            onChange={(e) => setLoopEnabled(e.target.checked)}
            disabled={isPlaying || isPaused}
          />
          ⟲ A-B 루프
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            type="checkbox"
            checked={showSticking}
            onChange={(e) => setShowSticking(e.target.checked)}
          />
          R/L 표시
        </label>
        {loopEnabled && (
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
      </div>

      <canvas ref={canvasRef} style={{ width: '100%', height: 400, background: 'var(--bg)' }} />

      {/* T3-4 게이트 피드백 1차(2026-10-25) — 믹서를 페이지 맨 아래 단독 블록
       * 대신 드럼킷 그림 옆 빈 공간에 둔다. 넓은 화면(!isPortraitPhone)에서
       * 킷 그림이 320px로 고정폭이라 그 오른쪽이 항상 비어 있던 걸 의뢰인이
       * 직접 지적 — `intent/04-ui-ux.md` §3 와이어프레임의 "믹서 열기"
       * 의도(하단에 큰 블록으로 항상 펼쳐두지 않음)에도 더 가까워짐. 세로
       * 폰은 킷 자체가 안 보이므로(§반응형, T5-1 전까지의 기존 동작) 믹서가
       * 캔버스 바로 아래 전체 폭으로 내려온다 — 레이아웃만 바뀌고 동작은
       * 그대로라 위험 작업 아님(T3-2-feedback-1 "보이는 마디 수"와 같은 기준). */}
      <div
        style={{
          display: 'flex',
          flexDirection: isPortraitPhone ? 'column' : 'row',
          gap: 'var(--space-4)',
          alignItems: 'flex-start',
        }}
      >
        {!isPortraitPhone && (
          <div style={{ maxWidth: 320 }}>
            <KitIllustration
              activeHandByPiece={activeHandByPiece}
              showSticking={showSticking}
              pieceColor={readPieceColor}
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <strong>믹서</strong>
            <button onClick={applyDrumlessPreset}>
              🥁 원곡 드럼 {mixerState.stem_drums.volume === 0 ? '켜기' : '끄기'}
            </button>
          </div>
          {/* T3-4 게이트 피드백 2차(2026-10-25) — M/S 체크박스를 눌러도 화면에서
           * 티가 잘 안 난다는 지적 → 약어 뜻을 바로 아래에 적어두고, 아래 각
           * 채널 행에서 음소거 중이면 흐리게, 솔로 중이면 강조색 테두리로
           * 즉시 눈에 띄게 한다. */}
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
            M = 음소거 · S = 솔로(이 채널만 들림)
          </span>
          {MIXER_ROW_KEYS.map((key) => {
            const channel = mixerState[key]
            const rows = [
              <MixerRow
                key={key}
                label={CHANNEL_LABELS[key]}
                volume={channel.volume}
                muted={channel.muted}
                solo={channel.solo}
                onVolumeChange={(volume) => updateChannel(key, { volume })}
                onMutedChange={(muted) => updateChannel(key, { muted })}
                onSoloChange={(solo) => updateChannel(key, { solo })}
              />,
            ]
            // T3-4 게이트 피드백 3차(2026-10-25, 의뢰인 요청) — "원곡 음악이
            // 드럼보다 너무 크다"는 지적에, 베이스·보컬·기타 악기 3채널을
            // 원래 위치(드럼(원곡) 바로 다음)에 슬라이더·M·S 하나로 묶어
            // 보여준다. 저장 구조는 그대로(mixer.ts의 setMusicVolume 등이
            // 3채널에 같은 값을 쓸 뿐) — 순수 UI 묶음.
            if (key === 'stem_drums') {
              rows.push(
                <MixerRow
                  key="music"
                  label="음악(베이스·보컬·기타)"
                  volume={musicVolume(mixerState)}
                  muted={isMusicMuted(mixerState)}
                  solo={isMusicSolo(mixerState)}
                  onVolumeChange={updateMusicVolume}
                  onMutedChange={updateMusicMuted}
                  onSoloChange={updateMusicSolo}
                />,
              )
            }
            return rows
          })}
        </div>
      </div>

      {loopEnabled && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
          ⟲ 마디 {loopStartBar1}~{loopEndBar1} 반복 중 — 아래 진행바는 이 구간 안에서의 위치
        </span>
      )}
      <div
        style={{
          position: 'relative',
          height: 8,
          borderRadius: 4,
          background: 'var(--surface-2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: loopEnabled ? 'var(--warning)' : 'var(--accent)',
          }}
        />
      </div>
    </div>
  )
}
