import * as Tone from 'tone'
import type { DrumScore } from '../score/types'
import { stopAllRinging, type DrumVoiceMap } from './drumVoices'
import { createClickVoice } from './metronome'
import type { TrackPlayer } from './trackPlayer'
import {
  audioTrackPositionSeconds,
  computePlaybackSchedule,
  metronomeBeatTimes,
  ticksToSeconds,
  type LoopBars,
} from './timing'

export interface PlaybackHandle {
  stop(): void
  /** T3-6(REQ-04) — Transport는 틱 위치를 동결할 뿐 이미 커밋된 원샷은
   * 자동으로 안 멈추므로(work/T3-6/plan.md §3) stopAllRinging()·
   * countInClick.stopRinging()으로 명시적으로 끊는다. */
  pause(): void
  /** 오프셋 없이 transport.start() — 멈춘 지점부터 정확히 재개(plan.md §1). */
  resume(): void
}

export interface PlayDrumScoreOptions {
  /** 재생 전 카운트인 마디 수. REQ-04 "카운트인: 재생 전 1마디" — 기본 1. */
  countInBars?: number
  /** 연습 BPM(원곡 대비 50~150%, REQ-04) — 기본 `score.meta.bpm`(원곡 그대로). */
  playbackBpm?: number
  /** A-B 구간 반복(REQ-04). 지정 시 그 구간만 반복 재생 — 끊김·중복 클릭 없이
   * 루프되는 근거는 work/T2-4/plan.md §설계 "Tone.js 루프 동작 근거" 참고. */
  loop?: LoopBars
  /** T3-3(REQ-04) — 분리된 오디오 트랙(이미 `prime()`까지 끝난 상태). 없으면
   * 기존과 동일하게 MIDI만 재생(분리 안 된 곡·`audioOffsetMs≠0` 가드가 켜진
   * 경우 — work/T3-3/plan.md §범위경계, 호출자 `PracticeCanvas`가 결정). */
  tracks?: TrackPlayer
  /** 2026-10-27(의뢰인 요청) — 카운트인 클릭 음량(dB). 기존엔 믹서의 "메트로놈"
   * 채널 설정과 무관하게 항상 Tone.js 기본 음량(0dB, 꽤 큼)으로 울려서 "음악
   * 소리는 작은데 그 소리만 너무 크다"는 불편의 원인이었다 — 호출자
   * (PracticeCanvas)가 재생 시작 시점의 메트로놈 채널 게인을 dB로 변환해
   * 넘긴다(재생 중 메트로놈 본체에 적용하는 것과 같은 변환). 안 넘기면
   * createClickVoice의 기본값(-6dB)을 그대로 씀. */
  countInVolumeDb?: number
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
  // T3-3(REQ-04) — score.meta.bpm은 원곡 BPM(위 playbackBpm 기본값과 같은 값에서
  // 확인). 오디오 트랙(원곡 그대로 녹음된 파일)의 재생 속도 비율 — audio.playbackRate
  // 에 그대로 쓰임(work/T3-3/plan.md §4 유도).
  const playbackRate = playbackBpm / score.meta.bpm
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
  // 2026-10-27(의뢰인 요청) — 재생 중 메트로놈과 같은 소리(createClickVoice)·
  // 같은 음량 기준(믹서 "메트로놈" 채널, 위 countInVolumeDb 코멘트 참고)을 쓴다.
  const countInClick = createClickVoice(options.countInVolumeDb)

  const scheduledIds: number[] = []

  for (const click of countInClicks) {
    scheduledIds.push(
      transport.schedule((time) => {
        countInClick.trigger(click.accent, time)
      }, click.timeSeconds),
    )
  }

  for (const note of score.notes) {
    // T2-8(Codex 모드C 1차 C-001): laneRenderer.ts의 noteTimeOf와 같은 식이어야
    // 화면·소리가 맞는다 — audioOffsetMs를 빼먹으면 그 값이 0이 아닐 때(Phase 3
    // 전까지는 검증에서 항상 0으로 강제돼 있음, Q-23) 둘이 어긋난다.
    const timeSeconds =
      schedule.songStartSeconds +
      ticksToSeconds(note.tick, score.ppq, playbackBpm) +
      score.audioOffsetMs / 1000
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

  // T3-3(REQ-04, work/T3-3/plan.md §4) — audioStartSeconds는 "최초 진입"과
  // "매 루프 재진입" 둘 다를 가리킨다(루프가 없으면 songStartSeconds 한 번만,
  // 있으면 Tone 네이티브 루프가 이 schedule() 콜백을 경계마다 재발화함 — 위
  // 주석과 같은 근거). 같은 일반식(audioTrackPositionSeconds)을 그대로 써서
  // 루프 시작 지점이 0마디가 아니어도 오디오가 올바른 위치로 이동한다(모드C
  // 1라운드에서 "항상 0으로 틀던" 설계 오류를 고친 자리).
  const tracks = options.tracks
  if (tracks) {
    const audioStartSeconds = schedule.loopStartSeconds ?? schedule.songStartSeconds
    scheduledIds.push(
      transport.schedule(() => {
        const positionSeconds = audioTrackPositionSeconds(
          audioStartSeconds,
          schedule.songStartSeconds,
          playbackRate,
        )
        tracks.playFrom(positionSeconds, playbackRate)
      }, audioStartSeconds),
    )
  }

  transport.start(undefined, schedule.playbackStartSeconds)

  return {
    stop() {
      for (const id of scheduledIds) transport.clear(id)
      transport.loop = false
      transport.stop()
      countInClick.dispose()
      tracks?.stop()
    },
    pause() {
      transport.pause()
      stopAllRinging(voices)
      countInClick.stopRinging()
      tracks?.pause()
    },
    resume() {
      transport.start()
      tracks?.resume()
    },
  }
}
