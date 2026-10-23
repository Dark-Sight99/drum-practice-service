import * as Tone from 'tone'
import type { DrumPiece } from '../score/types'

/** DrumPiece → Tone.js 내장 신스 매핑. 실제 드럼 샘플 오디오가 아닌 합성음
 * (라이선스·에셋 제작 부담 없음) — 음색 승인은 `intent/07-open-questions.md` Q-19,
 * work/T2-2/plan.md §가정. */
export interface DrumVoice {
  /** time: Tone.js Time(초 단위 숫자 권장), velocity: 0~1 정규화값. */
  trigger(time: number, velocity: number): void
  dispose(): void
}

function membraneVoice(note: string): DrumVoice {
  const synth = new Tone.MembraneSynth().toDestination()
  return {
    trigger(time, velocity) {
      synth.triggerAttackRelease(note, '8n', time, velocity)
    },
    dispose() {
      synth.dispose()
    },
  }
}

function noiseVoice(): DrumVoice {
  const synth = new Tone.NoiseSynth().toDestination()
  return {
    trigger(time, velocity) {
      synth.triggerAttackRelease('16n', time, velocity)
    },
    dispose() {
      synth.dispose()
    },
  }
}

function metalVoice(options: {
  harmonicity: number
  resonance: number
  release: number
}): DrumVoice {
  const synth = new Tone.MetalSynth({
    harmonicity: options.harmonicity,
    resonance: options.resonance,
    envelope: { release: options.release },
  }).toDestination()
  return {
    trigger(time, velocity) {
      synth.triggerAttackRelease('C4', '16n', time, velocity)
    },
    dispose() {
      synth.dispose()
    },
  }
}

export type DrumVoiceMap = Record<DrumPiece, DrumVoice>

/** 9종 분류 각각에 대한 신스를 생성한다. 실제 오디오 노드를 만들기 때문에
 * AudioContext가 있는 환경(실제 브라우저)에서만 정상 동작 — jsdom에서는
 * 생성 자체가 예외를 던짐(`param must be an AudioParam`, 실제 실행으로 확인). */
export function createDrumVoices(): DrumVoiceMap {
  return {
    kick: membraneVoice('C1'),
    tom_high: membraneVoice('G2'),
    tom_mid: membraneVoice('E2'),
    tom_floor: membraneVoice('C2'),
    snare: noiseVoice(),
    hihat_closed: metalVoice({ harmonicity: 5.1, resonance: 4000, release: 0.05 }),
    hihat_open: metalVoice({ harmonicity: 5.1, resonance: 4000, release: 0.4 }),
    crash: metalVoice({ harmonicity: 3.1, resonance: 3000, release: 1.5 }),
    ride: metalVoice({ harmonicity: 4.1, resonance: 5000, release: 0.8 }),
  }
}

export function disposeDrumVoices(voices: DrumVoiceMap): void {
  for (const voice of Object.values(voices)) voice.dispose()
}
