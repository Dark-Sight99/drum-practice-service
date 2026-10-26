> 한 줄 요약: 재생 버튼을 누르기 전에 오디오 스템 파일 전체를 fetch()로 미리 다 받아 blob URL로 바꾼 뒤에야 재생 가능하게 바꿔, 재생 "도중"엔 네트워크 요청이 전혀 안 생기게 함. Codex 모드C 설계 검수 1라운드(진행 가능, C-001~C-007), 자동 테스트 217개 통과(신규 blob URL 누수 회귀 테스트가 실제 버그 1건 발견·수정).

# T3-16-feedback-7(재생 전 전체 다운로드) QA 결과

## 근거(REQ)
REQ-04/05. T3-16-feedback-6(엘리먼트 재사용) 적용 후 의뢰인이 맥에서 재생→리셋→재생을 반복 테스트 — "아까보다 훨씬 깔끔해졌다"고 확인했지만, 네트워크 탭 실측상 재생이 아직 버퍼링 안 된 지점을 넘어서는 순간엔 여전히 "버퍼링된 지점부터 끝까지"만 다시 받는 패턴이 남아있어 그 순간 끊길 여지가 있었음(Q-35 후속). 의뢰인에게 "재생 전에 아예 다 받아두면 재생 중엔 네트워크를 전혀 안 타게 할 수 있다"고 제안 — 재생 가능해지기까지 기다리는 시간이 늘어나는 트레이드오프를 설명하고 동의받음. 작업 전 "지금 버전(main HEAD `5d6739a`)으로 되돌릴 수 있는지" 질문에 git으로 안전하게 되돌릴 수 있음을 확인받고 진행.

## 설계 검수(모드C 1라운드, 진행 가능 — `work/T3-16-feedback-7/plan.md` §모드C 지적 반영 참고)
REQ-04 핵심 재생 로직(풀 생성 경로)을 건드리는 변경이라 구현 전 설계 문서로 Codex 모드C 검수를 거침. 결과는 **진행 가능**(blocking 없음) + 비차단 권고 C-001~C-007(blob URL 메모리 관리, 이펙트 취소 경쟁, 로딩 중 버튼 UX, 곡 전환 시 로딩 상태, 실패 시 로딩 해제, same-origin credentials, "다운로드 완료"≠"재생 준비" 구분) — 전부 구현에 반영. 상세는 plan.md 참고.

## 변경 내용
1. **`app/web/src/audio/trackPlayer.ts`**: `createAudioTrackPool(sources): Promise<AudioTrackPool>`로 시그니처 변경(기존은 동기). 각 트랙마다 `fetch(source.url)` → `.blob()`(본문 전체를 끝까지 소비 — T3-16-feedback-4 C-001 교훈 재사용) → `URL.createObjectURL(blob)` → `new Audio(objectUrl)` 순서로 생성. `TrackState`에 `objectUrl: string` 필드 추가. 여러 트랙은 `Promise.allSettled`로 병렬 fetch(순차면 대기 시간이 트랙 수만큼 늘어남) — 하나라도 실패하면 이미 성공한 트랙들을 정리 후 재던짐. `destroyTrack()`을 모듈 스코프 함수로 추출(트랙 자체 생성 실패 시의 즉시 정리와 풀 파괴 양쪽에서 재사용)하고 `URL.revokeObjectURL()` 호출을 추가.
2. **`app/web/src/features/practice/PracticeCanvas.tsx`**: 풀 생성 이펙트를 비동기·취소 가능하게 재작성 — `const [audioTracksLoading, setAudioTracksLoading] = useState(false)` 추가. 이펙트 시작 시 일단 `false`로 리셋(직전 곡 로딩 상태가 새 곡의 early return에 남는 걸 방지 — 구현 중 자체 발견, plan.md 참고) 후 실제 작업 시작 시 `true`. `let cancelled` 지역 플래그로 늦게 도착한 풀을 즉시 `destroy()`. ▶재생 버튼의 `disabled` 조건에 `|| audioTracksLoading` 추가, 로딩 중엔 라벨을 "⏳ 음원 불러오는 중…"으로 교체.

## 위험 분류
REQ-04/05 핵심 재생 세션 로직(풀 생성 경로)에 직접 영향 — 모드C 1라운드 검수 완료(진행 가능 판정). `AudioTrackPool.prime()`/`reset()`/세션 레벨 로직(T3-16-feedback-6에서 이미 검수받은 부분)과 `handlePlay()`의 `canUseAudioTracks` 분기 자체는 무변경.

## 자동 테스트
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit   # 이번 변경으로 인한 새 오류 0건(기존 Q-34 오류 6건만 남음)
npm run lint                             # oxlint 통과, 경고 없음
npm test -- --run                        # 17 test files / 217 tests 모두 통과
```
`trackPlayer.test.ts` 전면 갱신(`createPlayer()` 헬퍼 async화 + 모든 호출부 `await` 추가, `fetch()`/`URL.createObjectURL`/`URL.revokeObjectURL` 모킹 신규 추가) + 신규 테스트:
- fetch() → blob URL → 엘리먼트 src 생성 경로 검증.
- HTTP 응답 `ok:false`면 상태 코드를 포함한 에러를 던짐.
- 모드C C-001 회귀: 트랙 하나의 fetch가 실패해도(Promise.allSettled) 이미 받은 다른 트랙의 blob URL이 새지 않고 해제됨.
- `AudioTrackPool.destroy()`가 모든 트랙의 blob URL을 `revokeObjectURL`로 해제.
- **구현 중 발견한 실제 버그의 회귀 테스트**: 기존 "createMediaElementSource() 성공, createGain() 실패" 테스트에 `revokeObjectURLMock`/`sourceNodes[0].disconnect` 검증을 추가했다가, `sourceNode.disconnect()`가 호출되지 않는 걸로 실패 — `buildTrack()`의 catch 블록이 이미 만든 `sourceNode`를 `destroyTrack()`에 `null`로 넘기던 버그(T3-16-feedback-6에서 고쳤던 것과 같은 종류의 실수가 이번 재구현 중 재발)를 잡아 `sourceNode`를 try 블록 밖에서 선언해 catch에서도 실제 참조를 넘기도록 수정, 테스트 통과 확인.

## 브라우저 수동 검증 — 제한적
새 탭으로 프런트 로드, 콘솔 에러 0건 확인. 로그인 자격증명이 없어 실제 재생 버튼의 로딩 대기 시간 체감, 재생 중 네트워크 탭에 `stem` 요청이 **0건**인지(이번 설계의 핵심 가설 — 이전 단계들과 달리 "일부만 남는 정도"가 아니라 "0건"을 목표)는 직접 확인 못함 — **의뢰인이 맥에서 재생 버튼을 누르고 (a) 로딩 대기 시간이 체감상 괜찮은지, (b) 재생 중 네트워크 탭에 `stem` 요청이 전혀 안 뜨는지 확인 필요**.

## 결론
REQ-04 핵심 로직 변경이라 Codex 모드C 설계 검수를 거쳤고(진행 가능, 비차단 권고 7건 전부 반영), 자동 테스트 작성 과정에서 이전 라운드와 같은 종류의 실제 버그(부분 생성 실패 시 정리 대상 노드를 null로 덮어씀)를 추측이 아니라 테스트로 직접 잡아 수정 — 이번에도 "증거 기반"으로 다져진 구현. 실제 네트워크 개선 효과(재생 중 `stem` 요청 0건)는 의뢰인의 맥 재테스트로 최종 확인.
