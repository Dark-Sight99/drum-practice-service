import * as Tone from 'tone'

/** Codex 검수 C-001(2026-10-31, main 병합 전 게이트 검수) 지적·확인 — 스템
 * 풀(stemPlayer.ts)과 신스 드럼(PracticeCanvas.tsx/EditorScreen.tsx)은 각자
 * 전용 Limiter(-1dB)를 거쳤지만, 메트로놈(metronome.ts)은 리미터 없이
 * `Tone.getDestination()`에 바로 연결돼 있었다. Web Audio Destination은
 * 거기 연결된 모든 소스를 그냥 다 더하므로, 각 체인이 개별적으로 -1dB
 * 이하로 눌러도 세 소스(스템+신스드럼+메트로놈)가 동시에 울리는 순간
 * "합산된" 최종 출력이 0dBFS를 넘는 디지털 클리핑이 날 수 있었다 — 기존
 * 코드 주석들은 "destination 직전에서 최종 합산 레벨을 묶는다"고 설명했지만
 * 실제로는 각 체인 "자기 자신의" 합만 묶었을 뿐, 세 체인을 가로지르는
 * 진짜 최종 합산은 전혀 안 묶여 있었다. 특히 의뢰인이 요청한 드럼/신스드럼
 * +12dB 부스트(mixer.ts STEM_DRUMS_BOOST_DB/SYNTH_DRUMS_BOOST_DB)가 이
 * 위험을 키운 상태였다.
 *
 * 세 경로(스템 풀·신스 드럼·메트로놈) 전부가 이 하나의 공유 Limiter를
 * 거쳐 Destination에 닿도록 한다. `Tone.getDestination()`과 같은 성격의
 * 앱 전역 싱글턴 — AudioContext 하나당 한 번만 만들고 절대 dispose()
 * 하지 않는다(여러 화면·여러 재생 세션에 걸쳐 공유되므로, 한쪽 세션 종료가
 * 다른 쪽이 아직 쓰는 중인 공유 노드를 끊어버리면 안 된다 — stemPlayer.ts의
 * 스템 풀 수명과 PracticeCanvas.tsx/EditorScreen.tsx의 재생 세션 수명이
 * 서로 다르고 겹칠 수 있다는 게 바로 이 버그의 근본 원인이었다). */
let masterLimiter: Tone.Limiter | null = null

export function getMasterLimiter(): Tone.Limiter {
  if (masterLimiter === null) {
    masterLimiter = new Tone.Limiter(-1).toDestination()
  }
  return masterLimiter
}

/** 테스트 전용 — 모듈 스코프 싱글턴을 초기화해 테스트끼리 "Limiter가 몇 번
 * 만들어졌는지" 같은 기대값이 실행 순서에 따라 새지 않게 한다. 프로덕션
 * 코드에서는 호출하지 않는다(플랫폼 코드와 같은 싱글턴 원칙은
 * platformAudioContext.ts와 같지만, 그쪽은 vi.resetModules()+동적 import로
 * 모듈 전체를 다시 불러오는 패턴을 쓰고 이쪽은 stemPlayer.test.ts의 기존
 * 구조(파일 맨 위 1회 import)와 맞추기 위해 명시적 리셋 함수를 둠). */
export function __resetMasterLimiterForTests(): void {
  masterLimiter = null
}
