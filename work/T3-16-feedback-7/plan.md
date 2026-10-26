> 한 줄 요약: 재생 버튼을 누르기 전에 오디오 스템 파일 전체를 완전히 받아둔 뒤에야 재생 가능하게 바꿔, 재생 "도중" 네트워크 요청 자체가 안 생기게 하는 설계안(Codex 모드C 검수 전). T3-16-feedback-6(엘리먼트 풀 재사용)의 직접적인 확장.

# T3-16-feedback-7 설계안 — 재생 전 전체 다운로드(blob URL)

## 근거(REQ)
REQ-04/05. T3-16-feedback-6(엘리먼트 재사용) 적용 후 의뢰인이 맥에서 재생→리셋→재생을 반복 테스트 — "아까보다 훨씬 깔끔해졌다"고 확인했지만, 아직 재생 중 간혹 끊김이 남아있음(네트워크 탭 확인 결과: 이전엔 재생할 때마다 전체(`0-5268208`)를 다시 받았는데, 이제는 "아직 버퍼링 안 된 뒷부분"만(`2097152-5268208` 등) 받음 — 재사용 자체는 되고 있지만, 재생이 버퍼링된 지점을 넘어서면 그 순간 또 네트워크를 타야 해서 거기서 끊길 여지가 남음). 사용자에게 "재생 전에 아예 다 받아두면 재생 중엔 네트워크를 전혀 안 타게 할 수 있다"고 제안 — 재생 가능해지기까지 기다리는 시간이 조금 늘어나는 트레이드오프를 설명하고 동의받음.

## 현재 구조 (T3-16-feedback-6 기준)
- `createAudioTrackPool(sources): AudioTrackPool`(동기 함수) — `new Audio(url)`로 엘리먼트를 만들고 `element.preload='auto'`만 설정, 실제 데이터는 브라우저가 알아서 점진적으로(스트리밍) 받음. `PracticeCanvas.tsx`가 `songId` 변경 시 이 풀을 만들어 `audioTrackPoolRef`에 저장.
- `handlePlay()`의 `canUseAudioTracks`가 `audioTrackPoolRef.current !== null`을 확인 — 풀이 있으면 바로 재생 가능(완전히 안 받아졌어도 일부만 받아진 상태로 재생 시작 가능, 브라우저의 점진적 버퍼링에 의존).
- ▶재생 버튼은 `disabled={isStarting}`(비동기 셋업 중에만 잠깐 비활성) — 풀이 다 받아졌는지는 전혀 안 봄.

## 설계
### 1. 풀 생성을 비동기로 바꾸고, "전체 다운로드 완료"를 명시적 상태로 노출
- `createAudioTrackPool(sources): Promise<AudioTrackPool>`로 시그니처 변경. 각 트랙마다 `fetch(source.url)` → `.blob()`(본문 전체를 끝까지 받음, T3-16-feedback-4 C-001에서 이미 쓴 "body를 끝까지 소비해야 전체 다운로드가 보장된다"는 교훈 재사용) → `URL.createObjectURL(blob)` → `new Audio(objectUrl)` 순서로 만든다. 여러 트랙을 `Promise.all`로 병렬 fetch(순차로 하면 대기 시간이 트랙 수만큼 늘어남).
- `TrackState`에 `objectUrl: string | null` 필드 추가(데스크톱·iOS 공통, Web Audio 사용 여부와 무관) — `destroy()`가 `URL.revokeObjectURL(objectUrl)`로 반드시 해제(안 하면 그 blob이 페이지가 떠 있는 동안 계속 메모리에 남음 — blob URL의 알려진 특성).
- 이미 Web Audio 와이어링(`createMediaElementSource()` 등)은 `objectUrl`을 `src`로 쓰는 엘리먼트에 대해 그대로 수행(동작상 차이 없음 — 소스가 서버 URL이냐 blob URL이냐는 Web Audio 그래프 구성과 무관).

