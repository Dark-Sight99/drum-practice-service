# 한 줄 요약: Inverse Drum Machine(idm-44-train-kits)으로 pretender 드럼 스템을
# 9클래스(HH_CHH/HH_OHH 포함)로 분리해, DrumSep 실험(T3-45 변형B/C)과 같은 방식으로
# 각 스템의 독립 onset 개수·RMS를 측정한다. 운영 코드는 건드리지 않음.

import json
import sys
from pathlib import Path

IDM_REPO = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\idm_repo")
sys.path.insert(0, str(IDM_REPO))

import librosa
import numpy as np
import soundfile as sf
import torch

from idm.inference import load_model, separate

DRUMS_PATH = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\separated\htdemucs\pretender\drums.wav")
OUT_DIR = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\idm_output")
RESULT_PATH = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\variant_idm_result.json")


def independent_onset_count(stem_path: Path) -> dict:
    y, sr = librosa.load(str(stem_path), sr=None, mono=True)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False)
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2))) if y.size else 0.0
    return {"onset_count": int(len(onsets)), "rms_dbfs": float(20 * np.log10(rms)) if rms > 0 else None}


def main() -> None:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[device] {device}", flush=True)

    model, name = load_model("idm-44-train-kits", device, log_dir="pretrained")
    print(f"[model] loaded: {name}", flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 모델이 모노 입력을 기대함(convnext 첫 conv가 in_channels=1) — separate()가 텐서를
    # 받으면 내부에서 바로 깨지는 버그가 있어(from_numpy(tensor)), 모노 WAV 파일로 미리
    # 변환해 경로로 넘긴다.
    audio_mono, sr = librosa.load(str(DRUMS_PATH), sr=44100, mono=True)
    mono_wav_path = OUT_DIR.parent / "drums_mono_for_idm.wav"
    sf.write(str(mono_wav_path), audio_mono, sr)
    separate(str(mono_wav_path), model, output_dir=str(OUT_DIR), masking="wiener", alpha=1.0)
    print("[separate] 완료", flush=True)

    results = {}
    for wav_path in sorted(OUT_DIR.glob("*.wav")):
        stats = independent_onset_count(wav_path)
        results[wav_path.stem] = stats
        print(f"[stem {wav_path.stem}] onsets={stats['onset_count']}, rms_dbfs={stats['rms_dbfs']}", flush=True)

    RESULT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] 결과 저장: {RESULT_PATH}", flush=True)


if __name__ == "__main__":
    main()
