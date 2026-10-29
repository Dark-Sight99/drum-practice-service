// 백엔드(FastAPI) 호출 공통 래퍼. work/T2-5/plan.md §설계 3.
// Vite 개발 프록시(vite.config.ts)가 /api를 FastAPI로 전달해 브라우저 입장에서는
// 전부 동일 출처 요청이 된다 — CORS 없이 credentials만 항상 포함시키면 된다.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// 2026-10-29(의뢰인 요청 — 예외처리 화면 점검 중 발견) — 서버가 응답할 수
// 없을 때(502/503/504, 프록시·리버스 프록시·백엔드 자체 중 누가 보내든
// "지금 서버에 연결 안 됨"이라는 뜻은 같다) response.statusText는 보통
// 영어 원문("Bad Gateway" 등)이라 사용자에게 그대로 보이면 안 된다. 실제로
// 개발 서버를 내리고 재현해 확인됨(qa-evidence/T3-55/result.md). FastAPI
// 자신이 의미 있는 한글 detail을 담아 502/503을 보내는 경우(JSON 파싱 성공)는
// 그 메시지를 그대로 쓰고, JSON이 아닌 경우(Vite 프록시·다른 리버스 프록시의
// 기본 에러 페이지)에만 이 공통 한글 문구로 대체한다.
const GATEWAY_FAILURE_STATUSES = new Set([502, 503, 504])

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // 응답이 JSON이 아니면 아래에서 상태 코드별로 대체
    if (GATEWAY_FAILURE_STATUSES.has(response.status)) {
      return '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요'
    }
  }
  return response.statusText || `요청 실패 (${response.status})`
}

/** `init`은 fetch()의 두 번째 인자와 동일 — `/api` 접두사를 자동으로 붙이고
 * 쿠키를 항상 포함시키며, 2xx가 아니면 서버의 에러 메시지로 예외를 던진다. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'include' })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }
  return response
}

export async function apiFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init)
  return (await response.json()) as T
}