### 2. `PracticeCanvas.tsx`의 풀 생성 이펙트를 비동기·취소 가능하게
- 이펙트 안에서 `createAudioTrackPool(...)`이 이제 Promise를 돌려주므로, **T3-16-feedback-6 모드C 1라운드에서 이미 겪은 것과 같은 종류의 경쟁**(이펙트가 cleanup된 뒤에 늦게 끝나는 비동기 작업)을 또 조심해야 한다 — `let cancelled = false` 플래그를 두고, `.then()` 콜백 맨 앞에서 `if (cancelled) { pool.destroy(); return }`로 가드(뒤늦게 도착한 풀을 바로 파괴 — 이미 안 쓸 화면이므로). cleanup 함수는 `cancelled = true`로 표시하고, **그 시점에 이미 완성된 풀이 있으면만** `destroy()`(아직 진행 중인 fetch는 위 가드가 알아서 처리하므로 여기서 더 할 일 없음).
- 로딩 중 상태를 노출: `const [audioTracksLoading, setAudioTracksLoading] = useState(false)` — 이펙트 시작 시 `true`, 풀 생성이 성공/실패로 끝나면(취소된 경우 제외) `false`. ▶재생 버튼의 `disabled` 조건에 `|| audioTracksLoading` 추가, 버튼 라벨도 로딩 중엔 "⏳ 음원 불러오는 중..." 등으로 바꿔 사용자가 "왜 안 눌리지" 혼란 없게 한다(구체적 문구는 구현 시 기존 UI 톤에 맞춰 결정).
- 실패 처리(네트워크 에러로 fetch 자체가 실패하는 경우): 기존과 동일하게 콘솔 경고만 남기고 `audioTrackPoolRef.current`를 `null`로 둠 — `canUseAudioTracks`가 자연히 false가 돼 신스만 재생되는 기존 폴백 경로 재사용. 다만 **로딩 상태(`audioTracksLoading`)는 반드시 `false`로 내려야** 버튼이 영원히 "불러오는 중" 상태로 멈추지 않는다(실패해도 일단 눌러볼 수는 있어야 함 — 신스만이라도 재생 가능).

### 3. 범위 밖(이번엔 안 바꿈)
- `handlePlay()`의 `canUseAudioTracks`/`createTrackPlayer(audioTrackPoolRef.current)` 호출부 자체는 무변경 — 풀이 "완전히 준비된 뒤에만" 존재하게 되는 건 위 2번의 로딩 상태로 UI에서 막지, `handlePlay()` 내부 로직을 건드리진 않는다.
- `AudioTrackPool.prime()`/`reset()`/세션 레벨 로직(T3-16-feedback-6에서 이미 검수받은 부분)은 전혀 안 바꿈.

## 위험·확인 필요 사항(모드C 검수 요청 사항)
1. **blob URL 메모리 관리**: `destroy()`가 `revokeObjectURL`을 빠짐없이 부르는지, 생성 도중 실패(일부 트랙만 fetch 성공 후 나머지 실패)해도 이미 만든 blob URL이 새지 않는지(기존 `createAudioTrackPool()`의 부분 실패 정리 로직에 이 해제까지 포함해야 함 — 모드A가 전에 지적했던 "부분 생성 실패 정리 누락"과 같은 종류의 함정).
2. **이펙트 취소 경쟁**: 위 2번에서 설명한 `cancelled` 가드가 실제로 "이펙트가 cleanup된 뒤 늦게 도착한 풀을 즉시 destroy()"하는 걸 놓치는 경로가 없는지(예: cleanup 함수 자체가 아직 진행 중인 Promise를 await 안 하고 그냥 리턴하는데, 그 Promise가 나중에 resolve될 때의 처리가 `.then()` 쪽에만 있다는 게 맞는 설계인지).
3. **로딩 중 UX**: 로딩 상태가 `false`로 안 떨어지는 경로가 없는지(성공/실패/취소 전부 커버해야 함) — 특히 **곡을 바꾸는 중간에 이전 곡의 로딩이 아직 안 끝난 상태로 남아있다가 새 곡 이펙트가 돌 때** `audioTracksLoading`이 꼬이지 않는지(이펙트 재실행 시 새로 `true`로 설정하는 지점이 올바른지).
4. **네트워크 느린 환경에서 체감**: 트랙 4개(각 ~5MB, 총 ~20MB)를 다 받을 때까지 재생 버튼이 막히는 게, 특히 느린 네트워크에서 체감 대기시간이 어느 정도일지 — 실측 없이 구현부터 하는 게 맞는지, 아니면 타임아웃/진행률 표시 같은 보완이 1차 구현에 필요한지(의뢰인은 "몇 초 수준일 거라 크게 불편하진 않을 것"이라는 제 설명에 동의하고 진행을 요청했으나, 실측 전 가정임을 명시).

