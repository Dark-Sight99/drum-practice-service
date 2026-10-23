import * as Tone from 'tone'
import type { TimeSignature } from './timing'

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
  setTimeSignature(timeSignature: TimeSignature): void
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
    setTimeSignature(timeSignature: TimeSignature) {
      // Codex 모드A C-001(재현됨): 분자만 넘기면 Transport가 분모를 늘 4로
      // 가정해서 "1마디" 길이가 실제와 달라짐(6/8을 6으로만 넘기면 Transport는
      // 6/4로 취급 — 실제 실행으로 확인: 6/8·120bpm 1마디는 1.5초인데 분자만
      // 넘기면 Transport가 3초로 계산함). 분자·분모 배열을 그대로 넘겨야 함
      // (Transport.timeSignature 공식 타입·문서 주석으로 확인: 배열을 받으면
      // "분모 4 기준 분자"로 환산).
      transport.timeSignature = timeSignature
    },
    getPositionSeconds() {
      return transport.seconds
    },
  }
}
