import * as Tone from 'tone'

/** 마스터 클록 — Tone.js의 Transport(AudioContext 시간 기반)를 감싼다.
 * 다른 모듈(메트로놈, 악보 재생, 추후 레인 렌더러 T2-3)은 Tone을 직접 참조하지
 * 않고 이 래퍼만 쓴다 — "교체 가능한 모듈" 원칙(intent/03-architecture-stack.md §1).
 *
 * jsdom은 Web Audio API가 없어 Tone.getTransport()가 내부적으로 깨진 객체를
 * 반환함(실제 실행으로 확인, work/T2-2/plan.md) — 이 파일은 실제 브라우저에서만
 * 의미 있게 동작하며 수동 QA로 검증한다. */
export interface MasterClock {
  start(): void
  stop(): void
  setBpm(bpm: number): void
  getBpm(): number
  setTimeSignatureNumerator(numerator: number): void
  getPositionSeconds(): number
}

export function getMasterClock(): MasterClock {
  const transport = Tone.getTransport()
  return {
    start() {
      transport.start()
    },
    stop() {
      transport.stop()
    },
    setBpm(bpm: number) {
      transport.bpm.value = bpm
    },
    getBpm() {
      return transport.bpm.value
    },
    setTimeSignatureNumerator(numerator: number) {
      transport.timeSignature = numerator
    },
    getPositionSeconds() {
      return transport.seconds
    },
  }
}
