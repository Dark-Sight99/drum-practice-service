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
| `app/server/tests/test_worker.py` | 테스트 7개(FIFO, 빈 큐, 핸들러 없음, 핸들러 예외, 재시작 복구 2개, 동시 워커 이중선점 방지 1개) | `work/T1-4/plan.md` 테스트계획 1-4 + Codex 모드A C-001 |
| `app/server/tests/test_jobs_api.py` | 테스트 2개(로그인 필요, 사용자간 격리) | 테스트계획 5-6 |

## 범위 경계(의도적으로 안 만든 것)
REQ-01/02의 실제 처리 로직(Demucs 분리, ADTOF 채보, Audiveris OMR)은 Phase 3·4 범위라 이번엔 만들지 않음(`work/T1-4/plan.md` §범위). `worker/handlers.py`의 레지스트리는 지금 비어 있고, 핸들러가 없는 작업은 크래시 없이 "아직 구현 안 됨"으로 FAILED 처리됨(`test_job_without_registered_handler_fails_cleanly`로 검증). 큐에 작업을 **넣는** 공개 API도 업로드 플로우(Phase 3 범위)가 없어 아직 안 만듦 — 테스트는 ORM으로 직접 Job을 생성해 워커 로직만 검증.

## 구현 근거 (실행 결과로 확인)
- FIFO 순서: `Job.created_at.asc(), Job.id.asc()`로 정렬(T1-2에서 이미 검증된 SQLAlchemy `DateTime` naive-UTC 컬럼 사용, `auth.security.utcnow_naive()` 재사용).
- 재시작 복구는 REQ-10 "재개 또는 실패 표시" 중 **실패 표시**를 선택(설계 결정, `work/T1-4/plan.md` §설계) — 범용 재개는 작업 종류별 체크포인트가 필요한데 Phase 3/4 처리 모듈이 없어 지금은 구현 불가능하다는 전제.
- `/jobs/{id}`에서 다른 사용자 작업은 403이 아니라 404 — `api/songs.py`(T1-3)와 동일한 원칙(존재 자체를 안 흘림)을 그대로 재사용.
- **발견한 문제(수동 서브프로세스 QA로 재현, pytest로는 못 잡음)**: `work/T1-4/plan.md` 테스트계획 7번("실제 서브프로세스로 독립 프로세스 동작 확인")을 실행하던 중 `python -m worker.runner --once`가 `sqlalchemy.orm.exc.DetachedInstanceError`로 크래시함. 원인: `db/session.py`의 `SessionLocal`이 기본값 `expire_on_commit=True`였고, `_run_job()`의 마지막 `db.commit()` 후 `run_once()`가 세션을 닫자 Job 객체의 속성이 "만료"된 상태로 남아 `__main__` 블록의 `result.id` 접근이 실패함. `expire_on_commit=False`로 수정 후 재검증(아래 "실행한 검증" 참고). 상세 분석과 재현/재검증 로그는 `qa-evidence/T1-4/result.md` 참고.

## 실행한 검증
`qa-evidence/T1-4/result.md`, `raw_log.txt` — ruff PASS, pytest 38/38 PASS(T1-4 신규 9개 포함 — C-001 수정으로 회귀 테스트 1개 추가), 수동 서브프로세스 QA(`python -m worker.runner --once`) 수정 전 재현/수정 후 재검증 포함.

## 가정
- 폴링 간격(`POLL_INTERVAL_SECONDS=2.0`)은 임시 상수 — 튜닝 가능한 구현 세부사항, 의뢰인 확인 사항 아님(`work/T1-4/plan.md` §가정).
- `db/session.py`의 `expire_on_commit=False` 변경은 `SessionLocal`로 만드는 모든 세션(API 요청, 워커, 테스트)에 전역 적용됨 — pytest 38개 전체 재통과로 회귀 없음을 확인함.
- GPU 작업 동시 1개 제약이나 "일시정지" 설정(Phase 5 범위)은 이번에 안 다룸 — 지금 워커가 순차 처리라 자동으로 만족됨.

## 질문
- 없음.

## 남은 문제
- 큐에 작업을 넣는 공개 API(업로드 트리거)는 Phase 3에서 추가.
- 실제 처리 핸들러(Demucs/ADTOF/Audiveris)는 Phase 3/4에서 `register_handler()`로 등록.
- Q-17(워커 2개 이상 동시 실행 시 재시작 복구 로직의 소유권 문제) — 운영 규칙(워커 1개만 띄움)으로 당장은 대응, 여러 워커가 필요해지면 재설계 필요.

