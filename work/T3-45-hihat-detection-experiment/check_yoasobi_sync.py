# 한 줄 요약: song id=6(YOASOBI)의 drumscore.json에 저장된 노트 시각(tick→초 환산)이
# 실제 드럼 스템 오디오의 독립 onset 검출 결과와 몇 초나 어긋나는지 직접 비교.

import json

import librosa
import numpy as np

DRUMSCORE_PATH = r"C:\Users\Jaewoo\드럼연습서비스\data\songs\6\drumscore.json"
DRUMS_WAV_PATH = r"C:\Users\Jaewoo\드럼연습서비스\data\songs\6\stem_drums.wav"

d = json.load(open(DRUMSCORE_PATH, encoding="utf-8"))
bpm = d["meta"]["bpm"]
ppq = d["ppq"]
audio_offset_ms = d["audioOffsetMs"]

note_times_s = sorted(
    (n["tick"] / ppq) * (60.0 / bpm) + audio_offset_ms / 1000.0 for n in d["notes"]
)
print(f"bpm={bpm}, ppq={ppq}, audioOffsetMs={audio_offset_ms}")
print(f"저장된 노트 시각(처음 10개, 초): {[round(t, 3) for t in note_times_s[:10]]}")

y, sr = librosa.load(DRUMS_WAV_PATH, sr=None, mono=True)
independent_onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False)
print(f"독립 onset 검출(처음 10개, 초): {[round(t, 3) for t in independent_onsets[:10]]}")

# 저장된 노트 시각 각각에 대해, 가장 가까운 독립 onset까지의 차이(초) — 부호 포함
# (양수 = 독립 onset이 저장된 노트 시각보다 "늦게" 실제로 울림 = 사용자가 보고한
# "노트가 지나간 뒤에 소리가 들린다"와 같은 방향)
diffs = []
for t in note_times_s[:200]:
    idx = np.searchsorted(independent_onsets, t)
    candidates = independent_onsets[max(0, idx - 1):idx + 2]
    if len(candidates) == 0:
        continue
    nearest = candidates[np.argmin(np.abs(candidates - t))]
    diffs.append(nearest - t)

diffs = np.array(diffs)
print(f"\n최근접 독립 onset과의 차이(초) — 평균: {diffs.mean():.4f}, 중앙값: {np.median(diffs):.4f}, "
      f"표준편차: {diffs.std():.4f}")
print(f"1박(60/{bpm}bpm) = {60.0/bpm:.4f}초")
print(f"처음 20개 차이: {[round(x, 3) for x in diffs[:20]]}")
