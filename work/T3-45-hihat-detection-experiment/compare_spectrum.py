# 한 줄 요약: pretender.mp4 vs 다른 두 소스의 드럼 스템 주파수 스펙트럼(평균 파워)을 비교해
# pretender.mp4에서 고주파(하이햇 대역)가 유난히 비는지 확인한다.

import json
from pathlib import Path

import librosa
import numpy as np

WORK_DIR = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment")

STEMS = {
    "original_mp4": WORK_DIR / "separated_compare" / "original_mp4" / "htdemucs" / "pretender" / "drums.wav",
    "recorded_ver": WORK_DIR / "separated_compare" / "recorded_ver" / "htdemucs" / "pretender_녹화버전" / "drums.wav",
    "official_video_mp3": WORK_DIR / "separated_compare" / "official_video_mp3" / "htdemucs" / "Official髭男dism - Pretender［Official Video］ (1)" / "drums.wav",
}

results = {}
for label, path in STEMS.items():
    if not path.exists():
        print(f"[skip] {label}: 파일 없음 {path}")
        continue
    y, sr = librosa.load(str(path), sr=None, mono=True)
    # 전체 곡 평균 스펙트럼(파워)을 STFT로 계산
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=2048)) ** 2
    mean_spec = S.mean(axis=1)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)

    def band_energy(lo, hi):
        mask = (freqs >= lo) & (freqs < hi)
        return float(mean_spec[mask].sum())

    total = float(mean_spec.sum())
    bands = {
        "0-300Hz(저음역)": band_energy(0, 300),
        "300-2kHz(중음역)": band_energy(300, 2000),
        "2k-6kHz(하이햇 하단)": band_energy(2000, 6000),
        "6k-12kHz(하이햇 상단)": band_energy(6000, 12000),
        "12k-20kHz(심벌 상단)": band_energy(12000, 20000),
        "20kHz+": band_energy(20000, sr / 2),
    }
    ratios = {k: (v / total if total > 0 else 0.0) for k, v in bands.items()}
    results[label] = {"sr": sr, "total_power": total, "band_ratio": ratios}
    print(f"\n=== {label} (sr={sr}) ===")
    for k, v in ratios.items():
        print(f"  {k}: {v*100:.3f}%")

out_path = WORK_DIR / "spectrum_comparison_result.json"
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n[done] {out_path}")
