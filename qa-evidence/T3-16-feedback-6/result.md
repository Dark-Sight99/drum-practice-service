> 한 줄 요약: 재생 버튼을 누를 때마다 `<audio>` 엘리먼트를 새로 만들고 버려서 재생 세션마다 네트워크 전체 재다운로드가 일어나던 걸(Q-35), 엘리먼트 소유권을 "연습 화면이 떠 있는 동안"으로 옮겨 재사용하도록 구조 변경. Codex 모드C 3라운드 설계 검수(비동기 prime() 경쟁 상태 등 다수 지적) 끝에 진행, 자동 테스트 212개 통과.

# T3-16-feedback-6(오디오 엘리먼트 재사용) QA 결과

## 근거(REQ)
REQ-04/05. T3-16-feedback-4(프리페치)·5(캐시 헤더) 적용 후에도, 의뢰인의 맥 네트워크 탭 실측으로 `<audio>` 엘리먼트가 `fetch()` 프리페치 캐시를 전혀 재사용하지 않고 재생 세션마다 4트랙 전체를 처음부터 다시 받는다는 걸 확인(Q-35). 원인: `createTrackPlayer()`가 재생 버튼을 누를 때마다(`handlePlay()`) `<audio>` 엘리먼트를 새로 만들고, `stopPlayback()`이 매번 `dispose()`로 버림(`element.src=''`).

## 설계 검수(모드C, 3라운드 전부 진행 — `work/T3-16-feedback-6/plan.md` 참고)
REQ-04 핵심 재생 로직을 건드리는 변경이라 구현 전 설계 문서로 Codex 모드C 검수를 거침:
- **1라운드 BLOCKING(C-001)**: 엘리먼트를 세션 간 재사용하면, 취소된 옛 세션의 비동기 `prime()`이 늦게 끝나면서 새 세션 상태를 덮어쓸 위험 — `unlocked`를 세션이 아니라 **풀(`AudioTrackPool`) 스코프 상태**로 옮기고 `pool.prime()`을 멱등(이미 언락된 트랙은 재시도 없이 즉시 반환, 진행 중인 호출은 Promise 공유)으로 만들어 구조적으로 해소.
- **2라운드 BLOCKING(C-005)**: 설계 문서 안에 "reset()이 started/unlocked 둘 다 리셋"이라는, 1라운드 수정 전에 썼던 모순된 문장이 남아있던 걸 지적받아 "reset()은 started만 리셋, unlocked는 안 건드림"으로 문서를 바로잡음.
- **3라운드(최대) BLOCKING(C-007)/Medium(C-008)**: "unlocked를 풀 레벨로 옮긴다"는 표현이 "풀 전체에 불리언 하나"로 오해될 여지가 있다는 지적 — 실제로는 트랙별로 독립된 상태(원래부터 그랬음)가 풀이 들고 있는 `TrackState` 객체를 세션과 참조로 공유해 자동 동기화되는 구조임을 명확화. 풀 생성 도중 일부 트랙만 만들고 실패하는 경우의 정리 규칙이 없다는 지적도 반영(트랙별 독립 정리 후 재던짐). 3라운드가 이 프로젝트 규칙상 최대 라운드라, 두 지적 모두 마스터가 직접 설계 문서에 반영하고 4라운드 없이 진행 확정.

