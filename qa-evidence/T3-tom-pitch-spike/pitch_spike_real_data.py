# 2단계: 실제 곡(MDB Drums, MusicDelta_Punk — HIT/MHT/HFT 3종 탐이 다 등장하는 트랙)의
# "드럼만 분리된" 오디오에서, 공식 ISMIR 2017 어노테이션이 표시한 각 탐 타격 시점을
# 그대로 잘라내 pyin으로 피치를 측정 — "하이탐(HIT) vs 미드/플로어(MHT/HFT)"가
# 실전 데이터에서도 피치로 갈리는지 확인.
import numpy as np
import librosa
from pathlib import Path

SR = 22050
DATASET = Path(r"C:\Users\Jaewoo\드럼연습서비스\data\datasets\MDBDrums\MDB Drums")
TRACK = "MusicDelta_Punk"


def load_annotation(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 2:
                rows.append((float(parts[0]), parts[1]))
    return rows


def onset_pitch(y, sr, onset_time, window=0.15):
    start = int(onset_time * sr)
    end = start + int(window * sr)
    seg = y[start:end]
    if len(seg) < sr * 0.03:
        return None
    f0, voiced_flag, voiced_prob = librosa.pyin(
        seg, sr=sr, fmin=40, fmax=400, frame_length=1024, hop_length=256
    )
    f0_valid = f0[~np.isnan(f0)]
    if len(f0_valid) == 0:
        return None
    return float(np.median(f0_valid))


sub = load_annotation(DATASET / "annotations" / "subclass" / f"{TRACK}_subclass.txt")
tom_onsets = [(t, lab) for t, lab in sub if lab in ("HIT", "MHT", "HFT", "LFT")]
print(f"{TRACK}: 탐 타격 {len(tom_onsets)}개 (HIT/MHT/HFT/LFT)")

y, sr = librosa.load(DATASET / "audio" / "drum_only" / f"{TRACK}_Drum.wav", sr=SR, mono=True)

by_label = {}
for t, lab in tom_onsets:
    p = onset_pitch(y, sr, t)
    if p is not None:
        by_label.setdefault(lab, []).append(p)

print("\n라벨별 피치(Hz) 분포:")
for lab, pitches in sorted(by_label.items()):
    arr = np.array(pitches)
    print(f"  {lab} (n={len(arr)}): 평균={arr.mean():.1f}, 중앙값={np.median(arr):.1f}, "
          f"표준편차={arr.std():.1f}, 범위=[{arr.min():.1f}, {arr.max():.1f}]")
