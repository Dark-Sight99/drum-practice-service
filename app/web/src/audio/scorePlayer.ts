import * as Tone from 'tone'
import type { DrumScore } from '../score/types'
import type { DrumVoiceMap } from './drumVoices'
import {
  computePlaybackSchedule,
  metronomeBeatTimes,
  ticksToSeconds,
  type LoopBars,
} from './timing'

export interface PlaybackHandle {
  stop(): void
}

export interface PlayDrumScoreOptions {
  /** 재생 전 카운트인 마디 수. REQ-04 "카운트인: 재생 전 1마디" — 기본 1. */
  countInBars?: number
  /** 연습 BPM(원곡 대비 50~150%, REQ-04) — 기본 `score.meta.bpm`(원곡 그대로). */
  playbackBpm?: number
  /** A-B 구간 반복(REQ-04). 지정 시 그 구간만 반복 재생 — 끊김·중복 클릭 없이
   * 루프되는 근거는 work/T2-4/plan.md §설계 "Tone.js 루프 동작 근거" 참고. */
  loop?: LoopBars
}

/** DrumScore를 재생한다: 마스터 클록(Transport)에 BPM/박자표를 맞추고, 카운트인
 * 클릭을 먼저 예약한 뒤 각 노트를 해당 피스의 신스로 트리거하도록 예약한다.
 *
 * 노트 시각은 Transport의 틱 체계(기본 PPQ=192)가 아니라 DrumScore 자신의 ppq로
 * 직접 초 단위를 계산해 예약한다(`ticksToSeconds`) — Transport PPQ와 DrumScore
 * ppq가 다를 수 있어(T2-1에서 실제로 960ppq 샘플을 다뤘음) 틱 단위 스케줄링을
 * 피하고 초 단위로 통일(work/T2-2/plan.md §설계). */
export function playDrumScore(
  score: DrumScore,
  voices: DrumVoiceMap,
  options: PlayDrumScoreOptions = {},
): PlaybackHandle {
  const countInBars = options.countInBars ?? 1
  const playbackBpm = options.playbackBpm ?? score.meta.bpm
  const transport = Tone.getTransport()
  // Transport는 싱글턴이라 이전에 메트로놈 등으로 이미 돌고 있을 수 있음 — 노트를
  // 절대 시각(0초 기준)으로 예약하므로 재생 시작 전 항상 0으로 되돌린다. 실제
  // 브라우저에서 메트로놈을 먼저 돌린 뒤 재생을 누르면 Transport가 이미 지난
  // 과거 시각에 노트가 예약돼 하나도 울리지 않는 버그를 수동 QA로 재현해 발견함
  // (work/T2-2/plan.md, qa-evidence/T2-2/result.md).
  transport.stop()
  transport.position = 0
  transport.loop = false // 이전 재생의 A-B 루프 상태가 남아있지 않게 초기화
  transport.bpm.value = playbackBpm
  // Codex 모드A C-001(재현됨): 분자만 넘기면 Transport가 분모를 4로 가정해
  // "1마디" 길이가 실제와 달라짐(6/8을 6으로 넘기면 Transport는 6/4로 취급 —
  // 실제 실행으로 확인: 6/8·120bpm 1마디는 1.5초인데 분자만 넘기면 3초가 됨).
  transport.timeSignature = score.meta.timeSignature

  const schedule = computePlaybackSchedule(
    score.meta.timeSignature,
    playbackBpm,
    countInBars,
    options.loop,
  )
  const countInClicks = metronomeBeatTimes(
    score.meta.timeSignature,
    playbackBpm,
    countInBars,
    4,
    schedule.playbackStartSeconds,
  )
  const countInSynth = new Tone.MembraneSynth().toDestination()

  const scheduledIds: number[] = []

  for (const click of countInClicks) {
    scheduledIds.push(
      transport.schedule((time) => {
        countInSynth.triggerAttackRelease(click.accent ? 'C3' : 'C2', '16n', time)
      }, click.timeSeconds),
    )
  }

  for (const note of score.notes) {
    const timeSeconds =
      schedule.songStartSeconds + ticksToSeconds(note.tick, score.ppq, playbackBpm)
    scheduledIds.push(
      transport.schedule((time) => {
        voices[note.piece].trigger(time, note.velocity / 127)
      }, timeSeconds),
    )
  }

  // work/T2-4/plan.md §설계 "Tone.js 루프 동작 근거"(Transport.js/TransportEvent.js/
  // TransportRepeatEvent.js 실제 소스로 확인): 네이티브 loop/loopStart/loopEnd는
  // schedule()·scheduleRepeat() 이벤트 모두 루프 경계에서 끊김·중복 없이 재발화함.
  if (schedule.loopStartSeconds !== null && schedule.loopEndSeconds !== null) {
    transport.setLoopPoints(schedule.loopStartSeconds, schedule.loopEndSeconds)
    transport.loop = true
  }

  transport.start(undefined, schedule.playbackStartSeconds)

  return {
    stop() {
      for (const id of scheduledIds) transport.clear(id)
      transport.loop = false
      transport.stop()
      countInSynth.dispose()
    },
  }
}
