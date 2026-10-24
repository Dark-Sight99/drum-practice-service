> 한 줄 요약: T2-7 — 스티킹(R/L/RF/LF) 자동 추천 규칙, 편집기 노트별/일괄(RLRL·LRLR 교대) 지정, 레인·킷 R/L 표시(켜기/끄기). DB 스키마·공개 API 변경 없음(위험 작업 아님) — Codex 모드C 생략, 모드A/B만 적용.

# T2-7 계획

## 목표
REQ-12 — 노트에 손/발(R/L/RF/LF) 정보를 붙이고, 자동 추천(오른손잡이 기본 규칙)·편집기에서 직접 지정·여러 노트 일괄 교대를 지원하고, 연습 화면 레인·킷에 R/L로 표시한다.

## 근거
- `intent/02-requirements.md` REQ-12 전문.
- `intent/04-ui-ux.md` §3 "스티킹(R/L)": 노트 위 R/L 글자, 킷 점등 테두리(오른손 실선/왼손 점선), 자동 추천은 흐리게, 상단 바 켜기/끄기.
- `intent/08-design.md` §3: "자동 추천 값은 50% 투명도."
- `intent/03-architecture-stack.md` §2: `hand: R|L|RF|LF|null`, `handSource`가 `user`인 값은 자동 추천이 절대 덮어쓰지 않음.
- `intent/07-open-questions.md` Q-11: 자동 추천 규칙의 음악적 타당성은 Phase 2 게이트에서 의뢰인이 실제 곡으로 검토(이번 작업은 "규칙이 코드 상수로 분리돼 수정 가능한" 구현까지만 책임지고, 규칙 자체의 최종 확정은 게이트 항목).

## 위험 작업 여부 판단
`intent/06-pipeline.md` §1-1 "위험 작업"(인증·권한, 오디오 타이밍·동기, DB 스키마·마이그레이션, 외부 모델·라이선스 변경, 공개 API 변경, 오프라인 캐시·세션 처리) 중 해당 사항 확인:
- DB 스키마: `Asset` 테이블은 DrumScore 전체를 JSON 파일로 저장하고(T1-2) 개별 노트 필드를 컬럼으로 갖지 않음 — `hand`/`handSource`는 이미 `app/web/src/score/types.ts`(T1-5)·`app/server/api/schemas.py`(T2-5, `hand`만)에 존재. 이번 작업은 DB 스키마를 건드리지 않음.
- 공개 API: 새 라우트 없음. `api/schemas.py`의 `DrumNoteIn`에 `handSource` 필드를 **추가**(기존 필드는 그대로, 거부 조건 추가 없음 — 순수 확장)하지만, 이미 T2-5/T2-6에서 확인했듯 업로드/저장 둘 다 원본 바이트를 그대로 저장하므로(재직렬화 안 함) 이 필드가 선언에 없어도 실제로는 통과·보존돼 왔음(실제 코드로 확인, 아래 §설계 5). 추가하는 이유는 검증 공백을 메우기 위함이지 새 동작을 만드는 게 아님.
- 오디오 타이밍·동기: 건드리지 않음(마스터 클록·스케줄링 무변경, 순수 시각 표시만 추가).
- 인증·권한, 외부 모델·라이선스, 오프라인 캐시: 해당 없음.

**→ 위험 작업 아님. Codex 모드C(구현 전 설계 검수) 생략**, T2-1~T2-3(순수 프론트 작업)과 같은 패턴으로 바로 구현 → 모드A(독립 코드 검수) → 모드B(보고서 대조) 진행.

## 범위 — 이번 작업이 다루는 것과 안 다루는 것
**다룬다**
- 자동 추천 규칙 엔진(`score/sticking.ts`, 순수 함수) — 아래 §설계 1
- 편집기: 선택한 노트 1개에 R/L/RF/LF 직접 지정 + 지우기, 자동 추천 일괄 적용("재분석") 버튼, 필인 시작손(R/L) 설정
- 편집기: 여러 노트 선택(새 기능, 아래 §설계 3) 후 "RLRL 교대"/"LRLR 교대" 일괄 적용
- 연습 화면(레인·킷): R/L 표시 켜기/끄기, 노트 위 R/L 글자(자동=반투명/사용자=불투명), 킷 점등 테두리 실선(R/RF)·점선(L/LF)
- `api/schemas.py`의 `DrumNoteIn`에 `handSource` 필드 추가(검증 공백 메우기)

