import * as Tone from 'tone'
import type { TimeSignature } from './timing'

export interface MetronomeOptions {
  timeSignature: TimeSignature
  /** 4(4분음표 단위) | 8(8분음표 단위) — REQ-04 "박 단위(4·8분)". */
  subdivisionDenominator?: 4 | 8
  volumeDb?: number
}

export interface Metronome {
  setEnabled(enabled: boolean): void
  setVolume(volumeDb: number): void
  dispose(): void
}

const CLICK_INTERVAL: Record<4 | 8, string> = { 4: '4n', 8: '8n' }

/** Transport.scheduleRepeat로 매 박마다 클릭을 울린다. 강박(마디 첫 박)은
 * 다른 음높이로 구분(REQ-04 "강박 강조"). jsdom에서는 Tone 신스를 만들 수
 * 없어 실제 브라우저에서만 검증 가능(work/T2-2/plan.md). */
export function createMetronome(options: MetronomeOptions): Metronome {
  const subdivision = options.subdivisionDenominator ?? 4
  const synth = new Tone.MembraneSynth({ volume: options.volumeDb ?? -6 }).toDestination()
  const transport = Tone.getTransport()

  let beatIndex = 0
  const clicksPerBar = Math.round(
    options.timeSignature[0] * (subdivision / options.timeSignature[1]),
  )
  let enabled = true

  const eventId = transport.scheduleRepeat((time) => {
    if (!enabled) {
      beatIndex = (beatIndex + 1) % clicksPerBar
      return
    }
    const isAccent = beatIndex === 0
    synth.triggerAttackRelease(isAccent ? 'C3' : 'C2', '16n', time)
    beatIndex = (beatIndex + 1) % clicksPerBar
  }, CLICK_INTERVAL[subdivision])

  return {
    setEnabled(next: boolean) {
      enabled = next
    },
    setVolume(volumeDb: number) {
      synth.volume.value = volumeDb
    },
    dispose() {
      transport.clear(eventId)
      synth.dispose()
    },
  }
}
