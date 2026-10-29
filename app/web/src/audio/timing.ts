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

/** 한 마디의 틱 수(DrumScore 자신의 ppq 기준). 곡 전체 마디 수 계산 등에 씀. */
export function ticksPerBar(timeSignature: TimeSignature, ppq: number): number {
  return beatsPerBar(timeSignature, 4) * ppq
}

/** 틱이 속한 마디 번호(0-기준) — 곡 전체 마디 수(마지막 노트 기준)·A-B 루프
 * 입력 범위 제한에 씀(T2-4, REQ-04). */
export function barIndexForTick(tick: number, timeSignature: TimeSignature, ppq: number): number {
  return Math.floor(tick / ticksPerBar(timeSignature, ppq))
}

/** 재생 위치(초)가 속한 마디 번호(0-기준) — barIndexForTick의 "초 단위" 버전.
 * T3-9(REQ-04) — "지금 재생 위치"를 A-B 루프 마디로 바로 지정하는 데 씀.
 * 음수 결과(카운트인 구간 등 songStartSeconds 이전)는 0으로 클램프,
 * NaN/Infinity·barSeconds<=0 입력도 0으로 방어(모드C 1라운드 C-004 권장). */
export function barIndexForSeconds(
  positionSeconds: number,
  songStartSeconds: number,
  barSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(songStartSeconds)) return 0
  if (!Number.isFinite(barSeconds) || barSeconds <= 0) return 0
  return Math.max(0, Math.floor((positionSeconds - songStartSeconds) / barSeconds))
}

/** T3-3(REQ-04) — Transport 절대 시각(초)을, 분리된 오디오 트랙 파일 안에서의
 * 위치(초, 원곡 기준)로 환산한다. `scorePlayer.ts`의 노트 스케줄 식
 * `songStartSeconds + ticksToSeconds(tick, ppq, playbackBpm)`과
 * `ticksToSeconds(tick,ppq,bpm) = (tick/ppq)*(60/bpm)`에서 유도(work/T3-3/plan.md
 * §4): 틱 `T`가 연습 BPM 기준으로 `ticksToSeconds(T,ppq,playbackBpm)`초 뒤에
 * 울리는데, 같은 틱이 "원곡 그대로 녹음된" 오디오 파일에서는 원곡 BPM 기준으로
 * `ticksToSeconds(T,ppq,originalBpm)`초 지점이다. 두 식의 비율이 정확히
 * `playbackRate = playbackBpm/originalBpm`이므로, Transport가 `songStartSeconds`를
 * 지난 뒤 경과한 시간에 `playbackRate`를 곱하면 오디오 파일 내 위치가 나온다
 * (루프 유무와 무관한 일반식 — `audioStartSeconds`에 `songStartSeconds` 대신
 * `loopStartSeconds`를 넣으면 루프 재진입 시점의 올바른 위치도 그대로 나옴,
 * 모드C 1라운드에서 "루프 재진입마다 0으로 틀던" 설계 오류를 이 일반식으로 수정).
 *
 * `audioOffsetSeconds`(2026-10-29, T3-72, REQ-02, intent/07-open-questions.md
 * Q-43) — `DrumScore.audioOffsetMs`를 초로 바꾼 값(기본 0, 기존 동작과 동일).
 * 다운비트 자동 보정(서버 쪽 work/T3-72/plan.md §1) 이후 "틱 0 = 원곡 파일
 * 위치 0"이 더 이상 성립하지 않는다 — 틱 0은 이제 다운비트이고, 그 다운비트는
 * 원곡 파일에서 `audioOffsetSeconds`초 지점이다. `transportSeconds ===
 * songStartSeconds`(틱 0)일 때 결과가 정확히 `audioOffsetSeconds`가 되도록
 * 더해준다. `audioStartSeconds`(songStartSeconds 또는 loopStartSeconds)는
 * 항상 `songStartSeconds` 이상이고 `audioOffsetSeconds`는 항상 0 이상(한
 * 박 길이 미만, api/schemas.py·score/validate.ts가 그 범위를 보장)이므로
 * 결과는 수학적으로 항상 0 이상이다(plan.md §5 증명 — 음수 위치가 나올
 * 입력 자체가 없어 호출부에서 별도 클램프가 필요 없음). */
export function audioTrackPositionSeconds(
  transportSeconds: number,
  songStartSeconds: number,
  playbackRate: number,
  audioOffsetSeconds = 0,
): number {
  return (transportSeconds - songStartSeconds) * playbackRate + audioOffsetSeconds
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

/** A-B 구간 반복 경계(0-기준 마디 번호, 반열림 구간 [startBar, endBar)). */
export interface LoopBars {
  startBar: number
  endBar: number
}

export interface PlaybackSchedule {
  /** "마디 0 시작" 절대 시각(초) — 노트는 루프 여부와 무관하게 항상 이 기준으로 스케줄. */
  songStartSeconds: number
  /** 재생이 실제로 시작되는 위치(초). 카운트인 클릭도 이 시각부터 스케줄한다. */
  playbackStartSeconds: number
  loopStartSeconds: number | null
  loopEndSeconds: number | null
}

/** BPM·카운트인·A-B 루프 설정을 실제 Transport 스케줄링에 필요한 절대 초 값으로
 * 변환한다(REQ-04, work/T2-4/plan.md §설계). 루프가 있으면 카운트인을 곡 맨
 * 앞이 아니라 "루프 시작 바로 앞"에 둬서, 루프 밖 구간을 처음부터 재생하지
 * 않고 곧장 루프 구간으로 진입한다 — `loop.startBar===0`이면 결과가 루프 없음과
 * 동일해진다(별도 분기 불필요, 아래 식 그대로 성립). */
export function computePlaybackSchedule(
  timeSignature: TimeSignature,
  bpm: number,
  countInBars: number,
  loop?: LoopBars,
): PlaybackSchedule {
  const barSeconds = barDurationSeconds(timeSignature, bpm)
  const songStartSeconds = barSeconds * countInBars
  if (!loop) {
    return {
      songStartSeconds,
      playbackStartSeconds: 0,
      loopStartSeconds: null,
      loopEndSeconds: null,
    }
  }
  const loopStartSeconds = songStartSeconds + barSeconds * loop.startBar
  const loopEndSeconds = songStartSeconds + barSeconds * loop.endBar
  return {
    songStartSeconds,
    playbackStartSeconds: loopStartSeconds - songStartSeconds,
    loopStartSeconds,
    loopEndSeconds,
  }
}
