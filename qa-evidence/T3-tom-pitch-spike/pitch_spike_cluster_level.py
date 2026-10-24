# 3단계: 클러스터(필인) 단위 분류 — 타격 하나하나가 아니라, 0.5초 이내로 뭉친
# 탐 구간 전체를 하나의 단위로 보고 피치를 재추정했을 때 "하이(HIT) vs 나머지"
# 분류 정확도가 개선되는지 확인(앞선 클러스터 패턴 분석에서 76%가 "같은 탐 반복"
# 이었던 것에 근거 — qa-evidence/T3-tom-pitch-spike/result.md §4 참조).
import glob
import os
import warnings

import numpy as np
import librosa
from collections import Counter

warnings.filterwarnings("ignore")

SR = 22050
DATASET = r"C:\Users\Jaewoo\드럼연습서비스\data\datasets\MDBDrums\MDB Drums"
RANK = {"HIT": 0, "MHT": 1, "HFT": 2, "LFT": 3}


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
    f0, vf, vp = librosa.pyin(seg, sr=sr, fmin=50, fmax=400, frame_length=1105, hop_length=256)
    f0v = f0[~np.isnan(f0)]
    return float(np.median(f0v)) if len(f0v) else None


def cluster_onsets(toms, gap=0.5):
    clusters = []
    cur = [toms[0]]
    for i in range(1, len(toms)):
        if toms[i][0] - toms[i - 1][0] <= gap:
            cur.append(toms[i])
        else:
            clusters.append(cur)
            cur = [toms[i]]
    clusters.append(cur)
    return clusters


cluster_results = []  # (label, cluster_pitch)
for subf in sorted(glob.glob(os.path.join(DATASET, "annotations", "subclass", "*_subclass.txt"))):
    track = os.path.basename(subf).replace("_subclass.txt", "")
    drum_wav = os.path.join(DATASET, "audio", "drum_only", f"{track}_Drum.wav")
    if not os.path.exists(drum_wav):
        continue
    sub = load_annotation(subf)
    toms = sorted((t, lab) for t, lab in sub if lab in RANK)
    if not toms:
        continue
    y, sr = librosa.load(drum_wav, sr=SR, mono=True)
    clusters = cluster_onsets(toms)
    for c in clusters:
        pitches = [onset_pitch(y, sr, t) for t, _ in c]
        pitches = [p for p in pitches if p is not None]
        if not pitches:
            continue
        cluster_pitch = float(np.median(pitches))  # 클러스터 내 여러 타격의 중앙값 -> 노이즈 감소
        labels = [lab for _, lab in c]
        majority_label = Counter(labels).most_common(1)[0][0]
        cluster_results.append((track, majority_label, cluster_pitch, len(c)))

print(f"총 클러스터 수: {len(cluster_results)} (기존 타격 단위 n=72 -> 클러스터 단위로 묶음)\n")
for track, lab, pitch, n in cluster_results:
    print(f"  {track}: {lab} (묶인 타격 {n}개) -> 클러스터 피치 {pitch:.1f}Hz")

by_label = {}
for _, lab, pitch, _ in cluster_results:
    by_label.setdefault(lab, []).append(pitch)

print("\n===== 클러스터 단위 라벨별 피치(Hz) 분포 =====")
for lab in ["HIT", "MHT", "HFT", "LFT"]:
    pitches = by_label.get(lab, [])
    if not pitches:
        continue
    arr = np.array(pitches)
    print(f"  {lab} (n={len(arr)}): 평균={arr.mean():.1f}, 중앙값={np.median(arr):.1f}, "
          f"범위=[{arr.min():.1f},{arr.max():.1f}]")

high = np.array(by_label.get("HIT", []))
low = np.array(by_label.get("MHT", []) + by_label.get("HFT", []) + by_label.get("LFT", []))
print("\n===== '하이(HIT) vs 나머지' 클러스터 단위 분류 =====")
if len(high) and len(low):
    thr = (high.mean() + low.mean()) / 2
    tp = (high >= thr).sum()
    tn = (low < thr).sum()
    acc = (tp + tn) / (len(high) + len(low))
    baseline = max(len(high), len(low)) / (len(high) + len(low))
    print(f"  HIT 그룹(n={len(high)}): 평균={high.mean():.1f}Hz")
    print(f"  나머지 그룹(n={len(low)}): 평균={low.mean():.1f}Hz")
    print(f"  임계값({thr:.1f}Hz) 분류 정확도: {acc*100:.1f}% "
          f"({tp}/{len(high)} HIT 맞춤, {tn}/{len(low)} 나머지 맞춤)")
    print(f"  (비교) 다수결 베이스라인 정확도: {baseline*100:.1f}%")
