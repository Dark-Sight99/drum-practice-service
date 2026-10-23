// 순수 타이밍 계산(Tone.js 의존 없음 — jsdom에서 단위 테스트 가능).
// 근거: REQ-04, intent/03-architecture-stack.md §1("단일 마스터 클록"),
// work/T2-2/plan.md §설계.

export type TimeSignature = [number, number]

/** BPM(분당 4분음표 수)을 4분음표 1개의 길이(초)로 변환. MIDI/DrumScore의 bpm은
 * 항상 4분음표 기준(@tonejs/midi의 header.ppq·bpm 관례와 동일, T2-1에서 확인). */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm
}

/** DrumScore의 틱(해당 곡 자신의 ppq 기준)을 초로 변환. */
export function ticksToSeconds(tick: number, ppq: number, bpm: number): number {
  return (tick / ppq) * secondsPerBeat(bpm)
}

/** 박자표의 분자를, 분모가 다른 세분음표 기준으로 환산한 "박 수". 메트로놈이
 * 4분·8분 중 어느 단위로 찍든 한 마디에 클릭이 몇 번 들어가는지 계산하는 데 씀. */
export function beatsPerBar(timeSignature: TimeSignature, subdivisionDenominator = 4): number {
  const [numerator, denominator] = timeSignature
  return numerator * (subdivisionDenominator / denominator)
}

/** 클릭 세분음표 1개의 길이(초). subdivisionDenominator=4(4분)|8(8분). */
export function secondsPerClick(bpm: number, subdivisionDenominator = 4): number {
  return secondsPerBeat(bpm) * (4 / subdivisionDenominator)
}

/** 마디 1개(카운트인)의 길이(초). */
export function barDurationSeconds(
  timeSignature: TimeSignature,
  bpm: number,
  subdivisionDenominator = 4,
): number {
  return (
    beatsPerBar(timeSignature, subdivisionDenominator) *
    secondsPerClick(bpm, subdivisionDenominator)
  )
}

export interface MetronomeBeat {
  timeSeconds: number
  accent: boolean
}

/** `bars`마디 분량의 메트로놈 클릭 시각 배열을 만든다. 각 마디의 첫 클릭만 강박. */
export function metronomeBeatTimes(
  timeSignature: TimeSignature,
  bpm: number,
  bars: number,
  subdivisionDenominator = 4,
  startSeconds = 0,
): MetronomeBeat[] {
  const clicksPerBar = beatsPerBar(timeSignature, subdivisionDenominator)
  const clickDuration = secondsPerClick(bpm, subdivisionDenominator)
  const beats: MetronomeBeat[] = []
  const totalClicks = Math.round(clicksPerBar * bars)
  for (let i = 0; i < totalClicks; i++) {
    beats.push({
      timeSeconds: startSeconds + i * clickDuration,
      accent: i % Math.round(clicksPerBar) === 0,
    })
  }
  return beats
}
