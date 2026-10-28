# 한 줄 요약: ADTOF-pytorch가 하이햇(GM42)에 대해 내놓는 "원시 활성값"(0~1, 임계값 0.22로
# 거르기 전)이 0.22 근처까지 올라오는지, 아예 0에 가까운지 확인 — 임계값 문제인지 모델
# 블라인드스팟인지 구분하기 위한 1회성 진단. 운영 코드/벤더 코드는 건드리지 않음.

import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\Jaewoo\드럼연습서비스\data\repos\ADTOF-pytorch\src")
sys.path.insert(0, r"C:\Users\Jaewoo\드럼연습서비스\app\server")

import numpy as np

from adtof_pytorch import transcribe_to_midi, LABELS_5, FRAME_RNN_THRESHOLDS
from modules.transcriber.adtof_transcriber import normalize_loudness

DRUMS_PATH = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\separated\htdemucs\pretender\drums.wav")

CLASS_NAMES = {35: "kick", 38: "snare", 47: "tom", 42: "hihat", 49: "crash"}

normalized_path = normalize_loudness(DRUMS_PATH)
try:
    pred = transcribe_to_midi(normalized_path, "unused.mid", return_activations=True, device="cuda")
finally:
    normalized_path.unlink(missing_ok=True)

pred = np.asarray(pred)[0]  # [time, 5]
print("activation array shape:", pred.shape)

for i, pitch in enumerate(LABELS_5):
    name = CLASS_NAMES[pitch]
    col = pred[:, i]
    threshold = FRAME_RNN_THRESHOLDS[i]
    frac_above = {
        f">{t}": float((col > t).mean()) for t in [0.05, 0.1, 0.15, 0.2, threshold]
    }
    print(f"\n[{name}] (GM{pitch}, 운영 임계값={threshold})")
    print(f"  max={col.max():.4f}  mean={col.mean():.4f}  p99={np.percentile(col, 99):.4f}  p99.9={np.percentile(col, 99.9):.4f}")
    print(f"  frame fraction above each level: {frac_above}")
