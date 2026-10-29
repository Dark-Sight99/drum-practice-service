import { useEffect, useState } from 'react'

const COMPACT_HEADER_BREAKPOINT_QUERY = '(max-height: 480px)'

/** 2026-10-30(T5-1, 폰 가로 레인 겹침 버그 수정) — 연주 화면 캔버스(레인)에는
 * "극단적으로 짧은 창에서도 레인이 안 쪼그라들게" 최소 300px가 보장돼 있는데
 * (PracticeCanvas.tsx의 canvas minHeight:300 — 6차 의뢰인 요청), 폰 가로
 * 모드처럼 뷰포트 세로가 ~375px밖에 안 되면 뒤로가기·제목·믹서 버튼이 차지한
 * 나머지 공간(약 220px)이 그 300px보다 작아져 레인이 재생 버튼 줄을 시각적으로
 * 덮어버린다(DOM엔 버튼이 있지만 안 보이고 클릭도 안 됨 — 실브라우저
 * getBoundingClientRect+elementFromPoint로 확인). 의뢰인 선택(① 상단 UI
 * 압축)에 따라, 아주 짧은 창에서만 상단 뒤로가기+제목 줄의 높이·여백을
 * 줄여(두 줄→한 줄 등) 레인에 더 많은 공간을 돌려준다 — 레인의 300px
 * 최소값 자체는 그대로 유지. 480px는 흔한 폰 가로 높이(iPhone SE 375,
 * 대부분의 폰 360~430)는 걸리고 태블릿/PC(보통 600px+)는 안 걸리는
 * 어림값(다른 브레이크포인트들과 같은 성격의 추정치 — intent/07-open-questions.md 기록). */
export function useCompactHeaderLayout(): boolean {
  const [isCompact, setIsCompact] = useState(
    () => window.matchMedia(COMPACT_HEADER_BREAKPOINT_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_HEADER_BREAKPOINT_QUERY)
    const onChange = () => setIsCompact(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isCompact
}
