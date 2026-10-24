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
