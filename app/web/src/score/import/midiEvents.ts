import type { Midi } from '@tonejs/midi'
import { GM_NOTE_TO_PIECE } from '../gmMapping'
import type { DrumNote, ScoreSource } from '../types'
import type { ImportResult } from './types'

const DEFAULT_BPM = 120
const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4]

/** 파싱된 MIDI(@tonejs/midi `Midi` 인스턴스)를 DrumScore로 변환한다.
 * .mid 직접 가져오기와 MusicXML/GP(alphaTab이 생성한 MIDI 바이트를 재파싱한 것)
 * 양쪽에서 공유하는 단일 변환 경로 — work/T2-1/plan.md §설계. */
export function midiToDrumScore(midi: Midi, source: ScoreSource, title = ''): ImportResult {
  const notes: DrumNote[] = []
  const unmappedGmNotesSet = new Set<number>()
  let unmappedNoteCount = 0

  for (const track of midi.tracks) {
    if (!track.instrument.percussion) continue
    for (const note of track.notes) {
      const piece = GM_NOTE_TO_PIECE[note.midi]
      if (piece === undefined) {
        // CLAUDE.md 규칙1: 우리 9종 분류 밖의 GM 퍼커션(카우벨 등)을 임의로 비슷한
        // 분류에 끼워 맞추지 않고 건너뛰며 집계만 한다 — work/T2-1/plan.md §설계.
        unmappedGmNotesSet.add(note.midi)
        unmappedNoteCount += 1
        continue
      }
      notes.push({
        tick: Math.round(note.ticks),
        piece,
        velocity: Math.min(127, Math.max(0, Math.round(note.velocity * 127))),
        hand: null,
      })
    }
  }

  notes.sort((a, b) => a.tick - b.tick)

  const bpm = midi.header.tempos[0]?.bpm ?? DEFAULT_BPM
  const timeSignature =
    (midi.header.timeSignatures[0]?.timeSignature as [number, number] | undefined) ??
    DEFAULT_TIME_SIGNATURE

  return {
    ok: true,
    score: {
      version: 1,
      meta: { title, bpm, timeSignature, source },
      notes,
      ppq: midi.header.ppq,
      audioOffsetMs: 0,
    },
    unmappedNoteCount,
    unmappedGmNotes: [...unmappedGmNotesSet].sort((a, b) => a - b),
  }
}
