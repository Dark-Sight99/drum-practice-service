// T6-11(REQ-04/06, Q-33, work/T6-11/plan.md) — 스템(실제 음원) 재생을 `<audio>`
// 엘리먼트에서 `Tone.Player`(AudioBufferSourceNode)로 옮기는 전환의 1단계.
// 이 파일은 Tone을 import하지 않는 순수 계산 모듈이다(jsdom에서 그대로 단위
// 테스트 가능 — clock.ts/drumVoices.ts와 같은 "작은 책임" 원칙 재사용).
//
// 왜 이 전환이 필요한가(근거는 work/T6-11/plan.md 전체, 아래는 요약): 노트는
// Tone.Transport(Web Audio 시계)로 스케줄되고 실제 음원은 `<audio>` 엘리먼트의
// 별도 미디어 파이프라인으로 재생돼, 두 시계가 자연적으로 어긋난다(Web Audio
// 공식 스펙: AudioContext 시간이 "may not be synchronized with other clocks in
// the system"). 그 어긋남을 바로잡던 `trackPlayer.ts`의 `resync()`(주기적
// `currentTime` 강제 seek, 또는 시도했다가 되돌린 playbackRate 미세조정)가
// iOS에서 fps 저하·오디오 끊김의 직접 원인임을 실기기 라이브 실험 + WebKit
// 소스 코드 + WebKit 미디어 엔지니어의 공식 답변(Bug 301824 "If you want
// sample accurate playback, you really need a BufferSource, not a
// HTMLMediaElement")으로 확정(2026-10-30). 스템을 AudioBufferSourceNode 기반
// 재생으로 바꾸면 노트와 완전히 같은 시계를 쓰므로 드리프트 자체가 구조적으로
// 없어져 resync()가 통째로 불필요해진다.
import { audioTrackPositionSeconds } from './timing'

/** `app/server/modules/tempo/atempo.py`의 `ATEMPO_FILTER_MIN`/`MAX`와 반드시
 * 같은 값으로 유지해야 한다(Codex 검수 C-004, 2026-10-31 — 재검수에서 발견).
 * 서버는 요청 permille(부동소수점 반올림 여유를 둬 490~1510까지 받음)을
 * ffmpeg atempo 필터 자체의 유효 범위로 clamp한 rate로 실제 변환하지만,
 * 캐시 파일명·`X-Tempo-Permille` 응답 헤더는 요청값을 그대로 돌려준다(API
 * 계약 — Codex 모드C 1차 C-003) — "이 버퍼가 실제로 몇 배속으로 렌더됐는지"는
 * 요청 permille만으로는 알 수 없고, 아래 `appliedBufferTempoRatio()`로 서버와
 * 같은 clamp를 프론트에서도 재현해야 한다. 안 그러면(실제 재현된 버그) 경계
 * permille(예: 498)에서 `bufferTempoRatio`가 "요청값 그대로"라고 잘못
 * 믿어버려 `stemNodePlaybackRate()`의 잔차 보정이 "불필요"로 판단되고, 그
 * 결과 스템 오디오가 신스 노트보다 0.4%(0.5/0.498−1) 빠르게 재생돼 곡
 * 길이 내내 어긋남이 누적된다(5분 곡 기준 끝에 약 1.2초). */
export const ATEMPO_FILTER_MIN = 0.5
export const ATEMPO_FILTER_MAX = 100

/** 요청 `permille`로부터 "서버가 실제로 적용했을" `bufferTempoRatio`를
 * 계산한다 — 위 상수로 서버의 clamp를 그대로 재현. `permille===1000`(배속
 * 변경 없음)은 애초에 atempo 자체를 안 거치므로(`stemTempoAudioUrl()`의
 * 원본 URL 폴백) 이 함수를 거칠 필요가 없지만, 호출해도 결과가 그대로 1이라
 * 안전(1000/1000=1, 범위 안이라 clamp 영향 없음). */
export function appliedBufferTempoRatio(permille: number): number {
  return Math.max(ATEMPO_FILTER_MIN, Math.min(ATEMPO_FILTER_MAX, permille / 1000))
}

/** 한 재생 세션의 스템 타이밍 상수. `scorePlayer.ts`가 `computePlaybackSchedule()`
 * 결과로 채워서 `StemPlayer.attach()`에 넘긴다. */
