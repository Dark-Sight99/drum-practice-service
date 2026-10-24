> 한 줄 요약: 피아노롤 방식 드럼 편집기(REQ-03) 구현 — 노트 추가/삭제/이동/악기변경/셈여림, 실행취소·다시실행(100단계), BPM/박자표 편집, `PUT /songs/{id}/drumscore` 저장. 구현 전 Codex 모드C 설계 검수 3회(동시저장 중복 방지·파일 원자적 쓰기), 구현 후 모드A에서 ppq가 격자 분할 수로 안 나누어떨어질 때 정수가 아닌 틱이 생기는 문제(P1) 발견·수정. 실제 서버+브라우저로 저장→재오픈 동일성과 PracticeCanvas 연동까지 확인. 수동 QA 중 발견한 행 레이블 가로스크롤 소실 버그를 직접 고쳤다.

# T2-6 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/server/db/models.py` | `Asset(song_id) WHERE kind='drumscore_edited'` 부분 유니크 인덱스 추가 | REQ-03, Codex 모드C C-001 |
| `app/server/alembic/versions/1424de118cb2_...py`(신규) | 위 인덱스 마이그레이션 | 위와 동일 |
| `app/server/file_storage.py` | `write_song_file()`을 같은 디렉터리+요청별 고유 임시파일명 기반 원자적 교체로 재작성 | REQ-03, Codex 모드C C-002(3차 수정) |
| `app/server/api/songs.py` | `PUT /songs/{id}/drumscore`(저장, 조회→UPDATE 또는 INSERT, IntegrityError 시 rollback 후 재시도) | REQ-03 |
| `app/server/tests/test_songs_editor_api.py`(신규) | 테스트 11개 | work/T2-6/plan.md 테스트계획 |
| `app/web/src/features/editor/grid.ts`(신규) | 틱↔픽셀 격자 수학, `EDITOR_ROWS`(9행) | REQ-03 |
| `app/web/src/features/editor/editHistory.ts`(신규) | 스냅샷 기반 실행취소/다시실행(100단계 캡) | REQ-03(≥20단계) |
| `app/web/src/features/editor/velocity.ts`(신규) | 셈여림 3단계(약/중/강) | REQ-03 |
| `app/web/src/features/editor/EditorScreen.tsx`(신규) | DOM/SVG 기반 편집 그리드 UI | REQ-03 |
| `app/web/src/api/songs.ts` | `saveSongDrumScore()` 추가 | REQ-03 |
| `app/web/src/features/library/LibraryScreen.tsx` | "편집" 버튼·`onEditSong` 추가 | REQ-03 |
| `app/web/src/App.tsx` | `'editor'` 화면 전환 추가 | work/T2-6/plan.md §설계 |

## 범위 결정
`work/T2-6/plan.md` §범위 — OMR 원본 사진 대조 패널(Phase 4), 마우스 드래그 이동(방향키만 지원), 곡 중간 템포변경, 스티킹 편집(T2-7), 동시편집 충돌 해결 UI는 전부 범위 밖. 상세 근거는 plan.md 참고.

