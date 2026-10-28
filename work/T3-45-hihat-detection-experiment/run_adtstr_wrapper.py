# 한 줄 요약: torchaudio.load()가 이 환경에서 torchcodec(ffmpeg DLL 미설치로 실패)을
# 강제로 쓰려는 걸 피하려고, soundfile 기반 로더로 바꿔치기한 뒤 ADT_STR의 inference.py를
# 그대로 호출한다. 벤더 코드(adt_str_repo/*) 자체는 수정하지 않음.

import sys
import torch
import soundfile as sf


def _patched_load(path, *args, **kwargs):
    data, sr = sf.read(str(path), always_2d=True)
    waveform = torch.from_numpy(data.T).float()
    return waveform, sr


import torchaudio
torchaudio.load = _patched_load

sys.path.insert(0, r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\adt_str_repo")
sys.argv = [
    "inference.py",
    "--config", "checkpoints/setting-tau-0.6/adt_config.yaml",
    "--input", r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\separated\htdemucs\pretender\drums.wav",
    "-o", r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\adtstr_output",
]

import inference
inference.main()