## 모드C 지적 반영 (1라운드, 진행 가능 — C-001~C-007)
Codex 모드C 검수 결과는 **진행 가능**(blocking 없음), 아래 비차단 권고사항을 구현에 반영:
- **C-001(blob URL 누수)**: `Promise.allSettled`로 병렬 fetch 후, 하나라도 실패하면 이미 성공한 트랙들을 `destroyTrack()`으로 정리(그 안에 `URL.revokeObjectURL()` 포함) — 반영함. 트랙 자신의 생성 중 실패(Web Audio 노드 생성 실패 등)도 `buildTrack()` 안쪽 catch가 자기 자신을 즉시 정리.
- **C-002(이펙트 취소 경쟁)**: `cancelled` 지역 플래그를 이펙트 호출마다 새로 만들어 `.then()`/`.catch()` 콜백 맨 앞에서 가드 — 늦게 도착한 풀은 즉시 `destroy()`. 반영함.
- **C-003(로딩 중 버튼)**: `audioTracksLoading` 상태를 `isStarting`과 함께 재생 버튼 `disabled` 조건에 추가, 로딩 중엔 라벨도 "⏳ 음원 불러오는 중…"으로 교체. 반영함(`PracticeCanvas.tsx` Play 버튼 JSX).
- **C-004(곡 전환 시 로딩 상태 꼬임)**: 이펙트 시작 시 `setAudioTracksLoading(false)`로 먼저 리셋한 뒤, 실제로 비동기 작업을 시작할 때만 `true`로 올리는 순서로 구현 — early return(곡 없음/스템 없음) 경로에서 직전 곡의 `true`가 그대로 남는 걸 방지. 구현 중 자체 발견한 보강(최초 설계 문서엔 명시 안 돼 있었음).
- **C-005(실패 시 로딩 해제)**: `.catch()`에서도 `cancelled`가 아니면 반드시 `setAudioTracksLoading(false)` 호출 — 반영함.
- **C-006(same-origin credentials)**: 별도 조치 불필요 — T3-16-feedback-4에서 이미 같은 패턴(인증 필요 엔드포인트에 자격증명 옵션 없는 `fetch()`)으로 실제 동작 확인된 전례를 설계 문서 §현재 구조에 재인용.
- **C-007(다운로드 완료 ≠ 재생 준비)**: 이번 구현에서는 "전체 다운로드 완료"와 "재생 가능"을 동일하게 취급(풀이 resolve되면 즉시 재생 버튼 활성화) — `prime()`(play()/pause() 언락)은 재생 버튼을 누른 "이후"에 `handlePlay()` 경로에서 별도로 진행되므로 범위 밖. 문서화만 하고 코드 변경 없음.

## 구현 중 자체 발견·수정한 버그(모드C 설계 검수 범위 밖, 구현 단계에서 발견)
- `buildTrack()`의 Web Audio 와이어링 catch 블록이 처음엔 `createGain()` 실패 시 이미 만든 `sourceNode`를 `destroyTrack()`에 `null`로 넘겨 `sourceNode.disconnect()`가 안 불리는 버그가 있었음(T3-16-feedback-6에서 이미 고쳤던 것과 같은 종류의 실수를 재구현 중 반복) — 신규 회귀 테스트(`트랙 하나 생성 중 실패`)로 실제로 잡아 `sourceNode`를 try 블록 밖에서 선언해 catch에서도 실제 참조를 넘기도록 수정. 자동 테스트로 검증 완료(아래 참고).

## QA 계획
- 자동 테스트: `trackPlayer.test.ts`에 `createAudioTrackPool()`이 이제 Promise를 반환하는 것에 맞춰 기존 테스트 전부 `await`로 갱신. blob URL 생성(`URL.createObjectURL`을 모킹)·`destroy()`의 `revokeObjectURL` 호출·부분 실패 시 이미 만든 blob URL 해제까지 신규 테스트.
- 브라우저 수동 검증: PC/Chromium으로 재생 버튼이 로딩 중엔 비활성화되고, 로딩 끝나면 눌려서 정상 재생되는지 확인.
- **의뢰인 재확인 포인트**: 맥에서 재생 버튼을 누르고 로딩 대기 시간이 실제로 어느 정도인지(체감 괜찮은지), 그리고 재생 중 네트워크 탭에 `stem` 요청이 **전혀** 안 뜨는지(이번 설계의 핵심 가설 — 이전 단계들과 달리 이번엔 "일부만 남는 정도"가 아니라 "0건"을 목표로 함).
