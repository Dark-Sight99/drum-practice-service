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
  } catch {
    /* 폴백: Tone이 알아서 기본 컨텍스트를 만들게 둔다. configured는 false로 남겨 재시도
     * 가능성을 열어둠(Codex C-002). */
  }
}
