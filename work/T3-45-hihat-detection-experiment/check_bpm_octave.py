# 한 줄 요약: 공식영상 소스의 드럼 스템에서 start_bpm을 바꿔가며 beat_track을 돌려,
# 92bpm(현재 추정값)과 184bpm(의뢰인이 발견한 songscription 기준값)이 옥타브 관계인지 확인.

import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\Jaewoo\드럼연습서비스\app\server")

import librosa
import numpy as np

DRUMS_PATH = Path(
    r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\separated_compare"
    r"\official_video_mp3\htdemucs\Official髭男dism - Pretender［Official Video］ (1)\drums.wav"
)

y, sr = librosa.load(str(DRUMS_PATH), sr=None, mono=True)

for start_bpm in [60, 80, 92, 100, 120, 140, 160, 184, 200]:
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr, start_bpm=start_bpm)
    bpm = float(np.asarray(tempo).reshape(-1)[0])
    print(f"start_bpm={start_bpm:>4} -> 추정 bpm={bpm:.3f}")