export interface StemSessionTiming {
  /** 틱 0(다운비트)의 Transport 절대 초 = 카운트인 길이. */
  songStartSeconds: number
  /** 이 세션에서 스템이 처음 들려야 하는 Transport 초(loopStart ?? songStart)
   * — 카운트인 동안 원곡이 무음이어야 하는 게이트 기준. */
  audioStartSeconds: number
  /** `score.audioOffsetMs / 1000` — "원곡 파일" 기준 초(T3-72, Q-43). */
  audioOffsetSeconds: number
  /** `playbackBpm / 원곡 BPM`. 재생 세션 동안 상수(재생/일시정지 중 BPM
   * 변경은 UI에서 이미 막혀 있음 — PracticeCanvas.tsx 확인됨). */
  playbackRate: number
  /** `audioLatencyCompensationMs / 1000` — 소리를 이만큼 "당긴다"
   * (scorePlayer.ts의 같은 이름 옵션과 같은 의미). */
  latencyCompensationSeconds: number
}

/** 버퍼 안 오프셋(초, 버퍼 파일 자체의 시간축 기준).
 *
 * `bufferTempoRatio`는 이 버퍼가 몇 배속으로 렌더된 파일인지를 뜻한다 —
 * 원본 스템 그대로면 1, 서버가 사전 변환한 배속 파일이면 그 배속의 실제
 * 적용값(T6-11 API 계약상 `permille / 1000`, 요청값 자체가 정의 — 백엔드
 * 실측 길이가 아니라 요청값을 기준으로 삼는다, work/T6-11/plan.md "API 계약"
 * §Codex C-003 반영 참고). **단, 경계 permille(위 ATEMPO_FILTER_MIN/MAX
 * 범위 밖)는 예외 — 서버가 실제로는 clamp된 rate로 변환하므로, 호출자는
 * "요청값"이 아니라 `appliedBufferTempoRatio()`가 돌려주는 값을 넘겨야
 * 한다(Codex 검수 C-004 재발견, 위 상수 코멘트 참고).**
 *
 * 유도: 원곡(1배속) 기준 위치 p = audioTrackPositionSeconds(...)(기존
 * 함수·기존 증명 그대로 재사용). b배속으로 늘이거나 줄인 파일에서 "원곡의
 * p초 지점"은 그 파일 자체의 시간축으로 p/b초 지점이다(b<1로 느리게
 * 늘였으면 파일이 길어져 있으므로 같은 원곡 지점이 파일 안에서는 더 뒤에
 * 있다 — 예: b=0.5면 원곡 10초 지점은 변환 파일의 20초 지점). */
export function stemBufferOffsetSeconds(
  contentTransportSeconds: number,
  timing: StemSessionTiming,
  bufferTempoRatio: number,
): number {
  return (
    audioTrackPositionSeconds(
      contentTransportSeconds,
      timing.songStartSeconds,
      timing.playbackRate,
      timing.audioOffsetSeconds,
    ) / bufferTempoRatio
  )
}

/** 네이티브 소스(`AudioBufferSourceNode`/`Tone.Player`)에 설정할 `playbackRate`.
 *
 * 서버가 이미 `timing.playbackRate`만큼 느리거나 빠르게 변환해둔 파일이면
 * (`bufferTempoRatio === timing.playbackRate`) 결과가 정확히 1 — 버퍼 자체가
 * 이미 원하는 속도라 추가로 재생 속도를 바꿀 필요가 없다(= 피치도 안 바뀜,
 * REQ-04 핵심). `bufferTempoRatio`가 캐시 키 양자화(permille, 0.1% 단위)
 * 때문에 `timing.playbackRate`와 아주 살짝 다르면, 그 차이(최대 0.05%,
 * 음정 영향 0.87cent — 가청 임계 이하)만큼만 이 네이티브 rate로 보정한다
 * (work/T6-11/plan.md "API 계약" 참고 — 이 보정은 "요청한 배속"과 "서버가
 * 실제로 그 값으로 변환했다고 간주하는 값"의 양자화 오차만을 다루고, ffmpeg
 * 출력 자체의 실측 오차(시작 오프셋 등)는 다루지 않는다 — 두 종류의 오차를
 * 섞지 않는다, Codex C-003). 원본(1배속) 그대로 재생할 때는
 * `bufferTempoRatio = 1`이라 결과가 그대로 `timing.playbackRate`가 되어
 * (피치가 바뀌는) 예전 동작과 같아진다 — 개발 중 백엔드 API 연결 전
 * 임시 검증(work/T6-11/plan.md Step 2)에 쓰는 경로. */
