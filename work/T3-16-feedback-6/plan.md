> 한 줄 요약: 재생 버튼을 누를 때마다 `<audio>` 엘리먼트를 새로 만들고 버리던 걸, 연습 화면이 떠 있는 동안은 재사용하도록 바꿔 재생 시작마다 전체 재다운로드가 일어나던 문제를 없애는 설계안. 모드C 1라운드 BLOCKING(비동기 prime() 경쟁 상태)을 unlocked를 풀 레벨 상태로 옮겨 구조적으로 해소, 2라운드 BLOCKING(reset()이 unlocked까지 리셋한다는 설명·설계 불일치)도 문구 수정으로 해소, 권장사항 전부 반영 — 3라운드(최대) 검수 전.

# T3-16-feedback-6 설계안 — 오디오 엘리먼트 재사용

## 근거(REQ)
REQ-04/05. T3-16-feedback-4(프리페치)·5(캐시 헤더)를 적용했는데도, 의뢰인이 맥 네트워크 탭으로 실측한 결과 **재생 버튼을 누를 때 실제 `<audio>` 엘리먼트가 만드는 Range 요청이 프리페치 캐시를 전혀 재사용하지 않고 매번 4트랙 전체를 처음부터 다시 받는다**는 걸 확인(Q-35). 원인: `trackPlayer.ts`의 `createTrackPlayer()`가 재생 세션(▶재생 누를 때)마다 `new Audio(url)`로 새 엘리먼트를 만들고, `stopPlayback()`이 매번 `tracks.dispose()`로 그 엘리먼트를 완전히 버림(`element.src = ''`) — 미디어 엘리먼트는 fetch() 캐시를 공유 안 하는 걸로 보여(실측, 브라우저 내부 동작이라 소스 확인 불가) 새 엘리먼트 = 새 다운로드가 됨.

## 현재 생명주기 (코드로 확인, `PracticeCanvas.tsx`)
- `handlePlay()`의 "새 세션" 경로(일시정지 재개가 아닌 경우): `stopPlayback()`(이전 세션 완전 폐기) → `createTrackPlayer()`(새 엘리먼트+Web Audio 그래프) → `tracks.prime()` → ... → `playbackRef.current = {...}`.
- `stopPlayback()`: `playbackRef.current.tracks?.dispose()` — `trackPlayer.ts`의 `dispose()`가 `element.pause(); element.src=''; gainNode?.disconnect(); sourceNode?.disconnect()`.
- `handlePause()`/`resume()`(Transport만): **tracks를 안 건드림** — 일시정지→재개는 이미 같은 엘리먼트를 그대로 씀(이 경로는 문제 없음, 확인 완료).
- `setChannelGain()`은 믹서 변경 시(L522)와 **매 세션 시작 시**(L931) 둘 다 호출됨 — 즉 세션마다 게인 값을 처음부터 다시 적용하므로, GainNode를 여러 세션에 걸쳐 재사용해도 "이전 세션의 게인이 새 세션에 스며드는" 문제는 없음(실제 호출 지점 확인).

## 설계
### 1. 소유권 이전
`<audio>` 엘리먼트(+iOS에서만 필요한 `sourceNode`/`gainNode` Web Audio 와이어링)를 "재생 세션"이 아니라 "연습 화면에 이 곡이 떠 있는 동안"으로 소유권을 옮긴다.

