// 라이브러리(곡 목록/업로드/이름변경/삭제/DrumScore 조회). 백엔드: app/server/api/songs.py.
// work/T2-5/plan.md §설계 2·3.

import type { MixerState } from '../audio/mixer'
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

export async function listSongs(): Promise<SongSummary[]> {
  return apiFetchJson<SongSummary[]>('/songs')
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

/** T3-4(REQ-05) — 곡별 믹서 설정 조회. 저장된 게 없으면 `volumes: null`
 * (서버가 기본값을 추측하지 않음 — work/T3-4/plan.md §1, 기본값은 호출자가
 * `defaultMixerState()`로 채움). */
export async function fetchPracticeSetting(id: number): Promise<{ volumes: MixerState | null }> {
  return apiFetchJson<{ volumes: MixerState | null }>(`/songs/${id}/practice-setting`)
}

/** T3-4(REQ-05) — 곡별 믹서 설정 저장(volumes_json만 갱신, practice_bpm/루프는
 * 안 건드림). */
export async function saveMixerSetting(id: number, volumes: MixerState): Promise<void> {
  await apiFetch(`/songs/${id}/practice-setting`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volumes }),
  })
}
