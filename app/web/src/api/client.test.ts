import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'

// 2026-10-29(의뢰인 요청 — 예외처리 화면 점검 중 발견) — 서버다운/네트워크
// 끊김을 실제로 재현했을 때 영어 원문 "Bad Gateway"가 그대로 노출되는
// 문제를 readErrorMessage()에서 고쳤다. 이 테스트는 그 수정이 의도한
// 3가지 경로를 각각 확인한다.
describe('apiFetch error messages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('502(JSON 아님)는 한글 안내문으로 대체한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' })),
    )
    await expect(apiFetch('/songs')).rejects.toMatchObject({
      message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요',
    })
  })

  it('503(JSON 아님)도 한글 안내문으로 대체한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }),
      ),
    )
    await expect(apiFetch('/songs')).rejects.toMatchObject({
      message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요',
    })
  })

  it('502라도 서버가 JSON detail을 보내면 그 메시지를 그대로 쓴다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: '일시적으로 점검 중입니다' }), {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(apiFetch('/songs')).rejects.toMatchObject({ message: '일시적으로 점검 중입니다' })
  })

  it('502/503/504이 아닌 상태 코드는 기존처럼 statusText를 그대로 쓴다', async () => {
    // Codex 모드A 지적(반영) — 같은 Response 인스턴스로 apiFetch()를 두 번
    // 부르면 첫 호출이 이미 본문 스트림을 소비해 두 번째는 "JSON 파싱
    // 실패" 경로만 우연히 재확인하게 된다(의도가 불명확). 한 번만 호출해
    // 그 결과(err) 하나로 두 가지를 전부 단언한다.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' })),
    )
    let err: unknown
    try {
      await apiFetch('/songs')
    } catch (caught) {
      err = caught
    }
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ message: 'Not Found' })
  })
})