- `trackPlayer.ts`에 새 함수 `createAudioTrackPool(sources: TrackSource[]): AudioTrackPool` 추가. 이게 지금 `createTrackPlayer()` 안에서 하던 `new Audio(url)` + (iOS면) `createMediaElementSource()`/`createGain()` 와이어링을 **한 번만** 수행하고 보관한다. `AudioTrackPool`은 `{ get(kind): TrackState | undefined, destroy(): void }` 정도의 작은 인터페이스.
- `createTrackPlayer(pool: AudioTrackPool): TrackPlayer`로 시그니처 변경 — 더 이상 `sources`를 안 받고, 이미 만들어진 pool에서 트랙 상태를 읽어다 세션 동작(prime/playFrom/seekTo/resync/setChannelGain/pause/resume/stop)만 구현한다. **엘리먼트·Web Audio 노드를 직접 만들거나 지우지 않는다.**
- `TrackPlayer.dispose()`의 의미를 바꾼다 — 지금처럼 엘리먼트를 파괴하는 게 아니라 **"이번 세션 정리"**(일시정지 + `currentTime=0` + `started`만 리셋)만 한다. **`unlocked`는 건드리지 않는다**(아래 모드C 1라운드 C-001 반영 참고 — 풀 레벨 상태로 옮겨서 세션 정리와 무관하게 유지됨, 2라운드 C-005 지적으로 이 문단과 아래 섹션의 불일치를 바로잡음). 이름도 혼동 방지를 위해 `reset()`으로 바꾸는 걸 제안(검수에서 확정).
- `PracticeCanvas.tsx`에 `audioTrackPoolRef = useRef<AudioTrackPool | null>(null)` 추가. `songId`/`availableAudioKinds`(가입 당시 한 번 정해지고 안 바뀌는 메타데이터)가 바뀔 때 도는 `useEffect`에서 `createAudioTrackPool(...)`로 새 pool을 만들고, **그 effect의 cleanup에서 `pool.destroy()`**(진짜 파괴 — `element.src=''`, 노드 disconnect)를 호출한다. 지금 있는 "재생 전 프리페치" `fetch()` 이펙트(T3-16-feedback-4)는 이 pool 생성으로 대체(진짜 재생용 엘리먼트 자체가 `preload="auto"`로 미리 버퍼링하므로 더 정확한 프리페치가 됨).
- `handlePlay()`는 `createTrackPlayer(stemKinds.map(...))` 대신 `createTrackPlayer(audioTrackPoolRef.current)`를 호출(pool이 없으면 — 아직 준비 안 됐거나 `canUseAudioTracks`가 false면 — 지금처럼 `tracks = null`).
- `stopPlayback()`의 `playbackRef.current.tracks?.dispose()`를 `?.reset()`으로 변경(엘리먼트는 그대로 둠).

### 2. `createMediaElementSource()` 1회 제약 처리
스펙상 한 엘리먼트에 `createMediaElementSource()`를 두 번 부르면 `InvalidStateError`. Pool이 엘리먼트당 이 호출을 **정확히 한 번**만 하고(`createAudioTrackPool()` 내부, 엘리먼트 생성 직후) 그 결과(`sourceNode`/`gainNode`)를 계속 들고 있다가 매 세션(`createTrackPlayer(pool)`)마다 재사용하므로, 이 제약을 구조적으로 지킴(세션이 몇 번을 돌아도 같은 엘리먼트에 이 호출이 두 번 안 일어남).

### 3. 영향받는 다른 코드
- `TrackPlayer` 인터페이스 자체(`prime/playFrom/seekTo/resync/setChannelGain/pause/resume/stop`)는 동작·시그니처 그대로 — `dispose`만 `reset`으로 이름·의미 변경.
- `scorePlayer.ts`(`playDrumScore`)가 `tracks` 인자를 어떻게 쓰는지는 이번 변경과 무관(그대로 `TrackPlayer` 인터페이스로 받음).
- 테스트: `trackPlayer.test.ts`가 `createTrackPlayer(sources)`를 직접 호출하는 기존 테스트 전부 `createAudioTrackPool(sources)` → `createTrackPlayer(pool)` 2단계로 바꿔야 함(상당수 재작성 필요).

## 모드C 1라운드 BLOCKING(C-001) 반영 — `prime()`을 세션 단위가 아니라 풀 단위로 옮김

**지적 내용**: `prime()`은 각 엘리먼트의 `play()`가 끝날 때까지 비동기로 진행하고 완료 후 `track.unlocked`를 쓴다. 풀을 세션 간 재사용하면, 취소된(이전) 세션의 `prime()`이 새 세션의 `prime()`/`reset()`보다 **늦게** 끝나면서 `unlocked`를 되돌려 쓸 수 있고, `pool.destroy()`와도 경합할 수 있다.

