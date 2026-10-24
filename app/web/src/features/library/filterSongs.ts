import type { SongSummary } from '../../api/songs'

/** 제목·아티스트 부분일치(대소문자 무시) — 서버 쪽 검색 API 없이 클라이언트에서
 * 필터링(work/T2-5/plan.md §가정: 사용자 규모가 작아 서버 검색 불필요). */
export function filterSongs(songs: readonly SongSummary[], query: string): SongSummary[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return [...songs]
  return songs.filter((song) => {
    const title = song.title.toLowerCase()
    const artist = (song.artist ?? '').toLowerCase()
    return title.includes(trimmed) || artist.includes(trimmed)
  })
}
