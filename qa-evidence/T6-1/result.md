> 한 줄 요약: T6-1(Phase 6, 모바일 성능 개선 v1.2) — 연습 화면 렌더 루프의 GC/연산 낭비 3건을 동작 변경 없이 수정. Codex 모드A 1차 REQUEST_CHANGES(C-001, 실제 버그) 반영 후 테스트 333개 전부 통과, 타입체크·린트 0건(새 오류 기준), 브라우저로 시각적 동일성 확인. 실기기 fps 재측정은 의뢰인 몫(T6-2).

# T6-1 결과

근거: `intent/05-todo.md` Phase 6 T6-1, `intent/07-open-questions.md` Q-33(재착수 섹션), REQ-06("60fps 목표(측정)").

## 구현 내용

1. **`app/web/src/render/laneRenderer.ts`** — `render()`가 매 프레임(최대 60회/초) 레인 8개 × 전체 노트를 전부 순회하던 것을, 레인별로 한 번만 필터링한 배열을 캐싱(`ensureLaneIndex`, 곡이 바뀔 때만 재구축)하고 `lowerBoundIndex()` 이진탐색으로 보이는 시간창만 순회하도록 변경. 실측(song 9 "Pretender", 노트 1,809개): 8×1809≈14,472회/프레임 → 보이는 노트 수(보통 수십 개) 수준으로 축소.
   - T3-15 모드A가 지적했던 "판정 허용범위가 그리기 가시창보다 넓어질 수 있는 극단적 BPM" 케이스를 그대로 보존 — 이진탐색 경계를 `min(windowStart, currentTime-hitWindow)` ~ `max(windowEnd, currentTime+hitWindow)`로 두 조건을 모두 포함하게 잡아, 원래 전체 스캔과 결과가 항상 동일함을 코드 주석으로 근거와 함께 남김.
2. **`app/web/src/features/practice/PracticeCanvas.tsx`** — 60fps 루프(`useEffect`의 `loop()`) 안에서 매 프레임 호출하던 `getMasterClock()`을 effect 시작 시 한 번만 호출하도록 호이스팅(`clock.ts` 확인 결과 Transport는 앱 전역 싱글턴이고 메서드들은 라이브 값을 읽으므로 동작 동일).
3. **`app/web/src/features/practice/PracticeCanvas.tsx`** — `readPieceColor()`가 보이는 노트마다 캐싱 없이 `getComputedStyle()`을 호출하던 것을, `Map<DrumPiece, string>` 캐시로 첫 호출만 실제로 읽고 이후 재사용하도록 변경. 이 앱에 라이트/다크 테마 전환 기능이 없음을 그렙으로 확인(`data-theme`/`prefers-color-scheme`/`setTheme` 전부 0건) — 재생 중 값이 바뀔 경로가 없어 캐싱 안전.

범위 밖(의도적으로 안 함): `getMasterClock()`의 다른 호출부(이벤트 핸들러 11곳 — 재생/일시정지/시크 등, 60fps 루프가 아니라 호출 빈도 낮음)는 손대지 않음 — 서브에이전트 코드 감사에서도 "낮은 우선순위"로 분류됨. `EditorScreen.tsx`는 별도의 자체 `readPieceColor()`를 갖고 있어(모듈 스코프 분리) 영향 없음(그렙으로 확인).

## 테스트

- `npm run test -- --run`: 25개 파일, 333개 테스트 전부 통과(신규 테스트 추가 없음 — 동작을 보존하는 순수 최적화라 기존 테스트가 곧 회귀 검증).
- `npx tsc --noEmit -p tsconfig.app.json`: 오류 0건.
- `npm run lint`(oxlint): 경고 4건 — 전부 이번 변경과 무관한 기존 경고(변경 전 `main`에서 `git stash`로 동일하게 재현해 대조 확인, `Drawer.tsx` 1건 + `PracticeCanvas.tsx` 기존 `exhaustive-deps` 3건, 둘 다 줄 번호만 내 변경으로 밀렸을 뿐 내용 동일).

