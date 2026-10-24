> 한 줄 요약: Codex 모드B(보고서 대조, 3회차/최종) — REQUEST_CHANGES. [Major] 재현 명령이 레포 루트에서 실행하면 스크립트를 못 찾음(작업 디렉터리 미지정) — `cd qa-evidence/T2-14` 추가로 반영. 반영 과정에서 직접 재현 테스트를 돌려보니 `PYTHONIOENCODING=utf-8` 없이는 Windows 콘솔 인코딩(cp949) 문제로 스크립트가 실제로 멈추는 것까지 추가로 발견·수정 — Codex가 지적하지 않은 부분까지 직접 실행해서 잡아낸 추가 버그. `intent/06-pipeline.md` §1-1 최대 3회 규칙에 따라 모드B 종료.

# T2-14 Codex 모드B 원문 (2026-10-24, 3차/최종)

대상: `branch diff against main` + `qa-evidence/T2-14/raw_log.txt`, `result.md`, `hh_spacing_analysis.py`/`hh_interval_crosscheck.py`, `intent/07-open-questions.md`(Q-25, 2차 반영 확인)

## Codex 출력 원문

```
Target: task/T2-14-feedback-7 vs main
Verdict: REQUEST_CHANGES — 독립성 과장은 바로잡혔지만, raw_log.txt의 재현 명령이
Windows PowerShell과 저장소 내 스크립트 경로에서 그대로 실행되지 않습니다.

Findings:

- Major — 재현 명령이 실제 Windows PowerShell에서 실행되지 않음
  로그는 Bash식 `\` 줄 이어쓰기와 curl -c/-b 옵션으로 적었는데, PowerShell에서는
  `\`가 줄 이어쓰기가 아니고 curl이 Invoke-WebRequest 별칭일 수 있습니다. 또
  명령은 python hh_spacing_analysis.py song2.json처럼 실행하지만 스크립트는
  qa-evidence/T2-14/에 있어 저장소 루트에서 실행하면 파일을 찾지 못합니다. 로그에
  작업 디렉터리도 지정되어 있지 않습니다.
  Recommendation: 스크립트 실행 경로를 저장소 루트 기준으로 명시한 뒤, 그대로
  실행 가능한 명령 체인을 증거 로그에 남기세요.

- Minor — 출력 파일의 수치 일관성은 코드 흐름과 맞지만 원본 입력으로 재실행
  검증은 못 함. (저장소에 song2.json이 없어 Codex가 직접 재현하지 못함)

- 조치 완료 — 독립성 과장 없음(result.md, raw_log.txt, Q-25, 스크립트·출력).
- 조치 완료 — 보고서의 핵심 수치 주장은 코드·출력과 부합.
```

## 반영
1. **작업 디렉터리 명시**: `raw_log.txt`에 `cd qa-evidence/T2-14`를 추가해 어디서 실행해야 하는지 명확히 함. (셸 문법 자체는 이 세션이 T2-6부터 일관되게 Git Bash로 실행해왔고 모든 기존 raw_log.txt가 같은 bash 문법을 써왔음을 명시 — Windows PowerShell이 아니라 이 레포의 실제 실행 환경을 그대로 반영.)
2. **직접 재실행으로 재현성을 실제로 검증(Codex가 못 한 부분을 직접 수행)**: Codex는 `song2.json`이 레포에 없어 재실행하지 못한다고 명시했는데, 이 세션은 T2-11/T2-12에서 이미 받아둔 사본으로 **문서화된 명령 체인을 그대로** 실행해봤다. 그 결과 **새로운 버그를 발견**했다 — `PYTHONIOENCODING=utf-8` 없이 그대로 실행하면 Windows 콘솔 기본 인코딩(cp949)이 스크립트 출력의 일부 문자(em dash "—")를 인코딩 못 해 `hh_interval_crosscheck.py`가 `UnicodeEncodeError`로 중단됨(`hh_spacing_analysis.py`는 깨진 글자로나마 돌아가지만 실제로는 읽을 수 없는 출력). 환경변수를 추가하고 나니 출력이 커밋된 `_output.txt`들과 **바이트 단위로 정확히 일치**함을 `diff`로 직접 확인 — `raw_log.txt`에 `PYTHONIOENCODING=utf-8`을 추가하고, 이 검증 과정 자체를 기록.
3. `intent/06-pipeline.md` §1-1 "재검수 최대 3회" 규칙에 따라 모드B 종료 — 이번 라운드는 Codex 지적(작업 디렉터리)에 더해, 그 지적을 실제로 테스트해보다가 직접 발견한 추가 버그(인코딩 크래시)까지 고쳐 반영했으므로 4차 Codex 호출 없이 마스터 자체 검증(실행+`diff` 바이트 비교)으로 마무리.
