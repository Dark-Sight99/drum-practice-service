// 라이브러리(곡 목록/업로드/이름변경/삭제/DrumScore 조회). 백엔드: app/server/api/songs.py.
// work/T2-5/plan.md §설계 2·3.

import type { DrumScore } from '../score/types'
import { apiFetch, apiFetchJson } from './client'

export interface SongSummary {
  id: number
  title: string
  artist: string | null
  status: string
  original_bpm: number | null
  source_type: string
  /** T3-3(REQ-04) — `GET /songs/{id}/audio/{kind}`로 가져올 수 있는 종류
   * (`AssetKind`의 오디오 전용 부분집합). 분리가 아직 안 된 곡은 빈 배열. */
  available_audio_kinds: string[]
}

/** T3-3(REQ-04) — 분리된 오디오 트랙(스템/원본)의 URL. 서버가 쿠키 기반 인증을
 * 그대로 쓰므로(`client.ts` 주석 — Vite 프록시로 동일 출처) 토큰을 붙일 필요
 * 없음. */
export function songAudioUrl(songId: number, kind: string): string {
  return `/api/songs/${songId}/audio/${kind}`
}

/** T6-11 Step 3(REQ-04, Q-33) — 음정 유지 배속 변환본 URL(work/T6-11/plan.md
 * "API 계약"). `permille`은 `Math.round(exactRate * 1000)`(exactRate =
 * playbackBpm/원곡BPM). 1000(배속 변경 없음)이면 백엔드가 atempo조차 안 거치고
 * 원본을 그대로 돌려주므로, 여기서도 그 경우엔 기존 `songAudioUrl()`과 완전히
 * 같은 URL을 써서 불필요한 추가 경로 분기를 만들지 않는다(두 URL이 최종적으로
 * 같은 파일을 가리킴 — 캐시 적중률도 그대로 유지). */
export function stemTempoAudioUrl(songId: number, kind: string, permille: number): string {
  return permille === 1000
    ? songAudioUrl(songId, kind)
    : `/api/songs/${songId}/audio/${kind}/tempo/${permille}`
}

export async function listSongs(): Promise<SongSummary[]> {
  return apiFetchJson<SongSummary[]>('/songs')
}

/** 2026-10-26 의뢰인 요청 — 음원 업로드 후 분리·채보 진행 상태를 폴링하려고
 * 곡 하나만 가볍게 조회(목록 전체를 다시 불러올 필요 없음). */
export async function fetchSong(id: number): Promise<SongSummary> {
  return apiFetchJson<SongSummary>(`/songs/${id}`)
}

export async function uploadSong(
  file: File,
  title: string,
  artist: string,
  drumScore: DrumScore,
): Promise<SongSummary> {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  if (artist) form.append('artist', artist)
  form.append('drumscore', JSON.stringify(drumScore))
  return apiFetchJson<SongSummary>('/songs', { method: 'POST', body: form })
}

/** T3-19(REQ-01) — 음원(또는 음원 트랙이 있는 mp4)을 올려 Demucs 분리 작업을
 * 큐에 넣는다. `POST /songs` (디지털 악보, 위 uploadSong)와 달리 DrumScore를
 * 클라이언트가 안 만든다 — 서버가 분리 후 자동으로 채보 작업까지 이어 큐에
 * 넣는다(`modules/separator/handler.py`). 응답의 song은 아직 처리중 상태. */
export async function uploadAudioSong(
  file: File,
  title: string,
  artist: string,
): Promise<{ song: SongSummary; job_id: number }> {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  if (artist) form.append('artist', artist)
  return apiFetchJson<{ song: SongSummary; job_id: number }>('/songs/audio', {
    method: 'POST',
    body: form,
  })
}

export async function renameSong(
  id: number,
  patch: { title?: string; artist?: string | null },
): Promise<SongSummary> {
  return apiFetchJson<SongSummary>(`/songs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export async function deleteSong(id: number): Promise<void> {
  await apiFetch(`/songs/${id}`, { method: 'DELETE' })
}

export async function fetchSongDrumScore(id: number): Promise<DrumScore> {
  return apiFetchJson<DrumScore>(`/songs/${id}/drumscore`)
}

/** T2-6(REQ-03) — 편집기가 수정한 DrumScore를 저장(편집본). work/T2-6/plan.md
 * §설계 1 — 원문 그대로 보내고(재직렬화는 호출자 쪽 JSON.stringify 한 번뿐),
 * 서버도 그 바이트를 그대로 저장한다. */
export async function saveSongDrumScore(id: number, drumScore: DrumScore): Promise<void> {
  await apiFetch(`/songs/${id}/drumscore`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(drumScore),
  })
}

// T3-4(REQ-05)의 곡별 믹서 설정(fetchPracticeSetting/saveMixerSetting, 백엔드
// `/songs/{id}/practice-setting`)은 T3-28(2026-10-27 의뢰인 요청)에서 계정 전체
// 공유(`api/auth.ts`의 fetchMixerSetting/saveMixerSetting, `/auth/me/mixer-setting`)
// 로 바뀌며 더 이상 프런트에서 호출하지 않는다. 백엔드 테이블·엔드포인트 자체는
// 이미 저장된 데이터가 있어 그대로 둔다(work/T3-28/plan.md §범위경계).
