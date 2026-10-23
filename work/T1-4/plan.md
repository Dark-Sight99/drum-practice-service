> 한 줄 요약: T1-4 — 작업 큐 워커(별도 프로세스, FIFO, 재시작 시 고아 작업 실패 처리) + 사용자별 작업 상태 조회 API.

# T1-4 계획

## 목표
`intent/05-todo.md` T1-4: "작업 큐 워커(별도 프로세스, 재시작 복구) (REQ-10)".

## 근거
REQ-10: 무거운 작업은 서버 작업 큐에서 순차 처리(브라우저 닫아도 계속), 다중 사용자 FIFO, 서버 재시작 후 미완료 작업 재개 또는 실패 표시, 사용자 A가 B의 작업 상태 조회 시도 시 차단.

## 범위 — 중요한 경계
REQ-01/02의 실제 처리 로직(Demucs 분리, ADTOF 채보, Audiveris OMR)은 Phase 3(T3-1,T3-2)·Phase 4(T4-1) 범위라 **이번엔 만들지 않는다**(CLAUDE.md 절대규칙 6). T1-4는 **큐 메커니즘 자체**만 다룬다:
- 작업 종류(`JobType`)별로 실제 처리 함수를 등록하는 레지스트리(`worker/handlers.py`) — 지금은 비어 있고, Phase 3/4에서 실제 함수를 등록하면 된다.
- 등록된 핸들러가 없는 작업은 "아직 구현 안 됨"으로 **실패 처리**(크래시 없이).
- 큐에 작업을 **넣는** 공개 API는 아직 안 만든다(업로드 플로우 자체가 Phase 3 범위라 지금 넣을 게 없음) — 대신 워커의 FIFO·재시작 복구는 테스트에서 ORM으로 직접 Job을 만들어 검증한다.
- 사용자가 **자기 작업 상태를 조회**하는 API(`GET /jobs`, `/jobs/{id}`)는 REQ-10 수용 기준에 명시돼 있어 이번에 만든다(`api/songs.py`와 같은 패턴 — 403 대신 404로 존재 자체를 안 흘림).

## 설계
- `worker/runner.py`:
  - `process_next_job(db)`: 가장 오래된 `QUEUED` 작업 하나를 꺼내 처리하고 그 Job을 반환(없으면 None) — 테스트에서 반복 호출해 큐를 비움.
  - `recover_orphaned_jobs(db)`: 시작 시 `PROCESSING` 상태로 멈춰있는 작업(이전 실행이 죽은 흔적)을 전부 `FAILED`로 표시. 범용 "재개"는 작업 종류별 체크포인트가 있어야 가능한데 Phase 3/4 처리 모듈이 아직 없어 불가능 — "실패 표시" 쪽을 선택(REQ-10 "재개 **또는** 실패 표시" 중 하나).
  - `run_forever()`: 실제 운영 시 `python -m worker.runner`로 띄우는 무한 루프(복구 → 폴링). `--once` 옵션으로 작업 하나만 처리하고 종료하는 모드도 둬서 수동 QA 때 쓴다.
- `worker/handlers.py`: `JobType -> Callable[[Job], None]` 레지스트리. `register_handler()`/`get_handler()`.
- `api/jobs.py`: `GET /jobs`(내 작업 목록), `GET /jobs/{id}`(내 것 아니면 404).

## 바꿀 파일
```
app/server/worker/handlers.py   신규
app/server/worker/runner.py     신규
app/server/api/jobs.py          신규
app/server/api/main.py          라우터 연결
app/server/tests/test_worker.py 신규
app/server/tests/test_jobs_api.py 신규
```

## 테스트 계획
1. 작업 2개를 생성 순서대로 등록 → `process_next_job`을 두 번 호출 → 등록 순서대로 완료되는지
2. 핸들러가 등록 안 된 작업 → 크래시 없이 FAILED + 에러 메시지
3. 핸들러가 예외를 던지는 작업 → FAILED + 에러 메시지에 예외 내용 포함
4. `PROCESSING` 상태로 멈춰있는 작업(서버 재시작 흉내) → `recover_orphaned_jobs` 호출 시 FAILED로 바뀌는지
5. `GET /jobs`: 로그인 없으면 401, 로그인하면 내 작업만 보임
6. `GET /jobs/{id}`: 다른 사용자 작업 id → 404(REQ-10 "조회 시도 차단")
7. (QA 수동) `python -m worker.runner --once`를 실제 서브프로세스로 실행해 독립 프로세스로 동작하는지 확인

## 가정
- 폴링 간격(`POLL_INTERVAL_SECONDS`)은 2초로 임시 설정 — 튜닝 가능한 상수, 의뢰인 확인 사항 아님.
- GPU 작업 1개만 처리하는 제약(03-architecture-stack.md)이나 "CPU 전용 모드"/"작업 일시정지" 설정은 Phase 5 범위로 보고 이번엔 다루지 않음(지금 큐는 애초에 순차 처리라 "GPU 1개만"은 자동으로 만족됨 — 병렬 워커를 나중에 추가할 때 재검토).
