export interface SpinnerProps {
  size?: number
}

// 2026-10-26 의뢰인 요청 — 진행률(%)을 보여줄 실제 데이터가 없어(백엔드 Job은
// 상태만 갖고 숫자 진행률이 없음) 부정확한 숫자 대신 도는 원으로 "진행 중"만
// 표시한다. 애니메이션(.spinner)은 index.css 한 곳에서만 정의.
export function Spinner({ size = 40 }: SpinnerProps) {
  return <div className="spinner" style={{ width: size, height: size }} />
}
