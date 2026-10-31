// T6-11 임시 진단(2026-10-31, 의뢰인 보고 — "연습↔편집 화면을 2~3번 오가며
// 편집 화면에서 BPM을 바꿔 음원을 다시 받는 걸 반복하면 웹앱이 스스로
// 새로고침된다") 조사용. 의뢰인 기기(iPad)에서 재현시키고, 그동안 쌓인 로그를
// 백엔드 api/debug_log.py가 qa-evidence/T6-11-memory-diag/client-debug.jsonl에
// 쌓아두면 Claude가 파일로 직접 읽어 확인한다 — 의뢰인이 콘솔을 따로 복사해줄
// 필요 없음. **조사 끝나면 이 파일과 호출부(stemPlayer.ts, main.tsx,
// PracticeCanvas.tsx, EditorScreen.tsx) 전부 삭제한다.**

let livePoolCount = 0
let cumulativeBytesLoaded = 0
let cumulativeBytesDestroyed = 0
const startedAtMs = performance.now()

function post(event: string, data: Record<string, unknown>): void {
  // 테스트 환경(jsdom, 상대 URL을 해석할 origin이 없음)이나 네트워크 실패에서도
  // 앱 동작에 전혀 영향이 없어야 한다 — 동기 예외(try/catch)뿐 아니라 fetch가
  // 돌려주는 프라미스 자체의 거부(reject)도 반드시 .catch()로 받아야 처리되지
  // 않은 프라미스 거부로 새지 않는다(try/catch만으로는 비동기 거부를 못 잡음).
  try {
    // keepalive — 화면 전환·언마운트 도중에도 요청이 끊기지 않게(sendBeacon은
    // Content-Type을 세밀히 못 정해 fetch+keepalive로 대신함, 표준 우회법).
    fetch('/api/debug/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
      keepalive: true,
      credentials: 'include',
    }).catch(() => {})
  } catch {
    // 진단 전송 실패는 앱 동작에 전혀 영향 없어야 함 — 조용히 무시.
  }
}

function snapshot(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    livePoolCount,
    cumulativeBytesLoaded,
    cumulativeBytesDestroyed,
    liveBytesEstimate: cumulativeBytesLoaded - cumulativeBytesDestroyed,
    uptimeMs: Math.round(performance.now() - startedAtMs),
    // Safari는 performance.memory/navigator.deviceMemory를 지원 안 함
    // (표준 아님, Chrome 전용) — undefined로 와도 그냥 생략됨.
    jsHeapUsedBytes: (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
      ?.usedJSHeapSize,
    deviceMemoryGiB: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    ...extra,
  }
}

/** `loadStemBufferPool()` 성공 시 1회 호출 — `bytes`는 디코딩된 PCM 총
 * 바이트(압축 전 — 실제로 메모리에 남는 양). */
export function reportPoolCreated(bytes: number, extra: Record<string, unknown> = {}): void {
  livePoolCount += 1
  cumulativeBytesLoaded += bytes
  post('pool_created', snapshot({ bytes, ...extra }))
}

/** `StemBufferPool.destroy()` 내부에서 호출. */
export function reportPoolDestroyed(bytes: number, extra: Record<string, unknown> = {}): void {
  livePoolCount -= 1
  cumulativeBytesDestroyed += bytes
  post('pool_destroyed', snapshot({ bytes, ...extra }))
}

/** 화면(연습/편집) 마운트·언마운트 시 호출 — 어느 화면 전환 시점에 풀 개수가
 * 바뀌는지 맞춰보기 위함. */
export function reportScreenLifecycle(event: string, extra: Record<string, unknown> = {}): void {
  post(event, snapshot(extra))
}

/** 앱 시작 시(main.tsx) 1회만 호출 — 페이지 로드 자체가 "새로고침"이었는지
 * (performance Navigation Timing의 `type`)와, 그 뒤 5초마다 하트비트를 남긴다.
 * 의뢰인이 보고한 "스스로 새로고침"이 진짜 브라우저 reload라면, 그 순간
 * uptimeMs/livePoolCount가 0으로 리셋된 새 page_load 로그가 중간에 찍힐 것 —
 * 그 직전 하트비트의 liveBytesEstimate/livePoolCount가 원인 추적의 핵심 단서. */
export function startMemoryDiagHeartbeat(): void {
  const nav = performance.getEntriesByType('navigation')[0] as
    | (PerformanceNavigationTiming & { type: string })
    | undefined
  post('page_load', snapshot({ navigationType: nav?.type, referrer: document.referrer }))
  setInterval(() => {
    post('heartbeat', snapshot())
  }, 5000)
  document.addEventListener('visibilitychange', () => {
    post('visibilitychange', snapshot({ visibilityState: document.visibilityState }))
  })
  window.addEventListener('pagehide', () => {
    post('pagehide', snapshot())
  })
}
