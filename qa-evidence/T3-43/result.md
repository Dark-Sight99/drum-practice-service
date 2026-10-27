> 한 줄 요약: 벤더 패키지(ADTOF-pytorch) LABELS_5의 하이햇/탐 채널 순서가 모델 실제 출력과 반대임을 실제 모델 추론 + 실제 곡(Pretender) 채널별 활성화 통계로 확인.

# T3-43 하이햇/탐 라벨 뒤바뀜 — 실측 기록

## 배경
의뢰인이 사람이 만든 Pretender(Official髭男dism) 악보와 생성된 DrumScore(song id=18)를 비교하다가, 생성 데이터에 하이햇이 0개, 탐이 280개(전체 725개 중 39%)나 있는 걸 발견. 악보는 거의 모든 마디에 하이햇이 꾸준히 나오고 탐은 드문드문만 나오는데 정반대였음.

## 실측 1 — 벤더 패키지 내 문서 간 불일치
`data/repos/ADTOF-pytorch`(git 추적 밖, CLAUDE.md §5) 안에서 채널 순서를 설명하는 두 곳이 서로 다름:

- `src/adtof_pytorch/post_processing.py`: `LABELS_5 = [35, 38, 47, 42, 49]` — 순서상 인덱스2=47(탐), 인덱스3=42(하이햇)이라고 가정.
- `examples/example_usage.py`, `examples/visualize_activations.py`: `class_names = ["Bass Drum (BD)", "Snare Drum (SD)", "Hi-Hat (HH)", "Tom-Tom (TT)", "Cymbal (CY)"]` — 인덱스2=하이햇, 인덱스3=탐이라고 명시.
- `dev/adtof_pytorch.py:355`: `output_classes=5,  # BD, SD, HH, TT, CY` — 역시 인덱스2=하이햇, 인덱스3=탐.

같은 저장소 안에서 `post_processing.py`만 인덱스 2·3이 반대로 기록돼 있음.

## 실측 2 — 실제 모델을 실제 곡에 직접 통과시켜 채널별 활성화 확인
입력: `data/songs/18/stem_drums.wav`(song id=18, pretender, 315초, 실제 업로드·분리된 드럼 스템)

```python
import sys
sys.path.insert(0, 'data/repos/ADTOF-pytorch/src')
from adtof_pytorch import transcribe_to_midi
pred = transcribe_to_midi('data/songs/18/stem_drums.wav', 'dummy.mid',
                           return_activations=True, device='cpu')
# pred shape: (1, 31525, 5)
```

결과(채널 인덱스별, `LABELS_5` 기준 라벨 표기):

| 인덱스 | LABELS_5 라벨 | mean | max | frac>0.3(임계값 넘는 프레임 비율) |
|---|---|---|---|---|
| 0 | kick(35) | 0.0146 | 0.70 | 2.13% |
| 1 | snare(38) | 0.0078 | 0.80 | 0.57% |
| 2 | **탐(47)** | 0.0233 | 0.77 | **2.50%** |
| 3 | **하이햇(42)** | 0.0003 | 0.06 | **0.00%**(315초 전체에서 단 한 프레임도 임계값 0.32를 못 넘음) |
| 4 | crash(49) | 0.0001 | 0.01 | 0.00% |

## 해석
- "탐"이라 라벨링된 채널(인덱스2)은 킥과 비슷한 수준으로 활발(2.5%) — 이건 거의 모든 마디에 꾸준히 나오는 **하이햇**의 활동 패턴과 일치하지, 보통 필인에만 드문드문 쓰는 탐의 패턴이 아님.
- "하이햇"이라 라벨링된 채널(인덱스3)은 5분 내내 단 한 번도 반응 안 함 — 악보상 실제로 거의 없는 **탐**의 패턴과 일치.
- 실측 2(모델 행동)가 실측 1(같은 저장소 예제 코드의 문서화된 채널 순서)과 정확히 일치하고, 둘 다 실제 악보(그라운드 트루스)와 맞음 — `LABELS_5`의 인덱스 2·3(GM 피치 47·42) 배정이 모델의 실제 출력 순서와 반대라는 결론.

## 결론 및 조치
- 벤더 패키지 소스(`data/` 밖, git 추적 안 함) 자체는 고치지 않고, 우리 번역 계층(`app/server/modules/transcriber/midi_to_drumscore.py`의 `PITCH_TO_PIECE`)에서 GM 42/47 매핑을 서로 바꿔 보정(Q-41).
- crash(인덱스4)도 활동이 거의 없음(max 0.01)이 같이 관측됐으나, 이건 별도 문제(Q-26 "크래시/라이드 확장" 미해결 과제와 같은 범주로 보임, 이번 조사 범위 밖) — 섣불리 같이 손대지 않음.
