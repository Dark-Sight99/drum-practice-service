> 한 줄 요약: 윈도우(RTX 5060) Demucs 분리 시간 벤치마크 결과. REQ-01 수용 기준(3~5분 곡 처리) 충족 확인.

# T0-1 결과 — 서버 후보 벤치마크(윈도우만, 2026-10-23)

## 근거 REQ
REQ-01 오디오 분리 — 수용 기준 "3~5분 곡 업로드 → 분리 완료 후 각 트랙 개별 재생 가능", "처리 시간 측정값을 로그에 기록"

## 환경
| 항목 | 값 |
|---|---|
| OS | Windows 11 |
| GPU | NVIDIA GeForce RTX 5060 (8151MiB VRAM) |
| GPU 드라이버 | NVIDIA-SMI 610.88, CUDA 13.3 (UMD) |
| Python | 3.12.7 |
| torch | 2.11.0+cu128 (sm_120 Blackwell 인식 확인: `torch.cuda.get_device_capability(0)` → `(12, 0)`) |
| Demucs | 4.1.0 (adefossez/demucs, 공식 유지 저장소 — Q-08 해소, 상세는 INSTALL.md) |
| 모델 | htdemucs (기본) |

## 테스트 입력
MDB Drums 데이터셋(CC BY-NC-SA 4.0, T0-2용으로 이미 다운로드된 것 재사용)의 `MusicDelta_Disco_MIX.wav`(124.78s) + `MusicDelta_FusionJazz_MIX.wav`(110.99s)를 이어붙여 **235.77초(3.93분)** 테스트 파일 생성(`data/bench_input_4min.wav`, git 제외 대상).
- 이유: MDB Drums 원본 트랙은 전부 13~125초로 짧아 REQ-01의 "3~5분" 기준을 만족하는 실제 사용자 음원이 아직 없음(의뢰인 보유 음원 미확보 상태). 두 트랙을 이어붙여 길이 조건만 맞춘 합성 입력으로 **속도 측정**(음악적 내용은 무관)을 진행함 — 정확도 측정(T0-2)과는 별개 목적.

## 측정 결과 (`bench_demucs.py` 실행, 전체 로그는 `raw_log.txt`)
| 디바이스 | 입력 길이 | 처리 시간 | 배속(입력/처리) | 결과 |
|---|---|---|---|---|
| cuda (RTX 5060) | 235.77s | **22.76s** | 10.36배 | drums/bass/other/vocals 4트랙 정상 생성 |
| cpu | 235.77s | 53.43s | 4.41배 | drums/bass/other/vocals 4트랙 정상 생성 |

재현 명령:
```bash
.venv/Scripts/python.exe qa-evidence/T0-1/bench_demucs.py data/bench_input_4min.wav --device cuda --out data/bench_out
.venv/Scripts/python.exe qa-evidence/T0-1/bench_demucs.py data/bench_input_4min.wav --device cpu --out data/bench_out_cpu
```

## 수용 기준 충족 여부
- [x] 3~5분 곡(3.93분) 업로드 → 분리 완료, 각 트랙(drums/bass/other/vocals) 개별 파일로 생성됨(`data/bench_out/htdemucs/bench_input_4min/*.wav`) → 재생 가능 여부는 파일 존재로 간접 확인(직접 청취 검증은 안 함, 필요시 추가 가능)
- [x] 처리 시간 측정값 기록(위 표)
- [ ] 진행률/상태 표시, 실패 메시지 — 이건 REQ-10 작업 큐 구현(Phase 1) 범위이며 이번 스파이크 대상 아님

## 가정 및 한계 (지어내지 않음, 명시)
- 가정: GPU 분리 10.36배속은 "다른 무거운 작업이 동시에 돌지 않는" 유휴 상태에서의 측정값. 실제 서비스에서는 03-architecture-stack.md의 "워커는 GPU 작업 1개만 처리" 정책과 결합해 판단해야 함.
- 가정: 입력이 실제 음원이 아닌 합성 파일이라 "재생 가능"의 음질/내용은 검증하지 않음. 실제 사용자 음원 확보 전 임시 측정.
- 한계: 맥(M1) 벤치마크는 하지 않음(2026-10-23 의뢰인 결정, Q-01). `INSTALL.md`에 공용 실행 안내를 남겨 맥 입수 후 의뢰인이 직접 실행 가능하게 함.
- 한계: GPU 메모리 피크 사용량은 별도로 모니터링하지 않음(측정 전 여유 7613MiB 확인, OOM 없이 성공은 확인).

## 결론 (제안, 최종 결정은 의뢰인)
현재 측정 기준으로 윈도우(RTX 5060)에서 3~5분 곡 분리는 약 23초(GPU) ~ 53초(CPU)로 REQ-01 기준을 충분히 만족. 맥 비교 데이터가 없어 Q-01(서버 PC 최종 결정)은 여전히 보류 상태.
