> 한 줄 요약: T1-4 QA — ruff/pytest 38개 전부 통과(FIFO 처리·핸들러 없음/예외 실패 처리·재시작 복구·작업 조회 사용자간 격리·동시 워커 이중선점 방지) + 실제 서브프로세스로 워커 단독 실행 검증(DetachedInstanceError 발견·수정·재검증).

# T1-4 QA 결과(2026-10-23)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| lint | `ruff check .` | PASS (지적 0건) |
| test | `pytest -v` | PASS (38/38, T1-4 신규 9개 + 기존 29개 — C-001 수정으로 회귀 테스트 1개 추가) |
| 수동 QA | `python -m worker.runner --once`(실제 서브프로세스) | PASS(수정 후) — 아래 "발견한 문제" 참고 |

전체 로그: `raw_log.txt`

## T1-4 신규 테스트와 REQ-10 수용 기준 대응
| 테스트 | 확인하는 것 |
|---|---|
| `test_jobs_processed_in_fifo_order` | 다중 사용자 FIFO(생성 순서대로 처리) |
| `test_empty_queue_returns_none` | 큐 빈 상태에서 안전하게 종료 |
| `test_job_without_registered_handler_fails_cleanly` | Phase 3/4 처리 모듈 미구현 작업도 크래시 없이 FAILED 처리 |
| `test_handler_exception_marks_job_failed_with_message` | 핸들러 예외 시 FAILED + 에러 메시지 기록(큐 자체는 안 멈춤) |
| `test_recover_orphaned_jobs_marks_stuck_processing_as_failed` | **재시작 복구**: PROCESSING으로 멈춘 작업을 FAILED로 표시 |
| `test_recover_orphaned_jobs_does_not_touch_queued_or_completed` | 복구 로직이 QUEUED/COMPLETED 작업을 건드리지 않음 |
| `test_jobs_require_login` | 로그인 없이 작업 상태 조회 불가(401) |
| `test_user_only_sees_own_jobs` | **"사용자 A가 사용자 B의 작업 상태 조회 시도 시 차단"** — 목록엔 안 보이고 상세는 404(403 아님, songs.py와 같은 원칙) |

## 수용 기준(REQ-10) 충족 여부
- [x] 무거운 작업은 서버 작업 큐에서 순차 처리(브라우저를 닫아도 계속 진행) — 워커가 API 서버와 별개 프로세스(`python -m worker.runner`)로 동작, 수동 QA로 실제 서브프로세스 실행 확인
- [x] 다중 사용자 작업이 FIFO로 순서대로 처리(테스트로 증명)
- [x] 서버 재시작 후 미완료 작업을 "재개 또는 실패 표시" 중 **실패 표시**로 처리(테스트로 증명) — 범용 재개는 작업 종류별 체크포인트가 필요한데 실제 처리 모듈(Phase 3/4)이 아직 없어 불가능하다는 전제, `work/T1-4/plan.md`에 기록
- [x] 사용자 A가 사용자 B의 작업 상태 조회 시도 시 차단(테스트로 증명)

## 발견한 문제(수동 QA 중 재현, pytest로는 못 잡음)
`work/T1-4/plan.md` 테스트계획 7번("실제 서브프로세스로 독립 프로세스 동작 확인")을 실행하던 중 재현됨:

- **증상**: `python -m worker.runner --once`를 실제 서브프로세스로 실행하면 `sqlalchemy.orm.exc.DetachedInstanceError: Instance <Job ...> is not bound to a Session; attribute refresh operation cannot proceed`로 크래시.
- **원인**: `db/session.py`의 `SessionLocal`이 기본값 `expire_on_commit=True`였음 → `_run_job()`의 마지막 `db.commit()` 이후 Job 객체의 속성이 "만료"되고, `run_once()`가 `finally: db.close()`로 세션을 닫은 뒤 `__main__` 블록이 `result.id`를 읽으려 하면 다시 읽어올 세션이 없어 에러.
- **pytest가 못 잡은 이유**: (1) FastAPI `TestClient` 기반 테스트는 요청 스코프 세션이 응답 직렬화까지 열려 있어 이 패턴을 안 건드림. (2) `test_worker.py`는 `process_next_job(db)`를 세션이 열린 채로 직접 호출해서 검증 — "세션을 닫은 뒤 접근"하는 `__main__`의 패턴을 재현하지 않음. 그래서 `plan.md`에 수동 서브프로세스 QA를 별도 항목(7번)으로 넣은 게 실제로 버그를 잡아냄.
- **수정**: `app/server/db/session.py`의 `SessionLocal = sessionmaker(...)` 호출에 `expire_on_commit=False` 추가(근거 주석 포함). commit 후에도 이미 읽은 속성 값이 메모리에 남아있게 해서, 세션이 닫힌 뒤에도 안전하게 읽을 수 있게 함.
- **재검증**: 수정 후 pytest 38/38 재실행(회귀 없음 확인) + `python -m worker.runner --once` 서브프로세스 재실행 — exit code 0, `처리한 작업: 1` 정상 출력, DB에서 해당 Job이 `status=failed`(핸들러 미등록이라 의도된 결과), `error_message`도 기대한 문구로 저장된 것을 세션을 새로 열어 확인. 로그: `raw_log.txt`.

## 가정
- `expire_on_commit=False`는 `SessionLocal`로 만드는 모든 세션(API 요청, 워커, 테스트)에 전역으로 적용됨 — API 쪽은 요청이 끝나면 세션도 바로 닫히므로 동작에 영향 없음(FastAPI `get_db()`가 응답 생성 전까지 세션을 유지), 테스트는 전부 재통과 확인.