**안 다룬다(범위 밖으로 명시)**
- 하이햇 페달(LF) 자동 규칙: 현재 9종 `DrumPiece` 분류(T1-5 확정)에 "하이햇 페달"에 해당하는 값이 없음(GM 노트 44 Pedal Hi-Hat은 `gmMapping.ts`에 아예 없음, `hihat_closed`/`hihat_open`만 존재) — 적용할 대상 자체가 데이터에 없어 구현 불가. **모르는 정보를 지어내지 않는다(CLAUDE.md §1-1)**는 원칙에 따라 추측으로 새 피스를 추가하지 않고 `intent/07-open-questions.md`에 Q-22로 등록(아래 §가정).
- 왼손잡이 레인 반전: `intent/04-ui-ux.md` §3에 "[확장]"으로 명시된 범위 밖 항목.
- 노트별 R/L을 Canvas가 아닌 실제 그림(손 일러스트 등)으로 표현 — 텍스트+테두리 스타일만(08-design.md §3 그대로).
- 편집기 다중선택으로 이동/삭제/셈여림 일괄 적용 — REQ-12가 요구하는 건 "교대 일괄 적용"뿐, 범위 확장 안 함.
- MusicXML/GP 원본에 스티킹 표기가 있어도 가져오기 단계에서 읽어 반영 — REQ-12에 "원본 악보에 스티킹 표기가 있어도 OMR이 읽는다고 가정하지 않음" 명시, 같은 원칙을 디지털 악보 가져오기(T2-1)에도 적용해 전부 자동 추천 대상으로 둔다(가져오기 코드 변경 없음).

## 설계

### 1. 자동 추천 규칙 엔진 — `app/web/src/score/sticking.ts`(신규, 순수 함수)
```ts
export const DEFAULT_START_HAND: 'R' | 'L' = 'R'
// 필인(연속 스네어/탐)으로 묶는 최대 간격 — 16분음표 간격 이내(ppq/이 값)면 같은
// 구간으로 본다. REQ-12 "규칙은 코드 상수로 분리해 수정 가능하게".
export const FILL_RUN_MAX_GAP_DIVISOR = 4
export const STICKING_PIECE_RULES: Partial<Record<DrumPiece, 'R' | 'RF'>> = {
  kick: 'RF', hihat_closed: 'R', hihat_open: 'R', ride: 'R', crash: 'R',
}
const COINCIDENCE_TRIGGER_PIECES: readonly DrumPiece[] = ['hihat_closed', 'hihat_open', 'ride']
const FILL_PIECES: readonly DrumPiece[] = ['snare', 'tom_high', 'tom_mid', 'tom_floor']

export function recommendSticking(
  notes: readonly DrumNote[], ppq: number, startHand: 'R' | 'L' = DEFAULT_START_HAND,
): DrumNote[]

export function alternateHandsByTick(
  notes: readonly DrumNote[], startHand: 'R' | 'L',
): DrumNote[]
```
- `recommendSticking`: 입력 **순서를 그대로 유지**해 반환(같은 길이)하되, 계산 자체는 틱 순서로 한다(인덱스를 보존해 정렬→계산→원래 자리에 되돌림 — 입력이 이미 틱순이라는 가정에 기대지 않음). `handSource === 'user'`인 노트는 그대로 통과(덮어쓰지 않음, REQ-12 핵심 수용기준). 그 외는:
  1. `STICKING_PIECE_RULES`에 있는 피스는 그 값(킥=RF, 하이햇/라이드/크래시=R).
  2. 스네어이면서 **같은 틱**에 `COINCIDENCE_TRIGGER_PIECES` 중 하나가 있으면 L("같은 박에 치는 스네어 → L". "같은 박"=정확히 같은 틱으로 해석 — 디지털 악보는 이미 양자화돼 있어 미세 타이밍이 없음, §가정).
  3. 그 외 `FILL_PIECES`(스네어·탐)는, 틱 순서로 봤을 때 간격이 `ppq/FILL_RUN_MAX_GAP_DIVISOR` 이하로 연속되는 구간(길이 1 이상, `handSource==='user'`인 노트도 구간 멤버로는 포함해 틱 간격 계산에 쓰되 그 노트 자체는 건너뜀)을 "필인 구간"으로 묶고, 구간 내 **위치**(0부터)에 따라 `startHand`부터 교대(규칙 2가 이미 정한 값은 그대로 두되 위치 카운트에는 포함 — 교대 리듬 자체가 흐트러지지 않게). 구간 밖(이웃 간격이 임계값을 넘는 고립된 스네어/탐 1개)은 `startHand`로 기본값.
  4. 그 외 피스(현재 9종 중 커버 안 되는 건 없음 — 코드 상 default 분기는 안전망).
