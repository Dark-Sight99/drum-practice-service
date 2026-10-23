import * as alphaTab from '@coderline/alphatab'
import { Midi } from '@tonejs/midi'
import type { ScoreSource } from '../types'
import { midiToDrumScore } from './midiEvents'
import type { ImportResult } from './types'

/** MusicXML(.musicxml/.mxl)·Guitar Pro(.gp/.gp3~.gp5/.gpx) 파일을 DrumScore로 변환한다.
 *
 * alphaTab으로 악보를 파싱해 Score를 얻고, alphaTab 자신의 MIDI 생성기로 표준 MIDI
 * 바이너리를 뽑아낸 뒤, 그 바이트를 @tonejs/midi로 다시 파싱해서 .mid 직접 가져오기와
 * 같은 변환기(`midiToDrumScore`)로 넘긴다 — 틱·템포·타이 계산을 alphaTab에 전부
 * 맡기고 "MIDI 노트 이벤트 → DrumScore" 로직은 한 곳만 유지하기 위함
 * (work/T2-1/plan.md §설계, 실제 샘플 파일로 검증됨).
 *
 * 예외를 던지지 않음 — alphaTab이 손상된 바이트에 `EndOfReaderError` 등을 던지는 것을
 * 실제 실행으로 확인함. */
export function importNotationBytes(
  bytes: Uint8Array,
  source: Extract<ScoreSource, 'musicxml' | 'gp'>,
  title = '',
): ImportResult {
  try {
    const settings = new alphaTab.Settings()
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)

    const midiFile = new alphaTab.midi.MidiFile()
    const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, true)
    const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler)
    generator.generate()
    const binary = midiFile.toBinary()

    const midi = new Midi(binary)
    return midiToDrumScore(midi, source, title)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `악보 파싱 실패: ${message}` }
  }
}
