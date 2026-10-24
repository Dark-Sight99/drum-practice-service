// Canvas 2D 레인 렌더러 — jsdom은 2D 컨텍스트가 없어(`getContext('2d')`가 null,
// 실제 실행으로 확인) 실제 브라우저에서만 동작·검증 가능(work/T2-3/plan.md).
import type { DrumNote, DrumPiece, DrumScore, Hand } from '../score/types'
import {
  activeHandByPiece,
  activePieces,
  barBeatLines,
  LANES,
  noteYPosition,
  pixelsPerSecond,
  type NoteShape,
} from './layout'
import { ticksToSeconds } from '../audio/timing'

function handLabel(hand: Hand): string | null {
  return hand === 'R' || hand === 'L' || hand === 'RF' || hand === 'LF' ? hand : null
}

export interface LaneRendererOptions {
  /** DrumPiece별 색을 돌려주는 함수 — 호출자가 CSS 변수(`--piece-*`)를 읽어 전달
   * (Canvas는 CSS 변수를 모름, intent/08-design.md §3). */
  pieceColor: (piece: DrumNote['piece']) => string
  laneBorderColor: string
  laneBarColor: string
  laneBeatColor: string
  hitLineColor: string
  /** 스티킹 R/L 글자 색(REQ-12, intent/08-design.md §3 "노트 위 R/L 글자(--text)"). */
  stickingTextColor: string
  /** 판정선 근처 노트를 "히트"로 보는 허용범위(초) — work/T2-3/plan.md §가정. */
  hitWindowSeconds: number
}

export interface LaneRenderResult {
  activePieces: Set<DrumPiece>
  /** 판정선 근처 피스별 손/발(REQ-12) — 킷 점등 테두리 실선/점선 트리거. */
  activeHandByPiece: Map<DrumPiece, Hand>
}

export interface LaneRenderer {
  /** `songStartSeconds`는 호출자가 `scorePlayer.ts`의 `computePlaybackSchedule()`과
   * 똑같이 계산해 넘겨야 한다(카운트인 마디 길이) — 실제 오디오가 이 시각부터
   * 노트를 트리거하므로, 화면도 같은 기준으로 그려야 판정선 통과 시점과 소리가
   * 맞는다(T2-8, Phase 2 게이트 피드백으로 발견: 이 값을 빼먹어서 노트가 카운트인
   * 길이만큼 일찍 보이고 소리는 늦게 들리는 버그가 있었음).
   * `playbackBpm` 생략 시 `score.meta.bpm`(원곡 그대로) 사용 — 연습 BPM(T2-4,
   * REQ-04)으로 재생 중이면 낙하 속도·노트 위치가 그 속도를 따라가도록 넘긴다.
   * `showSticking`(REQ-12, 기본 true)이 꺼지면 노트 위 R/L 글자를 그리지 않는다. */
  render(
    score: DrumScore,
    currentTimeSeconds: number,
    songStartSeconds: number,
    barsVisible: number,
    playbackBpm?: number,
    showSticking?: boolean,
  ): LaneRenderResult
  dispose(): void
}

const LOOKBEHIND_SECONDS = 0.15

