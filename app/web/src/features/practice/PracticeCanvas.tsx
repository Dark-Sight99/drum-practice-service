import { useEffect, useRef, useState } from 'react'
import {
  barDurationSeconds,
  createDrumVoices,
  disposeDrumVoices,
  getMasterClock,
  playDrumScore,
  type DrumVoiceMap,
  type PlaybackHandle,
} from '../../audio'
import type { DrumPiece, DrumScore } from '../../score/types'
import { createLaneRenderer, type LaneRenderer } from '../../render/laneRenderer'
import { KitIllustration } from '../../render/KitIllustration'

// 연습 화면의 레인+킷 렌더러를 실제로 돌려보는 최소 데모 컴포넌트. BPM/루프
// UI(T2-4)·라이브러리 연동(T2-5)은 범위 밖 — 재생/정지 버튼만(work/T2-3/plan.md §범위).

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
}

export function PracticeCanvas({ score, barsVisible = 2 }: PracticeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LaneRenderer | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [activePieces, setActivePieces] = useState<ReadonlySet<DrumPiece>>(new Set())
  const [isPlaying, setIsPlaying] = useState(false)
  const isPortraitPhone = usePortraitPhoneLayout()
  // 재생 중인 핸들·보이스를 들고 있다가 정지/언마운트 시 반드시 정리한다 —
  // 안 그러면 Transport에 예약된 이벤트가 남아 있다가 재생을 다시 시작했을 때
  // 이미 폐기된(또는 아직 로드 전인) 버퍼로 Player.start()를 호출해 실제로
  // "buffer is either not set or not loaded" 예외가 나는 것을 실제 브라우저로
  // 재현 확인함(work/T2-3/plan.md, qa-evidence/T2-3/result.md).
  const playbackRef = useRef<{ handle: PlaybackHandle; voices: DrumVoiceMap } | null>(null)

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
      hitWindowSeconds: 0.06,
    })
  }, [])

  const lastActiveKeyRef = useRef('')

  useEffect(() => {
    function loop() {
      const clock = getMasterClock()
      const renderer = rendererRef.current
      if (renderer) {
        const active = renderer.render(score, clock.getPositionSeconds(), barsVisible)
        // 성능: 대부분의 프레임은 활성 피스가 없거나 직전 프레임과 동일함(판정선
        // 근처에 노트가 있을 때만 바뀜) — 매 프레임 새 Set으로 setState하면
        // KitIllustration이 매 프레임(최대 60회/초) 리렌더되며, 실제 측정해보니
        // 평균 fps가 30fps로 떨어지는 걸 확인(REQ-06 목표 60fps 미달). 내용이
        // 실제로 바뀔 때만 setState하도록 바꿔 불필요한 리렌더를 없앤다
        // (qa-evidence/T2-3/result.md §fps 측정).
        const key = [...active].sort().join(',')
        if (key !== lastActiveKeyRef.current) {
          lastActiveKeyRef.current = key
          setActivePieces(active)
        }
      }
      rafIdRef.current = requestAnimationFrame(loop)
    }
    rafIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [score, barsVisible])

  function stopPlayback() {
    if (!playbackRef.current) return
    playbackRef.current.handle.stop()
    disposeDrumVoices(playbackRef.current.voices)
    playbackRef.current = null
    setIsPlaying(false)
  }

  async function handlePlay() {
    stopPlayback() // 혹시 이전 재생이 안 끝났으면 먼저 정리(이중 재생 방지)
    const voices = await createDrumVoices()
    const handle = playDrumScore(score, voices, { countInBars: 1 })
    playbackRef.current = { handle, voices }
    setIsPlaying(true)
    // 재생 종료(마지막 노트 이후) 자동 정지 — 정확한 종료 이벤트 연결은 범위 밖,
    // 데모용 최소 구현(work/T2-3/plan.md). playDrumScore가 카운트인만큼 모든
    // 노트 시각을 뒤로 미루는데 처음엔 그걸 안 더해서, 마지막 노트가 아직 Transport에
    // 예약돼 있는 도중에 타이머가 먼저 발동해 disposeDrumVoices가 버퍼를 지워버리는
    // 경쟁 상태를 실제 브라우저로 재현함("buffer is either not set or not loaded"
    // 예외) — qa-evidence/T2-3/result.md. 카운트인 길이를 더하고 여유도 넉넉히 둠.
    const countInSeconds = barDurationSeconds(score.meta.timeSignature, score.meta.bpm)
    const lastTick = Math.max(0, ...score.notes.map((n) => n.tick))
    const lastNoteSeconds = (lastTick / score.ppq) * (60 / score.meta.bpm)
    const safetyMarginSeconds = 4 // 크래시/라이드 등 길게 울리는 샘플이 다 끝날 시간
    const totalMs = (countInSeconds + lastNoteSeconds + safetyMarginSeconds) * 1000
    setTimeout(() => {
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
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={handlePlay} disabled={isPlaying}>
          ▶ 재생
        </button>
        <button onClick={handleStop} disabled={!isPlaying}>
          ⏹ 정지
        </button>
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height: 400, background: 'var(--bg)' }} />
      {!isPortraitPhone && (
        <div style={{ maxWidth: 320 }}>
          <KitIllustration activePieces={activePieces} pieceColor={readPieceColor} />
        </div>
      )}
    </div>
  )
}
