import * as Tone from 'tone'
import type { TimeSignature } from './timing'

export interface MetronomeOptions {
  timeSignature: TimeSignature
  /** 4(4분음표 단위) | 8(8분음표 단위) — REQ-04 "박 단위(4·8분)". */
  subdivisionDenominator?: 4 | 8
  volumeDb?: number
  /** 2026-10-27(의뢰인 요청) — "소리가 잘 안 들린다, 후보를 몇 개 보여주면
   * 그중 고르겠다". 기본값은 `DEFAULT_CLICK_SOUND_ID`. */
  soundId?: ClickSoundId
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

/** 2026-10-27(의뢰인 요청) — "소리가 잘 안 들린다. 대중적으로 많이 쓰이는
 * 메트로놈 소리로 바꾸고 싶다, 후보 몇 개를 보여주면 그중 고르겠다."
 * Claude는 소리를 직접 들을 수 없어 "이게 그 소리다"를 단정할 근거가
 * 없으므로(CLAUDE.md §1 "모르는 정보는 지어내지 마라"), 합성 방식이 서로
 * 다른 후보 4개를 만들어 실제 브라우저에서 의뢰인이 직접 듣고 고르게
 * 한다. 넷 다 강박/약박을 (더 밝은 소리/더 어두운 소리)로 구분하는 원칙은
 * 공유 — 아래 각 함수 docstring에 합성 방식 설명. */
export type ClickSoundId = 'filtered_noise' | 'beep' | 'square_click' | 'tap'

export const CLICK_SOUND_LABELS: Record<ClickSoundId, string> = {
  filtered_noise: '후보 1 — 필터링된 노이즈(기존, "딱" 소리)',
  beep: '후보 2 — 순음 비프(디지털 메트로놈 앱 느낌)',
  square_click: '후보 3 — 사각파 클릭(또렷하고 날카로운 전자음)',
  tap: '후보 4 — 타격음(나무를 톡 치는 듯한 짧은 음정 타격)',
}

export const DEFAULT_CLICK_SOUND_ID: ClickSoundId = 'filtered_noise'

/** 기존(T3-26) 구현 그대로 — 대역통과 필터를 통과한 짧은 화이트노이즈
 * 한 번("딱" 소리). 강박은 고역(3000Hz) 대역통과, 약박은 저역(1200Hz)
 * 대역통과로 구분. 대부분의 디지털 메트로놈·DAW 클릭 트랙이 이 방식. */
function createFilteredNoiseClick(volumeDb: number): ClickVoice {
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

/** 순음(사인파) 짧은 비프 — 강박은 높은 음(1760Hz, A6), 약박은 낮은 음
 * (1320Hz, E6). 노이즈가 섞이지 않은 맑은 "삐" 소리라 필터링 노이즈
 * 클릭보다 음정이 또렷하게 들림(간단한 디지털 메트로놈 앱들의 전형적인
 * 소리 — Tone.Synth 공식 예제 그대로, 출처: node_modules/tone/build/esm/
 * instrument/Synth.d.ts 상단 JSDoc 예제). */
function createBeepClick(volumeDb: number): ClickVoice {
  const output = new Tone.Volume(volumeDb).toDestination()
  const accentSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
  }).connect(output)
  const normalSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
  }).connect(output)

  return {
    trigger(isAccent, time) {
      const synth = isAccent ? accentSynth : normalSynth
      synth.triggerAttackRelease(isAccent ? 1760 : 1320, '32n', time)
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
      output.dispose()
    },
  }
}

/** 사각파(square) 짧은 클릭 — 사인파보다 배음이 많아 더 날카롭고 "전자
 * 기기스러운" 소리. 강박/약박은 beep과 같은 두 음높이로 구분. */
function createSquareClick(volumeDb: number): ClickVoice {
  const output = new Tone.Volume(volumeDb).toDestination()
  const accentSynth = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
  }).connect(output)
  const normalSynth = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 },
  }).connect(output)

  return {
    trigger(isAccent, time) {
      const synth = isAccent ? accentSynth : normalSynth
      synth.triggerAttackRelease(isAccent ? 1760 : 1320, '32n', time)
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
      output.dispose()
    },
  }
}

/** 음정이 있는 타격음(MembraneSynth) — T3-26 이전에 쓰던 것과 같은 신스
 * 종류지만, 더 짧은 pitchDecay·envelope로 "톡" 치는 듯한 타격감을
 * 낸다(이전엔 톰 드럼처럼 들린다는 지적을 받았던 길고 낮은 피치 하강과는
 * 다름 — pitchDecay를 1/10 이하로 줄여 피치가 거의 순간적으로 떨어짐).
 * 강박은 더 높은 음(C5), 약박은 더 낮은 음(G4)으로 구분. */
function createTapClick(volumeDb: number): ClickVoice {
  const output = new Tone.Volume(volumeDb).toDestination()
  const accentSynth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
  }).connect(output)
  const normalSynth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
  }).connect(output)

  return {
    trigger(isAccent, time) {
      const synth = isAccent ? accentSynth : normalSynth
      synth.triggerAttackRelease(isAccent ? 'C5' : 'G4', '16n', time)
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
      output.dispose()
    },
  }
}

const CLICK_SOUND_FACTORIES: Record<ClickSoundId, (volumeDb: number) => ClickVoice> = {
  filtered_noise: createFilteredNoiseClick,
  beep: createBeepClick,
  square_click: createSquareClick,
  tap: createTapClick,
}

/** 재생 중 메트로놈(createMetronome)과 카운트인(scorePlayer.ts)이 같은
 * 소리·같은 음량 기준을 쓰도록 공유하는 팩토리. */
export function createClickVoice(
  volumeDb = -6,
  soundId: ClickSoundId = DEFAULT_CLICK_SOUND_ID,
): ClickVoice {
  return CLICK_SOUND_FACTORIES[soundId](volumeDb)
}

/** Transport.scheduleRepeat로 매 박마다 클릭을 울린다. 강박(마디 첫 박)은
 * 다른 음높이로 구분(REQ-04 "강박 강조"). jsdom에서는 Tone 신스를 만들 수
 * 없어 실제 브라우저에서만 검증 가능(work/T2-2/plan.md). */
export function createMetronome(options: MetronomeOptions): Metronome {
  const subdivision = options.subdivisionDenominator ?? 4
  const click = createClickVoice(options.volumeDb ?? -6, options.soundId)
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
