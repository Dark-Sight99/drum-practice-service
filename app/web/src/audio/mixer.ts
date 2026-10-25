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

/** T3-8(2026-10-25, 의뢰인 요청) — 솔로(S) 기능 제거. `muted`면 0, 아니면
 * `volume` 그대로. `ChannelState.solo` 필드 자체는 그대로 둔다(백엔드
 * `ChannelStateIn.solo`가 필수값이라 PUT마다 계속 `false`로 보내야 함 —
 * 필드를 지우면 "공개 API 변경"이 되어 범위가 커짐, work/T3-8/plan.md
 * §범위경계). 혹시 이 기능이 있던 시절 저장된 `solo: true` 레거시 값이
 * 남아있어도 여기서 완전히 무시해 무해하게 만든다(S 체크박스가 이제
 * UI에 없어서 사용자가 직접 끌 방법이 없으므로, 반드시 여기서 중립화해야
 * "채널 하나만 들리고 나머지는 무음"인 채로 영원히 고정되는 버그를 막음). */
export function effectiveGain(channel: ChannelState): number {
  return channel.muted ? 0 : channel.volume
}

/** "원곡 드럼 켜기/끄기" 프리셋. 원래(work/T3-4/plan.md §범위경계)는
 * stem_drums(실제 원곡 녹음)만 건드리고 신스 드럼은 그대로 뒀는데,
 * T3-8(2026-10-25, 의뢰인 요청)에서 "버튼을 두 번 눌러야 하니까"라는
 * 이유로 신스 드럼을 반대 방향으로 자동 전환하도록 변경 — 원곡 드럼을
 * 켜면 신스 드럼은 자동으로 꺼지고(겹쳐 들릴 필요 없음), 원곡 드럼을
 * 끄면 신스 드럼이 자동으로 다시 켜짐(기존 연습 모드로 복귀). 사용자가
 * 그 사이 신스 드럼 볼륨을 따로 조절해뒀어도 이 버튼을 누르면 0/1로
 * 덮어씀(의뢰인이 요청한 "자동 전환" 자체가 핵심이라 중간값 보존은
 * 범위 밖으로 판단).
 * 모드A 지적(필수, 반영) — `volume`만 바꾸고 `muted`를 그대로 두면,
 * 사용자가 미리 신스 드럼을 M 체크박스로 음소거해둔 상태에서 이 버튼을
 * 눌렀다 다시 누를 때 volume은 1로 돌아와도 `muted`가 여전히 true라
 * `effectiveGain()`이 계속 0을 반환 — "꺼짐→다시 켜짐" 복귀가 실제로는
 * 안 들리는 버그였음. 이 프리셋이 눌리는 순간엔 두 채널의 가청 상태를
 * 전부 이 버튼이 책임진다는 원칙으로, `muted`도 항상 `false`로 같이
 * 리셋(볼륨 0/1 덮어쓰기와 같은 "이 버튼이 전적으로 결정한다" 원칙). */
export function toggleDrumlessPreset(state: MixerState): MixerState {
  const isSilent = state.stem_drums.volume === 0
  const nextStemDrumsVolume = isSilent ? 1 : 0
  return {
    ...state,
    stem_drums: { ...state.stem_drums, volume: nextStemDrumsVolume, muted: false },
    synth_drums: { ...state.synth_drums, volume: isSilent ? 0 : 1, muted: false },
  }
}

/** T3-4 게이트 피드백 3차(2026-10-25, 의뢰인 요청) — "원곡 음악 소리가
 * 드럼보다 너무 크다"는 지적에, 베이스·보컬·기타 악기(=원곡에서 드럼 뺀
 * 나머지 전체)를 UI에서 슬라이더 하나·M 하나로 묶어 조작한다(T3-8에서
 * 솔로 기능 자체가 제거돼 S는 더 이상 없음). 저장되는 데이터 구조(6채널
 * 각각의 volume/muted/solo)는 그대로 — 이 함수들이 그 3채널을 한꺼번에
 * 같은 값으로 맞출 뿐이라 백엔드 스키마·`effectiveGain()` 모두 무수정. */
export const MUSIC_STEM_KEYS: readonly ChannelKey[] = ['stem_bass', 'stem_vocals', 'stem_other']

/** "음악 전체" 슬라이더에 표시할 대표 볼륨 — 평균(저장된 예전 값이 서로
 * 달라도 합리적인 중간값으로 시작, 슬라이더를 한 번이라도 움직이면
 * setMusicVolume()이 셋을 똑같이 맞춰 그 뒤로는 항상 일치). */
export function musicVolume(state: MixerState): number {
  const sum = MUSIC_STEM_KEYS.reduce((acc, key) => acc + state[key].volume, 0)
  return sum / MUSIC_STEM_KEYS.length
}

/** 3채널 "전부" 음소거일 때만 체크 표시 — 섞여 있으면(저장된 예전 설정 등)
 * 다음 클릭에서 셋 다 같은 값으로 정규화됨(아래 setMusicMuted). */
export function isMusicMuted(state: MixerState): boolean {
  return MUSIC_STEM_KEYS.every((key) => state[key].muted)
}

export function setMusicVolume(state: MixerState, volume: number): MixerState {
  const next = { ...state }
  for (const key of MUSIC_STEM_KEYS) next[key] = { ...state[key], volume }
  return next
}

export function setMusicMuted(state: MixerState, muted: boolean): MixerState {
  const next = { ...state }
  for (const key of MUSIC_STEM_KEYS) next[key] = { ...state[key], muted }
  return next
}

/** 0(무음)~1(최대) 선형 게인을 데시벨로 변환 — Tone.js(신스 드럼 공용
 * Gain·메트로놈 synth)가 쓰는 단위. 실제 dB 공식(20*log10) 그대로 — T3-2
 * normalize_loudness()의 같은 공식과 일관. 0 이하는 -Infinity(완전 무음,
 * Tone.js Volume/Gain이 그대로 받아들이는 값). */
export function linearGainToDb(linear: number): number {
  if (linear <= 0) return -Infinity
  return 20 * Math.log10(linear)
}
