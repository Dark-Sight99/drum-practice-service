> 한 줄 요약: T3-15(모바일 노트 낙하 버벅임 — 실제 원인 수정) QA 결과 — 의뢰인이 맥+아이폰을 USB로 연결해 Safari 웹 속성 관리자(실기기 프로파일러)로 직접 잡아낸 GC 병목을 수정(매 프레임 새 배열·객체·Set·Map을 만들던 걸 재사용/통합). 타입체크/테스트/린트 통과, 브라우저로 정상 동작 확인. 실기기 fps 재측정은 의뢰인 몫.

# T3-15 QA 결과

## 근거(REQ)
- REQ-06 "드럼 연습 화면" 수용 기준 "60fps 목표(측정)".
- T3-14(진단용 FPS 계측)로 모바일에서 24~46fps(60fps 미달)를 수치로 확인한 뒤, 원인을 추측하지 않고 의뢰인이 맥+아이폰을 USB로 연결해 **Safari 웹 속성 관리자(실기기 프로파일러)**로 직접 측정 — 이 세션 최초로 코드 추측이 아니라 실제 프로파일러 데이터로 원인을 확정한 사례.

## 프로파일링 과정 (의뢰인이 직접 수행, 스크린샷 다수로 확인)
1. 1차 가설(Tone.js 오디오 시계가 Worker 생성 실패로 메인 스레드로 샌 게 아닐까) → **기각**: 타이머 이벤트를 눌러 호출 스택을 열어보니 실제로 Worker(블롭 URL) 안에서 도는 Tone.js 설계대로의 50ms 틱이었고, 셀프 시간도 0.02~0.3밀리초로 무시할 수준 — Tone.js는 결백.
2. 메인 페이지 스레드로 전환 후 "셀프 시간" 기준 정렬 → **"부분 가비지 모음"(minor GC)이 2~8밀리초씩, 매우 빈번하게 반복**, "Message 이벤트를 발송함"(React 내부 스케줄러의 MessageChannel 디스패치, 위치가 `scheduler.development...`로 찍힘)도 최대 21.55밀리초 — 둘 다 "매 프레임 새 객체를 많이 만든다"는 공통 원인을 가리킴.

## 원인 (코드로 직접 확인)
`app/web/src/render/laneRenderer.ts`의 `render()`(매 프레임, 최대 60회/초 호출)가:
1. 보이는 노트마다 새 객체를 담은 **새 배열**(`visibleNotes: VisibleNote[] = []`)을 매번 생성.
2. 그와 별개로 `layout.ts`의 `activePieces()`/`activeHandByPiece()`를 호출 — 둘 다 `score.notes` **전체(994개, 이전 T3-14 조사로 확인)를 처음부터 다시 스캔**하며 매번 **새 `Set`/`Map`**을 생성.

결과: 매 프레임 (a) 노트 배열+객체 전체 재생성, (b) 994개 노트를 최대 3번(그리기용 1번 + activePieces/activeHandByPiece 각 1번) 스캔, (c) Set/Map 2개 추가 생성 — 전부 가비지이고, 그게 쌓여 GC가 빈번히 메인 스레드를 막아 "몇 프레임 멈췄다 건너뛰는" 체감 버벅임(T3-14 영상 분석에서 이미 확인한 패턴)으로 이어진 것으로 판단.

## 변경 내용 (`app/web/src/render/laneRenderer.ts`만 수정)
1. **노트 객체 풀링**: `visibleNotes` 배열을 매 프레임 새로 만드는 대신, `createLaneRenderer()` 레벨에 영구 배열(`visibleNotePool`)을 두고 `visibleNoteCount`만 매 프레임 리셋 — 기존 객체를 덮어써서 재사용한다. 이 데이터는 `render()` 밖으로 절대 안 나가므로(React state에 안 들어감) 재사용해도 안전.
2. **activePieces/activeHandByPiece 통합**: 별도로 `score.notes` 전체를 두 번 더 스캔하던 걸 없애고, 이미 돌고 있는 레인별 노트 루프 안에서 판정 허용범위(`hitWindowSeconds`) 체크를 같이 수행해 `Set`/`Map`을 채운다 — 그리기용 가시창(lookbehind+lookahead)이 판정 허용범위보다 항상 넓어서 이 루프 안에서 체크해도 놓치는 노트가 없음(코드 주석에 근거 명시). **단, 이 `Set`/`Map`은 호출자(`PracticeCanvas.tsx`)가 React state로 저장하므로 풀링하지 않고 프레임마다 새로 만듦** — 재사용하면 이미 state로 넘어간 이전 프레임 결과가 다음 프레임에 몰래 바뀌어버려 React의 불변성 전제를 깨는 버그가 되기 때문(이 구분을 명확히 의식하고 설계).
3. `layout.ts`의 `activePieces()`/`activeHandByPiece()` 순수 함수 자체는 그대로 둠(자체 테스트가 있고, API 변경이 아니라 "호출 안 함"으로만 바뀜 — 공개 API 변경 아님).

## 위험 분류
렌더링 루프 내부 구현만 바꾸고 `LaneRenderer`의 공개 인터페이스(`render()`의 인자·반환 타입)는 전혀 안 바뀜 — 호출자(`PracticeCanvas.tsx`)는 무수정. 다만 메인 스레드 성능/GC에 직접 영향을 주는 변경이라 신중하게 다룸(모드A 검수 진행, 오디오 타이밍 자체는 안 건드려 모드C는 불필요).

## 자동 테스트
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit   # 통과
npm test -- --run       # 17 test files / 197 tests 모두 통과(layout.ts의 activePieces/activeHandByPiece 자체 테스트도 그대로 통과 — 함수 자체는 무수정)
npm run lint             # oxlint 통과, 경고 없음
```

## 브라우저 수동 검증 (localhost:5174, huibigyocha 곡, PC/Chromium)
재생 시작 후 수 초간 관찰 — 노트 도형·halo·R/L(현재 꺼짐)·킷 점등 전부 기존과 동일하게 정상 렌더링(풀링된 객체가 겹치거나 잔상처럼 남는 등의 시각적 결함 없음), 콘솔 에러 0건. **한계**: 이 PC/Chromium 환경은 이미 여유롭게 60fps라 GC 감소 효과 자체를 수치로 비교하진 못함 — 실제 개선 폭은 의뢰인이 같은 Safari 프로파일러로 재측정해야 확인 가능.

## 결론
의뢰인이 Safari 실기기 프로파일러로 직접 잡아낸 GC 병목을 코드로 확인하고 수정. 추측이 아니라 프로파일러 데이터 기반 수정이라는 점에서 이번 세션의 다른 수정들과 결이 다름(기존엔 코드만 보고 가설을 세웠다가 실측으로 기각된 사례들이 있었음 — Q-33 참고). 실제 fps 개선폭은 의뢰인의 재측정 결과로 확정.