**해결**: 세대 토큰을 별도로 추가하는 대신, 애초에 세션마다 `prime()`을 다시 부를 필요가 없다는 사실을 구조에 반영한다 — 기존 `resume()`의 주석이 이미 명시하듯("이미 한 번 사용자 제스처 안에서 성공적으로 재생된 엘리먼트는 이후 play()가 '블레스'된 상태로 유지되는 게 표준 동작") 언락은 **엘리먼트 수명 전체에 1번**만 의미가 있다. 그래서:

- `unlocked`를 세션(`TrackPlayer`)이 아니라 **풀(`AudioTrackPool`) 레벨 상태**로 옮긴다 — 한 번 `true`가 되면 그 풀이 살아있는 동안 계속 `true`(세션이 몇 번을 돌든 다시 안 풂).
- `pool.prime()`(세션의 `prime()`이 아니라 풀의 메서드로 이동): 이미 모든 트랙이 언락됐으면 **진짜 play()/pause() 재시도 없이** 즉시 캐시된 결과를 반환(no-op). 진행 중인 prime이 있으면(겹친 호출 — 예: 사용자가 재생을 빠르게 두 번 누름) **그 Promise를 그대로 재사용**해 중복으로 같은 엘리먼트에 `play()`를 또 걸지 않는다.
- 비동기 `play()`가 끝나 결과를 쓰기 직전, `if (pool.destroyed) return`(또는 그 트랙만 건너뜀) 가드를 추가 — 화면을 떠나 풀이 파괴된 뒤에 늦게 도착한 결과가 이미 없는 엘리먼트에 쓰이는 걸 막는다.
- 결과: "오래된 세션의 결과가 새 세션을 덮어쓰는" 경로 자체가 구조적으로 없어짐(세션마다 새로 prime하지 않으므로 "여러 세대의 prime이 동시에 돈다"는 전제 자체가 사라짐) — 덤으로 **두 번째 재생부터는 언락 왕복(play+pause)도 생략**돼 재생 시작이 더 빨라짐.
- `TrackPlayer.prime()`(세션 레벨)은 이제 풀의 캐시된 `unlocked` 상태를 각 트랙에서 읽어오기만 하는 얇은 래퍼로 남긴다(호출자인 `handlePlay()` 쪽 코드는 안 바뀜 — `await tracks.prime()` 그대로 호출 가능, 내부적으로 즉시 resolve될 뿐).

## 모드C 1라운드 권장사항 반영

- **C-002(게인 적용 시점)**: `setChannelGain()`은 지금처럼 **매 세션 시작 시**(`handlePlay()`의 `tracks?.setChannelGain(key, gain)` 호출, 변경 없음) 계속 적용된다 — 풀이 세션보다 먼저 만들어져도, 그 시점엔 아직 세션이 없어 게인을 적용할 대상(`TrackPlayer`)이 없을 뿐이고, 첫 세션이 시작되는 순간 기존과 동일하게 현재 믹서 값이 전부 다시 적용되므로 "첫 재생 전 믹서 조정이 반영 안 되는" 문제는 없음(명시적으로 QA 항목에 포함).
- **C-003(정리 중 예외 안전성)**: `reset()`/`pool.destroy()` 둘 다 트랙 배열을 순회하며 **트랙 하나당 독립적으로 try/catch**로 감싸, 한 트랙에서(`currentTime` 대입이 미디어 준비 전이라 던지는 등) 예외가 나도 나머지 트랙 정리가 중단되지 않게 한다. `destroy()`는 트랙마다 `element.pause()`(소리부터 끔) → `sourceNode?.disconnect()`/`gainNode?.disconnect()` → `element.src = ''` 순서로, 앞 단계가 실패해도 다음 트랙으로 넘어감.
- **C-004(프리페치 효과 미검증)**: 계획서에 "`preload=auto`가 재다운로드를 막아준다"고 단정하지 않고, **실측으로 검증할 가설**로 표현을 낮춤. QA 계획에 "재생→리셋→재생을 반복했을 때 두 번째부터 네트워크 탭에 새 요청이 없는지"를 의뢰인의 실기기 확인 항목으로 명시(아래 QA 계획에 반영).

