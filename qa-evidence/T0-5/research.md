> 한 줄 요약: iOS/iPadOS Safari 조사 결과(무음 스위치, 저장소 삭제, AudioWorklet/WakeLock 지원) — 출처 포함, 추측 없음. 실제 ms 측정은 폰·태블릿 실측 대기 중.

# T0-5 사전 조사 — iOS/iPadOS Safari (2026-10-23)

대상 기기: iPhone 13 Pro(iOS 27.0.1), iPad mini 5(iPadOS 26.6.1) — 둘 다 Safari/WebKit. 안드로이드 테스트 제외(의뢰인 결정).

## ① iOS Safari 무음(벨소리) 스위치가 Web Audio API에 미치는 영향
**결론: Web Audio API(AudioContext/AudioWorklet)로 재생하는 소리는 무음 스위치가 켜져 있으면 소리가 나지 않을 가능성이 높다. 반면 `<audio>`/`<video>` 엘리먼트는 무음 스위치의 영향을 받지 않는다.**
- WebKit 측 설명(버그 코멘트): AudioContext가 생성하는 소리를 시스템의 "Ambient" 오디오 동작에 매핑했고, 이 경우 무음 스위치를 따른다("Web Audio would obey the mute switch"). 출처: WebKit Bugzilla 코멘트(adactio.com/journal/19929에서 재인용, 2026-10-23 확인)
- 별도 WebKit 버그(#237322)도 "WebAudio is muted when the ringer is muted"로 요약됨.
- ⚠ 이 자료들은 비교적 오래된 버전(iOS 16대) 기준 리포트이며, **iOS 27/iPadOS 26.6에서 공식적으로 재확인된 자료는 찾지 못함**. 실측(측정 페이지에서 무음 스위치 on/off 두 번 테스트) 권장.
- **영향**: 후보2(HTMLMediaElement `preservesPitch`)는 무음 스위치의 영향을 안 받아 "연습실에서 무음 모드로 오해해 소리가 안 남" 같은 사용성 문제가 없음. 후보1(SoundTouch AudioWorklet)은 Web Audio 기반이라 무음 스위치가 켜져 있으면 소리가 안 날 수 있음 — **드럼 연습 앱에서는 사용자가 무음 스위치를 깜빡 켜둔 상태로 열었을 때 소리가 전혀 안 나는 것이 치명적**이므로 후보 평가에 반영해야 함.

## ② iOS/iPadOS Safari의 IndexedDB·Cache 저장소 삭제 조건과 REQ-09(30일 오프라인) 영향
- **일반 Safari 탭(홈 화면 추가 안 한 경우)**: "7일간 사이트 사용(사용자 상호작용) 없으면" 스크립트가 쓴 저장소(IndexedDB 포함)가 삭제되는 정책이 있다고 보고됨. 출처: habr.com 글, WebKit 관련 논의(2026-10-23 확인, 정확한 1차 출처 WebKit 공식 발표문은 직접 확인 못 함 — ⚠ 확인 필요).
- **홈 화면에 추가한 PWA(standalone/fullscreen)**: WebKit 엔지니어(John Wilander)가 "Home Screen Web Application Domain Exempt From ITP"라고 밝혀, 홈 화면 앱은 이 7일 규칙에서 **예외**라는 설명이 있음(Ionic 블로그에서 재인용).
- **그러나 실제로는 예외가 항상 지켜지지 않는다는 보고도 있음**: WebKit 버그 #237350(2022, iOS 15.3) — 홈 화면 앱인데도 로그인 쿠키가 7일 후 삭제된 사례. WebKit 버그 #232302(2021) — IndexedDB·서비스워커 데이터가 일주일 후 삭제된 사례, WebKit 측 답변은 "`minimal-ui`가 아니라 `standalone`/`fullscreen` 디스플레이 모드를 쓰라"였음.
- **완화 방법(미확정)**: Apple Developer Forums 글에 따르면 앱을 열 때마다 `navigator.storage.persist()`를 호출하면 데이터가 보호된다는 보고가 있으나 **공식 문서로 확정되지 않음**.
- **2026년 기준 최신 공식 발표는 찾지 못함**(검색 결과 중 "2주 후 캐시 삭제"라고 쓴 글은 1차 출처가 불명확한 벤더 블로그라 신뢰도 낮음 — 참고만).

### REQ-09(오프라인 30일) 영향
위 조사가 사실이라면, **홈 화면에 추가하지 않고 브라우저 탭으로만 쓰는 경우 7일 안에 오프라인 캐시가 날아갈 위험**이 있어 REQ-09의 "30일" 목표와 충돌할 수 있다. 완화책(모두 미확정, Phase 1/5 구현 시 재검증 필요):
1. `display: standalone`으로 홈 화면 추가를 강하게 권장/유도(REQ-09 UI에 안내 문구 추가 제안 — 승인 필요).
2. 앱 열 때마다 `navigator.storage.persist()` 호출(효과 미확정이지만 비용이 거의 없으니 추가하는 것을 제안).
3. 그래도 iOS는 7일/30일 보장을 공식적으로 약속하지 않으므로, REQ-09의 "30일"을 iOS에서는 "최선 노력(best-effort)"으로 명시하고, 마지막 오프라인 재생일을 사용자에게 보여줘 재접속을 유도하는 UX를 Phase 5에서 고려할 것을 제안.
이 결론은 마스터의 **제안**이며, intent 반영은 의뢰인 승인 후 진행.

## ③ 해당 iOS/iPadOS 버전에서 AudioWorklet·Wake Lock 지원 여부
| 기기 | AudioWorklet(AudioWorkletNode) | Wake Lock(`navigator.wakeLock.request`) |
|---|---|---|
| iPhone 13 Pro, iOS 27.0.1 | **지원**(caniuse: iOS 14.5부터 지원, 데이터 범위가 iOS 27.1–27.2까지 있어 27.0.1도 포함되는 것으로 판단) | caniuse 메인 wake-lock 표는 26.x까지만 명시(16.4–26.6 지원). **27.x 전용 수치는 못 찾음 → "확인 불가"로 보고.** 26.6까지 지원이 이어져 왔으므로 27.0.1도 지원될 가능성이 높으나 이는 추정이며 확정 아님. |
| iPad mini 5, iPadOS 26.6.1 | **지원**(위와 동일 범위) | **지원**(caniuse: 16.4–26.6 Supported, 18.4부터 완전 지원 — 26.6.1 포함) |
| 출처 | https://caniuse.com/mdn-api_audioworkletnode (2026-10-23 확인) | https://caniuse.com/wake-lock , https://caniuse.com/mdn-api_navigator_wakelock (2026-10-23 확인) |

**실측 대체**: 공식 자료로 100% 확정하기 어려운 부분(특히 27.0.1 Wake Lock)은 의뢰인 요청대로 **측정 페이지 자체가 `'audioWorklet' in BaseAudioContext.prototype`, `'wakeLock' in navigator` 등을 기능 감지(feature detection)해서 화면에 바로 보여주도록 구현**함(아래 §T0-5 측정 페이지). 조사가 아니라 실제 그 기기에서 실행한 결과이므로 이게 가장 정확한 답.

## HTTPS(보안 컨텍스트) 필요 여부 — 집 공유기 http 주소로 열면 AudioWorklet이 막히는지
**확인됨: 맞다.** MDN은 `BaseAudioContext.audioWorklet`을 "secure context에서만 사용 가능"이라고 명시하고, Chrome 개발자 블로그도 "Worklet API는 secure context에서만 사용 가능하므로 HTTPS로 제공해야 한다(`http://localhost`는 예외)"고 설명한다. 집 공유기의 사설 IP(예: `http://192.168.x.x`)는 `localhost`가 아니므로 **secure context가 아니고, AudioWorklet이 동작하지 않을 것으로 판단**된다.
출처: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/audioWorklet , https://developer.chrome.com/blog/audio-worklet (2026-10-23 확인)

**후보 평가에 반영**: 이 사실은 (a) 측정 페이지를 HTTPS로 서빙해야 하는 이유이자 (b) 실제 서비스에서도 SoundTouch(AudioWorklet) 후보를 채택하면 **프로덕션에서도 HTTPS가 필수**라는 뜻 — Tailscale 사설망이라도 HTTPS 터널(Tailscale Serve/Funnel, 또는 자체 인증서)이 필요함을 뒷받침. `03-architecture-stack.md`에 이미 "HTTPS (Tailscale 사설망)"로 되어 있어 기존 설계와 충돌 없음, 다만 이유를 명확히 알게 됨.

## 안드로이드 Chrome 관련 제안 (승인 필요, 아직 수정 안 함)
`intent/02-requirements.md`의 비기능 요구사항에 "대상 브라우저: 최신 Chrome(PC·안드로이드), Safari(iOS·iPadOS), Edge"로 되어 있는데, 실사용 기기가 iPhone 13 Pro + iPad mini 5(둘 다 Safari)로 확정됐으므로 **"안드로이드 Chrome 지원"을 테스트 범위에서 빼고 "PC Chrome/Edge + iOS/iPadOS Safari"로 좁히는 걸 제안**합니다. 수정은 의뢰인 승인 후 진행하겠습니다.
