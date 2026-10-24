> 한 줄 요약: Codex 모드A 코드 검수 2라운드 — 1라운드 REQUEST_CHANGES(필수 1건, 권장 1건) 수정 후 2라운드 APPROVE WITH NITS(나이트픽 1건, 즉시 반영).

# T3-2-feedback-2 Codex 모드A 검수 로그

## 라운드 1 — REQUEST_CHANGES

Target: `task/T3-2-feedback-2-loudness-normalize` 브랜치 diff(`main` 대비), `app/server/modules/transcriber/adtof_transcriber.py`의 `normalize_loudness()` 신설분과 `app/server/tests/test_normalize_loudness.py`, `app/server/tests/test_adtof_transcriber.py`.

Findings:
- **C-001(필수)**: `normalize_loudness()`에서 `sf.write()`가 실패하면 `tempfile.mkstemp()`가 이미 만든 임시 파일이 어떤 호출자에게도 경로가 전달되지 않아 영원히 정리되지 않는 고아 파일로 남음.
- **C-002(권장)**: `test_normalize_does_not_clip`이 -80dBFS 사인파를 입력으로 썼는데, 사인파는 크레스트 팩터(피크/RMS)가 항상 sqrt(2)로 고정이라 목표 -18dBFS로 증폭해도 피크가 ~0.18에 그쳐 클리핑 방지 분기(`peak > 0.99`)를 전혀 건드리지 못함 — 그 분기를 통째로 지워도 이 테스트는 그대로 통과했을 것.

## 수정(커밋 `04ef022`)
- C-001: `sf.write()` 호출을 `try/except`로 감싸, 실패 시 `tmp_path.unlink(missing_ok=True)`로 정리 후 재발생.
- C-002: `test_normalize_does_not_clip`을 사인파 대신 "짧은 타격 버스트"(전체의 0.1%만 진폭 0.9, 나머지 무음) 신호로 교체 — 증폭 전 피크가 실제로 1.0을 넘는다는 전제를 `assert`로 직접 확인한 뒤, 정규화 후 피크가 `<= 1.0`이면서 `> 0.5`(과도하게 깎이지 않음)인지 검사.

재검증: `pytest -q` 141개 전부 통과, `ruff check` 0건.

## 라운드 2 — APPROVE WITH NITS

Target: 커밋 `04ef022`(`9f81599` 대비) 단독 diff.

Findings:
- **C-001 CORRECT/COMPLETE** — 다만 정리(`unlink()`) 자체가 실패하면 원래 `sf.write()` 예외가 가려질 수 있다는 나이트픽(심각도: Minor).
- **C-002 CORRECT/COMPLETE** — 버스트 입력이 무정규화 전제(피크>1.0)를 확인하고, 출력 피크가 `<=1.0`이면서 `>0.5`인지 검사해 클리핑 제한 동작을 실제로 검증함.

## 나이트픽 반영(즉시, 재검수 없이 머지 전 직접 반영 — T3-2 C-003과 동일한 "정리 실패가 원래 예외를 가리면 안 된다" 패턴)
`unlink()` 호출을 `try/except OSError: pass`로 한 번 더 감싸 정리 실패가 원래 `sf.write()` 예외를 가리지 않도록 함.

재검증: `pytest -q` 141개 전부 통과, `ruff check` 0건(`pytest_output.txt`, `ruff_output.txt`).

## 결론
모드A 검수 완료(실질적으로 APPROVE) — 머지 진행.
