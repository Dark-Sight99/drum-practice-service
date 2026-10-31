// T6-5(REQ-06, Q-33) — T6-4 실기기 라이브 실험으로 확정: iOS에서만 쓰는 Web Audio
// 우회 경로(trackPlayer.ts의 createMediaElementSource()+GainNode, T3-12)가 서버 mp3
// 샘플레이트(44100Hz)와 iOS 기본 AudioContext 샘플레이트(48000Hz, 실측)의 불일치 때문에
// 매 프레임 실시간 리샘플링을 해야 해서 fps가 떨어짐(20~40대) — 같은 경로를 44100Hz로
// 맞춘 AudioContext로 바꿨더니 실기기에서 렉이 사라짐(60fps)을 확인. 이 모듈은 그
// 수정을 앱 전체가 Tone.js를 처음 건드리기 "전에" 적용하는 역할만 한다(책임 분리 —
// trackPlayer.ts/drumVoices.ts는 이 모듈의 존재를 몰라도 됨, main.tsx가 부트스트랩
// 시점에 한 번 호출).
import * as Tone from 'tone'

/** T3-16-feedback-3 — iPhone/iPod/iPad는 보통 UA에 그대로 찍히지만(일부 설정·구버전
 * iPadOS는 "iPad"가 그대로 남음), iPadOS 13+ 기본값은 데스크톱 Safari와 똑같은
 * UA("Macintosh")를 보내 UA만으론 못 가른다 — 모드A 지적(2026-10-26, C-001): 처음엔
 * "iPad" 리터럴 자체를 안 보고 "Macintosh+터치" 폴백에만 의존해서, UA에 "iPad"가
 * 남아있는 기기를 놓치고 있었음. 두 가지를 OR로 합쳐 둘 다 잡는다(iPadOS 13+ 위장은
 * 멀티터치로 구분 — Mac은 `maxTouchPoints` 0~1). T6-5 — trackPlayer.ts에 있던 원본을
 * 이 모듈로 옮기고 export(로직 중복 방지, trackPlayer.ts는 이 함수를 import해서 씀). */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1
}

let configured = false

/** main.tsx가 `createRoot().render()` 전에 **단 한 번, 동기로** 호출한다(work/T6-5/plan.md
 * "어디서 설정하나" — 앱 안에서 Tone.js API를 처음 건드리는 모든 코드(createAudioTrackPool/
 * createDrumVoices/scorePlayer·metronome·clock의 Transport 접근)보다 먼저 실행시키는 게
 * 핵심이라, React 컴포넌트가 하나도 마운트되기 전인 이 시점이 가장 이르고 안전함).
 *
 * iOS에서만, 서버 mp3 샘플레이트(44100Hz — 현재 인코딩 기준, 서버가 바뀌면 재검증 필요)와
 * 맞춘 AudioContext로 `Tone.setContext()`를 미리 해둬 위 리샘플링 비용을 없앤다.
 *
 * Codex 모드C 1차 C-002 지적 반영 — `configured`는 **성공했을 때만** true로 올린다(생성
 * 또는 setContext()가 실패하면 false로 남겨, 이 함수가 다시 호출될 기회가 있으면 재시도할
 * 수 있게). 실패는 조용히 Tone 기본 컨텍스트로 넘어간다(기존 동작으로 폴백이라 안전 —
 * 이 함수를 아예 안 부른 것과 동일한 결과일 뿐, 더 나빠지지 않음). */
export function ensureIOSAudioContextSampleRate(): void {
  if (configured || !isIOS()) return
  try {
    const context = new AudioContext({ sampleRate: 44100 })
    Tone.setContext(context)
    configured = true
    // T6-11(진단용 임시, 2026-10-30) — AudioBufferSourceNode를 Tone 공유 컨텍스트에
    // 얹었을 때도 T6-6 때 발견한 "공유 컨텍스트 자체가 느려지는" 문제가 재현되는지
    // 사전검증하기 위해 임시 노출. 확인 끝나면 제거.
    // @ts-expect-error 진단용 임시 전역
    window.__t6_11_tone_context = context

  } catch {
    /* 폴백: Tone이 알아서 기본 컨텍스트를 만들게 둔다. configured는 false로 남겨 재시도
     * 가능성을 열어둠(Codex C-002). */
  }
}

