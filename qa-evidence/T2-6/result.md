> 한 줄 요약: T2-6 QA — 프론트(tsc/oxlint/vitest 105/105)·백엔드(ruff/pytest 77/77) 전부 통과. 실제 FastAPI 서버+브라우저로 편집기 add/select/move/kit변경/velocity/undo-redo/삭제/저장→새로고침→재오픈 동일성(REQ-03 핵심 기준) 확인, 편집본이 PracticeCanvas 재생에도 반영됨을 확인. 수동 QA 중 발견한 행 레이블 가로스크롤 소실 버그를 코드로 수정(고정 거터)하고 재검증 완료.

# T2-6 QA 결과(2026-10-24)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 프론트 타입체크 | `npx tsc -b` | PASS |
| 프론트 lint | `npx oxlint` | PASS |
| 프론트 포맷 | `npx prettier --check`(T2-6가 바꾼 파일) | FAIL — 전부 CRLF 줄바꿈 문제(아래 "알려진 이슈" 참고, T2-6 범위 밖) |
| 프론트 단위 테스트 | `npx vitest run` | PASS (105/105 — 기존 T2-5까지 81개 + T2-6 신규 24개: grid 5 + editHistory 6 + velocity 3 + EditorScreen RTL 9 + App.test.tsx 기존 1) |
| 백엔드 lint | `ruff check`(T2-6가 바꾼 파일) | PASS |
| 백엔드 포맷 | `ruff format --check`(T2-6가 바꾼 파일) | PASS |
| 백엔드 단위 테스트 | `pytest` | PASS (77/77, T2-6 신규 11개) |
| Alembic 마이그레이션 | 실제 dev DB(`data/db/app.db`)에 `alembic upgrade head` | PASS — `1424de118cb2 (head)` |
| 수동(실제 브라우저+실제 서버) | 아래 "수동 QA" 섹션 | PASS (버그 1건 발견→수정→재검증) |

전체 로그: `raw_log.txt`

## 알려진 이슈 — prettier CRLF 경고(T2-6 범위 밖)
`npx prettier --check`가 T2-6이 건드린 파일 6개 전부를 "포맷 안 맞음"으로 표시하지만, `git stash`로 T2-6 변경분을 전부 제거한 상태에서 같은 명령을 돌려도 레포 전체 54개 파일이 동일하게 실패함을 확인했다(원인: Windows `git config core.autocrlf`가 체크아웃 시 LF→CRLF로 바꾸는데 prettier 기본 설정은 LF를 기대 — 레포 전역 설정 문제). T2-6이 새로 만들거나 수정한 파일만의 문제가 아니라 레포 전체의 기존 문제이므로, CLAUDE.md 6항(범위 밖 작업 금지)에 따라 이번 작업에서 고치지 않았다. `.prettierrc.json`에 `endOfLine` 설정을 추가하는 별도 작업으로 제안 가능.

## 신규 백엔드 테스트(11개, `tests/test_songs_editor_api.py`)
- 로그인 필요(401), 저장→재조회 바이트 동일(REQ-03 핵심), 두 번 저장해도 `DRUMSCORE_EDITED` 행 1개만 유지(최신 내용으로)
- 부분 유니크 인덱스가 실제로 중복 `DRUMSCORE_EDITED` 삽입을 막음(ORM 레벨 직접 검증), 다른 kind(`original`)에는 영향 없음
- 동시 저장 경합 상황(먼저 삽입된 행을 못 보고 INSERT 시도 → IntegrityError → rollback → 재조회 → UPDATE) 복구 — `_find_edited_asset`을 몽키패치해 첫 호출만 레이스를 재현
- 타 사용자 접근 404(403 아님, 기존 패턴과 동일)
- `DrumScoreIn` 수치 불변식 위반 3종 거부(업로드와 동일 모델 재사용 확인)
- `write_song_file` 원자적 교체 — 두 번 써도 `.tmp` 잔재 없이 최신 내용만 남음

## 수동 QA(실제 브라우저 + 실제 FastAPI 서버)
Claude Browser pane(Vite dev 5173 → `/api` 프록시 → 실제 `uvicorn` 127.0.0.1:8000, `data/db/app.db`에 직접 `alembic upgrade head` 적용 후 진행)로 확인. 테스트 대상은 실제 사용자 곡 "MusicDelta_Grunge"(의뢰인이 이미 업로드해 둔 실데이터) — 모든 편집은 검증 후 삭제해 원상복구했다(서버 로그로 PUT 2건만 발생했음을 확인: 추가 1건 + 원복 1건).

