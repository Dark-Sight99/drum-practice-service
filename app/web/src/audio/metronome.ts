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
  /** T3-6(REQ-04) — 일시정지 시 호출. 지금 울리는 클릭을 즉시 release
   * 단계로 넘겨 테일을 앞당겨 끊는다(Tone.js Monophonic.triggerRelease
   * 공식 JSDoc: "If no time is given, the release happens immediately" —
   * 완전 무음은 아니고 release 커브를 지금부터 다시 타는 것, 기본
   * release 1.4초라 드럼 원샷만큼은 아니지만 무시 못할 크기라 추가함,
   * work/T3-6/plan.md §3). */
  stopRinging(): void
  dispose(): void
}

const CLICK_INTERVAL: Record<4 | 8, string> = { 4: '4n', 8: '8n' }

export interface ClickVoice {
  trigger(isAccent: boolean, time: number): void
  setVolume(volumeDb: number): void
  stopRinging(): void
  dispose(): void
}

/** 2026-10-27(의뢰인 요청) — "더 대중적인 메트로놈 소리로". 기존엔
 * MembraneSynth(톰 비슷한 타격음)를 다른 음높이(C3/C2)로 쳐서 강박/약박을
 * 구분했는데, 그 소리 자체가 흔히 아는 "메트로놈 틱" 소리가 아니라는
 * 지적 — 대부분의 디지털 메트로놈·DAW 클릭 트랙은 짧게 필터링한 노이즈
 * 한 번("딱" 소리)으로 클릭을 만든다. 강박은 더 밝은(고역) 대역통과
 * 필터, 약박은 더 어두운(저역) 대역통과 필터로 구분 — 같은 구분 방식
 * (강박만 다르게)은 유지. 재생 중 메트로놈(createMetronome)과 카운트인
 * (scorePlayer.ts)이 똑같은 소리를 쓰도록 공유 팩토리로 뺌. */
export function createClickVoice(volumeDb = -6): ClickVoice {
  const output = new Tone.Volume(volumeDb).toDestination()
  const accentFilter = new Tone.Filter({ type: 'bandpass', frequency: 3000, Q: 1 }).connect(output)
  const normalFilter = new Tone.Filter({ type: 'bandpass', frequency: 1200, Q: 1 }).connect(output)
  const accentSynth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.03 },
  }).connect(accentFilter)
  const normalSynth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.022 },
  }).connect(normalFilter)

  return {
    trigger(isAccent, time) {
      ;(isAccent ? accentSynth : normalSynth).triggerAttackRelease('16n', time)
    },
    setVolume(nextVolumeDb) {
      output.volume.value = nextVolumeDb
    },
    stopRinging() {
      accentSynth.triggerRelease()
      normalSynth.triggerRelease()
    },
    dispose() {
      accentSynth.dispose()
      normalSynth.dispose()
      accentFilter.dispose()
      normalFilter.dispose()
      output.dispose()
    },
  }
}

/** Transport.scheduleRepeat로 매 박마다 클릭을 울린다. 강박(마디 첫 박)은
 * 다른 음높이로 구분(REQ-04 "강박 강조"). jsdom에서는 Tone 신스를 만들 수
 * 없어 실제 브라우저에서만 검증 가능(work/T2-2/plan.md). */
export function createMetronome(options: MetronomeOptions): Metronome {
  const subdivision = options.subdivisionDenominator ?? 4
  const click = createClickVoice(options.volumeDb ?? -6)
  const transport = Tone.getTransport()

  const clicksPerBar = Math.round(
    options.timeSignature[0] * (subdivision / options.timeSignature[1]),
  )
  // Codex 모드A C-002(재현됨): 클릭마다 로컬 카운터를 1씩 올리는 방식은
  // Transport가 마디 경계가 아닌 위치에서 이미 돌고 있을 때(예: 이전 재생을
  // 멈췄다가 메트로놈만 다시 켠 경우) 몇 번째 클릭이 강박인지 처음부터 틀어짐.
  // 대신 Transport 절대 틱(항상 0=1마디 1박 기준)에서 직접 몇 번째 클릭인지
  // 계산해, 메트로놈이 언제 시작되든 항상 올바른 위치에서 강박이 울리게 함.
  const ticksPerClick = transport.PPQ * (4 / subdivision)
  let enabled = true

  const eventId = transport.scheduleRepeat((time) => {
    if (!enabled) return
    const clickIndex = Math.round(transport.getTicksAtTime(time) / ticksPerClick)
    const isAccent = clickIndex % clicksPerBar === 0
    click.trigger(isAccent, time)
  }, CLICK_INTERVAL[subdivision])

  return {
    setEnabled(next: boolean) {
      enabled = next
    },
    setVolume(volumeDb: number) {
      click.setVolume(volumeDb)
    },
    stopRinging() {
      click.stopRinging()
    },
    dispose() {
      transport.clear(eventId)
      click.dispose()
    },
  }
}