## Codex 모드 A 검수 반영 (2026-10-23)
판정: REQUEST_CHANGES. 원문: `qa-evidence/T1-4/codex-modeA.md`.

- **C-001**(필수): 작업 선점(조회→`PROCESSING` 전환)이 원자적이지 않아, 워커 프로세스 2개를 동시에 띄우면 같은 작업을 둘 다 처리할 수 있다는 지적 — 파일 기반 SQLite+별도 커넥션 2개로 직접 재현 스크립트를 돌려 **재현 확인**(두 워커 모두 같은 Job id를 가져감). `worker/runner.py`에 `_claim_next_job()`을 추가해 `UPDATE ... WHERE id=? AND status='queued'` 단일 문장으로 선점하도록 수정(두 번째 워커의 UPDATE는 0행 갱신 → 자동으로 선점 실패). 회귀 테스트 `test_concurrent_workers_cannot_claim_the_same_job` 추가(아래 모드B 반영에서 결정적으로 보강함). 스키마·인터페이스 변경 없는 국소 수정이라 파이프라인 자동수정 기준을 충족해 바로 적용함.
- **C-002**(필수로 지적, 판단 대기로 처리): 재시작 복구 로직이 워커 소유자를 구분하지 않아 다른 워커가 정상 처리 중인 작업까지 실패 처리할 수 있다는 지적 — 코드 검토로 재현됨(논리상 명백), 다만 제대로 고치려면 Job에 워커 식별자 컬럼을 추가하는 **스키마 변경**이 필요해 자동수정 범위를 벗어남. 수정하지 않고 `intent/07-open-questions.md` Q-17로 등록, 현재는 "워커 프로세스 1개만 운영"이라는 설계 전제(`intent/03-architecture-stack.md`, `work/T1-4/plan.md`)로 실질 위험이 낮다고 판단(추천일 뿐, 최종 결정은 사용자).

## Codex 모드 B 검수 반영 (2026-10-23)
판정: REQUEST_CHANGES. 원문: `qa-evidence/T1-4/codex-modeB.md`.

- **C-001**(필수): C-001 수정으로 테스트가 38개가 됐는데 `report.md`/`result.md`에 "37/37"이 그대로 남아있다는 지적 — **재현됨**(그렙으로 확인) → **수정함**(전부 38로 교체, 이 문서 포함).
- **C-002**(필수): 새 회귀 테스트(`test_concurrent_workers_cannot_claim_the_same_job`)가 `process_next_job()` 호출 직전에만 스레드를 동기화해서, SELECT~UPDATE 사이의 실제 경쟁 구간을 결정적으로 재현하지 못하고 운 좋게 통과할 수 있다는 지적 — **재현됨**: 고치기 전 코드로 이 테스트를 30회 돌리면 약 70%만 실패, 나머지는 우연히 순차 처리돼 통과함(버그가 있어도 테스트가 가끔 넘어감). **수정함**: `worker/runner.py`에 테스트 전용 훅 `_race_window_hook()`(운영 코드에서는 아무 동작 안 함)을 SELECT~UPDATE 사이에 추가하고, 테스트가 이를 배리어로 monkeypatch해서 두 워커가 그 지점에서 반드시 동시에 멈추도록 강제. 수정 후 재검증: 고친 구현 15회 반복 전부 통과 / 선점 로직을 예전 방식으로 되돌린 구현 10회 반복 전부 실패 — 이제 테스트가 결정적으로 버그를 잡는다는 것을 직접 확인함(`qa-evidence/T1-4/result.md` "C-002 결정성 검증 로그" 참고).

## Codex 모드 B 검수 반영 (2차, 2026-10-23)
판정: REQUEST_CHANGES(C-001·C-002는 해소 확인받음). 원문: `qa-evidence/T1-4/codex-modeB-2.md`.

- **C-003**(필수): 회귀 테스트의 워커 스레드에서 예외(SQLite 잠금 오류 등)가 나도 조용히 끝나버려서 `claimed == [job_id]` 비교만으로는 정상 동작과 한쪽이 몰래 깨지는 것을 구분 못할 수 있다는 지적 — 결정적 배리어를 적용한 뒤 지금까지 돌린 반복(예외 캡처 추가 전 15회 + 추가 후 20회, 총 35회) 전부 예외 없이 통과했지만, 테스트가 그 사실을 스스로 검증하진 않고 있었다는 점에서 타당한 지적 → **수정함**: `worker_sim()`을 `try/except`로 감싸 스레드별 예외를 모아 `assert errors == []`로 명시적으로 검증하도록 추가. 수정 후 20회 재검증 전부 통과(예외 0건).
