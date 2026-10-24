> 한 줄 요약: Codex 모드B(보고서 대조, 1회차) — needs-attention. [medium] 오디오 지연 방향이 실제론 반대(소리가 화면보다 먼저)인데 보고서는 "소리가 늦다"로 서술 — 합성 신호로 부호를 직접 검증해 정정, outputLatency 가설 철회. [low] "재생 중 확인" 주장이 정지 화면 캡처 범위를 넘어섬 — 표현 한정. 모드A 지적(사용자 지정 노트 처리)은 현재 코드에 올바르게 반영됐음을 확인.

# T2-11 Codex 모드B 원문 (2026-10-24)

대상: `branch diff against main` + `work/T2-11/report.md`, `qa-evidence/T2-11/result.md`, `raw_log.txt`, `sticking_sim_output.txt`, `cross_correlation_output.txt`, `sync_extract_output.txt`, 스크린샷 3장, `codex-modeA.md` 교차 대조

## Codex 출력 원문

```
# Codex Adversarial Review

Target: task/T2-11-feedback-4 vs main; work/T2-11/report.md, qa-evidence/T2-11/; current sticking.ts

Verdict: needs-attention

Findings:

- [medium] 오디오 지연의 방향을 반대로 해석함 (qa-evidence/T2-11/cross_correlation.py:20–25;
  qa-evidence/T2-11/result.md:26–29; work/T2-11/report.md:20)
  스크립트에서 lag=+7은 오디오 시계열의 앞부분과 영상 시계열의 7프레임 뒤를 맞춥니다
  (v[t+7]와 a[t]). 따라서 이 결과가 뜻하는 방향은 영상이 오디오보다 약 233ms 늦음입니다.
  보고서의 "소리가 화면보다 약 230ms 늦다"와 반대입니다. raw log의 상관계수와 제한
  사항은 출력과 일치하지만, 제한 사항이 이 부호 오류를 해결해주지는 않습니다.
  Recommendation: lag 정렬 부호를 고쳐 재계산하거나, 현재 계산을 유지한다면 지연
  방향을 바꾸고 result.md와 report.md의 설명을 함께 정정하세요.

- [low] '재생 중 확인' 주장에 비해 이미지 증거가 제한적임 (work/T2-11/report.md:18;
  qa-evidence/T2-11/screenshot-playback-header-bottom-rl-dense.jpg)
  캡처는 브라우저 UI에서 하단 레인 머리글과 조밀한 구간의 R/L 레이블을 보여주므로
  배치와 레이블 가시성은 뒷받침합니다. 다만 정지 화면만으로는 재생 중 여러 노트가
  지나가는 동안 레이블이 계속 보였다는 점까지 확인하기 어렵습니다. 특히 raw log에는
  이 재생 확인을 뒷받침하는 브라우저 영상이나 타임라인 기록이 없습니다.
  Recommendation: 해당 주장을 "브라우저 화면 캡처에서 밀집 구간의 레이블이 보임"으로
  한정하거나, 재생 중 지속 가시성을 주장하려면 재생 장면 증거를 추가하세요.

- [확인 결과] 모드 A 지적은 현재 코드에 반영됨 (app/web/src/score/sticking.ts:71–75;
  app/web/src/score/sticking.test.ts)
  고정 우선순위 맵에서 사용자 지정 손이 R이 아닌 노트를 제외하고, 이를 검증하는
  테스트도 추가했습니다. 모드 A의 사용자 지정 L 노트가 자동 추천 충돌 맵에서 R을
  점유한 것으로 잘못 계산되던 문제는 수정된 것으로 보입니다.

Recommendation: 오디오 지연 방향을 먼저 바로잡고, 브라우저 검증 표현을 캡처가
증명하는 범위에 맞추세요. 레인 머리글 이동, 조밀한 구간에서의 레이블 표시,
hihat+crash 동시 타격 수정, 그리고 같은 틱의 snare/crash 잔여 충돌을 한계로 공개한
내용은 확인한 증거와 대체로 일치합니다. raw_log.txt의 133/133 테스트 수치도 해당
로그의 출력과 일치합니다.

확인하지 못한 것: 첨부 동영상 및 로컬 오디오 파일 자체는 제공되지 않아 다시
분석하지 않았습니다. 이미지는 모두 확인했습니다.
```

## 반영
1. **오디오 지연 방향 정정(가장 중요)**: `sign_check.py`를 새로 작성 — `cross_correlation.py`와 완전히 같은 lag 루프를, "오디오가 화면보다 7프레임(233ms) 늦는다"는 정답을 고정한 합성 신호(시각 스파이크 뒤 7프레임에 오디오 스파이크)에 적용해 이 코드가 실제로 어느 부호를 어느 방향으로 보고하는지 직접 검증. 결과: 정답("오디오가 늦음=화면이 먼저")에 대해 스크립트는 `best_lag=-7`을 보고함(corr=1.07) — 즉 "화면이 먼저"는 **음수** lag로 나타난다. 실제 영상 분석의 `best_lag=+7`은 반대 부호이므로, **실제로는 소리가 화면보다 약 233ms 먼저**였다는 뜻 — 최초 서술("소리가 늦다")과 정반대. `result.md`·`report.md`·`raw_log.txt`·`intent/07-open-questions.md`(Q-05, Q-24) 전부 방향을 정정.
2. **outputLatency 가설 철회**: 방향이 뒤집히면서 "하드웨어 출력 지연(소리를 늦추기만 하는 값)"으로는 "소리가 먼저"인 이 현상을 설명할 수 없음을 깨달아 그 가설을 폐기 — 대신 화면 녹화 소프트웨어의 영상 인코딩 지연(오디오보다 흔히 큼)을 더 유력한 설명으로 교체하고, Q-24를 "앱 버그 vs 녹화 아티팩트" 질문으로 재정의.
3. **"재생 중 확인" 표현을 캡처 범위로 한정**: `result.md`·`report.md` 둘 다 "정지 화면 캡처에서 그 시점에 라벨이 안 지워졌음을 확인"으로 범위를 좁히고, "재생 내내 계속 보였다"는 별도의 미증명 주장임을 명시(이 세션 도구로는 재생 녹화가 불가능하다는 T2-8~T2-10의 기존 한계와 동일선상).
4. 모드A 지적 반영 확인은 Codex 스스로 "반영됨"으로 판정 — 추가 조치 없음.
