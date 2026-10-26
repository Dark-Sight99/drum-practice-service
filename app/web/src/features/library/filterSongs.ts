import type { SongSummary } from '../../api/songs'

/** 제목·아티스트 부분일치(대소문자 무시) — 서버 쪽 검색 API 없이 클라이언트에서
 * 필터링(work/T2-5/plan.md §가정: 사용자 규모가 작아 서버 검색 불필요).
 *
 * 2026-10-26 의뢰인 지적("희비"로는 "희비교차"가 안 걸림) — 원인은 대소문자가
 * 아니라 유니코드 정규화였다. Mac에서 올린 파일명 기반 제목이 NFD(자모
 * 분해형)로 저장돼 있던 반면(직접 확인: '희비교차'가 NFD, NFC 아님), 사용자가
 * 입력기로 치는 검색어는 보통 NFC(완성형)라 눈엔 같은 글자라도
 * String.includes()가 코드포인트 단위로 비교해 매칭이 안 됐다. 양쪽 다
 * normalize('NFC')로 맞춰 비교. */
export function filterSongs(songs: readonly SongSummary[], query: string): SongSummary[] {
  const trimmed = query.trim().normalize('NFC').toLowerCase()
  if (!trimmed) return [...songs]
  return songs.filter((song) => {
    const title = song.title.normalize('NFC').toLowerCase()
    const artist = (song.artist ?? '').normalize('NFC').toLowerCase()
    return title.includes(trimmed) || artist.includes(trimmed)
  })
}
