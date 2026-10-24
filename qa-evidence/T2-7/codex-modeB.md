> 한 줄 요약: Codex 모드B(보고서 대조, 1회차) — needs-attention. 서버 접근 로그는 PUT 3건의 "총횟수"만 증명하고 "어느 조작이 어느 PUT인지"·"정리 후 175개 전부 null"이라는 서술형 주장까지는 뒷받침하지 못함(medium). 정리 단계는 별도 세션에서 재조회한 실제 응답 본문을 커밋해 독립 검증 가능하게 만들고, PUT 귀속 서술은 "로그로 증명되지 않는 설명"이라고 명시해 반영.

# T2-7 Codex 모드B 원문 (2026-10-24)

대상: `branch diff against main` + `work/T2-7/report.md`, `qa-evidence/T2-7/result.md`, `qa-evidence/T2-7/raw_log.txt`, `qa-evidence/T2-7/server-log-full.txt` 교차 대조

## Codex 출력 원문

```
# Codex Adversarial Review

Target: branch diff against main
Verdict: needs-attention

테스트 수와 PUT 3회는 로그와 일치하지만, 수동 QA 결과 및 PUT별 동작 귀속은 제시된 로그로 입증되지 않아 QA의 PASS 주장이 증거 범위를 넘어섭니다.

Findings:
- [medium] 수동 QA PASS와 PUT별 귀속을 로그가 뒷받침하지 않음 (qa-evidence/T2-7/result.md:27-40)
  result.md는 수동 브라우저 QA 전체를 PASS로 판정하고, PUT 3회를 저장 버튼 1회와 후속 fetch 2회로 귀속하며, 마지막 PUT 뒤 175개 노트의 hand 값이 모두 null이었다고 주장합니다(27, 29–40행). server-log-full.txt에는 PUT 3회(12, 17, 19행)가 있어 총횟수만 확인되지만 요청 본문·호출 주체·사용자 조작은 기록되지 않습니다. raw_log.txt에도 수동 브라우저 조작이나 175개 노트 검사 결과가 없습니다. 따라서 개별 QA 단계의 결과와 PUT별 설명은 네 문서의 원자료로 교차검증할 수 없으며, PASS 표시는 확인 가능한 증거보다 강합니다.
  Recommendation: PUT별 요청을 식별할 수 있는 시각·요청 본문 또는 QA 스크립트 출력과 브라우저 단계별 기록을 증거에 포함하고, 이를 제공할 수 없다면 해당 수동 QA 및 PUT 귀속 주장을 미검증으로 표시하세요.

Next steps:
- 수동 QA 단계와 PUT 호출을 연결하는 재현 가능한 기록을 추가한 뒤 판정을 갱신하세요.
```

## 반영
1. **"정리"(최종 상태) 주장을 재현 가능한 증거로 교체**: 원래는 QA 세션 중 콘솔 스크립트 출력 문자열(`{"totalNotes":175,"notesStillWithHand":0}`)만 서술로 인용했는데, 이건 그 순간의 실행 결과를 그대로 믿어야 하는 narrative 증거였다. **완전히 별도의 새 서버 프로세스를 띄워**(별도 로그 `server-log-cleanup-verification.txt`) 다시 `GET /songs/2/drumscore`를 호출하고, 그 실제 응답 본문을 그대로 `response-body-after-cleanup.json`으로 커밋 — `grep -c "handSource"` = 0, 비-null `"hand":"..."` 패턴 매치 0건을 파일 자체에서 누구나 재확인 가능. 이 2차 검증 세션의 로그에는 `GET`만 있고 `PUT`이 없어 "검증 자체가 데이터를 또 바꾸지 않았다"는 것도 로그로 확인됨.
2. **PUT 귀속 서술의 한계를 명시**: result.md에 "이 로그는 요청 본문·호출 주체를 남기지 않아 각 PUT을 어느 조작에 귀속시키는지까지는 로그만으로 증명되지 않는다"는 문장을 추가하고, 기존의 "저장 1건+정리 2건" 서술은 "수행 당시의 기억에 기반한 설명"이라고 명시적으로 구분 — 로그·파일로 증명되는 것(건수 3건, 정리 후 최종 상태)과 그렇지 않은 것(어느 PUT이 어느 조작인지)을 섞지 않도록 함.
