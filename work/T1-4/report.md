> 한 줄 요약: 작업 큐 워커(별도 프로세스, FIFO, 재시작 시 고아 작업 실패 처리) + 사용자별 작업 상태 조회 API(`GET /jobs`, `/jobs/{id}`) 구현. REQ-10 수용 기준 전부 테스트로 증명.

# T1-4 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/server/worker/handlers.py` | `JobType -> Callable[[Job], None]` 핸들러 레지스트리(`register_handler`/`get_handler`/`clear_handlers`) | REQ-10, CLAUDE.md 절대규칙 6(범위 밖 작업 금지 — 실제 처리 로직은 Phase 3/4) |
| `app/server/worker/runner.py` | `process_next_job`(FIFO 1건 처리), `recover_orphaned_jobs`(재시작 복구), `run_forever`/`run_once`(CLI 진입점) | REQ-10 |
| `app/server/api/jobs.py` | `GET /jobs`(내 작업 목록), `GET /jobs/{id}`(내 것 아니면 404) | REQ-10("사용자 A가 B의 작업 상태 조회 시도 시 차단") |
| `app/server/api/main.py` | jobs 라우터 연결 | — |
| `app/server/db/session.py` | `SessionLocal`에 `expire_on_commit=False` 추가 | 수동 QA로 재현된 `DetachedInstanceError` 수정(아래 참고) |
| `app/server/tests/test_worker.py` | 테스트 6개(FIFO, 빈 큐, 핸들러 없음, 핸들러 예외, 재시작 복구 2개) | `work/T1-4/plan.md` 테스트계획 1-4 |
| `app/server/tests/test_jobs_api.py` | 테스트 2개(로그인 필요, 사용자간 격리) | 테스트계획 5-6 |

## 범위 경계(의도적으로 안 만든 것)
REQ-01/02의 실제 처리 로직(Demucs 분리, ADTOF 채보, Audiveris OMR)은 Phase 3·4 범위라 이번엔 만들지 않음(`work/T1-4/plan.md` §범위). `worker/handlers.py`의 레지스트리는 지금 비어 있고, 핸들러가 없는 작업은 크래시 없이 "아직 구현 안 됨"으로 FAILED 처리됨(`test_job_without_registered_handler_fails_cleanly`로 검증). 큐에 작업을 **넣는** 공개 API도 업로드 플로우(Phase 3 범위)가 없어 아직 안 만듦 — 테스트는 ORM으로 직접 Job을 생성해 워커 로직만 검증.

## 구현 근거 (실행 결과로 확인)
- FIFO 순서: `Job.created_at.asc(), Job.id.asc()`로 정렬(T1-2에서 이미 검증된 SQLAlchemy `DateTime` naive-UTC 컬럼 사용, `auth.security.utcnow_naive()` 재사용).
- 재시작 복구는 REQ-10 "재개 또는 실패 표시" 중 **실패 표시**를 선택(설계 결정, `work/T1-4/plan.md` §설계) — 범용 재개는 작업 종류별 체크포인트가 필요한데 Phase 3/4 처리 모듈이 없어 지금은 구현 불가능하다는 전제.
- `/jobs/{id}`에서 다른 사용자 작업은 403이 아니라 404 — `api/songs.py`(T1-3)와 동일한 원칙(존재 자체를 안 흘림)을 그대로 재사용.
- **발견한 문제(수동 서브프로세스 QA로 재현, pytest로는 못 잡음)**: `work/T1-4/plan.md` 테스트계획 7번("실제 서브프로세스로 독립 프로세스 동작 확인")을 실행하던 중 `python -m worker.runner --once`가 `sqlalchemy.orm.exc.DetachedInstanceError`로 크래시함. 원인: `db/session.py`의 `SessionLocal`이 기본값 `expire_on_commit=True`였고, `_run_job()`의 마지막 `db.commit()` 후 `run_once()`가 세션을 닫자 Job 객체의 속성이 "만료"된 상태로 남아 `__main__` 블록의 `result.id` 접근이 실패함. `expire_on_commit=False`로 수정 후 재검증(아래 "실행한 검증" 참고). 상세 분석과 재현/재검증 로그는 `qa-evidence/T1-4/result.md` 참고.

## 실행한 검증
`qa-evidence/T1-4/result.md`, `raw_log.txt` — ruff PASS, pytest 37/37 PASS(T1-4 신규 8개 포함), 수동 서브프로세스 QA(`python -m worker.runner --once`) 수정 전 재현/수정 후 재검증 포함.

## 가정
- 폴링 간격(`POLL_INTERVAL_SECONDS=2.0`)은 임시 상수 — 튜닝 가능한 구현 세부사항, 의뢰인 확인 사항 아님(`work/T1-4/plan.md` §가정).
- `db/session.py`의 `expire_on_commit=False` 변경은 `SessionLocal`로 만드는 모든 세션(API 요청, 워커, 테스트)에 전역 적용됨 — pytest 37개 전체 재통과로 회귀 없음을 확인함.
- GPU 작업 동시 1개 제약이나 "일시정지" 설정(Phase 5 범위)은 이번에 안 다룸 — 지금 워커가 순차 처리라 자동으로 만족됨.

## 질문
- 없음.

## 남은 문제
- 큐에 작업을 넣는 공개 API(업로드 트리거)는 Phase 3에서 추가.
- 실제 처리 핸들러(Demucs/ADTOF/Audiveris)는 Phase 3/4에서 `register_handler()`로 등록.