1. **편집기 진입**: 라이브러리 "편집" 버튼 → 실제 저장된 DrumScore가 9개 행(HH닫힘/HH열림/CR/SN/T1/T2/FT/RD/KK) 그리드에 정확히 렌더링됨(HH/CR/SN/T2 행에 실데이터 노트 존재, 스크린샷 확인).
2. **빈 칸 클릭 → 노트 추가**: KK 행 클릭 → 새 노트 생성, "선택됨: KK · 틱 1430 · 셈여림 mid" 표시.
3. **방향키 이동**: →(틱 이동), ↑(KK→RD로 행/악기 변경) 모두 정상 동작, 선택 정보 텍스트에 즉시 반영됨.
4. **셈여림 변경**: "강" 버튼 클릭 → "셈여림 strong"으로 반영.
5. **실행취소/다시실행**: 실행취소 → strong→mid 복원, 다시실행 → mid→strong 재적용, 둘 다 정상.
6. **삭제(키보드 포커스 범위 확인 포함)**: 툴바의 실행취소/다시실행/강 버튼을 클릭한 직후에는 포커스가 그리드 밖으로 이동해 Delete 키가 무반응이었음 — 이는 Codex 모드C C-004 설계대로 키보드 단축키를 그리드 컨테이너에만 바인딩한 **의도된 동작**(노트를 다시 클릭해 포커스를 그리드로 되돌리면 Delete가 정상 동작함을 확인). 버그 아님, 설계 의도 확인.
7. **BPM 입력창 포커스 격리**: 노트를 선택한 뒤 BPM 입력창을 클릭해 포커스를 옮기고 →를 누름 → 선택된 노트의 틱이 그대로 유지됨(그리드로 이벤트가 버블링되지 않음, Codex C-004 검증).
8. **REQ-03 핵심 — 저장→새로고침→재오픈 동일성**: KK 틱 1430 노트를 추가해 저장(204 응답, 라이브러리로 복귀) → 같은 탭에서 "편집" 재클릭 → 노트 존재 확인 → **브라우저 전체 새로고침(새 앱 인스턴스, 서버에서 새로 fetch)** 후 다시 "편집" 클릭 → 노트가 여전히 존재함을 확인. 서버 로그에도 `PUT /songs/2/drumscore → 204`가 정확히 1건 기록됨.
9. **PracticeCanvas 연동 확인**(T2-5↔T2-6 end-to-end 최초 확인): 저장한 편집본 상태로 라이브러리에서 곡 제목 클릭(연습 화면 진입) → PracticeCanvas가 정상 렌더링됨(레인·킷 일러스트 모두 표시) — `GET /songs/{id}/drumscore`가 T2-5에서 구현한 DRUMSCORE_EDITED 우선 로직을 그대로 타므로, 방금 편집·저장한 내용이 연습 화면에도 반영된다.
10. **정리**: 테스트용 KK 노트를 삭제 후 재저장해 원본 데이터로 복원, 재오픈으로 복원 확인.

### 수동 QA 중 발견한 버그 → 수정 → 재검증
그리드를 가로로 스크롤하면 행 레이블(HH/CR/SN/...)이 음표와 같은 스크롤 영역에 `position: absolute`로 떠 있어서 **화면 밖으로 완전히 사라짐**을 발견(스크린샷으로 재현). 이 앱의 첫 사용자가 악보를 못 읽어 레이블이 유일한 행 식별 수단이므로, 곡 후반부를 편집할 때 어느 행이 무슨 악기인지 알 수 없게 되는 실사용 문제였다.
- 수정: 레이블 전용 고정 거터(`ROW_LABEL_WIDTH = 64px`)를 분리하고 레이블을 `position: sticky; left: 0`으로 바꿔 가로 스크롤과 무관하게 항상 보이게 함. 음표 타임라인 좌표(`tickToPx`/`pxToSnappedTick`)와 클릭 판정(`handleRowClick`)도 거터만큼 보정.
- 재검증: 같은 화면에서 5칸 스크롤 후 스크린샷 — 레이블 전부 고정되어 보임. `tsc`/`oxlint`/`vitest`(105/105) 재실행해 회귀 없음 확인.
