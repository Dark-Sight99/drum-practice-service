> 한 줄 요약: ADTOF 로컬 실행 확인 및 MDB Drums 5트랙 기준 F-measure 측정 결과(macro 0.7585). 대안 모델(ADTOF-pytorch) 사용, 라이선스 미표시 이슈 있음(Q-15).

# T0-2 결과 — 드럼 채보 모델 실행·정확도 측정(2026-10-23)

## 근거 REQ
REQ-02 드럼 채보 모델 — "경로 A: 기준곡으로 분류별 F-measure 측정·기록", "대안 모델 1개 이상 조사(라이선스 포함)"

## 모델 선택 경위 (의뢰인 확인 완료)
1. 원 모델 **ADTOF(MZehren/ADTOF)**: TensorFlow+madmom 의존. madmom은 PyPI에 소스(tar.gz)만 배포되어 설치 시 항상 C 컴파일이 필요(확인: https://pypi.org/pypi/madmom/json, 전 버전 sdist만 존재). 이 PC엔 MSVC Build Tools·WSL 둘 다 없어 즉시 빌드 불가.
2. README에 명시된 **대안**(이미 REQ-02의 "대안 모델 1개 이상 조사" 요구를 겸함): [`xavriley/ADTOF-pytorch`](https://github.com/xavriley/ADTOF-pytorch) — torch/librosa/pretty_midi만 필요, madmom·TensorFlow 불필요. 저자 자체 벤치마크(MDBDrums++ 기준) F-measure 88.51 vs 원본 88.74(차이 약 -0.2%p).
3. 의뢰인에게 "ADTOF-pytorch로 단축 진행" vs "Build Tools 설치 후 원본 진행" vs "둘 다" 질문 → **"ADTOF-pytorch로 단축 진행(추천)" 선택**(2026-10-23). 라이선스 이슈는 Q-15로 별도 기록.
4. 이번 스파이크는 **ADTOF-pytorch**로 진행.

## ⚠ 라이선스 이슈 (Q-15, 신규)
`ADTOF-pytorch` 저장소에는 LICENSE 파일이 없고 GitHub API도 `"license": null`을 반환(확인: `curl https://api.github.com/repos/xavriley/ADTOF-pytorch`, 2026-10-23). 원본 ADTOF는 CC BY-NC-SA 4.0으로 명확하지만, 이 포크는 그 가중치를 변환해 사용하면서도 자체 라이선스 표시가 없어 **사용 권한이 법적으로 불분명**함. 지금은 Phase 0 내부 정확도 측정(배포 없음)에만 사용. Phase 3(T3-2, 실제 서비스 구현)에 이 모델을 채택할지는 **별도로 라이선스를 재확인하거나 저자에게 문의한 뒤 결정**해야 함 — 지금 단정하지 않음.

## 환경
Python 3.12.7, torch 2.11.0+cu128(T0-1과 동일 venv), adtof-pytorch 0.1.0(`pip install -e`로 설치, 소스: data/repos/ADTOF-pytorch, git 추적 안 함).

## 평가 파이프라인 (REQ-02 경로 A를 그대로 재현: 분리 후 채보)
```
full_mix.wav --[Demucs htdemucs, GPU]--> drums.wav --[adtof-pytorch CLI]--> output.mid
```
→ output.mid의 온셋을 MDB Drums 정답 어노테이션(`annotations/class/*.txt`)과 클래스별로 비교.

클래스 매핑(`adtof_pytorch/post_processing.py`의 `LABELS_5 = [35, 38, 47, 42, 49]` 소스 확인):
| GM 피치 | 의미 | MDB 라벨 |
|---|---|---|
| 35 | kick | KD |
| 38 | snare | SD |
| 47 | tom(합산) | TT |
| 42 | hihat(합산) | HH |
| 49 | cymbal(합산) | CY |

MDB의 `OT`(기타 타악기) 라벨은 5-class 모델에 대응 클래스가 없어 평가 제외(원 논문 관례).

측정 지표: `mir_eval.onset.f_measure(ref, est, window=0.05)` — mir_eval 기본값(±50ms) 그대로 사용(추측 아님, `inspect.signature`로 실제 확인).

## 테스트 트랙 (5곡, CY/HH/KD/SD/TT 5개 클래스를 모두 포함하는 트랙 중 선정)
MusicDelta_FreeJazz, FunkJazz, FusionJazz, LatinJazz, Grunge (합계 약 6.2분)

## 결과 (클래스별 F-measure 평균, 전체 로그: `result_raw.json`)
| 클래스 | 평균 F-measure | 비고 |
|---|---|---|
| KD(킥) | **0.9487** | 안정적으로 높음 |
| SD(스네어) | **0.8506** | 양호 |
| HH(하이햇) | **0.6980** | FreeJazz 트랙에서 0.0(n_ref=7건뿐, 극단치) — 표본 적은 트랙 영향 큼 |
| CY(크래시/라이드 합산) | **0.8144** | 양호 |
| TT(탐 합산) | **0.4810** | 트랙당 탐 샘플 수가 2~23건으로 적어 추정치 불안정(특히 LatinJazz n_ref=2에서 F=0) |
| **전체 macro 평균** | **0.7585** | 산출 방식(Codex 검수 C-002 반영, 2026-10-23 명시): 클래스별로 "트랙 5개 중 해당 클래스가 등장한(n_ref>0) 트랙들의 F-measure 평균"을 먼저 구하고, 그 **5개 클래스 평균**을 다시 평균한 값(macro-of-macro). 트랙에 해당 클래스가 전혀 없는 경우(n_ref=0)는 그 트랙·클래스 조합을 집계에서 제외함(`eval_adtof.py` 97~101행) |

## 해석 (가정 명시, 지어내지 않음)
- 이 수치(0.7585)는 저자가 보고한 88.51(클린 분리 없이 측정했을 가능성이 있는 벤치마크, MDBDrums++ 데이터셋)보다 낮음. 원인으로 추정되는 것(확인은 안 됨):
  1. 우리 파이프라인은 REQ-02 경로 A대로 **Demucs 분리를 먼저 거침** — 분리 잡음이 채보 정확도를 낮출 수 있음(저자 벤치마크가 분리 전/후 중 어느 쪽인지는 README에 명시 안 됨 — 확인 필요 항목으로 남김).
  2. 평가에 사용한 데이터셋(MDB Drums 원본)과 저자가 쓴 MDBDrumsPlusPlus(강화판)가 동일하지 않을 수 있음.
  3. TT·CY처럼 트랙당 샘플 수가 적은 클래스는 F-measure가 몇 건의 오탐/누락만으로 크게 흔들림(통계적으로 불안정) — 더 많은 트랙으로 재측정하면 달라질 수 있음.
- 가정: threshold는 CLI 기본값(`--thresholds` 미지정) 사용. 클래스별 threshold 튜닝은 하지 않음 — 튜닝하면 수치가 달라질 수 있음.

## REQ-02 수용 기준 충족 여부
- [x] 경로 A: 기준곡(5곡)으로 분류별 F-measure 측정·기록 완료
- [x] 대안 모델 1개 조사(라이선스 포함) — ADTOF-pytorch, 라이선스 불명 이슈 Q-15로 기록
- 목표 F-measure 수치는 아직 의뢰인과 확정하지 않음(원래 계획대로 "Phase 0 측정 후 설정" — 이번 측정값(위 표)을 토대로 의뢰인이 목표치를 정할 차례)
