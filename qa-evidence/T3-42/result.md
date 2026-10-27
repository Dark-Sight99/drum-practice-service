> 한 줄 요약: librosa 비트 트래킹으로 실제 Pretender 드럼 스템(song id=18)에서 템포를 추정한 실측 기록 — 기본 설정(120)은 123.05bpm(옥타브 오류), start_bpm을 80~100으로 낮추면 92.29bpm으로 정확히 수렴함을 확인.

# T3-42 템포 추정 — 실측 기록

## 배경
의뢰인이 사람이 만든 Pretender(Official髭男dism) 악보(♩=92)와 생성된 DrumScore를 비교하다가, 생성된 쪽은 `bpm: 120.0`으로 저장돼 있음을 발견(Q-40). 원인 추적 결과 ADTOF-pytorch가 템포를 전혀 추정하지 않아 `pretty_midi.PrettyMIDI()`가 라이브러리 기본값(120)을 그대로 쓰고 있었음.

## 실측 1 — pretty_midi 기본 템포 확인
```python
>>> import pretty_midi
>>> m = pretty_midi.PrettyMIDI()
>>> m.get_tempo_changes()
(array([0.]), array([120.]))
```
`initial_tempo` 인자 없이 생성하면 항상 120.0 — ADTOF-pytorch의 `post_processing.py:136`도 `pretty_midi.PrettyMIDI()`를 인자 없이 호출함(소스 확인).

## 실측 2 — librosa 비트 트래킹으로 실제 곡 템포 추정
입력: `data/songs/18/stem_drums.wav`(song id=18, pretender, 실제 업로드·분리된 드럼 스템, 315초)

```python
>>> import librosa
>>> y, sr = librosa.load('data/songs/18/stem_drums.wav', sr=None, mono=True)
>>> librosa.beat.beat_track(y=y, sr=sr)  # 기본 start_bpm=120
(array([123.046875]), array([...]))  # 걸린 시간 약 7.9s
```
→ 기본 설정은 **123.05bpm**으로 수렴 — 92 × 4/3 ≈ 122.67에 가까움(옥타브/배수 모호성, MIR 분야에서 흔히 알려진 비트 트래킹 오류 패턴).

```python
>>> onset_env = librosa.onset.onset_strength(y=y, sr=sr)
>>> for sb in [60, 80, 92, 100, 120, 150]:
...     tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, start_bpm=sb)
...     print(sb, '->', tempo)
60 -> [61.5234375]
80 -> [92.28515625]
92 -> [92.28515625]
100 -> [92.28515625]
120 -> [123.046875]
150 -> [123.046875]
```
→ `start_bpm`을 80~100 범위로 낮추면 **92.29bpm**으로 정확히 수렴(악보의 92와 오차 0.3%). `start_bpm`이 120 이상이면 틀린 123bpm 쪽으로 수렴.

## 결론 및 선택
- `librosa.beat.beat_track()`의 비트 트래킹 자체는 정상 동작하지만, 함수 자체의 기본 `start_bpm=120.0`이 하필 틀린 답 쪽으로 편향시키고 있었음.
- `modules/transcriber/tempo.py`의 `estimate_tempo()`는 `start_bpm=100.0`을 기본값으로 둠 — 이 표본(Pretender)에서 올바른 답(92bpm)으로 수렴하는 범위(80~100) 안에 있는 값을 선택.
- **주의**: 이건 표본 1곡 기준 경험적 선택이다. 다른 곡·다른 장르에서는 여전히 옥타브 오류가 날 수 있음 — "항상 정답"이 아니라 "아무 보정 없이 118~120으로 고정돼 있던 것보다 나은 추정"이라는 수준으로 이해해야 함(Q-40에 그대로 기록).

## 재현 방법
```bash
cd app/server
.venv/Scripts/python.exe -c "
import librosa
y, sr = librosa.load('../../data/songs/18/stem_drums.wav', sr=None, mono=True)
onset_env = librosa.onset.onset_strength(y=y, sr=sr)
for sb in [80, 100, 120]:
    tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, start_bpm=sb)
    print(sb, '->', tempo)
"
```
