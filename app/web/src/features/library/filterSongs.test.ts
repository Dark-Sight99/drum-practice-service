import { describe, expect, it } from 'vitest'
import type { SongSummary } from '../../api/songs'
import { filterSongs } from './filterSongs'

const songs: SongSummary[] = [
  {
    id: 1,
    title: 'Rock Anthem',
    artist: 'The Band',
    status: 'completed',
    original_bpm: 120,
    source_type: 'midi',
    available_audio_kinds: [],
  },
  {
    id: 2,
    title: '발라드',
    artist: '가수A',
    status: 'completed',
    original_bpm: 80,
    source_type: 'musicxml',
    available_audio_kinds: [],
  },
  {
    id: 3,
    title: 'Jazz Tune',
    artist: null,
    status: 'completed',
    original_bpm: 100,
    source_type: 'gp',
    available_audio_kinds: [],
  },
]

describe('filterSongs', () => {
  it('returns everything when query is empty or whitespace', () => {
    expect(filterSongs(songs, '')).toHaveLength(3)
    expect(filterSongs(songs, '   ')).toHaveLength(3)
  })

  it('matches by title, case-insensitively', () => {
    expect(filterSongs(songs, 'rock')).toEqual([songs[0]])
    expect(filterSongs(songs, 'ROCK')).toEqual([songs[0]])
  })

  it('matches by artist', () => {
    expect(filterSongs(songs, '가수A')).toEqual([songs[1]])
  })

  it('handles songs with a null artist without throwing', () => {
    expect(filterSongs(songs, 'jazz')).toEqual([songs[2]])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterSongs(songs, 'no such song')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const copy = [...songs]
    filterSongs(songs, 'rock')
    expect(songs).toEqual(copy)
  })

  // 2026-10-26 의뢰인 지적 — Mac에서 올린 파일명 기반 제목은 유니코드 NFD(자모
  // 분해형)로 저장되는데, 사용자가 치는 검색어는 보통 NFC(완성형)라 눈엔 같은
  // 글자라도 정규화를 안 맞추면 String.includes()가 매칭을 못 했다.
  it('matches Korean text even when stored title is NFD and query is NFC(모드A 회귀)', () => {
    const nfdTitle = "희비교차".normalize('NFD')
    expect(nfdTitle).not.toEqual('희비교차') // 전제 확인 — 실제로 다른 코드포인트 시퀀스
    const nfdSongs: SongSummary[] = [
      {
        id: 4,
        title: `[Audio] 음율 - '${nfdTitle} (CROXX)'`,
        artist: null,
        status: 'completed',
        original_bpm: null,
        source_type: 'audio',
        available_audio_kinds: [],
      },
    ]
    expect(filterSongs(nfdSongs, '희비')).toEqual(nfdSongs) // 검색어는 일반적인 NFC
  })
})
