> 한 줄 요약: 채보 직전 드럼 스템 음량을 RMS -18dBFS로 정규화하는 `normalize_loudness()`를 `adtof_transcriber.transcribe()`에 추가 — ADTOF-pytorch가 입력 음량을 자동 정규화하지 않아(소스 코드로 확인), 원곡 믹스에서 드럼이 작게 녹음된 곡은 대부분의 타격을 놓치는 문제를 해결. 실제 의뢰인 음원(backnumber)으로 재현 전/후 테스트해 노트 37개→460개(12.4배), 스네어 0개→100개로 늘어나는 것을 실제 서버·워커로 end-to-end 확인.

# T3-2 게이트 피드백 2차 — 채보 전 음량 정규화

## 배경
의뢰인이 실제 음원(backnumber, 4분)을 T3-1·T3-2로 분리·채보해보고 "드럼 자체 소리가 작은 곡인데, 이게 노트 생성에 영향이 있냐"고 질문.

## 원인 진단(추측 전 확인)
`data/repos/ADTOF-pytorch/src/adtof_pytorch/audio.py`의 `AudioProcessor`를 직접 읽어 확인:
- `normalize: bool = False`가 기본값이고, `create_adtof_processor()`의 기본 설정 딕셔너리도 `'normalize': False`.
- 우리 CLI 호출(`adtof_transcriber.py`)은 이 옵션을 켜지 않고 있었음 — 즉 **입력 오디오의 절대 음량이 그대로 모델에 들어감**, 모델 스스로 음량을 맞추는 단계가 없음.

## 실측 — 음량이 실제로 문제였는가
| 곡 | 드럼 스템 RMS | 채보 결과(정규화 전) |
|---|---|---|
| MDB 기준곡(F-measure 측정됨) | -18.0dBFS | 정상 |
| 희비교차(빠른 곡, 잘 됨) | -18.8dBFS | 994개 노트(4.53개/초) |
| **backnumber** | **-43.7dBFS**(약 25dB = 18배 더 조용함) | **37개 노트뿐(0.15개/초), 스네어·하이햇 0개** |

조용한 스템을 수동으로 +25.7dB 증폭해 ADTOF를 다시 돌려보니 460개로 늘고 스네어도 100번 잡힘 — 음량이 원인임을 1차 확인(이 스파이크 자체는 커밋 안 함, 바로 정식 구현으로 반영).

## 구현
`app/server/modules/transcriber/adtof_transcriber.py`:
- `normalize_loudness(input_path, target_rms_dbfs=-18.0) -> Path` 신설 — RMS를 목표 dBFS로 맞춘 새 임시 WAV를 만들어 경로를 반환(원본은 안 건드림). 목표값 -18dBFS는 **업계 표준이 아니라, 우리가 가진 "잘 작동한 두 곡"의 실측 RMS에서 따온 경험적 기본값**임을 코드 주석에 명시(과장 안 함). 목표 게인 적용 시 피크가 1.0을 넘으면 클리핑 방지로 추가 감쇠. RMS가 `SILENCE_RMS_FLOOR`(1e-6) 미만인 사실상 무음 입력은 증폭 안 함(노이즈만 커짐).
- `transcribe()`가 내부적으로 이 함수를 먼저 호출해 정규화된 임시 파일을 ADTOF에 넘기고, 끝나면 `finally`에서 정리. **외부 시그니처(입력/출력 경로, 반환값 없음)는 그대로**라 호출자(`modules/transcriber/handler.py`)는 변경 없음 — 이미 Codex 검수를 거친 T3-2 핸들러의 실패 처리·스테이징 로직을 안 건드림.
- 원본 채널 수·샘플레이트는 보존(`sr=None, mono=False`) — ADTOF 자신의 로더가 44.1kHz·모노로 다시 변환하므로 이중 리샘플링 방지.

## 위험 분류
새 공개 API·DB 변경 없음, 이미 승인된 모듈의 내부 전처리 단계 추가(입출력 인터페이스 불변) — T3-1/T3-2 설계 당시 이미 다룬 "외부 모델 연동" 범주의 연장이지 새로운 위험 범주가 아니라고 판단, Codex 모드C 생략(T3-2-feedback-1과 같은 기준). 모드A 코드 검수 2라운드 진행(1차 REQUEST_CHANGES 2건 전부 반영 → 2차 APPROVE WITH NITS, 나이트픽도 즉시 반영) — 전체 로그는 `codex-modeA.md`.

## QA 증거

### 자동 테스트
- `pytest`: **141개 전부 통과**(`pytest_output.txt`, 기존 134개 + 신규 7개).
  - `test_normalize_loudness.py`(6개): 조용한 신호 증폭, 이미 큰 신호 감쇠(일방적 증폭만이 아님), 클리핑 방지, 무음 입력은 안 건드림, 항상 새 임시 파일 반환(원본 보존).
  - `test_adtof_transcriber.py`(기존 4개는 `normalize_loudness`를 우회하는 autouse 픽스처로 수정 — 가짜 경로로 실제 오디오 로드 시도하지 않게 함, +2개 신규: `transcribe()`가 정규화 결과 경로를 ADTOF에 넘기는지, 성공/실패 양쪽에서 정규화 임시 파일이 정리되는지).
- `ruff check`: 0건.

### 실제 end-to-end(진짜 서버·워커·ADTOF, 의뢰인 실제 음원)
수정 전 이미 채보해뒀던 `backnumber`(song id=10)를 **같은 실제 서버·워커로 재채보**(`POST /songs/10/transcribe` → `worker.runner --once`) — find-or-create+스테이징 후 승격 로직(T3-2 기존 설계)이 그대로 작동해 재채보가 자연스럽게 되는 것도 같이 확인:

| | 정규화 전(`before_drumscore.json`) | 정규화 후 |
|---|---|---|
| 노트 개수 | 37 | **460**(12.4배) |
| 분류 | kick:33, tom_mid:4 | tom_mid:194, kick:165, **snare:100**, crash:1 |
| 밀도 | 0.15개/초 | 1.90개/초 |

하이햇은 정규화 후에도 0개 — 이 곡 자체에 하이햇이 거의 없거나, 분리 품질·모델 한계로 여전히 못 잡는 부분일 수 있음(원인 미확정, 과장 안 함). 실제 브라우저로도 연습 화면에서 스네어·탐·킥 노트가 정상 렌더링됨을 확인(이전엔 거의 빈 화면이었음).

## 가정·한계
- `-18dBFS` 기본값은 **2곡**의 실측에서 나온 값 — 표본이 작아 모든 곡에 최적이라고 단정 못 함. 향후 더 많은 실제 곡으로 검증되면 조정 가능하도록 `target_rms_dbfs` 매개변수로 분리해둠.
- 하이햇 미검출 문제는 이번 수정으로 해소 안 됨 — 별도 원인 조사가 필요하면 추후 과제.
- 이 수정은 Q-26(ADTOF 5-class 한계)과는 별개 문제(그쪽은 "분류"가 섞이는 문제, 이번은 "검출 자체"가 안 되는 문제) — Q-26에 혼동되지 않게 별도로 기록.

## 재현
```
cd app/server
npx pytest -q  # 실제로는: .venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check . --exclude .venv
```
실제 end-to-end는 기존 분리된 스템에 `POST /songs/{id}/transcribe` 재호출 + `worker.runner --once`로 재현 가능(같은 스템 파일이 남아있는 한).
