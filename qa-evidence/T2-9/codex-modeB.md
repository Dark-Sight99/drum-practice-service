> 한 줄 요약: Codex 모드B(보고서 대조, 1회차) — needs-attention. (1) F-measure만으로 사용자 증상과의 구간별 인과관계를 확정 못 함(high), (2) result.md/report.md의 하단 정렬 설명이 Codex 모드A 반영 전 수식(`noteSize/2` 일괄)으로 남아 최종 코드와 불일치(medium), (3) 바이트 동일 주장이 재현 가능한 원자료(해시·diff 종료코드) 없이 서술만 있음(medium). 전부 반영.

# T2-9 Codex 모드B 원문 (2026-10-24)

대상: `branch diff against main` + `work/T2-9/report.md`, `qa-evidence/T2-9/result.md`, `raw_log.txt`, `musicdelta-grunge-fmeasure.json`, `codex-modeA.md` 교차 대조

## Codex 출력 원문

```
# Codex Adversarial Review

Target: branch diff against main
Verdict: needs-attention

출시 보류: QA·보고서의 하단 정렬 설명은 최종 코드와 어긋나고, MIDI 정확도 수치만으로 사용자 증상의 원인을 확정할 수 없습니다.

Findings:
- [high] F-measure만으로 증상의 원인과 무관함을 확정할 수 없음 (qa-evidence/T2-9/result.md:20-22)
  TT의 `r=0.25`, `n_ref=12`, `n_est=6`은 전체 평가에서 탐 온셋이 적게 검출됐다는 근거지만, 어느 구간에서 누락됐는지 또는 사용자가 보고한 초반 불일치·중간 소리 끊김을 일으켰는지는 보여주지 않습니다. 그럼에도 결과는 증상과 수치가 '정확히 부합'하고 T2-x 구현 버그가 아니라고 단정합니다. 이 자료만으로는 그 결론을 검증할 수 없어 실제 재생 경로의 버그를 배제할 위험이 있습니다.
  Recommendation: 결론을 '모델 평가에서 탐 누락이 관찰됐으며 증상 원인과의 연관성은 확인되지 않음'으로 제한하고, 증상 구간의 MIDI 이벤트·오디오 재생을 대조해 원인을 확인하세요.
- [medium] 하단 정렬 설명이 최종 구현과 불일치 (qa-evidence/T2-9/result.md:16)
  결과와 보고서는 노트 위치를 일괄 `yCenter - noteSize/2`로 옮겼다고 설명하지만, 최종 코드에서는 `shapeBottomExtent(shape, noteSize)`를 사용해 도형별로 이동량이 다릅니다. `x-ring`은 `0.75 × size`, `x-large`는 `0.65 × size`만큼 이동합니다. 따라서 `noteSize/2` 상수 이동만으로 정밀도가 개선됐다는 설명과 위험 작업 판단의 근거가 실제 변경을 정확히 나타내지 않습니다. raw_log에는 이 변경을 검증하는 브라우저 QA 결과가 없고, 스크린샷은 result.md 스스로 정확한 접촉 프레임을 보장하지 않는다고 밝힙니다.
  Recommendation: result.md와 work/T2-9/report.md의 변경 설명을 최종 shape별 오프셋 구현에 맞추고, 실제 하단 돌출거리 계산을 포함해 위험 작업 판단을 다시 검토하세요.
- [medium] 출처 확인 로그는 바이트 동일 주장만 기록하고 비교 재현 정보가 부족 (qa-evidence/T2-9/raw_log.txt:23-26)
  raw_log.txt에는 두 파일이 동일하다는 문구와 파일 크기·시각만 있습니다. 실제 비교 명령이나 해시, 비교 종료 코드가 기록되지 않아 이 로그만으로는 바이트 비교 수행을 독립 재현하거나 확인할 수 없습니다. 따라서 보고서가 비교로 출처를 '확정'했다고 표현한 강도는 제출된 원자료가 직접 뒷받침하는 수준을 넘습니다.
  Recommendation: 비교 명령과 종료 코드 또는 두 파일의 SHA-256 해시를 증거에 포함하고, 출처 결론은 해당 산출물을 만든 파이프라인 기록과 함께 제시하세요.

Next steps:
- 최종 코드 기준으로 T2-9 결과·보고서의 하단 정렬 설명을 갱신하세요.
- 증상 구간을 실제 오디오와 MIDI 이벤트에 대조하기 전까지 모델 정확도와 사용자 증상의 인과 결론을 유보하세요.
- MusicDelta_Grunge 비교 명령 또는 해시를 재현 가능한 증거로 남기세요.
```

## 반영
1. **인과관계 표현 한정**(Recommendation 그대로 채택): result.md·report.md의 "정확히 부합한다"는 결론을 "곡 전체 평균 수치라 구간 단위 인과까지는 증명 안 됨 — '같은 범주의 오류'라는 정황 설명까지만 주장"으로 교체. "T2-x 구현에 실제 버그가 없다고 배제하지 않는다"는 문장을 명시적으로 추가.
2. **하단 정렬 설명을 최종 코드에 맞춤**: `yCenter - noteSize/2`(1차, Mode A 반영 전) 서술을 `yCenter - shapeBottomExtent(shape, noteSize)`(최종)로 교체하고, 1차→Codex 모드A 지적→최종이라는 경과를 명시.
3. **출처 확인을 재현 가능한 증거로 보강**: `raw_log.txt`에 두 파일의 SHA-256 해시(`certutil -hashfile`)와 `diff` 명령의 종료 코드(0)를 추가 — 서술("동일하다")이 아니라 숫자로 누구나 재확인 가능하게 함.
