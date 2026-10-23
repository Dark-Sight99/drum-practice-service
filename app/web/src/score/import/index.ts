import { importMidiBuffer } from './importMidi'
import { importNotationBytes } from './importNotation'
import type { ImportResult } from './types'

export type { ImportResult } from './types'
export { importMidiBuffer } from './importMidi'
export { importNotationBytes } from './importNotation'

const MIDI_EXTENSIONS = ['.mid', '.midi']
const MUSICXML_EXTENSIONS = ['.musicxml', '.mxl']
const GP_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx']

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

/** 파일 바이트 + 파일명으로 포맷을 판별해 알맞은 가져오기 함수로 넘긴다
 * (REQ-02 경로 C: MIDI/MusicXML/GP 통합 진입점). 지원하지 않는 확장자는
 * 예외 없이 `{ok:false}`를 반환한다. */
export function importScoreFile(bytes: Uint8Array, filename: string): ImportResult {
  const ext = extensionOf(filename)
  const title = filename.slice(0, filename.length - ext.length)

  if (MIDI_EXTENSIONS.includes(ext)) {
    return importMidiBuffer(bytes, title)
  }
  if (MUSICXML_EXTENSIONS.includes(ext)) {
    return importNotationBytes(bytes, 'musicxml', title)
  }
  if (GP_EXTENSIONS.includes(ext)) {
    return importNotationBytes(bytes, 'gp', title)
  }
  return { ok: false, error: `지원하지 않는 파일 형식: ${ext || '(확장자 없음)'}` }
}
