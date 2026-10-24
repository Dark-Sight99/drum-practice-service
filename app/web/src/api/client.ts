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

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // 응답이 JSON이 아니면 상태 텍스트로 대체
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