export function stemNodePlaybackRate(timing: StemSessionTiming, bufferTempoRatio: number): number {
  return timing.playbackRate / bufferTempoRatio
}

export interface StemStartPlan {
  /** AudioContext 시각 — 이 시각에 네이티브 소스의 `start()`를 호출. */
  startAt: number
  /** 버퍼 안 오프셋(초) — `start(startAt, bufferOffset)`의 두 번째 인자. */
  bufferOffset: number
  /** true면 카운트인 게이트를 "지금 통과"(이후 세션 전체에서 게이트가 영구히
   * 열린 songStartSeconds 기준으로 바뀜). false면 아직 카운트인 중이라
   * `startAt` 시각에 게이트가 열릴 예정 — 호출자가 `pendingGateOpenAt`으로
   * 기억해뒀다가, 그 시각 이후의 다음 이벤트에서 게이트를 열어야 한다. */
  gateOpenedNow: boolean
}

/** Transport 이벤트 하나("이 AudioContext 시각에 Transport가 이 초에 있다")를
 * 스템 시작 계획으로 바꾼다. `StemPlayer`(stemPlayer.ts)가 Transport의
 * `start`/`loopStart` 이벤트마다 호출 — 매번 "지금 상태를 바탕으로 처음부터
 * 다시" 계산하므로(누적 보정 없음), 중간 이벤트를 하나 놓쳐도 다음 이벤트가
 * 올바른 최종 상태로 수렴한다(work/T6-11/plan.md "Transport 이벤트 핸들러의
 * 상태 전이 규칙" — Codex 모드C 1차 C-001 반영, "가장 최근 이벤트가 최종
 * 상태" 원칙). */
export function planStemStart(args: {
  /** Transport가 이벤트와 함께 알려준(또는 과거 시각 보정 후의) AudioContext 시각. */
  eventTime: number
  /** `eventTime` 시각의 Transport 위치(초) — 이벤트 페이로드를 그대로 믿지
   * 않고 `transport.getSecondsAtTime(eventTime)`으로 다시 조회한 값을 넘겨야
   * 함(호출자 책임, work/T6-11/plan.md 참고 — 지연 방출된 이벤트의 낡은
   * 페이로드를 걸러내기 위함). */
  transportSeconds: number
  /** 현재 AudioContext 시각(`Tone.immediate()`) — 메인스레드 지연으로 이벤트가
   * 늦게 처리된 경우를 보정하는 데 씀. */
  contextNow: number
  /** 카운트인 무음 게이트 — 이 Transport 초 미만이면 아직 원곡이 들리면 안 됨. */
  gateSeconds: number
  timing: StemSessionTiming
  bufferTempoRatio: number
}): StemStartPlan {
  const { eventTime, transportSeconds, contextNow, gateSeconds, timing, bufferTempoRatio } = args
  // 지연 보정: Transport 초 t에서 들려야 하는 "내용 시각"(원곡 파일 기준 위치를
  // 계산할 때 쓸 가상의 Transport 초) = t + L. scorePlayer.ts의 노트 트리거
  // 보정과 같은 방향(소리를 당긴다 = 그만큼 이른 내용을 더 일찍 재생).
  let content = transportSeconds + timing.latencyCompensationSeconds
  let startAt = eventTime
  let gateOpenedNow = true
  if (content < gateSeconds) {
    // 카운트인(또는 게이트 이전 구간) — 게이트 시각까지 미래로 예약한다.
    // 재생 중 BPM은 상수이므로 Transport 초와 AudioContext 초는 이 구간에서
    // 1:1 비율로 흐른다 — 그래서 "게이트까지 남은 Transport 초"를 그대로
    // AudioContext 초 지연값으로 써도 된다.
    startAt = eventTime + (gateSeconds - content)
    content = gateSeconds
    gateOpenedNow = false
  }
  // 메인스레드 지연 등으로 이벤트 처리 자체가 늦어 startAt이 이미 지난
  // 시각이면, 지금 시각으로 당기고 그만큼 버퍼 오프셋을 앞으로 민다(과거
  // 시각으로 네이티브 노드를 예약할 수 없으므로 — Web Audio 스펙 제약).
  if (startAt < contextNow) {
    content += contextNow - startAt
    startAt = contextNow
  }
  return {
    startAt,
    bufferOffset: stemBufferOffsetSeconds(content, timing, bufferTempoRatio),
    gateOpenedNow,
  }
}
