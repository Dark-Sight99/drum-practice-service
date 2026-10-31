import * as Tone from 'tone'
import { getMasterLimiter } from './masterLimiter'
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

/** 2026-10-27(의뢰인 요청 → 선택) — "소리가 잘 안 들린다. 대중적으로
 * 많이 쓰이는 메트로놈 소리로 바꾸고 싶다"는 지적에, Claude는 소리를
 * 직접 들을 수 없어 어떤 게 "대중적"인지 단정할 근거가 없으므로
 * (CLAUDE.md §1) 합성 방식이 다른 후보 4개(T3-29, qa-evidence/T3-29
 * 참고)를 만들어 실제 브라우저에서 의뢰인이 듣고 고르게 했다 — "후보 2"
 * (순음 비프)로 최종 결정. 강박은 높은 음(1760Hz, A6), 약박은 낮은 음
 * (1320Hz, E6)인 짧은 사인파 비프 — 노이즈가 섞이지 않은 맑은 "삐" 소리.
 * 재생 중 메트로놈(createMetronome)과 카운트인(scorePlayer.ts)이 같은
 * 소리·같은 음량 기준을 쓰도록 공유하는 팩토리. */
export function createClickVoice(volumeDb = -6): ClickVoice {
  // Codex 검수 C-001(2026-10-31) — 이전엔 리미터 없이 바로 destination에
  // 연결돼 있어, 스템·신스 드럼과 동시에 울릴 때 전체 합산이 0dBFS를 넘는
  // 클리핑 위험에 전혀 대비가 안 돼 있었다(masterLimiter.ts 상단 주석
  // 참고) — 앱 전역 공유 Limiter를 거치도록 한다.
  const output = new Tone.Volume(volumeDb).connect(getMasterLimiter())
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