function drawNoteShape(
  ctx: CanvasRenderingContext2D,
  shape: NoteShape,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  const half = size / 2

  switch (shape) {
    case 'x':
    case 'x-large':
    case 'x-ring': {
      const s = shape === 'x-large' ? half * 1.3 : half
      ctx.beginPath()
      ctx.moveTo(x - s, y - s)
      ctx.lineTo(x + s, y + s)
      ctx.moveTo(x + s, y - s)
      ctx.lineTo(x - s, y + s)
      ctx.stroke()
      if (shape === 'x-ring') {
        ctx.beginPath()
        ctx.arc(x, y, half * 1.5, 0, Math.PI * 2)
        ctx.stroke()
      }
      break
    }
    case 'diamond': {
      ctx.beginPath()
      ctx.moveTo(x, y - half)
      ctx.lineTo(x + half, y)
      ctx.lineTo(x, y + half)
      ctx.lineTo(x - half, y)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'rounded-rect': {
      const w = size
      const h = size * 0.7
      const r = 4
      ctx.beginPath()
      ctx.roundRect(x - w / 2, y - h / 2, w, h, r)
      ctx.fill()
      break
    }
    case 'circle':
    case 'circle-large': {
      const r = shape === 'circle-large' ? half * 1.2 : half
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'bar': {
      const w = size * 1.8
      const h = size * 0.4
      ctx.fillRect(x - w / 2, y - h / 2, w, h)
      break
    }
  }
}

/** 레인 렌더러를 만든다. `render()`를 매 프레임(requestAnimationFrame) 호출하면
 * 레인·마디/박선·판정선·노트를 그리고, 판정선 근처(히트) 피스 집합을 반환한다
 * (하단 드럼킷 점등 트리거용, 호출자가 KitIllustration에 넘김). */
export function createLaneRenderer(
  canvas: HTMLCanvasElement,
  options: LaneRendererOptions,
): LaneRenderer {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context를 가져올 수 없습니다(브라우저가 Canvas를 지원해야 함)')
  }

  return {
    render(
      score,
      currentTimeSeconds,
      songStartSeconds,
      barsVisible,
      playbackBpm = score.meta.bpm,
      showSticking = true,
    ) {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.clearRect(0, 0, width, height)

      const hitLineY = height - 24
      const laneWidth = width / LANES.length
      const speed = pixelsPerSecond(hitLineY, barsVisible, score.meta.timeSignature, playbackBpm)
      const lookaheadSeconds = hitLineY / speed

      const noteTimeOf = (note: DrumNote) =>
        songStartSeconds + ticksToSeconds(note.tick, score.ppq, playbackBpm) + score.audioOffsetMs / 1000

      // 레인 구분선
      ctx.strokeStyle = options.laneBorderColor
      ctx.lineWidth = 1
      for (let i = 1; i < LANES.length; i++) {
        const x = i * laneWidth
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }

      // 마디선·박선
      const windowStart = currentTimeSeconds - LOOKBEHIND_SECONDS
      const windowEnd = currentTimeSeconds + lookaheadSeconds
      for (const line of barBeatLines(
        score.meta.timeSignature,
        playbackBpm,
        windowStart,
        windowEnd,
      )) {
        const y = noteYPosition(line.timeSeconds, currentTimeSeconds, speed, hitLineY)
        ctx.strokeStyle = line.isBar ? options.laneBarColor : options.laneBeatColor
        ctx.lineWidth = line.isBar ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // 노트
      const noteSize = Math.min(laneWidth * 0.5, 28)
      for (let laneIndex = 0; laneIndex < LANES.length; laneIndex++) {
        const lane = LANES[laneIndex]
        const laneCenterX = laneIndex * laneWidth + laneWidth / 2
        for (const note of score.notes) {
          if (!lane.pieces.includes(note.piece)) continue
          const t = noteTimeOf(note)
          if (t < windowStart || t > windowEnd) continue
          const y = noteYPosition(t, currentTimeSeconds, speed, hitLineY)
          const shape = lane.shapeByPiece[note.piece]
          if (!shape) continue
          drawNoteShape(ctx, shape, laneCenterX, y, noteSize, options.pieceColor(note.piece))

          // REQ-12 — 노트 위 R/L(/RF/LF) 글자. 자동 추천 값은 반투명
          // (intent/08-design.md §3 "자동 추천 값은 50% 투명도"), 사용자 지정은 불투명.
          if (showSticking) {
            const label = handLabel(note.hand)
            if (label !== null) {
              const prevAlpha = ctx.globalAlpha
              ctx.globalAlpha = note.handSource === 'user' ? 1 : 0.5
              ctx.fillStyle = options.stickingTextColor
              ctx.font = `${Math.max(10, noteSize * 0.5)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'bottom'
              ctx.fillText(label, laneCenterX, y - noteSize / 2 - 2)
              ctx.globalAlpha = prevAlpha
            }
          }
        }
      }

      // 판정선
      ctx.strokeStyle = options.hitLineColor
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, hitLineY)
      ctx.lineTo(width, hitLineY)
      ctx.stroke()

      return {
        activePieces: activePieces(score.notes, noteTimeOf, currentTimeSeconds, options.hitWindowSeconds),
        activeHandByPiece: activeHandByPiece(
          score.notes,
          noteTimeOf,
          currentTimeSeconds,
          options.hitWindowSeconds,
        ),
      }
    },
    dispose() {
      // Canvas 자체는 DOM 요소 소유자(React)가 정리 — 여기선 내부 상태가 없어 no-op.
    },
  }
}