/** 2026-10-31(REQ-04, 의뢰인 실기기 보고 — qa-evidence/T6-11-memory-diag/
 * client-debug.jsonl로 확인) — 연습 속도를 느리게(배속<1) 할수록 디코딩된
 * PCM 버퍼가 그만큼 더 커진다(실측: 원곡 그대로 236MB → 65.2%로 늦췄을 때
 * 363MB). iOS는 WebKit 탭 메모리 상한이 빡빡해 이 반복(연습↔편집을 오가며
 * 배속을 계속 낮춤)이 겹치면 탭이 통째로 죽는 걸 실측으로 확인했다 — iOS
 * 에서만 "느리게" 쪽 하한을 좁혀 최악의 버퍼 크기를 제한한다. "빠르게" 쪽은
 * 배속>1이라 버퍼가 오히려 작아지므로 그대로 둔다. 정확히 몇 %가 "안전한
 * 하한"인지는 0.652(65.2%)에서 실제로 죽은 사례 하나뿐이라 0.7(70%)은
 * 안전 마진을 더한 추정값 — 의뢰인이 실기기로 재검증 필요(CLAUDE.md §1,
 * "모르는 정보는 지어내지 마라" — 보장된 수치가 아님을 명시). */
export const IOS_MIN_PLAYBACK_RATIO = 0.7

/** `score.meta.bpm`(원곡 BPM) 기준 연습 속도 조절 가능 범위.
 * PracticeCanvas.tsx·EditorScreen.tsx 둘 다 이 함수로 통일(중복 로직 방지 —
 * 기존엔 두 파일에 똑같은 `Math.max(1, Math.round(bpm * 0.5))` 식이 각각
 * 있었음). */
export function practiceBpmRange(originalBpm: number): { min: number; max: number } {
  const minRatio = isIOS() ? IOS_MIN_PLAYBACK_RATIO : 0.5
  return {
    min: Math.max(1, Math.round(originalBpm * minRatio)),
    max: Math.round(originalBpm * 1.5),
  }
}

let stemContext: AudioContext | null = null
let stemContextAttempted = false

/** T6-6(REQ-06, Q-33) — T6-5(위 `ensureIOSAudioContextSampleRate()`)로 Tone 공유
 * AudioContext의 샘플레이트를 44100Hz로 맞췄는데도 실기기에서 실제 사용 시나리오(음원
 * 2개 동시 재생)의 fps 개선이 거의 없었음. 실기기 라이브 실험으로 추가 확정(work/T6-6/plan.md
 * "문제" 절): 완전히 별도의 AudioContext로 같은 음원 2개를 동시 재생하면 60fps 깨끗한데,
 * Tone의 공유 컨텍스트(가상드럼·Transport가 같이 쓰는 바로 그 컨텍스트)에 새 엘리먼트로
 * 연결하면 렉이 재현됨 — "공유 컨텍스트 자체"가 범인일 가능성이 높다는 결론. 그래서 iOS에서
 * 스템(실제 음원) Web Audio 브리지만 Tone과 **완전히 분리된** 전용 컨텍스트를 쓰게 한다.
 *
 * 최초 호출 시 1회만 시도(성공/실패 불문 재시도 안 함 — `ensureIOSAudioContextSampleRate()`와
 * 다른 점: 이 함수가 실패해도 아래 "실패 시 폴백"이 Tone 컨텍스트로 넘어가 그나마 동작은
 * 하는 상태가 되므로 재시도 압박이 적음, work/T6-6/plan.md 참고). 비iOS는 항상 null —
 * 이 함수가 호출되는 trackPlayer.ts의 코드 경로 자체가 iOS 전용이라 영향 없음. */
export function getIOSStemAudioContext(): AudioContext | null {
  if (!isIOS()) return null
  if (stemContextAttempted) return stemContext
  stemContextAttempted = true
  try {
    stemContext = new AudioContext({ sampleRate: 44100 })
  } catch {
    stemContext = null
  }
  return stemContext
}
