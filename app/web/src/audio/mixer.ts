// T3-4(REQ-05) — 믹서(볼륨/음소거/솔로) 순수 로직. Tone.js 의존 없음(jsdom에서
// 단위 테스트 가능 — clock.ts/timing.ts와 같은 책임 분리 원칙).
// 근거: work/T3-4/plan.md §2.

export type ChannelKey =
  | 'stem_drums'
  | 'stem_bass'
  | 'stem_vocals'
  | 'stem_other'
  | 'synth_drums'
  | 'metronome'

export const CHANNEL_KEYS: readonly ChannelKey[] = [
  'stem_drums',
  'stem_bass',
  'stem_vocals',
  'stem_other',
  'synth_drums',
  'metronome',
]

export interface ChannelState {
  volume: number
  muted: boolean
  solo: boolean
}

export type MixerState = Record<ChannelKey, ChannelState>

/** T3-4 게이트 피드백 2차(2026-10-25, 의뢰인 요청) — `stem_drums`(원곡에서
 * 분리된 실제 드럼)는 기본 볼륨 0으로 시작한다. 신스 드럼(우리 앱의 클릭음)과
 * 동시에 들으면 같은 드럼 소리가 두 겹으로 겹쳐 들려서(T3-3 실사용 피드백에서
 * 처음 지적됨) 겹칠 필요가 없는 쪽을 기본으로 꺼둠 — 슬라이더 자체는 그대로
 * 조절 가능(음소거 체크박스가 아니라 볼륨 자체를 0으로 둠, 의뢰인이 명시한
 * 방식). 나머지 5채널은 기존처럼 전부 볼륨 1(100%). */
export function defaultMixerState(): MixerState {
  const state = {} as MixerState
  for (const key of CHANNEL_KEYS) {
    state[key] = { volume: key === 'stem_drums' ? 0 : 1, muted: false, solo: false }
  }
  return state
}

/** work/T3-4/plan.md §2 "솔로/음소거 규칙" — 표준 DAW 관례.
 * - 솔로인 채널이 하나도 없으면: muted면 0, 아니면 volume.
 * - 솔로인 채널이 1개 이상 있으면: 솔로인 채널만 자기 volume으로 들림(그
 *   채널 자신의 muted는 무시 — "솔로가 음소거를 이김"). 솔로 아닌 채널은
 *   자신의 muted와 무관하게 전부 0. 여러 채널을 동시에 솔로할 수 있고,
 *   서로 영향 없음(평균·boost 없음). */
export function effectiveGain(channel: ChannelState, allChannels: MixerState): number {
  const anySoloed = Object.values(allChannels).some((c) => c.solo)
  if (anySoloed) {
    return channel.solo ? channel.volume : 0
  }
  return channel.muted ? 0 : channel.volume
}

/** "원곡 드럼 켜기/끄기" 프리셋 — 의뢰인 확인(2026-10-25, work/T3-4/plan.md
 * §범위경계): stem_drums(실제 원곡 녹음)만 건드림, 다른 채널(신스 드럼·
 * 메트로놈·다른 스템)은 전혀 안 건드림.
 * T3-4 게이트 피드백 2차(2026-10-25) — `defaultMixerState()`가 stem_drums를
 * 볼륨 0으로 기본 설정하도록 바뀌면서, 이 프리셋도 `muted`가 아니라
 * **볼륨 자체를 0↔1로 토글**하도록 맞춤(기본값과 같은 "볼륨" 축을 써야
 * 토글이 실제로 의미 있음 — muted만 토글하면 이미 볼륨 0인 기본 상태에서
 * 눌러도 체감 변화가 없었을 것). */
export function toggleDrumlessPreset(state: MixerState): MixerState {
  const isSilent = state.stem_drums.volume === 0
  return {
    ...state,
    stem_drums: { ...state.stem_drums, volume: isSilent ? 1 : 0 },
  }
}

/** 0(무음)~1(최대) 선형 게인을 데시벨로 변환 — Tone.js(신스 드럼 공용
 * Gain·메트로놈 synth)가 쓰는 단위. 실제 dB 공식(20*log10) 그대로 — T3-2
 * normalize_loudness()의 같은 공식과 일관. 0 이하는 -Infinity(완전 무음,
 * Tone.js Volume/Gain이 그대로 받아들이는 값). */
export function linearGainToDb(linear: number): number {
  if (linear <= 0) return -Infinity
  return 20 * Math.log10(linear)
}
