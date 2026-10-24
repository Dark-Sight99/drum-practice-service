> 한 줄 요약: Codex 모드B(보고서 대조, 2회차) — needs-attention. 1차에서 추가한 응답 본문·GET-only 로그가 같은 요청인지(출처) 끝까지 증명되지 않는다는 재지적(medium). 타임스탬프 붙인 로그 + 요청 전후 시각·SHA-256 해시로 직접 상관관계 증명해 반영.

# T2-7 Codex 모드B 원문 (2026-10-24, 2차)

대상: `branch diff against main` + `work/T2-7/report.md`, `qa-evidence/T2-7/result.md`, `qa-evidence/T2-7/response-body-after-cleanup.json`, `qa-evidence/T2-7/server-log-cleanup-verification.txt`(1차 반영 확인)

## Codex 출력 원문

```
# Codex Adversarial Review

Target: branch diff against main
Verdict: needs-attention

정리 후 응답 본문은 175개 노트의 hand:null 상태를 보여주지만, 해당 본문과 GET-only 로그의 세션·응답 상관관계는 증명되지 않아 QA 증거로서의 출처가 여전히 불확실합니다.

Findings:
- [medium] C-001 정리 응답 본문과 GET 로그의 출처 연결이 검증되지 않음 (qa-evidence/T2-7/result.md:40)
  이전보다 나아졌습니다. 커밋된 JSON 본문 자체에는 175개 노트가 있고 각 hand가 null인 상태가 보입니다. 다만 JSON에는 캡처 시각·요청 식별자·HTTP 메타데이터가 없고, GET 로그도 시각이나 응답 식별 정보 없이 200 응답 한 건만 기록합니다. 따라서 이 본문이 로그에 기록된 GET의 실제 응답인지, 주장된 별도 서버 세션에서 받은 것인지 두 파일만으로 대조할 수 없습니다. 파일은 해당 상태의 스냅샷을 제시하지만 서버 조회와의 독립적인 교차검증까지 제공하지 않으므로, 정리 검증 PASS의 증거 강도는 제한됩니다.
  Recommendation: 응답 캡처에 요청 시각, URL, 상태 코드와 본문 해시를 함께 남기고, 로그에도 같은 요청을 식별할 시각 또는 요청 ID를 기록해 두 자료를 연결하세요. 또는 재현 가능한 검증 스크립트가 GET 응답을 직접 저장하며 노트 수와 non-null hand 수를 출력하도록 기록하세요.

Next steps:
- 정리 후 GET의 응답 캡처와 서버 로그를 같은 실행의 증거로 연결한 뒤 PASS 주장을 갱신하세요.
```

## 반영 — Recommendation을 그대로 따름
1. **서버 로그에 타임스탬프 추가**: `uvicorn ... | while read line; do echo "$(date -u ...) $line"; done`으로 접근 로그 각 줄에 UTC 타임스탬프(밀리초)를 붙임(`server-log-cleanup-verification-2.txt`).
2. **응답 캡처에 요청 시각 + 본문 해시**: 같은 `javascript_tool` 실행 안에서 요청 전후 `Date.toISOString()`과 `crypto.subtle.digest('SHA-256', ...)`로 계산한 해시를 함께 캡처(`cleanup-verification-correlation.md`에 원문 그대로 기록).
3. **상관관계 직접 증명**: 브라우저 측 `afterTimestamp`(09:04:56.615Z)와 서버 로그의 `GET /songs/2/drumscore` 줄(09:04:56.639Z)이 37ms 이내·그 구간 안에 유일하게 대응함을 보이고, 커밋된 `response-body-after-cleanup.json`에서 Write 도구가 붙인 개행 1바이트를 뺀 바이트열의 SHA-256이 브라우저가 계산한 해시와 **정확히 일치**함을 확인 — 이제 "이 파일이 그 로그 줄의 실제 응답"이라는 것이 추정이 아니라 해시 일치로 증명된다.
4. 1차에서 만든 비-타임스탬프 `server-log-cleanup-verification.txt`는 이제 2차 산출물로 완전히 대체돼 혼동을 줄이려 삭제.
