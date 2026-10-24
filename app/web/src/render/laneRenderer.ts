// Canvas 2D 레인 렌더러 — jsdom은 2D 컨텍스트가 없어(`getContext('2d')`가 null,
// 실제 실행으로 확인) 실제 브라우저에서만 동작·검증 가능(work/T2-3/plan.md).
import type { DrumNote, DrumScore } from '../score/types'
import {
  activePieces,
  barBeatLines,
  LANES,
  noteYPosition,
  pixelsPerSecond,
  type NoteShape,
} from './layout'
import { ticksToSeconds } from '../audio/timing'

export interface LaneRendererOptions {
  /** DrumPiece별 색을 돌려주는 함수 — 호출자가 CSS 변수(`--piece-*`)를 읽어 전달
   * (Canvas는 CSS 변수를 모름, intent/08-design.md §3). */
  pieceColor: (piece: DrumNote['piece']) => string
  laneBorderColor: string
  laneBarColor: string
  laneBeatColor: string
  hitLineColor: string
  /** 판정선 근처 노트를 "히트"로 보는 허용범위(초) — work/T2-3/plan.md §가정. */
  hitWindowSeconds: number
}

export interface LaneRenderer {
  render(score: DrumScore, currentTimeSeconds: number, barsVisible: number): Set<DrumNote['piece']>
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
    render(score, currentTimeSeconds, barsVisible) {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.clearRect(0, 0, width, height)

      const hitLineY = height - 24
      const laneWidth = width / LANES.length
      const speed = pixelsPerSecond(hitLineY, barsVisible, score.meta.timeSignature, score.meta.bpm)
      const lookaheadSeconds = hitLineY / speed

      const noteTimeOf = (note: DrumNote) =>
        ticksToSeconds(note.tick, score.ppq, score.meta.bpm) + score.audioOffsetMs / 1000

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
        score.meta.bpm,
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
        }
      }

      // 판정선
      ctx.strokeStyle = options.hitLineColor
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, hitLineY)
      ctx.lineTo(width, hitLineY)
      ctx.stroke()

      return activePieces(score.notes, noteTimeOf, currentTimeSeconds, options.hitWindowSeconds)
    },
    dispose() {
      // Canvas 자체는 DOM 요소 소유자(React)가 정리 — 여기선 내부 상태가 없어 no-op.
    },
  }
}
