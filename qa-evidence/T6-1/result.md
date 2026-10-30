> 한 줄 요약: T6-1(Phase 6, 모바일 성능 개선 v1.2) — 연습 화면 렌더 루프의 GC/연산 낭비 3건을 동작 변경 없이 수정. 테스트 333개 전부 통과, 타입체크·린트 0건(새 오류 기준), 브라우저로 시각적 동일성 확인. 실기기 fps 재측정은 의뢰인 몫(T6-2).

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

## 한계

- 이 샌드박스 브라우저 환경은 실제 모바일 CPU를 대표하지 않음(프로젝트 전체에서 반복 확인된 제약) — 여기서 측정한 fps 숫자는 "기능이 정상 동작하는지"만 증명하고, 실제 모바일 fps 개선 여부는 증명하지 않음. **다음 단계(T6-2)**: 의뢰인 실기기 재측정 필요.
- 색상 캐싱(수정 3)은 "테마 전환 기능이 없다"는 전제에 의존 — 향후 테마 전환 기능이 추가되면 이 캐시도 함께 무효화하는 로직이 필요(현재는 해당 없음, 추가 시 재검토 필요 항목으로 기억해둘 것).