## Codex 모드A 검수 반영
원문: `codex-modeA.md`. 판정: REQUEST_CHANGES.

- **C-001**(필수, `worker/runner.py:66-75`): 작업을 `QUEUED`로 조회한 뒤 별도 커밋으로 `PROCESSING` 전환해서, 워커 프로세스 2개가 동시에 돌면 같은 작업을 둘 다 선택할 수 있다는 지적 — **재현됨**(마스터가 직접 확인). 파일 기반 SQLite + 별도 커넥션 2개 + 인위적 지연으로 재현 스크립트를 실행한 결과 두 스레드 모두 같은 Job id를 가져갔음(`두 워커 모두 같은 작업을 집어간 횟수: 2 [1, 1]`, 아래 "재현 로그" 참고). **자동 수정함**: `_claim_next_job()`을 추가해 `UPDATE ... WHERE id=? AND status='queued'` 단일 문장으로 선점(SQLite가 쓰기 트랜잭션을 직렬화하므로 두 번째 워커의 UPDATE는 0행을 갱신함)하도록 `process_next_job`을 재구성. 회귀 테스트 `test_concurrent_workers_cannot_claim_the_same_job` 추가(아래 "모드B 검수 반영" 참고 — 처음엔 실제 스레드 타이밍에만 의존해 비결정적이었고, 모드B 지적 이후 `_race_window_hook` 테스트 훅으로 결정적으로 고침). REQ-10 수용 기준("작업 2개 연속 등록 시 순서대로 완료")이 암묵적으로 요구하는 "한 작업은 정확히 한 번만 처리됨"을 지키는 국소 수정이라 설계·스키마 변경 없이 바로 고침(파이프라인 자동수정 3조건 충족).
- **C-002**(필수로 지적됐으나 판단 대기, `worker/runner.py:31-36,81-82`): 재시작 시 `recover_orphaned_jobs()`가 워커 소유자를 구분하지 않아, 워커 B가 시작하면서 워커 A가 지금 정상 처리 중인 작업까지 FAILED로 표시할 수 있다는 지적 — 코드 검토로 **재현됨(논리적으로 명백)**, 다만 실제 실행 재현은 하지 않음. **수정 안 함(판단 대기)**: 제대로 고치려면 Job에 "어느 워커가 처리 중인지" 식별자를 추가하는 **DB 스키마 변경**이 필요해 파이프라인의 자동수정 3조건(설계·스키마 변경 없음) 중 하나를 위반함. `intent/03-architecture-stack.md`·`work/T1-4/plan.md`는 애초에 워커 프로세스를 1개만 띄우는 전제라 현재는 실질적 위험이 낮다고 판단했으나, 이건 추천일 뿐 결정이 아니라 `intent/07-open-questions.md` Q-17로 등록함.

### C-001 재현 로그(수정 전, 임시 스크립트로 확인 — 저장소에 커밋하지 않음)
```
두 워커 모두 같은 작업을 집어간 횟수: 2 [1, 1]
```
파일 기반 SQLite(두 워커가 각자 별도 엔진/커넥션으로 같은 DB 파일에 접근) + 조회와 커밋 사이에 0.2초 지연을 넣어 경쟁 구간을 넓힌 재현.

## Codex 모드B 검수 반영
원문: `codex-modeB.md`. 판정: REQUEST_CHANGES.

- **C-001**(필수, 보고서 수치 불일치): `report.md`·`result.md`가 C-001 수정 후에도 "pytest 37/37"로 남아있었다는 지적 — **재현됨**(그렙으로 직접 확인, C-001 수정으로 회귀 테스트 1개가 늘어 38개가 맞음). **수정함**: 이 문서와 `report.md`의 37 표기를 전부 38(신규 9개)로 교체.
- **C-002**(필수, 테스트 결정성): `test_concurrent_workers_cannot_claim_the_same_job`이 `barrier.wait()`을 `process_next_job()` 호출 **직전**에만 걸어서, SELECT 직후·UPDATE 직전의 실제 경쟁 구간은 스레드 스케줄링에 맡겨져 있어 두 워커가 매번 같은 후보를 동시에 집으려 든다는 보장이 없다는 지적 — **재현됨(마스터가 직접 확인)**: 수정 전(원자적 선점 없는) 코드로 이 테스트를 30회 반복한 결과 약 70%만 실패하고 나머지는 우연히 순차 처리되어 통과함(버그가 있어도 테스트가 가끔 넘어감). **자동 수정함**: `worker/runner.py`에 운영 코드에서는 아무 동작도 안 하는 테스트 전용 훅 `_race_window_hook()`을 SELECT와 UPDATE 사이에 추가하고, 테스트에서 `monkeypatch`로 이 훅을 배리어로 교체해 두 워커가 그 지점에서 반드시 동시에 멈추도록 강제함. 수정 후: (1) 고친 구현으로 15회 반복 전부 통과, (2) 선점 로직을 다시 예전 방식으로 되돌린 코드로는 10회 반복 전부 실패 — 이제 테스트가 결정적으로 버그를 잡아낸다는 것을 직접 재검증함(아래 "C-002 결정성 검증 로그" 참고). REQ-10 수용 기준을 검증하는 회귀 테스트의 신뢰도를 높이는 국소 수정이라 설계·스키마 변경 없이 바로 고침.

### C-002 결정성 검증 로그(임시로 구현을 되돌려 확인 — 저장소에는 최종(수정된) 버전만 커밋)
```
[수정된 구현으로 15회 반복] 15/15 passed
[선점 로직을 예전(비원자적) 방식으로 되돌린 구현으로 10회 반복] 10/10 failed
```
