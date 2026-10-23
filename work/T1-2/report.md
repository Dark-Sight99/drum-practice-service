> 한 줄 요약: SQLAlchemy 2.0 ORM 5개 테이블 + Alembic 마이그레이션 구현. enum 저장값이 .name이 아니라 .value로 저장되도록 하는 실제 버그를 실행으로 발견·수정.

# T1-2 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/server/db/models.py` | User/Song/Asset/Job/PracticeSetting ORM 모델 + enum 5종 | REQ-07,08,10, `intent/05-todo.md` T1-2 |
| `app/server/db/session.py` | 엔진/세션 팩토리, DB 경로를 루트 `data/db/app.db`로(pathlib, env var로 오버라이드 가능) | `intent/03-architecture-stack.md` §5("사용자 데이터는 data/"), §3("경로는 pathlib") |
| `app/server/alembic/`, `alembic.ini` | 마이그레이션 환경, 초기 스키마 리비전 1개 | T1-2 |
| `app/server/tests/test_models.py`, `test_migrations.py` | 모델 CRUD·제약·마이그레이션 테스트 9개 | 테스트 계획(`work/T1-2/plan.md`) |
| `app/server/requirements.txt` | `sqlalchemy`, `alembic` 추가 | 실제 사용 |

## 구현 근거 (실행 결과로 확인)
- SQLAlchemy 2.1.6의 `DeclarativeBase`/`Mapped`/`mapped_column` 임포트를 실제로 실행해 2.0 스타일 API가 설치 버전에서 동작함을 확인.
- **버그 발견**: `sa.Enum(PythonEnum)`을 `values_callable` 없이 쓰면 DB에 enum 멤버의 `.name`(예: `"PENDING"`)이 저장된다는 것을 실제 SQLite 조회로 확인(`qa-evidence/T1-2/raw_log.txt`). `intent/03-architecture-stack.md` §2의 DrumScore 포맷은 소문자(`"audio|omr|midi|..."`)라 불일치 — `values_callable=lambda x: [e.value for e in x]`를 추가하는 `str_enum_column()` 헬퍼로 수정하고, 회귀 테스트(`test_enum_columns_store_lowercase_value_not_member_name`)로 고정.
- `ruff`의 `UP042` 규칙이 `(str, enum.Enum)` 상속 대신 `enum.StrEnum`(Python 3.12+)을 권장 — 직접 전환 후 테스트 재실행으로 동작 확인(자동 수정은 "unsafe"로 표시돼 있어 수동으로 바꾸고 검증).
- Alembic `env.py`는 기본 템플릿이 `target_metadata = None`이라 autogenerate가 빈 마이그레이션만 만든다는 것을 실행으로 확인 → `db.models.Base.metadata`를 연결하고 `db.session.get_database_url()`로 URL을 주입하도록 수정.

## 실행한 검증
`qa-evidence/T1-2/result.md`, `raw_log.txt` 참고 — ruff PASS, pytest 16/16 PASS(Codex 모드A/B 반영 테스트 포함 최종 수치).

## 가정
- `password_hash` 컬럼은 이번엔 타입(String)만 만듦 — 실제 argon2 해싱 로직과 로그인 세션은 T1-3 범위.
- `app/server/storage/`는 빈 폴더로 남겨둠(03-architecture-stack.md 폴더 목록에 있으나 실제 파일은 루트 `data/`에 저장하는 걸로 해석) — 용도(코드 추상화 계층 등)는 Phase 2~3에서 필요해지면 채움.
- DB 파일 기본 경로는 `<repo>/data/db/app.db`(`DRUM_DB_PATH` 환경변수로 오버라이드 가능, 테스트는 임시 경로/in-memory 사용) — `data/`가 기존 `.gitignore` 패턴으로 이미 커밋 제외됨.

## 질문
- 없음.

## 남은 문제
- 로그인/세션/비로그인 차단은 T1-3.
- `jobs` 테이블의 FIFO 순서 보장(워커 쪽 로직)은 T1-4.

## Codex 모드 A 검수 반영 (2026-10-23)
- **C-001**(필수): SQLite는 기본적으로 FK를 검사하지 않음(실행으로 재현) → `db/session.py`에 `create_sqlite_engine()` 헬퍼 추가, 연결마다 `PRAGMA foreign_keys=ON` 실행. 유효하지 않은 `user_id`로 Song 생성 시 `IntegrityError` 발생 확인(`test_fk_violation_rejected_for_invalid_user`).
- **C-002**(필수): `Job.user_id`/`Job.song_id`가 독립 FK라 다른 사용자의 곡을 참조하는 작업이 저장될 수 있었음 → `songs`에 `UniqueConstraint(id, user_id)` 추가, `jobs`는 `ForeignKeyConstraint([song_id, user_id], [songs.id, songs.user_id])` 복합 FK로 변경(`song_id`는 NOT NULL로 조정 — REQ-10 작업 유형 전부 특정 곡에 대한 처리라 nullable일 이유 없음). 다른 사용자 곡 참조 시 `IntegrityError` 확인(`test_job_cannot_reference_another_users_song`).
- **C-003**(필수): `assets.file_path`에 경로 조작(`..`) 방지가 없었음 → `CheckConstraint("file_path NOT LIKE '%..%'")` 추가. `../../etc/passwd` 저장 시도 시 거부 확인(`test_asset_file_path_rejects_path_traversal`). 전체 경로 검증(절대경로 금지 등)은 실제 파일 저장 코드(Phase 3) 몫으로 남김.
- **C-004**(권장): REQ-08 최대 6명 제한은 스키마로 강제하지 않음 — 계정 생성은 관리자 1명이 수동으로 하므로(가입 화면 없음) 애플리케이션 레벨(T1-3 로그인/계정 관리) 책임으로 남김. 수정 안 함.
- **C-005**(권장): 테스트 fixture가 FK 검사 꺼진 엔진을 쓰고 있었음(C-001과 같은 원인) → `create_sqlite_engine()`으로 교체하며 자동 해결, 추가 조치 불필요.
- **C-006**(리스크 의견): FIFO·동시성·재시도는 T1-4(워커) 범위 — 이번엔 해당 없음, 수정 안 함.

복합 FK 도입 후 `Job.user`/`Job.song`/`Song.jobs` relationship이 같은 컬럼(`jobs.user_id`)을 쓰는 것에 대해 SQLAlchemy가 `SAWarning`을 냄(실제 실행으로 확인) → 각 relationship에 `overlaps=` 파라미터를 경고 문구가 안내한 대로 추가해 해소.

## Codex 모드 B 검수 반영 (2026-10-23)
- **C-007**(필수): C-003의 `CHECK`가 `..`만 막고 절대경로(유닉스 `/...`, 윈도우 드라이브 `C:...`, UNC `\\server\...`)는 못 막는다는 지적 — **재현 확인**(실제로 `/etc/passwd`, `C:\Windows\...` 저장이 통과했음). `CHECK` 조건에 `NOT LIKE '/%'`, `NOT LIKE '\%'`, `NOT LIKE '_:%'`를 추가해 세 가지 절대경로 패턴을 모두 막음. 거부 3종 + 정상 상대경로 허용 대조군까지 테스트 4개 추가(총 16개).
- **C-008**(권장): QA 로그가 "12 passed" 한 줄 요약만 있고 `result.md` 상단 수치가 옛날 "9/9"로 안 바뀌어 있었다는 지적 — **맞음**. `result.md` 상단 수치를 최신 테스트 수(16)로 동기화하고, `raw_log.txt`에 `pytest -v` 상세 출력 전체를 다시 붙여넣음.
