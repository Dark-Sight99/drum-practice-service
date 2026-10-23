모드: B  
판정: REQUEST_CHANGES  
요약: C-001·C-002와 C-005 처리는 코드로 확인되지만, C-003은 `..` 포함 경로만 막아 절대 경로를 허용하며, 추가 테스트 결과도 상세 로그로 확인되지 않습니다.

필수 수정:
- C-007 [app/server/db/models.py:137-147] **C-003은 부분 해소입니다.** `CheckConstraint("file_path NOT LIKE '%..%'")`는 `..`를 포함한 경로를 거부하지만, `C:\...` 같은 절대 경로나 `\\server\share\...` 경로는 막지 않습니다. 따라서 DB에 저장된 경로가 앱에서 그대로 파일 접근에 쓰이면 `data/` 바깥 파일을 가리킬 수 있습니다. 허용 루트 아래 상대 경로만 저장·사용하도록 검증하고, 절대 경로와 Windows 경로 사례도 테스트하십시오. 보고서도 전체 경로 검증은 Phase 3으로 미룬다고 적어, 현재 조치가 이 위험을 완전히 해소하지 않았음을 인정합니다([work/T1-2/report.md](/C:/Users/Jaewoo/드럼연습서비스/work/T1-2/report.md:38)).

권장 사항:
- C-008 [qa-evidence/T1-2/raw_log.txt:26-29] 추가 검수 후 `pytest -v: 12 passed`라고 요약하지만, 상세 pytest 출력은 9개 테스트 결과까지만 있습니다(7-19행). [result.md](/C:/Users/Jaewoo/드럼연습서비스/qa-evidence/T1-2/result.md:26)는 신규 테스트 목록을 적고도 본문 실행 결과는 9/9로 기록합니다. 최신 12개 테스트의 실제 실행 로그를 남기고 결과 문서의 수치를 동기화하십시오.

리스크/전략 의견:
- C-001: 해소 확인. [session.py](/C:/Users/Jaewoo/드럼연습서비스/app/server/db/session.py:24)에서 SQLite 연결 시 `PRAGMA foreign_keys=ON`을 설정하고, 테스트 fixture도 이 엔진 팩토리를 씁니다([test_models.py](/C:/Users/Jaewoo/드럼연습서비스/app/server/tests/test_models.py:22)). 잘못된 `user_id` 삽입과 다른 사용자의 곡을 참조하는 작업을 거부하는 테스트도 추가됐습니다.
- C-002: 해소 확인. [models.py](/C:/Users/Jaewoo/드럼연습서비스/app/server/db/models.py:98)는 `(id, user_id)` 고유 제약을 두고, 160-164행은 `(song_id, user_id)` 복합 FK를 선언합니다. 교차 사용자 곡 참조 거부 테스트가 이를 검증합니다([test_models.py](/C:/Users/Jaewoo/드럼연습서비스/app/server/tests/test_models.py:126)).
- C-004: 6계정 제한을 스키마에서 강제하지 않는 판단은 타당하지만, 보고서에서 T1-3 계정 생성 계층의 책임으로 넘겼으므로 아직 완료된 조치는 아닙니다. 해당 계층에서 제한이 구현되고 검증되는지 추적해야 합니다([report.md](/C:/Users/Jaewoo/드럼연습서비스/work/T1-2/report.md:39)).
- C-005: 자동 해결 판단은 타당합니다. 테스트 fixture가 FK 활성화 엔진을 사용하고, 잘못된 FK를 거부하는 테스트가 추가됐습니다([test_models.py](/C:/Users/Jaewoo/드럼연습서비스/app/server/tests/test_models.py:27), [test_models.py](/C:/Users/Jaewoo/드럼연습서비스/app/server/tests/test_models.py:139)).
- C-006: T1-4 worker 범위로 미룬 판단은 타당합니다. FIFO 처리와 재시도 동작은 이 DB 스키마만으로 확인할 수 없습니다([report.md](/C:/Users/Jaewoo/드럼연습서비스/work/T1-2/report.md:41)).

확인하지 못한 것: 테스트를 직접 실행하지 않았습니다. QA 로그의 12개 테스트 요약을 독립적으로 확인할 상세 출력은 없습니다.