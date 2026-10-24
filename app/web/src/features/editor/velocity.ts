// 셈여림 3단계. 근거: REQ-03 "셈여림(약/중/강 3단계)", work/T2-6/plan.md §가정 —
// 구체 velocity 값은 명시된 기준이 없어 MIDI 0~127 범위 안에서 임의 설정
// (intent/08-design.md §3의 "60%/85%/100% 밝기"는 렌더링 표현이고 이것과는 별개).

export type VelocityTier = 'soft' | 'mid' | 'strong'

export const VELOCITY_TIERS: Record<VelocityTier, number> = {
  soft: 40,
  mid: 90,
  strong: 120,
}

const TIER_ORDER: VelocityTier[] = ['soft', 'mid', 'strong']

/** 주어진 velocity 값에 가장 가까운 티어를 돌려준다(기존 노트의 현재 티어를
 * UI에 표시하는 용도 — 꼭 세 값 중 하나가 아니어도 동작). */
export function velocityTierOf(velocity: number): VelocityTier {
  let closest: VelocityTier = TIER_ORDER[0]
  let closestDistance = Infinity
  for (const tier of TIER_ORDER) {
    const distance = Math.abs(VELOCITY_TIERS[tier] - velocity)
    if (distance < closestDistance) {
      closestDistance = distance
      closest = tier
    }
  }
  return closest
}
