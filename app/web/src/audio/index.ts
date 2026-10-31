export type { MasterClock } from './clock'
export { getMasterClock } from './clock'
export { createDrumVoices, disposeDrumVoices } from './drumVoices'
export type { DrumVoice, DrumVoiceMap } from './drumVoices'
export { createMetronome } from './metronome'
export type { Metronome, MetronomeOptions } from './metronome'
export {
  CHANNEL_KEYS,
  defaultMixerState,
  effectiveGain,
  isMusicMuted,
  linearGainToDb,
  METRONOME_BOOST_DB,
  metronomeGainToDb,
  MUSIC_STEM_KEYS,
  musicVolume,
  normalizeMusicChannels,
  setMusicMuted,
  setMusicVolume,
  STEM_DRUMS_BOOST_DB,
  stemDrumsBoostedGain,
  SYNTH_DRUMS_BOOST_DB,
  synthDrumsBoostedGain,
  toggleDrumlessPreset,
} from './mixer'
export type { ChannelKey, ChannelState, MixerState } from './mixer'
export { playDrumScore } from './scorePlayer'
export type { PlaybackHandle, PlayDrumScoreOptions } from './scorePlayer'
export {
  ensureIOSAudioContextSampleRate,
  getIOSStemAudioContext,
  isIOS,
  practiceBpmRange,
} from './platformAudioContext'
// T6-11 Step 2(work/T6-11/plan.md) — PracticeCanvas.tsx는 이제 trackPlayer.ts
// (`<audio>` 기반)가 아니라 stemPlayer.ts(Tone.Player 기반)를 쓴다.
// trackPlayer.ts는 Step 4까지 EditorScreen.tsx가 계속 쓰므로 그대로 둔다 —
// selectStemKinds()만 stemPlayer.ts로 옮긴 사본을 대표로 export(두 파일의
// 구현이 로직상 동일 — stemPlayer.ts 상단 주석 참고).
export { createAudioTrackPool, createTrackPlayer } from './trackPlayer'
export type { AudioTrackPool, TrackPlayer, TrackSource } from './trackPlayer'
export {
  createStemPlayer,
  loadStemBufferPool,
  selectStemKinds,
  STEM_POOL_RELOAD_DELAY_MS,
} from './stemPlayer'
export type { StemBufferPool, StemPlayer, StemSource } from './stemPlayer'
export type { StemSessionTiming } from './stemSchedule'
export {
  audioTrackPositionSeconds,
  barDurationSeconds,
  barIndexForSeconds,
  barIndexForTick,
  beatsPerBar,
  computePlaybackSchedule,
  metronomeBeatTimes,
  secondsPerBeat,
  secondsPerClick,
  ticksPerBar,
  ticksToSeconds,
} from './timing'
export type { LoopBars, MetronomeBeat, PlaybackSchedule, TimeSignature } from './timing'
