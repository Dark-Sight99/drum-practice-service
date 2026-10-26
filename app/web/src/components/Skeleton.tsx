export interface SkeletonProps {
  width?: string | number
  height?: string | number
  style?: React.CSSProperties
}

// 2026-10-26 의뢰인 요청 — 각 화면 로딩 중 보여줄 스켈레톤 placeholder.
// 애니메이션(.skeleton)은 index.css 한 곳에서만 정의(디자인 토큰 규칙,
// intent/08-design.md §7).
export function Skeleton({ width = '100%', height = 16, style }: SkeletonProps) {
  return <div className="skeleton" style={{ width, height, ...style }} />
}

// 라이브러리 목록이 쓰는 카드 모양 스켈레톤 — 실제 .song-card와 같은 패딩/
// 둥근모서리를 써서 로딩이 끝나고 실제 카드로 바뀔 때 레이아웃이 튀지 않는다.
export function SongCardSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--surface)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Skeleton width="40%" height={18} />
        <Skeleton width="60%" height={13} />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        <Skeleton width={48} height={32} />
        <Skeleton width={64} height={32} />
        <Skeleton width={48} height={32} />
      </div>
    </div>
  )
}
