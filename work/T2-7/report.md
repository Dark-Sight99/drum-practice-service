> 한 줄 요약: 스티킹(R/L/RF/LF) 자동 추천(REQ-12) — 피스별 규칙, 동시타 스네어, 필인 구간 교대를 코드 상수로 분리한 순수 함수(`score/sticking.ts`)로 구현. 편집기에 다중선택(Ctrl+클릭)+RLRL/LRLR 일괄 교대, 노트별 R/L/RF/LF 지정, "자동 추천 재적용" 추가 — 사용자 지정값은 재분석해도 절대 안 바뀜을 테스트·수동 QA로 모두 확인. 연습 화면 레인·킷에 R/L 표시 켜기/끄기 추가. DB 스키마·공개 API 변경이 없어 Codex 모드C는 생략(위험 작업 아님, T2-1~T2-3과 같은 패턴).

# T2-7 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/src/score/sticking.ts`(신규) | `recommendSticking`(전체 재분석)·`alternateHandsByTick`(다중선택 교대) 순수 함수, 규칙은 코드 상수(`STICKING_PIECE_RULES`, `FILL_RUN_MAX_GAP_DIVISOR`)로 분리 | REQ-12 |
| `app/web/src/score/sticking.test.ts`(신규) | 테스트 13개 | work/T2-7/plan.md 테스트계획 |
| `app/web/src/score/index.ts` | 위 함수·상수 export 추가 | — |
| `app/web/src/render/layout.ts` | `activeHandByPiece()` 추가(기존 `activePieces()`는 시그니처 유지 — 회귀 없음) | REQ-12 |
| `app/web/src/render/layout.test.ts` | `activeHandByPiece` 테스트 3개 추가 | — |
| `app/web/src/render/laneRenderer.ts` | `render()` 반환 타입 확장(`{activePieces, activeHandByPiece}`), `showSticking` 파라미터, 노트 위 R/L 글자 그리기(자동=반투명) | REQ-12, intent/08-design.md §3 |
| `app/web/src/render/KitIllustration.tsx` | `activePieces` prop → `activeHandByPiece`+`showSticking`로 교체, L/LF는 점선 테두리 | REQ-12, intent/08-design.md §3 |
| `app/web/src/features/practice/PracticeCanvas.tsx` | "R/L 표시" 체크박스(기본 켜짐) 추가, 상태를 Map 기반으로 교체 | REQ-12 |
| `app/web/src/features/editor/EditorScreen.tsx` | 선택 모델을 단일→다중(`Set<number>`)으로 확장, Ctrl/Cmd+클릭 토글, 노트별 R/L/RF/LF 지정+지우기 버튼, "필인 시작손" select, "자동 추천 재적용" 버튼, "RLRL/LRLR 교대" 버튼, 노트 위 손 라벨 표시 | REQ-12 |
| `app/web/src/features/editor/EditorScreen.test.tsx` | 테스트 6개 추가 | — |
| `app/server/api/schemas.py` | `DrumNoteIn.handSource` 필드 추가(검증 공백 메우기, 저장 동작 무변경) | REQ-12 |
| `app/server/tests/test_songs_editor_api.py` | 테스트 2개 추가 | — |

## 범위 결정
`work/T2-7/plan.md` §범위 — "하이햇 페달→LF" 자동 규칙은 현재 9종 `DrumPiece` 분류에 대상 피스가 없어 구현 안 함(Q-22 신규 등록, 추측으로 새 피스를 만들지 않음). 왼손잡이 레인 반전, 편집기 다중선택 이동/삭제/셈여림 일괄 적용(교대만 요구됨), 가져오기 단계의 원본 스티킹 표기 반영은 전부 범위 밖으로 plan.md에 명시.

## 위험 작업 여부 판단(Codex 모드C 생략 근거)
`intent/06-pipeline.md` §1-1의 위험 작업 기준(인증·권한, 오디오 타이밍·동기, DB 스키마·마이그레이션, 외부 모델·라이선스 변경, 공개 API 변경, 오프라인 캐시·세션) 중 해당 사항 없음을 plan.md에서 확인 — 새 라우트 없음, DB 테이블/컬럼 변경 없음(DrumScore는 JSON 파일 통짜 저장), 마스터 클록·스케줄링 무변경. `DrumNoteIn.handSource` 추가는 기존 검증 범위를 넓히는 것뿐이고 실제 저장은 원본 바이트 그대로(재직렬화 안 함)라 동작 자체는 T2-5/T2-6 때부터 이미 통과·보존돼 왔음을 코드로 재확인했다. **T2-1~T2-3(순수 프론트 작업)과 같은 패턴으로 모드C 생략 → 구현 → 모드A/B만 적용.**

