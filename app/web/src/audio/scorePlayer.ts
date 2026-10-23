import * as Tone from 'tone'
import type { DrumScore } from '../score/types'
import type { DrumVoiceMap } from './drumVoices'
import { barDurationSeconds, metronomeBeatTimes, ticksToSeconds } from './timing'

export interface PlaybackHandle {
  stop(): void
}

export interface PlayDrumScoreOptions {
  /** 재생 전 카운트인 마디 수. REQ-04 "카운트인: 재생 전 1마디" — 기본 1. */
  countInBars?: number
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
  const transport = Tone.getTransport()
  // Transport는 싱글턴이라 이전에 메트로놈 등으로 이미 돌고 있을 수 있음 — 노트를
  // 절대 시각(0초 기준)으로 예약하므로 재생 시작 전 항상 0으로 되돌린다. 실제
  // 브라우저에서 메트로놈을 먼저 돌린 뒤 재생을 누르면 Transport가 이미 지난
  // 과거 시각에 노트가 예약돼 하나도 울리지 않는 버그를 수동 QA로 재현해 발견함
  // (work/T2-2/plan.md, qa-evidence/T2-2/result.md).
  transport.stop()
  transport.position = 0
  transport.bpm.value = score.meta.bpm
  transport.timeSignature = score.meta.timeSignature[0]

  const countInSeconds = barDurationSeconds(score.meta.timeSignature, score.meta.bpm) * countInBars
  const countInClicks = metronomeBeatTimes(score.meta.timeSignature, score.meta.bpm, countInBars)
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
    const timeSeconds = countInSeconds + ticksToSeconds(note.tick, score.ppq, score.meta.bpm)
    scheduledIds.push(
      transport.schedule((time) => {
        voices[note.piece].trigger(time, note.velocity / 127)
      }, timeSeconds),
    )
  }

  transport.start()

  return {
    stop() {
      for (const id of scheduledIds) transport.clear(id)
      transport.stop()
      countInSynth.dispose()
    },
  }
}
