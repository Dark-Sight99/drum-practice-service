> 한 줄 요약: Codex 모드B(보고서 대조) — Conditional. [Major] 전역 평균×명목 타격 추정은 메커니즘을 직접 증명 안 함 — 가정 없는 구간별 직접 교차검증으로 교체(결과가 오히려 더 강해짐, 비율 1.018→1.006). [Major] song2.json 재현 명령 미문서화 — raw_log.txt에 curl 명령 추가. [Minor×2] "예외 없음"·"7개가 더 흔함" 등 표현을 분석 구간/표본으로 범위 한정. [Minor] 인과관계 단정 표현을 상관관계로 교정.

# T2-14 Codex 모드B 원문 (2026-10-24)

대상: `branch diff against main` + `qa-evidence/T2-14/result.md`, `hh_spacing_analysis.py`/`_output.txt`, `intent/07-open-questions.md`(Q-25 T2-14 추가분)

## Codex 출력 원문

```
Target: task/T2-14-feedback-7 vs main
Verdict: Conditional — the printed counts and arithmetic check out, but the
evidence does not support the conclusion as strongly as the prose suggests.

Findings:

- Major — the "HH explains SN drift" comparison is a rough correspondence, not
  a demonstrated cause. The script multiplies the average excess HH gap by a
  nominal eight hits per bar, then compares that estimate with T2-13's SN
  slope (a linear fit across bars 9-13). The arithmetic is correct
  ((120.03-110)×8≈80.2 ticks/bar; 0.3582×220≈78.8; ratio≈1.018) but multiplying
  a mean gap by eight does not show that HH spacing causes the measured SN
  slope — the script does not calculate an HH drift slope over those same bars
  and compare it directly with SN.
  Recommendation: describe this as a close numerical consistency check, not as
  quantitative confirmation of the mechanism.

- Major — the analysis script depends on an unpreserved local input
  (song2.json from a user-specific temp directory). The diff contains no copy,
  so the analysis cannot be independently rerun from the branch as submitted.
  Recommendation: document how to obtain the exact analyzed score.

- Minor — "10/10 SN notes in bars 9-13 match HH" is verified for the notes
  printed but doesn't establish a broader "no exceptions" claim beyond those
  notes. Keep the scope explicit: this is a result from the analyzed score
  data, not a general property.

- Minor — "7 notes per bar rather than expected 8" needs careful wording —
  accurate for the bars represented, doesn't establish a general expectation
  across incomplete/irregular bars, and the >=200-tick gap filter is an
  analysis heuristic, not a proven classification.

- Minor — causal/model-bias conclusions are appropriately hedged in places,
  but some phrases overstate what the evidence establishes — the exact matches
  and gap statistics support "SN follows HH at those observed ticks" and "HH
  gaps are not uniformly 110 ticks", not that SN drift is simply following HH
  as a cause, or that ADTOF is more likely than human rubato. Retain the
  uncertainty and frame the ADTOF explanation as a hypothesis.

Additional note: T2-13's 0.3582 beats/bar reuse is traceable and clearly
identified as a prior result — fair reuse, though it doesn't independently
validate the causal comparison.
```

## 반영
1. **가정 없는 직접 교차검증으로 교체(가장 중요)**: `hh_interval_crosscheck.py`를 새로 작성 — 전역 평균이나 명목 타격 수를 전혀 가정하지 않고, SN-HH 동기점 사이에 실제로 몇 번의 HH 타격이 있었는지 구간마다 직접 세어 경과 틱을 구함. 결과: 마디당 초과분 75·75·79·88틱(평균 79.25틱) — T2-13의 독립 계산값(78.8틱/마디)과 비율 **1.006**(기존 전역 평균 기반 1.018보다 오히려 더 가까워짐). `result.md`·`raw_log.txt`·Q-25 전부 이 직접 교차검증 결과로 갱신.
2. **재현 방법 문서화**: `raw_log.txt`에 `song2.json`을 받는 정확한 `curl` 명령(로그인→drumscore 조회) 전문 추가 — T2-11/T2-12/T2-13과 같은 패턴으로 통일.
3. **"예외 없음"·"7개가 더 흔함" 등 표현 범위 한정**: `result.md`·Q-25 모두 "분석된 구간(9~13마디)에서는", "표본에 포함된 마디들 중에선"처럼 명시적으로 범위를 좁히고, 200틱 필터가 "마디 경계임을 증명한 분류"가 아니라 "분석 편의상 휴리스틱"임을 명시.
4. **인과관계 단정 → 상관관계로 교정**: "SN은 그 HH를 충실히 따라갈 뿐"(인과 단정) 같은 표현을 "SN이 HH와 정확히 같은 위치에서 관찰되고, 두 수치가 거의 일치한다"(관찰된 정합)로 바꾸고, "이게 인과관계를 수학적으로 증명하는 건 아니다(둘 다 같은 근본 원인의 결과일 수도 있다)"를 명시적으로 추가.