## 브라우저 확인

Vite 개발 서버(5173, HMR)로 실제 로그인 계정(QA_AI)에서 "Pretender"(노트 1,809개) 재생 — 레인 머리글(HH/CR/SN/KK/HT/MT/FT/RD), 노트 색상(하이햇 노랑·스네어 주황빨강·킥 흰색 등 변경 전과 동일), 낙하 애니메이션, FPS 카운터(60 표시) 전부 정상 동작 확인. 콘솔 에러 0건.

## Codex 모드A 검수

- **1차**: REQUEST_CHANGES — **C-001(실제 버그로 확인·반영)**: 이진탐색+조기 종료가 "레인별 배열이 틱 오름차순"이라는 전제에 의존하는데, `EditorScreen.tsx`가 노트의 배열 내 위치는 그대로 두고 tick 값만 바꾸는 편집 경로가 있어(`toDrumScore()`가 그 순서를 그대로 보존) 편집 후 저장된 DrumScore가 실제로는 틱 오름차순이 아닐 수 있음 — 기존(T6-1 이전) 전체 스캔은 순서에 의존하지 않아 문제없었지만 이번에 추가한 이진탐색은 깨질 수 있었음. **수정**: `ensureLaneIndex()`가 `score.notes`의 원래 순서를 믿는 대신 레인별 배열을 만들 때 틱 기준으로 직접 정렬(`sort((a,b) => a.tick - b.tick)`)하도록 변경 — 원본 순서가 뭐든 상관없이 이 함수 자신이 전제를 보장. 곡이 바뀔 때 한 번만 하는 O(n log n) 정렬이라 매 프레임 비용과 무관. 수정 후 재검수 대기 중(2라운드).
  - Codex가 함께 확인(문제없음으로 보고): `ticksToSeconds`는 고정 BPM에서 틱에 선형 — 동일/음수 틱이어도(배열이 정렬돼 있다면) 탐색이 깨지지 않음. 포함 하한·`t > searchUpperBound` 조건은 경계 노트를 보존. 넓힌 탐색 경계는 그리기 가시창과 판정 허용범위(판정 허용범위가 음수인 경우 포함)를 모두 포함. 에디터는 항상 새 score 객체를 만들어 내려보내므로(제자리 변형 경로 없음) 참조 비교 캐시 무효화 자체는 문제없음. clock 래퍼는 캡처한 Tone transport를 통해 라이브 값을 읽음. 피스 색상 CSS 변수는 미디어 쿼리 오버라이드 없는 정적 `:root` 값.
- **2차**: **APPROVE**, 지적사항 없음 — 틱 기준 직접 정렬로 C-001이 완전히 해소됨을 확인(배열 순서가 틱 오름차순이 아니어도 이진탐색·조기종료가 정상 동작). 같은 레인에서 동일 틱을 가진 노트가 있으면 구버전 엔진에서 그리기 순서(z-order)가 달라질 수 있으나 두 노트 모두 스캔에는 포함되므로 겹침 시각 효과에만 영향, 정확성 문제 아님으로 확인. `getMasterClock()` 호이스팅·`readPieceColor` 캐싱도 추가 지적 없음.

## 한계

- 이 샌드박스 브라우저 환경은 실제 모바일 CPU를 대표하지 않음(프로젝트 전체에서 반복 확인된 제약) — 여기서 측정한 fps 숫자는 "기능이 정상 동작하는지"만 증명하고, 실제 모바일 fps 개선 여부는 증명하지 않음. **다음 단계(T6-2)**: 의뢰인 실기기 재측정 필요.
- 색상 캐싱(수정 3)은 "테마 전환 기능이 없다"는 전제에 의존 — 향후 테마 전환 기능이 추가되면 이 캐시도 함께 무효화하는 로직이 필요(현재는 해당 없음, 추가 시 재검토 필요 항목으로 기억해둘 것).
