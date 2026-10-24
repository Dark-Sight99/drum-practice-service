# 2단계 확장: 트랙 1개(8개 타격)는 통계적으로 너무 적어서, MDB Drums 23개 트랙
# 전체를 돌며 HIT/MHT/HFT/LFT 라벨이 달린 탐 타격을 전부 모아 분포를 본다.
import glob
import os
import warnings

import numpy as np
import librosa

warnings.filterwarnings("ignore", message="With fmin=")

SR = 22050
DATASET = r"C:\Users\Jaewoo\드럼연습서비스\data\datasets\MDBDrums\MDB Drums"


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
    if len(seg) < sr * 0.05:
        return None
    f0, voiced_flag, voiced_prob = librosa.pyin(
        seg, sr=sr, fmin=50, fmax=400, frame_length=1105, hop_length=256
    )
    f0_valid = f0[~np.isnan(f0)]
    if len(f0_valid) == 0:
        return None
    return float(np.median(f0_valid))


by_label = {}
track_counts = {}
for subf in sorted(glob.glob(os.path.join(DATASET, "annotations", "subclass", "*_subclass.txt"))):
    track = os.path.basename(subf).replace("_subclass.txt", "")
    drum_wav = os.path.join(DATASET, "audio", "drum_only", f"{track}_Drum.wav")
    if not os.path.exists(drum_wav):
        continue
    sub = load_annotation(subf)
    tom_onsets = [(t, lab) for t, lab in sub if lab in ("HIT", "MHT", "HFT", "LFT")]
    if not tom_onsets:
        continue
    y, sr = librosa.load(drum_wav, sr=SR, mono=True)
    n_this_track = 0
    for t, lab in tom_onsets:
        p = onset_pitch(y, sr, t)
        if p is not None:
            by_label.setdefault(lab, []).append(p)
            n_this_track += 1
    track_counts[track] = n_this_track
    print(f"  {track}: 탐 {n_this_track}개 처리")

print("\n===== 전체 트랙 합산 — 라벨별 피치(Hz) 분포 =====")
for lab in ["HIT", "MHT", "HFT", "LFT"]:
    pitches = by_label.get(lab, [])
    if not pitches:
        print(f"  {lab}: 데이터 없음")
        continue
    arr = np.array(pitches)
    print(f"  {lab} (n={len(arr)}): 평균={arr.mean():.1f}Hz, 중앙값={np.median(arr):.1f}Hz, "
          f"표준편차={arr.std():.1f}Hz, 범위=[{arr.min():.1f}, {arr.max():.1f}]Hz")

print("\n===== '하이(HIT) vs 나머지(MHT+HFT+LFT)' 2그룹 분리 가능성 =====")
high = np.array(by_label.get("HIT", []))
low = np.array(by_label.get("MHT", []) + by_label.get("HFT", []) + by_label.get("LFT", []))
if len(high) and len(low):
    print(f"  HIT 그룹(n={len(high)}): 평균={high.mean():.1f}Hz, 범위=[{high.min():.1f},{high.max():.1f}]")
    print(f"  나머지 그룹(n={len(low)}): 평균={low.mean():.1f}Hz, 범위=[{low.min():.1f},{low.max():.1f}]")
    overlap = (high.min() <= low.max()) and (low.min() <= high.max())
    print(f"  두 그룹 범위가 겹치는가: {overlap}")
    # simple threshold at midpoint between means, report accuracy
    thr = (high.mean() + low.mean()) / 2
    tp = (high >= thr).sum()
    tn = (low < thr).sum()
    acc = (tp + tn) / (len(high) + len(low))
    print(f"  두 평균의 중간값을 임계값({thr:.1f}Hz)으로 썼을 때 분류 정확도: "
          f"{acc*100:.1f}% ({tp}/{len(high)} HIT 맞춤, {tn}/{len(low)} 나머지 맞춤)")