- `alternateHandsByTick`: 입력 순서 유지, 계산은 틱 순서. 편집기 "RLRL/LRLR 교대" 버튼이 다중 선택된 노트에 직접 호출 — 사용자의 명시적 행동이므로 결과는 전부 `handSource: 'user'`(기존 user 값도 덮어씀, 이건 "자동 추천이 덮어쓰면 안 된다"는 규칙과 별개 — 사용자가 지금 이 버튼을 누른 게 곧 새로운 사용자 지정).

### 2. 편집기(`EditorScreen.tsx`) — 선택 모델을 단일→다중으로 확장
- `selectedId: number | null` → `selectedIds: Set<number>`.
- 노트 클릭: 수정키(Ctrl/Cmd) 없으면 **교체**(기존 동작 그대로, 회귀 없음), 있으면 **토글**(추가/제거) — 신규.
- 빈 칸 클릭(새 노트 추가): 새 노트 하나로 교체(기존과 동일).
- `selectedNote`(단수, 기존 이동/셈여림/삭제/R-L-RF-LF 단일지정 UI가 씀) = `selectedIds.size === 1`일 때만 존재.
- `selectedMulti`(신규) = `selectedIds.size >= 2`일 때 해당 노트들(틱순 정렬) — "선택 N개" 표시 + "RLRL 교대"/"LRLR 교대" 버튼.
- 이동/삭제/셈여림/방향키는 기존처럼 `selectedNote`(정확히 1개 선택)에만 반응 — 범위 확장 안 함(§범위).
- 단일 선택 노트 정보 바에 손 지정 버튼 추가: `R` `L` `RF` `LF` `지우기`(각각 `handSource: 'user'`로, 지우기는 `hand: null, handSource: undefined`) + 현재 값 표시(예: "손: R(추천)" / "손: R(지정)" — REQ-12 "화면에 반드시 '추천' 표시"를 오파시티뿐 아니라 **명시적 텍스트**로도 보장, 저시력·악보를 못 읽는 사용자 대상 앱이라 은은한 opacity 차이에만 기대지 않음).
- 툴바에 "필인 시작손"(R/L 토글) + "자동 추천 재적용" 버튼 — 클릭 시 `recommendSticking(state.notes, ppq, startHand)`로 전체 재계산 후 커밋(사용자 지정 값은 함수 자체가 보존).
- 노트 버튼 위에 작은 R/L/RF/LF 텍스트 라벨(SVG `<text>` 대신 겹친 `<span>`, DOM 그대로 — 기존 noteSize 16px 안에 8px 정도) — 자동=50% 불투명도, 사용자=100%(08-design.md §3).

### 3. 연습 화면(레인·킷) — `laneRenderer.ts`, `KitIllustration.tsx`, `PracticeCanvas.tsx`
- `render.layout.ts`에 새 순수 함수 `activeHandByPiece(notes, noteTimeSeconds, currentTimeSeconds, hitWindowSeconds): Map<DrumPiece, Hand>` 추가(기존 `activePieces()`는 시그니처 그대로 — `layout.test.ts` 회귀 없음). 판정창 안에 여러 노트가 같은 피스로 겹치면 마지막 값이 남음(기존 `activePieces()`의 Set.add와 같은 단순화, §가정).
- `LaneRenderer.render()` 반환 타입을 `Set<DrumPiece>` → `{ activePieces: Set<DrumPiece>; activeHandByPiece: Map<DrumPiece, Hand> }`로 확장(이 타입을 직접 쓰는 곳은 `PracticeCanvas.tsx` 하나뿐, 전용 테스트 파일 없음 — 그레프로 확인).
- `render()`가 노트를 그리는 기존 루프 안에서, `showSticking`이 켜져 있으면 노트 좌표 바로 위에 `ctx.fillText(hand, x, y - noteSize/2 - 2)`로 R/L/RF/LF 그리기(색은 `--text`, 자동이면 `globalAlpha` 적용 후 복원).
- `KitIllustration.tsx`: `activePieces: ReadonlySet<DrumPiece>` prop을 `activeHandByPiece: ReadonlyMap<DrumPiece, Hand>` + `showSticking: boolean`로 교체. 점등 여부는 `map.has(piece)`로 판단(기존과 동일한 lit 조건), `showSticking`이 true면 손이 R/RF면 실선(기존 stroke 그대로), L/LF면 `strokeDasharray`로 점선, auto면 opacity 추가 감소.
- `PracticeCanvas.tsx`: 상단 바에 "R/L 표시" 체크박스(기본 켜짐) 추가, `activeHandByPiece` state로 교체, `showSticking` 꺼지면 빈 Map을 KitIllustration에 넘겨 기존(T2-3) 동작과 동일하게 복귀(회귀 없음 보장).

