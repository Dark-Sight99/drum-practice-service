> 한 줄 요약: 네트워크 문제 해결 후에도 맥에서 "음악" 채널이 0.5초 간격으로 끊기는 걸 의뢰인과 함께 실시간 격리 테스트(resync 드리프트 로그 + 직접 청취)로 추적 — T3-12에서 아이폰 볼륨 버그 때문에 넣은 Web Audio(GainNode) 우회가 맥에서는 거꾸로 `<audio>` 재생을 실시간보다 느리게 만드는 원인이었음을 확인. iOS에서만 Web Audio를 쓰고 그 외(맥·PC)는 원래의 `element.volume`을 쓰도록 분기.

# T3-16-feedback-3(맥 오디오 드리프트) QA 결과

## 근거(REQ)
REQ-04/05. T3-16-feedback-2(드럼 재생용 MP3 사이드카) 병합 후에도 의뢰인이 맥에서 "음악(베이스·보컬·그외)"이 템포는 정상인데 소리만 0.5초 간격으로 끊긴다고 재확인 — 네트워크 탭이 이미 깨끗했으므로(재요청·취소 없음) 네트워크 문제가 아니라고 판단하고 추적.

## 원인 추적 과정(전부 실측, 추측으로 건너뛴 단계 없음)
1. **의심 지점**: `PracticeCanvas.tsx`의 `TRACK_RESYNC_INTERVAL_MS=750`마다 도는 `resync()` — Tone.js 마스터 클록과 오디오 엘리먼트 `currentTime`이 `TRACK_RESYNC_THRESHOLD_SECONDS=0.1`초 이상 벌어지면 강제로 위치를 점프시킨다. 임시 진단 로그(`console.warn`, 원인 확정 후 제거함)를 넣어 실측.
2. **1차 확인**: 로그 결과 4트랙 전부 **매 주기(750ms)마다 예외 없이** drift>threshold로 보정이 발동, drift 값 자체가 0.3~0.6초 — 즉 오디오 엘리먼트가 실시간보다 2~3배 느리게 재생되고 있었고, 의뢰인이 직접 들은 "0.5초 들렸다 0.5초 뮤트"는 이 강제 점프가 그 사이 구간을 건너뛰는 소리였음.
3. **격리 1차**: stem_drums만 임시로 `createMediaElementSource()`를 안 거치게(Web Audio 우회 제거, 네이티브 재생) 했더니 drift가 다른 셋의 절반 수준으로 줄었지만 0은 아님 — Web Audio가 원인의 일부이지 전부는 아닌 것으로 보임.
4. **격리 2차**: 같은 drums에서 추가로 `preservesPitch`도 꺼봤더니(배속 1배라 이론상 불필요한 연산) drift가 완전히 사라짐(로그에 아예 안 찍힘) + 의뢰인이 믹서를 하나씩 뮤트해가며 직접 들어본 결과도 드럼원곡/신스드럼/메트로놈은 정상, "음악"만 문제라고 확인.
5. **격리 3차(결정적)**: Web Audio는 원래대로(GainNode 정상 사용) 되돌리고 `preservesPitch`만 drums에서 껐더니 drift가 **원래대로 완전히 복귀**(다른 셋과 동일한 0.5초대) — `preservesPitch`는 원인이 아니고, **Web Audio(GainNode) 우회 자체가 원인**임이 확정됨.
6. **교차 확인**: WebSearch로 같은 구조(스템 여러 개를 `MediaElementAudioSourceNode`로 재생)의 다른 오픈소스 프로젝트(`stemdeckapp/stemdeck`)도 Safari/WKWebView에서 같은 문제를 겪고 결국 Web Audio를 걷어내고 `element.volume`으로 되돌려 고친 사례를 확인(stemdeckapp/stemdeck#38) — 우리만의 특이 현상이 아님.
7. **핵심 발견**: T3-12의 "iOS가 `.volume`을 무시한다"는 버그는 **아이폰에서만** 확인됐었고, 맥(데스크톱 사파리)까지 같은지는 한 번도 검증한 적이 없었음. 의뢰인이 "지금까지 테스트한 환경이 맥노트북이었다"고 확인 — 즉 지금 겪는 문제는 애초에 iOS 전용이었어야 할 우회가 데스크톱에도 무조건 적용되면서 생긴 부작용.

## 변경 내용 (`app/web/src/audio/trackPlayer.ts`만 수정)
1. `isIOS()` 함수 신규 — iPhone/iPod은 User-Agent로 바로 식별, iPadOS 13+는 데스크톱 Safari와 같은 UA("Macintosh")를 보내 UA만으론 못 가르므로 `navigator.maxTouchPoints`(iPad는 멀티터치 보고, 맥은 0~1)로 추가 판별(iOS 기기 판별의 표준적인 우회법).
2. `createTrackPlayer()`의 트랙 생성 루프: `isIOS()`가 참일 때만 `createMediaElementSource()`+`GainNode` 연결(T3-12 원래 동작 그대로), 아니면 `sourceNode`/`gainNode`를 `null`로 둬 Web Audio를 아예 안 거침(네이티브 재생).
3. `setChannelGain()`: `gainNode`가 있으면(iOS) 기존대로 `gainNode.gain.value`, 없으면(데스크톱) `element.volume`에 직접 적용(클램프 로직은 동일).
4. `dispose()`: `gainNode?.disconnect()`/`sourceNode?.disconnect()`로 옵셔널 체이닝(데스크톱은 애초에 노드가 없음).
5. `preservesPitch`는 원인이 아니었으므로 손대지 않고 그대로(`= true`, T3-3 원래 목적대로 배속 변경 시 피치 유지).
6. 진단용으로 넣었던 `console.warn`(resync-diag)은 원인 확정 후 제거.

## 위험 분류
오디오 음량 제어 경로를 플랫폼별로 분기하는 변경 — REQ-04/05 핵심 재생 로직에 직접 영향. 다만 iOS 경로는 T3-12의 기존 동작을 **그대로 유지**(분기 조건만 추가)이고, 데스크톱 경로는 T3-12 **이전**의 원래 동작(`element.volume`)으로 되돌아가는 것뿐이라 완전히 새로운 코드 경로는 아님 — 두 경로 모두 과거에 실제로 동작이 검증된 적 있는 코드. 오디오 타이밍(스케줄링 자체)은 안 건드림 — 모드C 불필요, 모드A만 진행.

## 자동 테스트
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit   # 이번 변경으로 인한 새 오류 0건(기존 Q-34 오류만 남음)
npm run lint                             # oxlint 통과, 경고 없음
npm test -- --run                        # 17 test files / 201 tests 모두 통과
```
`trackPlayer.test.ts`에 신규/갱신:
- iOS UA 스텁(`navigator.userAgent` getter spy) 추가 — Web Audio 경로 테스트들이 iPhone UA를 흉내내도록 수정.
- "데스크톱(iOS 아님)에서는 Web Audio를 전혀 안 거침" — `createMediaElementSource`/`createGain`이 호출 안 되는지 확인(신규).
- `dispose()`가 데스크톱(노드 없음)에서도 안 터지는지 확인(신규).
- `setChannelGain()` 데스크톱 버전 — `element.volume`에 클램프까지 정확히 반영되는지 확인(신규, `<audio>` 엘리먼트를 생성 순서대로 추적하는 `window.Audio` 생성자 교체 헬퍼 추가).

## 브라우저 수동 검증 — 제한적
새 탭으로 프런트만 열어 콘솔 에러 0건 확인. 로그인 자격증명이 없어 실제 재생 화면(아이폰 볼륨 조절이 여전히 되는지, 맥 끊김이 사라졌는지)은 직접 검증 못 함 — **의뢰인의 맥 재생 재확인과, 가능하면 아이폰에서도 믹서 음량 조절이 여전히 되는지 재확인 필요**(T3-12가 되돌아가지 않았는지 최종 확인).

## 결론
네트워크(T3-16-feedback, -2)와는 완전히 다른 종류의 원인 — "아이폰 버그 고치려던 우회가 맥에서 부작용을 냄"이라는, 실기기 간 상호작용으로만 드러나는 문제였음. 의뢰인과 실시간으로 로그·청취 데이터를 주고받으며 3단계 격리 실험으로 추측 없이 원인을 확정한 사례.
