> 한 줄 요약: T1-2 — SQLAlchemy 2.0 ORM 모델(users/songs/assets/jobs/practice_settings) + Alembic 마이그레이션 + 단위 테스트.

# T1-2 계획

## 목표
`intent/05-todo.md` T1-2: "FastAPI + SQLite 스키마(users, songs, assets, jobs, practice_settings)"를 구현한다.

## 근거
- REQ-07(라이브러리): 곡 메타데이터(제목/아티스트/원곡 BPM/입력 경로/처리 상태), 곡별 저장(원본·분리트랙·DrumScore 원본/편집본·연습설정)
- REQ-08(로그인·다중 사용자): 최대 6명, 관리자가 계정 생성/정지, DB에 `user_id` 포함, 라이브러리는 사용자별 완전 분리
- REQ-10(작업 큐): 다중 사용자 FIFO 큐, 각자 자기 작업 상태만 조회

## 스키마 설계
| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `users` | id, username(unique), password_hash, is_admin, is_active, created_at, last_login_at | 비밀번호는 argon2 해시(`03-architecture-stack.md` §3) |
| `songs` | id, user_id(FK), title, artist, original_bpm, source_type(enum), status(enum), needs_review(bool) | `needs_review`=REQ-02 OMR 부분인식 시 편집 필요 플래그 |
| `assets` | id, song_id(FK), kind(enum), file_path | 원본/분리트랙/DrumScore 원본·편집본 등 |
| `jobs` | id, user_id(FK), song_id(FK, nullable), job_type(enum), status(enum), error_message, created_at, started_at, completed_at | REQ-10 큐. `status`로 대기·처리중·완료·실패 표시 |
| `practice_settings` | id, song_id(FK, unique=1:1), practice_bpm, volumes_json, loop_start_measure, loop_end_measure | REQ-04/05/07 연습 설정 |

## 바꿀 파일
```
app/server/db/models.py       SQLAlchemy 2.0 선언적 모델
app/server/db/session.py      엔진·세션 팩토리(SQLite 파일 경로)
app/server/alembic.ini, app/server/alembic/   마이그레이션
app/server/tests/test_models.py   스키마 단위 테스트
```

## 테스트 계획
- 임시 SQLite 파일(또는 in-memory)에 Alembic 마이그레이션 적용 → 테이블 생성 확인
- User/Song/Asset/Job/PracticeSetting 생성·조회 CRUD 테스트
- FK/unique 제약 위반 시 에러 발생 확인(예: 중복 username, 같은 song에 practice_settings 2개)
- `pytest`로 전부 실행, 로그는 `qa-evidence/T1-2/`에 저장

## 가정
- DB 파일 경로는 `app/server/storage/app.db`(실제 서비스 시) — 테스트는 별도 임시 파일/in-memory 사용.
- 세션(로그인) 자체는 T1-3에서 구현. 이번엔 테이블·ORM 모델까지만.
