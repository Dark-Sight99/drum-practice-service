import { Midi } from '@tonejs/midi'
import { midiToDrumScore } from './midiEvents'
import type { ImportResult } from './types'

/** .mid 파일을 DrumScore로 변환한다. 예외를 던지지 않음(REQ-02 "인식 실패 시에도
 * 크래시 없이 진입") — @tonejs/midi가 손상된 바이트에 예외를 던지는 것을 실제
 * 실행으로 확인함(work/T2-1/plan.md). */
export function importMidiBuffer(data: ArrayBuffer | Uint8Array, title = ''): ImportResult {
  try {
    const midi = new Midi(data)
    return midiToDrumScore(midi, 'midi', title)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `MIDI 파싱 실패: ${message}` }
  }
}