## 구현 근거 (실행 결과로 확인)
- **필인 교대 알고리즘**: 필인(연속 스네어/탐) 구간은 "틱 간격이 `ppq/FILL_RUN_MAX_GAP_DIVISOR`(=16분음표) 이내로 연속되는 구간"으로 정의하고, 구간 내 **위치**(0부터)로 교대를 계산한다 — `handSource==='user'`로 고정된 노트도 위치 계산(간격 측정)에는 포함하되 그 노트 자체의 값은 건드리지 않음. 단위 테스트로 "user 고정 노트를 사이에 끼워도 이웃의 교대 리듬이 안 흐트러짐"을 직접 검증(`still advances the fill position past a user-locked note for its neighbors`).
- **"같은 박에 치는 스네어 → L"**: 디지털 악보(MIDI/MusicXML/GP)는 이미 양자화돼 있어 미세 타이밍 차이가 없다는 전제로 "같은 박" = "정확히 같은 틱"으로 해석(plan.md §가정). 오디오 경로(Phase 3)는 범위 밖.
- **"자동 결과보다 사용자가 직접 지정한 값이 항상 우선, 재분석해도 덮어쓰지 않음"(REQ-12 핵심)**: `recommendSticking`이 `handSource==='user'`인 노트를 순회 중 **그대로 패스스루**하는 구조로 구현 — "덮어쓰지 않는 예외 처리"가 아니라 애초에 덮어쓸 경로 자체가 없음. 단위 테스트(`recommendSticking`을 같은 데이터에 두 번 호출해도 user 값이 그대로)와 실제 브라우저 수동 QA(단일 지정 후 "자동 추천 재적용"을 다시 눌러도 그 노트만 유지됨) 둘 다로 확인.
- **킷 점등 테두리 실선/점선**: `isDashedHand(hand)`가 L/LF만 점선으로 분류 — `intent/08-design.md` §3 "오른손 실선/왼손 점선"을 R/RF(오른쪽)·L/LF(왼쪽)로 자연스럽게 확장한 해석(발 포함, plan.md §설계 3 가정). 실제 브라우저에서 왼손으로 친 스네어가 점등되는 순간 점선 테두리로 렌더링됨을 스크린샷으로 확인.
- **레인·킷 기존 동작과의 회귀 없음**: `activePieces()`(기존 함수, `layout.test.ts` 테스트 그대로 유지)는 시그니처를 안 건드리고, `activeHandByPiece()`를 별도로 추가 — `LaneRenderer.render()`의 반환 타입만 `Set<DrumPiece>` → `{activePieces, activeHandByPiece}`로 확장했는데, 이 타입을 쓰는 곳은 `PracticeCanvas.tsx` 하나뿐임을 grep으로 확인 후 진행(전용 테스트 파일 없음). "R/L 표시" 토글을 끄면 레인 글자 안 그림 + 킷은 점선 없이 항상 실선 — T2-3 때와 동일한 모양으로 복귀함을 수동 QA로 확인.
- **편집기 다중선택이 기존 단일선택 동작을 깨지 않음**: 일반 클릭(수정키 없음)은 "교체"(기존 동작 그대로), Ctrl/Cmd+클릭만 "토글"(신규) — 기존 `EditorScreen.test.tsx`의 10개 테스트가 수정 없이 그대로 통과함으로 회귀 없음을 확인, 수동 QA에서도 일반 클릭 연속 2회가 다중선택을 만들지 않음을 별도 확인.
- **백엔드 `handSource` 검증 공백 메우기**: 업로드(`POST /songs`)·저장(`PUT /songs/{id}/drumscore`) 둘 다 Pydantic 검증은 통과 여부 판단에만 쓰고 저장은 원본 바이트 그대로임을 코드로 재확인(T2-5/T2-6과 동일 원칙) — `handSource` 필드가 선언에 없어도 실제로는 이미 통과·보존돼 왔다는 걸 실제 저장→재조회 테스트(`test_save_accepts_and_round_trips_hand_source`)로 증명. 추가하는 이유는 `handSource: "bogus"` 같은 값도 조용히 통과시키던 공백을 메우기 위함(새 테스트로 422 거부 확인).

