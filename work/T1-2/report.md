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
`qa-evidence/T1-2/result.md`, `raw_log.txt` 참고 — ruff PASS, pytest 9/9 PASS.

## 가정
- `password_hash` 컬럼은 이번엔 타입(String)만 만듦 — 실제 argon2 해싱 로직과 로그인 세션은 T1-3 범위.
- `app/server/storage/`는 빈 폴더로 남겨둠(03-architecture-stack.md 폴더 목록에 있으나 실제 파일은 루트 `data/`에 저장하는 걸로 해석) — 용도(코드 추상화 계층 등)는 Phase 2~3에서 필요해지면 채움.
- DB 파일 기본 경로는 `<repo>/data/db/app.db`(`DRUM_DB_PATH` 환경변수로 오버라이드 가능, 테스트는 임시 경로/in-memory 사용) — `data/`가 기존 `.gitignore` 패턴으로 이미 커밋 제외됨.

## 질문
- 없음.

## 남은 문제
- 로그인/세션/비로그인 차단은 T1-3.
- `jobs` 테이블의 FIFO 순서 보장(워커 쪽 로직)은 T1-4.
