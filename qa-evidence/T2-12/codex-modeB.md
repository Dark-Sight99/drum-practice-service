> 한 줄 요약: Codex 모드B(보고서 대조) — needs-attention. [low] report.md의 "녹화 아티팩트 가설을 강하게 뒷받침" 표현이 result.md보다 과한 확신도 — "일치하는 추가 증거"로 낮춰 두 문서의 신중함 수준을 맞춤. 나머지 모든 수치·주장(틱 간격, sticking_sim 결과, 교차상관 lag/corr, 부호 해석, 테스트 수)은 원시 증거와 전부 일치 확인.

# T2-12 Codex 모드B 원문 (2026-10-24)

대상: `branch diff against main` + `work/T2-12/report.md`, `qa-evidence/T2-12/result.md`, `raw_log.txt`, `sticking_sim.py`/`_output.txt`, `cross_correlation.py`/`_output.txt`, `sync_extract_output.txt`, `vitest_output.txt`, 스크린샷

## Codex 출력 원문

```
Target: task/T2-12-feedback-5 vs main; work/T2-12/report.md 및 qa-evidence/T2-12/의
보고서·원시 증거 대조
Verdict: needs-attention

Findings:

- [low] 녹음 아티팩트 해석의 확신도를 낮추는 편이 정확함 (work/T2-12/report.md:16;
  qa-evidence/T2-12/result.md:28)
  수치 비교는 증거와 일치합니다. 새 녹음은 lag=-1 프레임, 전체 corr 0.4319, 후반
  corr 0.6284이고, T2-11 녹음은 lag=+7 프레임, corr 0.2126, 후반 corr 0.5548입니다.
  앱의 오디오·렌더링 코드 변경도 diff에서 확인되지 않았습니다. 다만 보고서는 이
  변화를 녹음 아티팩트 가설을 "강하게" 뒷받침한다고 표현합니다. 두 녹음의 상관
  분석만으로는 녹음 조건이나 연주 차이의 영향을 분리하지 못하고, 새 녹음의 전체
  corr도 0.43입니다. result.md는 가능성을 뒷받침하는 추가 증거로 한정하고 Q-24가
  미해결임을 밝혀 더 신중하게 표현합니다.
  Recommendation: 보고서도 "녹음 아티팩트 가설과 일치하는 추가 증거" 정도로
  낮추고, 원인 확정이 아니라는 점을 결과 문서와 같은 수준으로 명시하세요.

확인된 주장:
- raw_log.txt의 GET 결과 기록에는 crash tick이 [959, 4550, 17270]으로 나오며,
  17270 crash와 17274 hihat 간격은 4틱, 9.1ms입니다. T2-11의 exact-tick 검사로는
  놓쳤다는 설명이 기록과 부합합니다.
- 보존된 sticking_sim.py 출력은 17270 crash=L, 17274 hihat_closed=R입니다.
  sticking.ts 변경도 ppq/16 허용폭을 이용해 근접한 고정 R 피스 충돌을 처리합니다.
  캡처에서도 A-B 루프와 R/L 표시가 확인됩니다.
- T2-12 cross_correlation.py는 T2-11의 수정된 Pearson 상관 스크립트와 코드가
  동일합니다. 새 입력에 대해 -1 프레임(-33.3ms), corr 0.4319 및 후반 0.6284를
  출력하며, T2-11 출력의 +7 프레임(+233.3ms), corr 0.2126 및 후반 0.5548과
  일치합니다.
- T2-11의 sign_check.py는 오디오가 시각보다 늦은 합성 신호에서 음수 lag를 내는
  규칙을 확인합니다. 따라서 T2-12의 lag=-1을 "오디오가 화면보다 약 33ms 늦음"으로
  해석한 것은 일관되고 정확합니다.
- 테스트 수 137/137은 raw_log.txt, vitest_output.txt, 두 보고서에서 일치합니다.
  추가적인 숫자 불일치나 오래된 수치는 찾지 못했습니다.

Recommendation: 보고서의 아티팩트 가설 문장만 result.md와 같은 신중한 강도로
조정하세요. 스크린샷은 화면의 R/L 표시를 뒷받침하지만, 실제 소리와 시각의
동기화를 단독으로 입증하지는 않습니다.
```

## 반영
1. **표현 강도를 result.md 수준으로 하향**: `work/T2-12/report.md`의 요약 줄과 "오디오 지연 재분석" 항목에서 "강하게 뒷받침한다"를 "일치하는 추가 증거다(확정 아님)"로 수정, 두 녹화 세션의 조건 차이(마이크 설정·연주)를 분리하지 못한다는 한계도 명시.
2. 나머지 모든 수치·주장(크래시 틱 3개·17270/17274 간격 9.1ms, sticking_sim 수정 전/후 결과, 교차상관 lag/corr 수치, 부호 해석, 테스트 137/137)은 Codex가 원시 증거와 전부 일치함을 직접 확인 — 추가 수정 없음.