## Codex 모드A(독립 코드 검수) 반영
판정: 지적 없음(깨끗함) — "스티킹 추천·사용자 override·일괄 교대·연습 화면 표시를 명백한 정합성 결함 없이 구현했고, 추가된 테스트가 주요 동작과 서버측 `handSource` 검증을 커버한다"는 평.

원문: `qa-evidence/T2-7/codex-modeA.md`

## Codex 모드B(보고서 대조) 반영 — 3회(최대)
**1회차: needs-attention.** 서버 접근 로그는 PUT 3건의 총횟수만 증명하고, "어느 PUT이 어느 조작인지"·"정리 후 175개 노트 전부 hand:null"이라는 서술형 주장까지는 로그만으로 뒷받침되지 않음(medium) — PASS 판정이 증거 범위보다 강하다는 지적.
→ "정리"(최종 상태) 주장을 완전히 별도의 새 서버 세션에서 재조회한 실제 응답 본문(`response-body-after-cleanup.json`, `handSource` 0건·non-null hand 0건을 파일 자체에서 직접 확인 가능)으로 교체, 그 검증 세션의 GET-only 로그도 함께 커밋. PUT 귀속 서술은 "로그로 증명되지 않는, 수행 당시 설명"이라고 result.md에 명시해 로그가 증명하는 것(건수·최종 상태)과 서술(어느 PUT이 어느 조작인지)을 구분.

**2회차: needs-attention.** 1차에서 추가한 응답 본문·GET-only 로그가 "같은 요청"인지(세션·응답 상관관계) 두 파일만으로는 여전히 대조할 수 없다는 재지적(medium) — 타임스탬프도 요청 식별자도 없었기 때문.
→ 서버 로그에 UTC 타임스탬프(밀리초)를 붙이고, 같은 브라우저 실행 안에서 요청 전후 시각과 응답 본문의 SHA-256을 함께 캡처 → 로그의 `GET /songs/2/drumscore` 줄(09:04:56.639Z)과 브라우저 측 `afterTimestamp`(09:04:56.615Z)가 37ms 이내로 유일하게 대응함을 보이고, 커밋된 JSON 파일(개행 1바이트 제외)의 SHA-256이 브라우저가 계산한 해시와 정확히 일치함을 확인 — `cleanup-verification-correlation.md`로 문서화. 1차의 비-타임스탬프 로그는 삭제하고 2차 산출물로 완전히 대체.

**3회차(최대 횟수): needs-attention.** 시간 근접성+해시만으로는 "같은 요청"을 수학적으로 증명 못 한다는 지적(medium) — 서버가 요청 ID나 응답 본문 해시를 자체적으로 로깅하지 않는 한 원천적 한계이고, 이를 완전히 없애려면 FastAPI 앱에 요청 추적 로깅을 추가해야 해(별도 작업 범위) `06-pipeline.md` §1-1 "재검수 최대 3회" 규칙에 따라 모드B는 3회에서 종료.
→ Codex가 Recommendation에서 직접 제시한 대안 표현("시간상 일치하는 유일한 후보이며 본문 해시는 파일과 일치")을 그대로 채택해 `cleanup-verification-correlation.md`·`result.md`의 "증명했다"/"유일하게 대응" 표현을 수정 — 수학적으로 확정되는 것(SHA-256 일치)과 정황 증거로만 뒷받침되는 것(로그-응답 상관관계)을 문장 단위로 구분.

원문: `qa-evidence/T2-7/codex-modeB.md`, `-2.md`, `-3.md`

## 실행한 검증
`qa-evidence/T2-7/result.md`, `raw_log.txt` — 프론트 tsc/oxlint/vitest(129/129), 백엔드 ruff/pytest(79/79) 전부 PASS. 실제 FastAPI 서버+브라우저로 자동 추천(피스 규칙·동시타·필인 교대)·사용자 지정 보존·다중선택 RLRL 교대·저장→연습 화면 R/L 표시(레인 글자+킷 실선/점선) 켜기/끄기까지 end-to-end 확인. 서버 접근 로그 전체(21줄, 프로세스 종료까지)와, 별도 검증 세션에서 재확인한 최종 데이터 상태(응답 본문 그대로 커밋)를 증거로 남겼다.
