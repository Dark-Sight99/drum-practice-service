import type { DrumPiece, Hand } from '../score/types'

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
  /** 판정선 근처 피스별 손/발(REQ-12) — 비어 있으면(또는 `showSticking`이 꺼지면)
   * T2-3 때처럼 단순 점등만 한다(회귀 없음). 키가 있으면(값이 null이어도) 점등됨 —
   * `has(piece)`가 "lit" 조건(work/T2-7/plan.md §설계 3). */
  activeHandByPiece: ReadonlyMap<DrumPiece, Hand>
  /** 꺼지면 손이 있어도 테두리를 항상 실선으로(T2-3 때와 동일 모양). */
  showSticking: boolean
  pieceColor: (piece: DrumPiece) => string
}

/** 오른손/오른발(R/RF) → 실선, 왼손/왼발(L/LF) → 점선(intent/08-design.md §3,
 * REQ-12). 자동 추천 값은 추가로 더 흐리게(opacity) — `note.handSource` 자체는
 * 레인에만 있고 킷은 피스 단위라 손이 L/R 어느 쪽인지만 반영, "자동이라 흐리게"는
 * 레인 글자가 이미 맡고 있어 여기선 생략(과한 중복 표시 방지, §가정). */
function isDashedHand(hand: Hand): boolean {
  return hand === 'L' || hand === 'LF'
}

/** 판정선에 도달한 피스를 짧게 밝힌다(intent/08-design.md §6 "약 120ms"). */
export function KitIllustration({ activeHandByPiece, showSticking, pieceColor }: KitIllustrationProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="드럼킷"
      style={{ width: '100%', height: 'auto' }}
    >
      {KIT_PIECES.map(({ piece, label, cx, cy, r }) => {
        const lit = activeHandByPiece.has(piece)
        const hand = activeHandByPiece.get(piece) ?? null
        const dashed = showSticking && lit && isDashedHand(hand)
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
              strokeDasharray={dashed ? '3 2' : undefined}
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