## 모드C 2라운드 BLOCKING(C-005) 반영 — `reset()`이 `unlocked`를 안 건드리게 문서 불일치 수정

**지적 내용**: 위 "설계" 섹션(수정 전 문구)이 `reset()`에서 `started`**와 `unlocked`** 둘 다 세션 로컬 상태로 리셋한다고 적어서, 바로 아래 C-001 반영 섹션의 "`unlocked`는 풀 레벨 상태로 옮겨 세션 재생성과 무관하게 유지"라는 설계와 서로 모순됨 — 설명과 설계가 어긋나 있었음.

**해결**: 위 "설계" 섹션의 해당 문장을 수정해 `reset()`은 **`started`만** 리셋하고 `unlocked`는 전혀 건드리지 않는다고 명시함(이번 수정 반영). `TrackState`의 `started`(이번 세션에서 실제로 playFrom()이 불렸는지 — 세션마다 다시 `false`로 시작해야 맞음, T3-6 원래 의도)와 `unlocked`(이 엘리먼트가 프로그램적 `play()`를 허락받았는지 — 풀 수명 전체의 속성)는 **서로 다른 레벨의 상태**라는 걸 명확히 구분: `started`=세션 스코프(매번 리셋), `unlocked`=풀 스코프(세션을 넘어 유지).

## 모드C 2라운드 권장사항 반영

- **C-006("블레스된 상태가 영원히 유지된다"는 가정이 브라우저/상황에 따라 깨질 수 있음)**: 이미 존재하는 `playFrom()`의 에러 처리(`play()`가 거부되면 `track.unlocked = false`로 되돌리고 `element.pause()`)를 그대로 활용 — 어떤 세션에서든 `play()`가 실제로 거부되면 풀 레벨 `unlocked`가 즉시 `false`로 내려가고, **다음 세션의 `pool.prime()`은 "이미 unlocked면 생략" 조건이 더 이상 성립하지 않으므로 자동으로 진짜 재언락(play+pause 재시도)을 다시 수행**한다 — 별도 코드 추가 없이 기존 실패 처리와 새 캐시 조건의 조합만으로 자연스럽게 "필요하면 다시 prime"이 보장됨. 다만 이 가정(한 번 블레스되면 유지) 자체가 모든 브라우저에서 보장된다는 공식 근거는 없다는 걸 계획에 명시하고, QA 단계에서 실제 PC/맥 브라우저로 "재생→리셋→재생"을 여러 번 반복해 매번 정상 재생되는지(중간에 소리가 전혀 안 나는 회귀가 없는지) 실측으로 확인하는 항목을 추가(QA 계획에 반영).

## 모드C 3라운드(최대) 지적 반영 + 마스터 최종 판단

3라운드가 이 프로젝트 규칙상 설계 검수의 마지막 라운드(`CLAUDE.md` §2 "Codex Mode C 설계 리뷰, capped at 3 rounds")라, 아래 두 지적은 마스터(이 문서를 작성한 모델 자신)가 직접 판단·반영하고 4라운드 재검수 없이 구현으로 넘어간다.

