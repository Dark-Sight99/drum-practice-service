"""ADTOF-pytorch 기반 드럼 채보. 근거: REQ-02 경로 A, work/T3-2/plan.md §1.

`intent/03-architecture-stack.md`가 이미 "교체 가능한 DrumTranscriber 인터페이스"를
명시해뒀다 — 구현체가 ADTOF-pytorch 1개뿐인 지금은 별도 추상 클래스 없이 이 함수
시그니처 자체가 그 인터페이스 역할을 한다(과한 설계 방지, T3-1 Separator와 동일 원칙).
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from modules.separator.demucs_separator import pick_device


class TranscriptionError(Exception):
    """ADTOF 서브프로세스가 실패했을 때."""


# T3-2 게이트 피드백 2차(2026-10-25) — ADTOF-pytorch는 입력 음량을 자동 정규화하지
# 않는다(adtof_pytorch/audio.py의 AudioProcessor, normalize 기본값 False, CLI도
# 안 켬 — 소스 코드로 확인). 원곡 믹스에서 드럼이 작게 녹음된 곡은 분리된 스템도
# 작게 나와 모델이 대부분의 타격을 놓치는 걸 실제 곡으로 확인(의뢰인 제공 "backnumber"
# — 드럼 스템 RMS -43.7dBFS, 4분짜리 곡에서 37개 노트만 생성, 스네어·하이햇은 단
# 하나도 안 잡힘). 같은 스템을 -18dBFS로 증폭해 재실행하니 460개로 늘고 스네어도
# 100번 잡힘(qa-evidence/T3-2-feedback-2/result.md) — 음량이 원인임을 실측 확인.
# -18dBFS는 잘 작동했던 기존 두 곡(MDB 기준곡 -18.0dBFS, 희비교차 -18.8dBFS)의
# 실측 RMS에서 따온 값 — "업계 표준"이 아니라 **우리가 가진 소수 샘플에서 경험적으로
# 검증된 기본값**임을 명시(과장하지 않음).
TARGET_RMS_DBFS = -18.0
# RMS가 이보다 작으면(사실상 무음) 증폭해봐야 노이즈만 커지므로 정규화를 건너뜀.
SILENCE_RMS_FLOOR = 1e-6


def normalize_loudness(
    input_path: Path, target_rms_dbfs: float = TARGET_RMS_DBFS
) -> Path:
    """`input_path`의 오디오를 읽어 RMS 음량을 `target_rms_dbfs`로 맞춘 새 임시
    WAV 파일을 만들고 그 경로를 반환한다 — 호출자가 다 쓴 뒤 정리할 책임을 진다.

    원본 채널 수·샘플레이트는 그대로 보존(`sr=None, mono=False`) — ADTOF 자신의
    로더가 어차피 44.1kHz·모노로 다시 변환하므로(`adtof_pytorch/audio.py`
    `AudioProcessor.load_audio`), 여기서 미리 바꾸면 이중 리샘플링만 될 뿐이라
    원본 특성을 최대한 그대로 둔다. 클리핑 방지: 목표 게인을 적용했을 때 피크가
    1.0을 넘으면 피크가 0.99가 되도록 추가로 낮춘다(무음에 가까운 신호를 과도하게
    증폭해 디지털 클리핑으로 노이즈를 만들지 않기 위함).
    """
    y, sr = librosa.load(str(input_path), sr=None, mono=False)
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))

    if rms < SILENCE_RMS_FLOOR:
        y_out = y
    else:
        current_db = 20 * np.log10(rms)
        gain_db = target_rms_dbfs - current_db
        gain_linear = 10 ** (gain_db / 20)
        y_out = y * gain_linear
        peak = float(np.max(np.abs(y_out)))
        if peak > 0.99:
            y_out = y_out * (0.99 / peak)

    fd, tmp_path_str = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    tmp_path = Path(tmp_path_str)
    try:
        sf.write(str(tmp_path), y_out.T if y_out.ndim > 1 else y_out, sr)
    except Exception:
        # 모드A 피드백 2차 1라운드 C-001: mkstemp()가 만든 임시 파일은 sf.write()가
        # 실패해도 OS에 이미 존재 — 여기서 못 지우면 호출자에게 경로가 전달되지
        # 않아 영원히 못 지워지는 고아 파일이 됨.
        tmp_path.unlink(missing_ok=True)
        raise
    return tmp_path


def transcribe(input_path: Path, output_path: Path, device: str | None = None) -> None:
    """`input_path`(드럼만 분리된 오디오, T3-1의 `stem_drums.wav`)를 ADTOF-pytorch로
    채보해 `output_path`에 MIDI 파일로 쓴다. 반환값 없음 — 호출자가 `output_path`를
    직접 파싱한다(`pretty_midi`로).

    모드C C-008: `device`가 `None`이면 실제 문자열로 먼저 확정한 뒤에만 서브프로세스
    인자에 넣는다(`demucs_separator.separate()`와 동일 패턴).

    내부적으로 `normalize_loudness()`로 음량을 먼저 맞춘 임시 파일을 ADTOF에
    넘긴다 — 이 함수의 외부 시그니처(입력/출력 경로, 반환값 없음)는 그대로라
    호출자(`modules/transcriber/handler.py`)는 변경 없음.
    """
    chosen_device = device or pick_device()
    normalized_path = normalize_loudness(input_path)
    try:
        cmd = [
            sys.executable,
            "-m",
            "adtof_pytorch.cli",
            "--audio",
            str(normalized_path),
            "--out",
            str(output_path),
            "--device",
            chosen_device,
        ]
        # encoding/errors 명시 이유: T3-1에서 실제로 재현된 cp949 콘솔 디코딩 크래시
        # (qa-evidence/T3-1/result.md) — 이번엔 처음부터 반영.
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if proc.returncode != 0:
            raise TranscriptionError(
                f"ADTOF 채보 실패(returncode={proc.returncode}): {proc.stderr[-2000:]}"
            )
        if not output_path.exists():
            raise TranscriptionError(f"ADTOF가 출력 MIDI를 만들지 않음(예상 경로: {output_path})")
    finally:
        normalized_path.unlink(missing_ok=True)