## 변경 내용
1. **`app/web/src/audio/trackPlayer.ts`**: `createAudioTrackPool(sources)` 신규 — `<audio>` 엘리먼트 생성·iOS 전용 Web Audio 와이어링(`createMediaElementSource()`는 엘리먼트당 평생 1번 제약)을 전담, `prime()`(멱등·Promise 공유·destroy 가드)과 `destroy()`(트랙별 독립 try/catch로 일시정지→노드 disconnect→src 비움) 제공. `createTrackPlayer(pool)`은 이제 풀을 받아 세션 범위 동작(`playFrom`/`seekTo`/`resync`/`setChannelGain`/`pause`/`resume`/`stop`)만 구현하는 얇은 래퍼. `dispose()`는 `reset()`으로 이름·의미 변경 — 엘리먼트를 안 건드리고 `started`만 세션별로 리셋(`unlocked`는 풀 스코프라 유지).
2. **`app/web/src/audio/index.ts`**: `createAudioTrackPool`/`AudioTrackPool` export 추가.
3. **`app/web/src/features/practice/PracticeCanvas.tsx`**: T3-16-feedback-4의 `fetch()` 프리페치 이펙트를 `audioTrackPoolRef`(연습 화면이 곡을 보여주는 동안 수명, `songId` 변경 시 재생성·이펙트 cleanup에서 `pool.destroy()`) 생성으로 교체. 풀 생성이 실패하면(모드C 3라운드 C-008) 콘솔 경고만 남기고 조용히 포기 — `handlePlay()`가 보는 "풀이 없음"은 기존 `canUseAudioTracks=false`(MIDI-only 등) 경로와 같은 모양이라 자연 폴백. `handlePlay()`의 `createTrackPlayer(stemKinds.map(...))` 호출을 `createTrackPlayer(audioTrackPoolRef.current)`로, `stopPlayback()`의 `tracks?.dispose()`를 `tracks?.reset()`으로 교체.

## 위험 분류
REQ-04/05 핵심 재생 세션 로직에 직접 영향 — 모드C 3라운드 검수를 전부 거침(위 참고). `scorePlayer.ts`가 쓰는 `TrackPlayer.stop()`/`pause()`/`resume()` 시그니처·동작은 무변경(데이터 소스만 풀로 바뀜) — 확인 완료.

## 자동 테스트
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit   # 이번 변경으로 인한 새 오류 0건(기존 Q-34 오류만 남음)
npm run lint                             # oxlint 통과, 경고 없음
npm test -- --run                        # 17 test files / 212 tests 모두 통과
```
`trackPlayer.test.ts` 전면 갱신(`createPlayer()` 헬퍼로 기존 테스트 대부분은 최소 변경) + 신규:
- C-001/C-006 회귀: `prime()` 두 번째 호출이 캐시만 반환(재시도 없음), 진행 중인 호출이 Promise 공유, destroy() 이후 늦게 끝나는 prime()이 상태를 되살리지 않음, 거부로 unlocked=false가 된 뒤 다음 prime()은 실제로 재시도.
- C-007 회귀: 같은 풀로 세션을 두 번 만들어도 `createMediaElementSource`/`createGain`이 트랙당 1번만 호출.
- C-008 회귀: 풀 생성 도중 트랙 하나가 실패하면 이미 만든 트랙을 정리하고 재던짐.
- reset()/destroy() 분리 회귀: `reset()`은 엘리먼트 src를 안 비움(destroy()만 비움), `reset()` 뒤 `prime()`은 재시도 없이 캐시 반환, `reset()`이 `started`만 리셋해 resume() 조기 재생을 막음.
- destroy() 중 트랙 하나 정리 실패해도 나머지 트랙은 계속 정리되는지(모드C 3라운드 C-003/C-008).

## 브라우저 수동 검증 — 제한적
새 탭으로 프런트 로드, 콘솔 에러 0건 확인. 로그인 자격증명이 없어 실제 재생→리셋→재생 반복 시 네트워크 탭에 새 요청이 없는지(이 설계의 핵심 가설, plan.md의 C-004)는 직접 확인 못함 — **의뢰인이 맥에서 재생→리셋→재생을 반복하며 네트워크 탭·청취로 확인 필요**.

## 결론
REQ-04 핵심 로직 변경이라 Codex 모드C 검수를 규칙상 최대인 3라운드까지 전부 거쳤고, 매 라운드 실제로 유효한 지적(비동기 경쟁 상태, 문서 불일치, 상태 스코프 오해 소지, 부분 실패 정리 누락)을 받아 반영 — 추측이 아니라 검수 기반으로 다져진 설계. 실제 네트워크 개선 효과는 의뢰인의 맥 재테스트로 최종 확인.
