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
  /** 2026-10-28(의뢰인 요청) — 블루투스 이어폰 등 출력 장치 자체의 물리적 지연
   * (보통 100~300ms)을 보정하기 위한 값(ms). "장치가 소리를 늦게 낸다"는 걸
   * 상쇄하려면 반대로 **소리를 그만큼 일찍 내보내야** 한다 — 화면(노트 위치,
   * `laneRenderer.ts`의 `noteTimeOf`)은 전혀 안 건드리고, 소리를 트리거하는
   * 시각만 당긴다. 노트 데이터(화면 기준 "진짜" 시각)와 오디오 트랙의 재생
   * 위치(`audioTrackPositionSeconds`로 구하는 "파일 안에서 어디를 재생할지")는
   * 그대로 두고, 그 트리거를 "언제 쏠지"만 당기는 것 — 연속 재생되는 오디오
   * 트랙은 이렇게 하면 실제 장치가 그 지연만큼 늦게 내보내도 결과적으로 원래
   * 의도한 시각에 들리게 된다(한 번 당겨서 틀기 시작하면 그 뒤로는 그냥
   * 흘러가는 연속 재생이라, "몇 초를 재생할지" 위치 자체는 바뀌면 안 됨).
   * 기본 0(보정 없음). 음수를 주면 반대로 늦출 수도 있음(유선인데 화면이
   * 오히려 늦는 특이 환경 대비, 제한은 안 둠). */
  audioLatencyCompensationMs?: number
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
  // 2026-10-28 — 보정값만큼 "소리를 트리거하는 시각"을 당긴다(위 옵션 설명 참고).
  // 화면 쪽(laneRenderer.ts)은 이 값을 전혀 모름 — 노트의 "진짜" 시각은 안 바뀜.
  const latencyCompensationSeconds = (options.audioLatencyCompensationMs ?? 0) / 1000
  // Codex 모드A 지적(Minor C-002, qa-evidence/T3-47) — 0초 밑으로는 못 당기게
  // 막는 바닥(아래 compensatedTriggerTime) 때문에, 곡 맨 앞(0초 근방)에 몰린
  // 여러 이벤트가 큰 보정값에서 같은 시각(0초)으로 겹칠 수 있다. 이 함수의
  // options는 UI(PracticeCanvas.tsx의 AUDIO_LATENCY_COMPENSATION_MIN/MAX_MS,
  // ±500ms)를 거쳐서만 들어오므로 실제로는 겹침이 적고, 겹쳐도(클릭/노트
  // 신스가 같은 틱에 두 번 트리거) 들리는 소리엔 사실상 차이가 없어 방치.

  // Codex 모드A 지적(Major C-001, 반영, qa-evidence/T3-47) — 위 "Tone.js 루프
  // 동작 근거" 주석대로 네이티브 루프는 예약 시각이 [loopStart, loopEnd) 안에
  // 있는 이벤트만 매 루프 재진입 때 재발화한다. 보정으로 시각을 당기면 루프
  // 시작 경계에 걸린 이벤트(특히 트랙 재시작 콜백 — 아래 audioStartSeconds가
  // loopStartSeconds와 정확히 같음)가 그 경계 밑으로 밀려나 더 이상 루프
  // 구간 안이 아니게 되고, 재진입 때 다시 안 울리는 회귀가 있었다(최초
  // 1회만 울리고 이후 루프에서 트랙이 재시작 안 됨).
  //
  // loopStartSeconds 이상인 이벤트는 그 경계 밑으로 못 내려가게 바닥을
  // 올린다 — 다만 정확히 loopStartSeconds "그 값"으로 고정하면 안 된다: Tone.js
  // 15.1.22를 Claude 내장 브라우저에서 직접 실행해 확인한 결과(2026-10-28,
  // qa-evidence/T3-47), loopStart 경계에 정확히 걸치거나 그로부터 ~3~4ms
  // 이내인 schedule() 이벤트는 "루프 진입 전 1회만 울리고 이후 재진입에서
  // 재발화하지 않는" 별도의 양자화 버그가 있었다(같은 이벤트를 loopStart+
  // 10~20ms 지점에 두면 여러 번의 루프 재진입에서 모두 정상 재발화함을
  // 반복 확인). 그래서 바닥을 loopStartSeconds 자체가 아니라
  // LOOP_BOUNDARY_SAFETY_MARGIN_SECONDS(확인된 위험 구간 3~4ms보다 5배 이상
  // 넉넉한 20ms)만큼 안쪽으로 둔다 — 그 경계에 걸린 이벤트는 보정 혜택을
  // 최대 20ms만 못 받지만(±500ms 보정 범위에 비하면 미미), 루프 재발화는
  // 항상 보장된다. 루프 밖(그 이전) 이벤트는 기존처럼 0까지만 막는다.
  //
  // 부수 효과 — 이 바닥은 보정값이 0(보정 안 씀)이어도 적용된다(Math.max가
  // "경계에 정확히 걸친" 값도 안전 구간으로 밀어올림). 즉 트랙 재시작
  // 콜백(아래)처럼 nominal 시각이 loopStartSeconds와 정확히 같은 이벤트는
  // T3-47 이전(이 보정 기능 자체가 없던 시절)부터 이미 이 Tone.js 경계
  // 버그에 걸려 있었을 가능성이 높다(지연 보정 유무와 무관하게 재현됨,
  // 위 실측 결과 참고) — 이번 수정이 그 잠재 버그도 같이 막는다.
  const LOOP_BOUNDARY_SAFETY_MARGIN_SECONDS = 0.02
  function compensatedTriggerTime(timeSeconds: number): number {
    const floor =
      schedule.loopStartSeconds !== null && timeSeconds >= schedule.loopStartSeconds
        ? schedule.loopStartSeconds + LOOP_BOUNDARY_SAFETY_MARGIN_SECONDS
        : 0
    return Math.max(floor, timeSeconds - latencyCompensationSeconds)
  }

  for (const click of countInClicks) {
    scheduledIds.push(
      transport.schedule((time) => {
        countInClick.trigger(click.accent, time)
      }, compensatedTriggerTime(click.timeSeconds)),
    )
  }

  for (const note of score.notes) {
    // T2-8(Codex 모드C 1차 C-001): laneRenderer.ts의 noteTimeOf와 같은 식이어야
    // 화면·소리가 맞는다.
    //
    // 2026-10-29(T3-72, REQ-02, Q-43) — 예전엔 여기 `+ score.audioOffsetMs /
    // 1000`이 더 있었다(Phase 3 전까지 그 값이 항상 0이라 한 번도 실행된 적
    // 없었던 코드, Q-23). 이제 서버의 다운비트 자동 보정이 노트 틱 자체를
    // 이미 "틱0=다운비트" 기준으로 재앵커해서 저장하므로(work/T3-72/plan.md
    // §1), 신스 트리거 시각을 여기서 또 밀면 같은 보정이 두 번 겹친다 —
    // `audioOffsetMs`는 이제 "음원 트랙 재생 위치"에만 쓰는 값으로 의미가
    // 바뀌었다(아래 §4, `laneRenderer.ts`도 같은 이유로 더 이상 안 더함).
    const timeSeconds =
      schedule.songStartSeconds + ticksToSeconds(note.tick, score.ppq, playbackBpm)
    scheduledIds.push(
      transport.schedule((time) => {
        voices[note.piece].trigger(time, note.velocity / 127)
      }, compensatedTriggerTime(timeSeconds)),
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
        // 재생 위치(파일 안 어디서부터 틀지)는 항상 "진짜" audioStartSeconds
        // 기준 — 트리거만 당겨지고 내용 자체는 안 당겨져야 연속 재생이 맞다
        // (위 audioLatencyCompensationMs 옵션 설명 참고).
        // T3-72(REQ-02, Q-43) — 4번째 인자(오프셋)로 다운비트가 원곡 파일
        // 에서 몇 초 지점인지 전달 — 더 이상 "틱0=파일 위치0"이 아니므로
        // 빠뜨리면 음원 트랙만 다운비트 위치에서 어긋난다(work/T3-72/
        // plan.md §4). 항상 0 이상이라 별도 클램프 불필요(§5 증명).
        const positionSeconds = audioTrackPositionSeconds(
          audioStartSeconds,
          schedule.songStartSeconds,
          playbackRate,
          score.audioOffsetMs / 1000,
        )
        tracks.playFrom(positionSeconds, playbackRate)
      }, compensatedTriggerTime(audioStartSeconds)),
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