## 구현 근거 (실행 결과로 확인)
- **"DB 스키마 변경 + 공개 API 추가"는 위험 작업이라 구현 전 Codex 모드C(설계 검수) 3회를 거쳤다**(`qa-evidence/T2-6/codex-modeC.md`, `-2.md`, `-3.md`): 1차 REQUEST_CHANGES(DB 레벨 중복 방지 부재 C-001, 파일쓰기 비원자적 C-002 등 필수 2건) → 반영 → 2차는 rollback 절차 누락·임시파일 "같은 볼륨"이 "같은 디렉터리"보다 느슨함을 지적 → 반영 → 3차에서 고정 임시파일명이 동시요청 간 충돌 가능성을 새로 지적(C-001 재발) → `uuid4` 기반 요청별 고유 임시파일명으로 수정 → 진행 가능 판정. 이후 자체 재검토로 `§가정` 섹션이 확정된 §설계(부분 유니크 인덱스)와 모순되는 구절("DB 제약 안 둠")을 스스로 발견해 수정.
- **SQLite 부분 유니크 인덱스**: `Index(..., unique=True, sqlite_where=text("kind = 'drumscore_edited'"))`를 실제 Python으로 실행해 `sqlite_master`를 직접 조회, 생성된 SQL이 `CREATE UNIQUE INDEX ... WHERE kind = 'drumscore_edited'`임을 확인(출처: SQLAlchemy 공식 문서 `sqlite_where` 파라미터). `(song_id, kind)` 전역 유니크가 아니라 `DRUMSCORE_EDITED`에만 한정한 이유: Phase 4에서 `SHEET_IMAGE`가 곡당 여러 행을 가져야 함.
- **ORM 세션 rollback 필수 여부**: `db.add()+commit()`이 `IntegrityError`를 던진 뒤 같은 세션으로 추가 쿼리를 시도하면 `PendingRollbackError`가 난다는 것을 실제 SQLAlchemy ORM 패턴(raw Core가 아니라 실제 엔드포인트와 동일한 방식)으로 재현·확인 — Codex 2차 지적이 맞았음을 검증 후 `db.rollback()`을 재조회 전에 추가.
- **원자적 파일 쓰기**: `Path.replace()`는 같은 디렉터리/볼륨 안에서만 원자적(POSIX `rename()`/Windows `MoveFileEx` 특성, 공식 pathlib 문서). 임시파일을 `<파일명>.<uuid4 hex>.tmp`로 만들어 동시 요청 간 충돌도 방지(3차 Codex 지적 반영).
- **DOM 기반 편집기는 T2-3/T2-4/T2-5와 달리 React Testing Library로 jsdom에서 직접 테스트 가능**: Canvas 2D나 Tone.js(Web Audio)에 의존하지 않는 순수 DOM 이벤트 UI라서, 클릭→노트추가, 방향키→이동, undo/redo, 저장 호출, BPM 입력 포커스 격리까지 jsdom 컴포넌트 테스트로 검증했다(`EditorScreen.test.tsx` 9개).
- **수동 QA로만 발견 가능했던 버그**: 실제 서버 데이터로 가로 스크롤을 해보니 행 레이블이 화면 밖으로 완전히 사라짐을 발견(스크린샷 `qa-evidence/T2-6/screenshot-labels-bug-before-fix.jpg`) — 악보를 못 읽는 사용자에게는 레이블이 유일한 행 식별 수단이라 실사용에 치명적인 문제였다. `position: sticky` 기반 고정 거터로 수정하고 재검증(`screenshot-labels-fixed-after.jpg`). 이 문제는 자동 테스트(jsdom은 실제 레이아웃/스크롤을 계산하지 않음)로는 발견할 수 없었다.

## Codex 모드A(독립 코드 검수) 반영
`qa-evidence/T2-6/codex-modeA.md` — P1 1건: `ticksPerGridUnit`이 ppq를 격자 분할 수(8분음표 셋잇단=3)로 나누는데, MIDI ppq가 3으로 나누어떨어지지 않으면(예: ppq=100) 결과가 정수가 아니게 되고, 이게 `snapTick`을 거쳐 `DrumScore.notes[i].tick`까지 전파되면 `score/validate.ts`의 정수 검증에 걸려 저장이 거부될 수 있음을 지적. 직접 계산으로 재현 확인(`snapTick(50, '8nt', 100) = 66.666…`). 코드를 더 살펴보니 방향키 이동(`moveSelected`)은 `snapTick`조차 거치지 않고 직접 덧셈만 해서 같은 종류의 문제가 하나 더 있었음을 추가로 발견. `snapTick`의 최종 결과를 반올림하고, `moveSelected`가 `snapTick`을 거치도록 수정 후 회귀 테스트 2개(그리드 단위 1개, EditorScreen RTL 1개) 추가 — 107/107 재통과.

## Codex 모드B(보고서 대조) 반영
판정: needs-attention — (1) result.md/report.md의 수동 브라우저 QA·PUT 요청 횟수 주장이 그때는 `raw_log.txt`(자동 명령 출력만 있었음)로 교차검증할 수 없었음(medium), (2) vitest 신규 테스트의 파일별 개수 분해가 raw_log의 요약 출력만으로는 확인 불가(low). 둘 다 반영: 수동 QA 중 받은 실제 서버 접근 로그를 `server-log-excerpt.txt`로 커밋해 PUT 2건·204 성공을 직접 근거로 남기고 result.md에서 참조하도록 수정, `npx vitest run --reporter=verbose` 출력을 `raw_log.txt`에 추가해 파일별 테스트 개수(grid 7·editHistory 6·velocity 3·EditorScreen RTL 10)를 실행 로그로 직접 확인 가능하게 했다.

원문: `qa-evidence/T2-6/codex-modeB.md`

## 실행한 검증
`qa-evidence/T2-6/result.md`, `raw_log.txt` — 프론트 tsc/oxlint/vitest(107/107, Codex 모드A 수정 반영), 백엔드 ruff/pytest(77/77) 전부 PASS. 실제 FastAPI 서버+브라우저로 편집기 전체 조작(추가/선택/이동/악기변경/셈여림/undo-redo/삭제/저장), 저장→새로고침→재오픈 동일성(REQ-03 핵심 기준), PracticeCanvas가 편집본을 재생함을 확인. prettier CRLF 경고는 레포 전체의 기존 문제임을 `git stash` 비교로 확인(T2-6 범위 밖, result.md 참고).
