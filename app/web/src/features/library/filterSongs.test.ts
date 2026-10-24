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
  },
  {
    id: 2,
    title: '발라드',
    artist: '가수A',
    status: 'completed',
    original_bpm: 80,
    source_type: 'musicxml',
  },
  {
    id: 3,
    title: 'Jazz Tune',
    artist: null,
    status: 'completed',
    original_bpm: 100,
    source_type: 'gp',
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
})