### 4. 편집기 노트 생성 시 기본값
새로 추가하는 노트는 지금처럼 `hand: null`(미지정)로 시작 — 자동 추천은 명시적으로 "재적용" 버튼을 눌러야 계산됨(의도치 않게 추천값이 끼어드는 걸 막음, REQ-12 "자동 결과보다 사용자가 직접 지정한 값이 항상 우선"이 성립하려면 최소한 "아직 아무것도 안 정해짐" 상태가 명확히 구분돼야 함).

### 5. 백엔드 — `app/server/api/schemas.py`
`DrumNoteIn`에 `handSource: Literal["auto", "user"] | None = None` 추가(프론트 `validate.ts`가 이미 검증하는 것과 동일 범위). **동작 변화 없음**: 업로드(`POST /songs`)·저장(`PUT /songs/{id}/drumscore`) 둘 다 Pydantic 검증은 거부 여부 판단에만 쓰고 저장은 원본 바이트 그대로(`write_song_file(..., raw_body)` / `write_song_file(..., drumscore.encode())`) — 지금 필드를 안 넣어도 `handSource`는 이미 통과·보존돼 왔음(T2-5/T2-6 코드 재확인). 추가하는 이유는 서버가 `handSource: "bogus"` 같은 잘못된 값도 조용히 통과시키는 검증 공백을 메우기 위함.

## 테스트 계획
1. `score/sticking.test.ts`(신규, 순수 함수 — jsdom 제약 없음): `recommendSticking` — 킥→RF, 하이햇/라이드/크래시→R 기본값; 스네어+하이햇 동시틱→L; 필인 구간(간격 ppq/4 이내) 교대(R/L/R/L…, startHand 반영); 간격이 넘으면 별개 구간으로 재시작; 고립 스네어→startHand; `handSource:'user'`인 노트는 절대 안 바뀜(재호출해도); 입력 순서 보존(틱 역순 입력에도 결과 배열 순서가 입력과 같음). `alternateHandsByTick` — 선택된 노트 다중에 R/L/R/L 또는 L/R/L/R, 결과 전부 `handSource:'user'`, 틱 역순 입력도 틱순으로 교대.
2. `render/layout.test.ts`에 `activeHandByPiece` 테스트 추가(기존 `activePieces` 테스트 패턴과 동일).
3. `EditorScreen.test.tsx`에 추가: Ctrl/Cmd+클릭으로 다중선택(2개) 확인, 선택 해제 없이 일반 클릭은 기존처럼 교체됨(회귀 확인), "RLRL 교대" 버튼 클릭 시 다중선택 노트들의 hand가 틱순 R/L로 바뀜, 단일 선택 노트에 R/L/RF/LF 버튼 클릭 시 `handSource:'user'`로 반영, "자동 추천 재적용" 버튼이 `recommendSticking` 결과를 반영하되 기존 user 값은 유지.
4. 전체 회귀: `npx tsc -b`/`oxlint`/`vitest run`, 백엔드 `ruff`/`pytest`.
5. 수동 QA(실제 브라우저): 편집기에서 필인 8노트 선택→"RLRL 교대" 적용→레인·킷에 반영 확인 스크린샷(REQ-12 수용 기준 그대로), 저장 후 재로드 동일 확인, 연습 화면에서 R/L 표시 켜기/끄기 토글 동작, 자동 추천 값이 반투명으로, 사용자 지정 값이 불투명으로 보이는지 확인.

## 가정
- "같은 박"(REQ-12) = 정확히 같은 틱(디지털 악보는 이미 양자화돼 있어 미세 타이밍 차이가 없음 — audio 경로(Phase 3)는 범위 밖).
- 필인 구간 간격 임계값(16분음표, `ppq/4`)과 시작손 기본값(R)은 둘 다 코드 상수/UI 설정으로 노출 — 음악적 타당성 최종 확정은 Phase 2 게이트에서 의뢰인 검토(Q-11, 기존 질문 그대로 유효).
- "하이햇 페달→LF" 규칙은 현재 9종 분류에 대상 피스가 없어 구현 불가 — Q-22로 신규 등록(아래).
- 판정창 안에 같은 피스로 손이 다른 노트가 동시에 들어오는 경우(예: 극단적으로 빠른 동시타) `activeHandByPiece`는 마지막 값만 반영 — 기존 `activePieces()`도 같은 단순화를 이미 쓰고 있어 새로운 리스크 아님.