- **BLOCKING(C-007) — "`unlocked`를 풀 레벨로 옮긴다"는 표현이 "풀 전체에 불리언 하나"로 오해될 수 있었음, 트랙별 독립 상태임을 명시**: 원래 코드도, 이번 설계도 `unlocked`는 **애초부터 트랙 하나하나(`TrackState`)마다 따로 있는 필드**다(스템 중 하나만 언락 실패하고 나머지는 성공하는 경우가 실제로 가능 — 현재 `prime()`의 `Promise.all(tracks.map(...))` 구조 자체가 이미 그렇게 동작함, 변경 없음). "풀 레벨로 옮긴다"는 건 **이 트랙별 상태를 담는 `TrackState` 객체 자체를 세션마다 새로 안 만들고 풀이 계속 들고 있는다**는 뜻이지, 풀 전체를 대표하는 새로운 단일 불리언을 만든다는 뜻이 아니다 — 그러니 "track의 변경이 pool 상태에 어떻게 반영되는지"는 애초에 **별도 동기화가 필요 없다**: `playFrom()`의 catch가 `track.unlocked = false`로 쓰는 그 `track` 객체가 곧 풀이 보관 중인 바로 그 객체이므로(참조 공유, 복사 없음), 쓰는 순간 풀의 기록도 바로 바뀐다. `pool.prime()`도 지금의 `prime()`과 똑같이 **트랙마다 독립적으로** "이미 `unlocked`면 생략, 아니면 재시도"를 판단 — 여러 트랙 중 하나만 거부돼도 그 트랙만 다음 세션에서 재언락을 시도하고 나머지는 그대로 생략됨(집계 판단 불필요). 설계 문서 §1·C-001·C-006 전체에 걸쳐 이 "트랙별 독립, 객체 참조 공유로 자동 동기화"를 명시적으로 추가 기술한다(구현 시 `AudioTrackPool`이 `Map<kind, TrackState>`를 직접 들고 있고 세션은 그 참조를 그대로 읽는 구조로 작성해 이 성질이 코드 구조로도 보장되게 한다 — 복사본을 만들면 이 성질이 깨지므로 구현 시 반드시 주의).
- **Medium(C-008) — `createAudioTrackPool()` 생성 도중 일부 트랙만 만들고 실패하는 경우의 정리**: `createAudioTrackPool()` 전체를 try/catch로 감싸, 트랙 생성 루프 중 하나라도(`new Audio()`, iOS의 `createMediaElementSource()`/`createGain()` 등) 던지면, **그때까지 이미 만든 트랙들만** `destroy()`와 같은 트랙별 정리(일시정지 → 노드 disconnect → `src=''`, C-003의 개별 try/catch 패턴 재사용)를 수행한 뒤 **예외를 다시 던진다**(호출자가 실패를 알아야 함 — 조용히 삼키지 않음). `PracticeCanvas.tsx`의 pool 생성 effect는 이 예외를 catch해 `audioTrackPoolRef.current = null`로 두고(화면 자체는 안 깨짐, 콘솔 경고만 남김) — `handlePlay()`가 보는 "pool이 없음"은 기존에 이미 있던 `canUseAudioTracks=false`(MIDI-only 등) 경로와 같은 모양이라 별도 새 분기 없이 자연스럽게 "오디오 트랙 없이 신스만 재생"으로 폴백된다(완전히 새 에러 처리 경로를 안 만들어도 됨 — 기존 폴백 재사용).

**마스터 최종 판단**: 두 지적 모두 "설계 자체가 틀렸다"기보다 "문서가 암묵적으로 전제한 걸 명시 안 했다/엣지 케이스 처리를 안 적었다"는 성격이라, 위처럼 명확화·추가하는 것으로 충분히 해소된다고 판단— 추가 구조 변경 없이 **진행 가능**으로 확정하고 구현으로 넘어간다.

