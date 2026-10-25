> 한 줄 요약: T3-16(성능) QA 결과 — T3-15 적용 후에도 "체감 여전히 최악"이라는 의뢰인 재확인에 따라, `PracticeCanvas.tsx`의 "바뀐 것만 반영" 변경 감지 로직 자체가 매 프레임 배열 스프레드+map+sort+join으로 문자열을 새로 만들던 걸 할당 없는 Map 직접 비교로 교체. 타입체크/테스트/린트 통과, 브라우저로 재생·점등·리셋 정상 동작 확인(콘솔 에러 0건).

# T3-16 QA 결과

## 근거(REQ)
- REQ-06 "드럼 연습 화면" 수용 기준 "60fps 목표(측정)".
- T3-15로 `laneRenderer.ts`의 GC 병목을 수정해 실측 최대 CPU 108.5%→84%로 개선됐으나, 의뢰인이 Safari 실기기 프로파일러로 재측정 후 "체감 여전히 최악인 상태인데?"라고 재확인 — T3-15가 다루지 않은 추가 가비지 발생원을 계속 찾아야 함.

## 원인 (코드로 직접 확인)
`PracticeCanvas.tsx`의 `loop()`(requestAnimationFrame 콜백, 최대 60회/초)에서 T2-3 때 추가한 "활성 피스가 바뀔 때만 setState" 최적화 자체가 다음 코드로 **매 프레임 가비지를 생성**하고 있었음:
```js
const key = [...active.entries()]
  .map(([piece, hand]) => `${piece}:${hand ?? ''}`)
  .sort()
  .join(',')
if (key !== lastActiveKeyRef.current) {
  lastActiveKeyRef.current = key
  setActiveHandByPiece(active)
}
```
`setActiveHandByPiece`를 실제로 호출하는지와 무관하게, 매 프레임마다 (1) `[...active.entries()]`로 새 배열, (2) `.map()`으로 문자열 배열, (3) `.sort()`로 재배열된 새 배열, (4) `.join(',')`로 새 문자열 — 총 4단계의 할당이 일어남. T3-15에서 고친 GC 원인과 같은 패턴(매 프레임 불필요한 할당 → minor GC 압박)이며, 변경 감지 로직 자체가 변경 감지를 위해 가비지를 만드는 아이러니한 구조.

## 변경 내용 (`app/web/src/features/practice/PracticeCanvas.tsx`만 수정)
- `lastActiveKeyRef = useRef('')`(문자열 키 저장)를 `lastActiveMapRef = useRef<ReadonlyMap<DrumPiece, Hand>>(new Map())`(직전 프레임의 Map 자체를 보관)로 교체.
- 키 문자열 생성 대신, 크기 비교 + `for...of` 루프로 각 `[piece, hand]` 쌍이 직전 Map과 일치하는지 직접 비교(할당 없음, 중간에 다르면 즉시 break):
  ```js
  let activeChanged = active.size !== lastActiveMapRef.current.size
  if (!activeChanged) {
    for (const [piece, hand] of active) {
      if (lastActiveMapRef.current.get(piece) !== hand) {
        activeChanged = true
        break
      }
    }
  }
  if (activeChanged) {
    lastActiveMapRef.current = active
    setActiveHandByPiece(active)
  }
  ```
- `active`는 `laneRenderer.ts`의 `render()`가 매 프레임 새로 만들어 반환하는 `Map`(T3-15에서 의도적으로 풀링하지 않음 — React state로 들어가므로)이므로, `lastActiveMapRef.current = active`로 그 참조를 그대로 보관해도 안전(새 프레임엔 또 새 Map이 와서 비교 대상이 되므로 뮤테이션 위험 없음).
- `stopPlayback()`의 리셋 지점도 `lastActiveKeyRef.current = ''` → `lastActiveMapRef.current = new Map()`로 함께 교체.
- 동작(언제 `setActiveHandByPiece`를 호출하는지)은 원래와 완전히 동일 — 비교 방식만 "문자열 직렬화 후 비교"에서 "직접 값 비교"로 바뀜.

## 위험 분류
렌더 루프 내부의 변경 감지 로직만 교체, `setActiveHandByPiece`를 호출하는 조건(내용이 실제로 바뀔 때만)은 그대로 — 공개 동작·인터페이스 변화 없음. 오디오 타이밍은 건드리지 않아 모드C 불필요, 모드A 검수만 진행.

## 자동 테스트
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit
```
결과: 이 변경으로 인한 새 오류 0건. 기존에 알려진(T3-13에서 발견, Q-34) 테스트 파일 4건의 사전 존재 오류만 그대로 출력됨(`trackPlayer.test.ts` 2건, `EditorScreen.test.tsx`/`filterSongs.test.ts` 각 1건 이상, 전부 `available_audio_kinds` 필드 누락 관련 — 이번 작업과 무관).
```
npm run lint        # oxlint 통과, 경고 없음
npm test -- --run    # 17 test files / 197 tests 모두 통과
```

## 브라우저 수동 검증 (localhost:5174, huibigyocha 곡, PC/Chromium, 새로 연 탭에서 콘솔 확인)
1. 라이브러리 → huibigyocha 연습 화면 진입, UI 정상 렌더링(토글 버튼·FPS 표시·믹서 모두 T3-13/T3-14 그대로).
2. 재생 시작 → 노트 낙하·halo 외곽선·HH 킷 점등 정상 동작(스크린샷으로 확인), 콘솔 에러 0건.
3. ↺ 리셋 클릭 → 정상 정지·초기화(`lastActiveMapRef` 리셋 경로 포함), 콘솔 에러 0건.
- **한계**: 브라우저 패널이 백그라운드(hidden) 상태로 열려 있어 `requestAnimationFrame`이 스로틀됨 — 이 환경에서의 FPS 수치는 신뢰할 수 없음(패널 자체의 알려진 한계, T3-15 때와 동일하게 PC 환경에서는 GC 감소 효과를 수치로 비교 못함). 기능적 정확성(점등·렌더링·콘솔 에러 없음)만 이 환경에서 확인 가능 — 실제 fps/체감 개선은 의뢰인의 Safari 실기기 재측정으로만 확인 가능.

## 결론
"바뀐 것만 반영" 최적화 자체가 가비지를 만들던 역설적 상황을 할당 없는 직접 비교로 수정. T3-15와 같은 종류(렌더 루프의 불필요한 할당 제거)의 추가 GC 압박 감소 조치. 타입체크/테스트/린트 통과, 브라우저 기능 검증 완료. 의뢰인의 "체감 여전히 최악" 문제가 완전히 해소됐는지는 재측정 필요 — 미해소 시 `PracticeCanvas.tsx:540` 부근의 다른 할당(예: `TRACK_RESYNC_INTERVAL_MS` 폴링 블록 등)을 추가 조사해야 함(Q-33 갱신 예정).
