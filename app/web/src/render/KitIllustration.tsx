import type { DrumPiece } from '../score/types'

// 드럼킷 점등 — 단순 도형 placeholder(intent/07-open-questions.md Q-09: 정밀 일러스트는
// 의뢰인 디자인 승인 필요, 이번엔 점등 "기능"만 구현, work/T2-3/plan.md §범위).
// 배치는 intent/04-ui-ux.md §3 3행 레이아웃: 상단 HH·CR·RD / 중단 SN·T1·T2 / 하단 KK·FT.
interface KitPieceDef {
  piece: DrumPiece
  label: string
  cx: number
  cy: number
  r: number
}

const KIT_PIECES: readonly KitPieceDef[] = [
  { piece: 'hihat_closed', label: 'HH', cx: 20, cy: 20, r: 16 },
  { piece: 'crash', label: 'CR', cx: 50, cy: 15, r: 14 },
  { piece: 'ride', label: 'RD', cx: 80, cy: 20, r: 16 },
  { piece: 'snare', label: 'SN', cx: 30, cy: 50, r: 15 },
  { piece: 'tom_high', label: 'T1', cx: 50, cy: 48, r: 13 },
  { piece: 'tom_mid', label: 'T2', cx: 70, cy: 50, r: 13 },
  { piece: 'kick', label: 'KK', cx: 25, cy: 82, r: 18 },
  { piece: 'tom_floor', label: 'FT', cx: 70, cy: 82, r: 17 },
]

export interface KitIllustrationProps {
  activePieces: ReadonlySet<DrumPiece>
  pieceColor: (piece: DrumPiece) => string
}

/** 판정선에 도달한 피스를 짧게 밝힌다(intent/08-design.md §6 "약 120ms"). */
export function KitIllustration({ activePieces, pieceColor }: KitIllustrationProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="드럼킷"
      style={{ width: '100%', height: 'auto' }}
    >
      {KIT_PIECES.map(({ piece, label, cx, cy, r }) => {
        const lit = activePieces.has(piece)
        const color = pieceColor(piece)
        return (
          <g key={piece} style={{ transition: 'opacity 120ms ease-out' }} opacity={lit ? 1 : 0.55}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={lit ? 2.5 : 1.5}
            />
            <text
              x={cx}
              y={cy}
              fill={color}
              fontSize={8}
              textAnchor="middle"
              dominantBaseline="middle"
              fontWeight={700}
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