## 위험·확인 필요 사항(모드C 검수 요청 사항, 1라운드 이후 잔존)
1. **Pool을 언제 만들지 타이밍**: 지금 프리페치 이펙트처럼 `songId`가 생기자마자 만들면, `canUseAudioTracks`(=`score.audioOffsetMs === 0 && stemKinds.length > 0`) 조건과 별개로 일단 만들어버리는 셈인데, 이게 안전한지(예: MIDI-only 곡에서 불필요한 엘리먼트를 만드는 낭비가 생기진 않는지 — `stemKinds.length===0`이면 애초에 만들 게 없으므로 자연히 no-op일 것으로 예상, 확인 필요).
2. **`reset()`이 Web Audio 그래프를 그대로 두는 게 정말 안전한지**: 세션이 끝나고 다음 세션 시작 전까지 `gainNode`가 `destination`에 계속 연결된 채로 남아있는데, `element.pause()` 상태라 소리는 안 나지만 "연결은 돼 있는 채로 오래 방치"가 메모리/성능에 문제 없는지(소규모 앱이라 큰 문제는 아닐 걸로 보이나 명시적으로 검수받고 싶음).
3. **unmount/song 변경 시 pool.destroy() 타이밍과 재생 중 세션의 상호작용**: 사용자가 재생 중에 곡을 바꾸거나 화면을 벗어나면, `stopPlayback()`(세션 reset)과 `pool.destroy()`(진짜 파괴) 둘 다 불릴 수 있는데 순서·중복 호출이 안전한지(예: `pool.destroy()`가 이미 `reset()`된 상태의 엘리먼트에 불려도 괜찮은지 — `element.pause()`를 이미 멈춘 엘리먼트에 또 불러도 안전함은 스펙상 보장되나, `sourceNode.disconnect()`를 이미 끊긴 노드에 또 부르는 것도 안전한지 확인 필요).
4. **테스트 재작성 범위**: `trackPlayer.test.ts`의 상당 부분이 `createTrackPlayer(sources)` 직접 호출 패턴이라, 이번 변경으로 대부분 2단계 호출(`createAudioTrackPool` + `createTrackPlayer`)로 바뀌어야 함 — 회귀 누락 없이 전부 갱신할 것.
5. **iOS 분기(`isIOS()`)와의 상호작용**: pool이 엘리먼트를 만들 때 iOS 여부를 판별해 Web Audio 와이어링을 할지 결정하는데, 이 판별이 pool 생성 시점(화면 진입)에 한 번만 일어나는 게 맞는지(재생 세션 시작 시점이 아니라) — 플랫폼이 화면을 보는 도중 바뀔 리는 없으므로 문제없을 것으로 보이나 명시적으로 확인.

## QA 계획
- 자동 테스트: `trackPlayer.test.ts` 전면 갱신(pool 생성 1회 + 세션 N회 생성 시나리오, `createMediaElementSource` 호출 횟수가 트랙당 정확히 1번인지 검증하는 테스트 신규 추가).
  - C-001 반영 회귀 테스트: 느린(아직 안 끝난) 1차 `prime()`이 진행 중일 때 2차 `prime()` 호출이 같은 Promise를 재사용하는지, 1차가 늦게 끝나도 이미 `destroy()`된 풀엔 쓰지 않는지(mock으로 타이밍 제어해 검증).
  - C-003 반영 회귀 테스트: 트랙 하나의 `currentTime` 대입이 던지도록 mock했을 때도 `reset()`/`destroy()`가 나머지 트랙은 정상 정리하는지.
  - C-006 반영 회귀 테스트: 어떤 세션에서 `play()`가 거부돼 `unlocked`가 `false`로 내려간 뒤, 다음 세션의 `prime()`이 실제로(캐시 생략 없이) 다시 play()+pause()를 시도하는지.
- 브라우저 수동 검증: PC/Chromium으로 재생→리셋→재생을 **여러 번** 반복해 매번 정상 재생되는지(C-006 — "한 번 블레스되면 영원히 유지"라는 가정이 깨져 중간에 소리가 전혀 안 나는 회귀가 없는지), 콘솔 에러 없는지 확인. 로그인 자격증명이 없어 실제 맥 네트워크 효과(두 번째 재생부터 네트워크 요청이 없는지) 확인은 의뢰인 몫.
- **의뢰인 재확인 포인트(C-004, 이 설계의 핵심 가설 검증 — 단정하지 않고 실측으로 확인)**: 재생→리셋→재생을 반복했을 때 두 번째부터는 네트워크 탭에 `stem` 요청이 전혀 안 뜨는지. 만약 여전히 뜬다면(`preload=auto`만으로는 브라우저가 버퍼를 안 지킨다는 뜻) 이 설계도 기대한 효과를 완전히는 못 낼 수 있음 — 그 경우 추가 조사 필요.
