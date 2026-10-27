"""Demucs 기반 오디오 분리. 근거: REQ-01, work/T3-1/plan.md §1.

`intent/03-architecture-stack.md` §2가 "교체 가능한 모듈: Separator... 인터페이스"라고
이미 명시해뒀다 — 구현체가 Demucs 1개뿐인 지금은 별도 추상 클래스 없이 이 함수 시그니처
자체가 그 인터페이스 역할을 한다(과한 설계 방지).
"""

import os
import subprocess
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

import librosa
import numpy as np


class SeparationError(Exception):
    """Demucs 서브프로세스가 실패했을 때."""


# 2026-10-27(의뢰인 요청) — "곡마다 믹서를 100으로 둬도 어떤 곡은 너무 작고
# 어떤 곡은 너무 커서, 곡을 바꿀 때마다 매번 믹서를 다시 조절해야 한다"는
# 불편 해소. `modules/transcriber/adtof_transcriber.py`의 TARGET_RMS_DBFS와
# 같은 공식(RMS→dB→선형 게인)을 쓰지만, 목적이 다르다(채보 모델 입력용이
# 아니라 재생 시 체감 음량을 곡 사이에 맞추는 용도) — 그래서 값이 같더라도
# 별도 상수로 둔다(하나를 나중에 바꿔도 다른 하나에 실수로 영향 안 가게).
# -18dBFS는 그쪽과 같은 "우리가 가진 소수 샘플에서 경험적으로 괜찮았던 값"을
# 재사용한 것일 뿐 재생 음량에 대해 별도로 검증된 "정답"은 아님 — 의뢰인이
# 실제로 들어보고 너무 작다/크다 싶으면 조정 필요.
TARGET_PLAYBACK_RMS_DBFS = -18.0
# RMS가 이보다 작으면(사실상 무음) 증폭해봐야 노이즈만 커지므로 건드리지 않는다.
PLAYBACK_SILENCE_RMS_FLOOR = 1e-6


def pick_device() -> str:
    """intent/03-architecture-stack.md §2: "device 자동 선택 cuda→mps→cpu" 그대로.

    torch 임포트는 여기 안에서만 한다 — 이 모듈을 쓰지 않는 테스트(예: API 단위
    테스트)가 무거운 torch 임포트 비용을 치르지 않게 하기 위함.

    T3-2(work/T3-2/plan.md §1)가 `modules/transcriber/adtof_transcriber.py`에서
    그대로 가져다 쓴다 — Demucs·ADTOF 둘 다 같은 device 선택 로직이 필요해서
    (과한 공용 유틸 모듈을 새로 만들기엔 함수 하나뿐이라) 공개 이름으로 둠.
    """
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def separate(
    input_path: Path, output_dir: Path, device: str | None = None, model: str = "htdemucs"
) -> dict[str, Path]:
    """`input_path`의 오디오(또는 오디오 트랙이 있는 비디오 컨테이너, ffmpeg가 지원하는
    모든 포맷 — qa-evidence/T3-1/demucs_mp4_spike.md로 실제 확인)를 Demucs로 분리해
    `output_dir` 아래에 쓴다.

    반환: `{"drums": Path, "bass": Path, "other": Path, "vocals": Path}`.

    Demucs 출력 구조는 `<output_dir>/<model>/<input_path.stem>/{drums,bass,other,vocals}.wav`
    (T0-1 벤치마크·이번 세션 mp4 스파이크로 실제 확인된 구조, `qa-evidence/T0-1/`,
    `qa-evidence/T3-1/demucs_mp4_spike.md`).
    """
    chosen_device = device or pick_device()
    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "-n",
        model,
        "-d",
        chosen_device,
        "-o",
        str(output_dir),
        str(input_path),
    ]
    # encoding/errors를 명시하지 않으면 text=True가 시스템 로캘(이 PC는 cp949)로
    # 디코딩을 시도한다 — Demucs의 진행률 표시줄이 cp949로 못 읽는 유니코드 문자를
    # 내보내면 subprocess의 내부 리더 스레드가 UnicodeDecodeError로 죽는다(실제
    # end-to-end QA로 재현, qa-evidence/T3-1/manual_qa/worker_run_output.txt).
    # 분리 자체는 returncode와 무관하게 끝나버려 겉보기엔 성공할 수도 있지만,
    # 진짜 실패 시 proc.stderr가 깨지거나 비어 있으면 에러 메시지도 같이 깨진다.
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise SeparationError(
            f"Demucs 분리 실패(returncode={proc.returncode}): {proc.stderr[-2000:]}"
        )

    track_dir = output_dir / model / input_path.stem
    stems = {}
    for name in ("drums", "bass", "other", "vocals"):
        stem_path = track_dir / f"{name}.wav"
        if not stem_path.exists():
            raise SeparationError(f"Demucs가 {name}.wav를 만들지 않음(예상 경로: {stem_path})")
        stems[name] = stem_path
    return stems


def encode_mp3(wav_path: Path, bitrate_kbps: int = 192, gain_linear: float = 1.0) -> bytes:
    """T3-16-feedback(REQ-06 아님, 네트워크 스트리밍) — WAV를 MP3로 인코딩해
    바이트로 돌려준다. `imageio-ffmpeg`가 pip 패키지에 번들로 넣어 배포하는
    ffmpeg 바이너리(`libmp3lame` 인코더 포함 — `imageio_ffmpeg.get_ffmpeg_exe()`로
    받은 실행파일을 `-encoders`로 실제 실행해 확인함, 2026-10-26)를 쓴다 —
    시스템에 ffmpeg가 PATH로 설치돼 있는지에 의존하지 않는다(이 PC에서
    `Get-Command ffmpeg`가 못 찾는 것으로 실측 확인).

    ⚠ 번들 ffmpeg 바이너리 자체는 `--enable-gpl --enable-version3` 빌드라
    GPLv3 — `imageio-ffmpeg` 패키지 자체(BSD-2-Clause)와는 별개. 의뢰인
    승인 받음(2026-10-26), 라이선스는 `intent/03-architecture-stack.md`
    라이선스 표에 기록.

    2026-10-27(의뢰인 요청) — `gain_linear`(기본 1.0=무변화)를 주면 인코딩과
    같은 ffmpeg 호출 안에서 음량도 같이 조절한다(`compute_playback_gain()`
    참고). 이미 한 번 거치는 인코딩 단계에 끼워 넣는 것이라, 음량 조절 때문에
    손실 압축을 한 번 더 거치는 게 아니다(재인코딩 추가 없음 — 의뢰인이
    "백엔드에서 조절하면 음질이 깨질 수 있냐"고 물었던 것에 대한 답)."""
    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    fd, tmp_path_str = tempfile.mkstemp(suffix=".mp3")
    tmp_path = Path(tmp_path_str)
    try:
        # 모드A 지적(Low) — os.close(fd)가 여기(try 안)에 있어야, 이 호출
        # 자체가 실패하는 드문 경우에도 finally의 unlink가 임시 파일을 치운다
        # (close 전에 두면 close가 실패할 때 정리 없이 새어나갈 수 있었음).
        os.close(fd)
        cmd = [ffmpeg_exe, "-y", "-i", str(wav_path)]
        if gain_linear != 1.0:
            cmd += ["-filter:a", f"volume={gain_linear}"]
        cmd += ["-codec:a", "libmp3lame", "-b:a", f"{bitrate_kbps}k", str(tmp_path)]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if proc.returncode != 0:
            raise SeparationError(
                f"MP3 인코딩 실패(returncode={proc.returncode}): {proc.stderr[-2000:]}"
            )
        return tmp_path.read_bytes()
    finally:
        tmp_path.unlink(missing_ok=True)


def apply_gain(wav_path: Path, gain_linear: float) -> bytes:
    """2026-10-27(의뢰인 요청) — `wav_path`의 WAV를 코덱 변환 없이(무손실)
    `gain_linear`만큼 음량만 조절해 바이트로 돌려준다. `encode_mp3()`와 같은
    ffmpeg 서브프로세스 패턴이지만 WAV→WAV라 재압축에 의한 손실이 전혀 없다
    — `stem_drums.wav`처럼 압축 안 하고 그대로 저장하는 스템의 음량 보정용
    (`compute_playback_gain()` 참고)."""
    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    fd, tmp_path_str = tempfile.mkstemp(suffix=".wav")
    tmp_path = Path(tmp_path_str)
    try:
        os.close(fd)
        cmd = [
            ffmpeg_exe,
            "-y",
            "-i",
            str(wav_path),
            "-filter:a",
            f"volume={gain_linear}",
            str(tmp_path),
        ]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if proc.returncode != 0:
            raise SeparationError(
                f"음량 보정 실패(returncode={proc.returncode}): {proc.stderr[-2000:]}"
            )
        return tmp_path.read_bytes()
    finally:
        tmp_path.unlink(missing_ok=True)


def compute_playback_gain(
    original_path: Path,
    stem_paths: Iterable[Path],
    target_rms_dbfs: float = TARGET_PLAYBACK_RMS_DBFS,
) -> float:
    """2026-10-27(의뢰인 요청) — 원곡(분리 전) 전체 믹스의 RMS 음량을
    `target_rms_dbfs`로 맞추는 데 필요한 선형 게인을 계산한다. 분리된 스템
    4개(드럼/베이스/보컬/기타) 전부에 이 값을 그대로 곱하면, 곡 사이의 음량
    차이는 없어지면서 스템끼리의 상대적 균형(원곡 믹스 그대로)은 유지된다
    — 원곡 하나에서 분리된 스템들이라 애초에 서로 자연스러운 비율을 이미
    갖고 있기 때문(스템마다 따로 게인을 재는 게 아님).

    `normalize_loudness()`(adtof_transcriber.py)와 같은 공식을 쓰지만
    실제로 파일을 바꾸지 않고 게인 값만 돌려준다 — 호출자(`handler.py`)가
    `encode_mp3()`/`apply_gain()`에 넘겨, 이미 한 번 거치는 인코딩/저장
    단계에 그대로 반영한다(재인코딩을 추가로 거치지 않아 음질 손실이 없음).

    클리핑 방지: 원곡 기준으로 계산한 게인을 스템에 그대로 적용하면, 스템은
    원곡과 피크/RMS 비율(크레스트 팩터)이 다를 수 있어(타격이 몰린 드럼
    스템은 피크가 유독 큼) 원곡에서는 안전했던 게인이 스템에서는 클리핑을
    낼 수 있다 — 그래서 분리된 스템 전부의 실제 피크를 직접 확인해, 어느
    하나라도 0.99를 넘기면 그 스템 기준으로 게인을 다시 낮춘다
    (`normalize_loudness()`와 같은 0.99 클램프, 가장 엄격한 스템에 맞춤).

    Codex 모드A 지적(Medium, 반영) — 원곡이 사실상 빈 파일(디코딩 결과
    샘플 0개)이면 `np.mean`이 빈 배열의 평균을 구하려다 NaN을 내는데,
    `NaN < PLAYBACK_SILENCE_RMS_FLOOR` 비교는 NaN과의 모든 비교가 그렇듯
    False라 무음 처리 분기를 그냥 통과해버린다 — 그러면 NaN이 그대로
    게인으로 반환돼 ffmpeg `volume=nan` 필터에 들어가 스템 쓰기 전체가
    실패할 수 있었다. `np.isfinite`를 같이 확인해 이런 퇴화 입력도 "게인
    없음(1.0)"으로 안전하게 빠지게 한다.
    """
    y, _ = librosa.load(str(original_path), sr=None, mono=False)
    if y.size == 0:
        return 1.0
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
    if not np.isfinite(rms) or rms < PLAYBACK_SILENCE_RMS_FLOOR:
        return 1.0
    current_db = 20 * np.log10(rms)
    gain_db = target_rms_dbfs - current_db
    gain_linear = 10 ** (gain_db / 20)

    for stem_path in stem_paths:
        y_stem, _ = librosa.load(str(stem_path), sr=None, mono=False)
        if y_stem.size == 0:
            continue
        peak = float(np.max(np.abs(y_stem)))
        if peak > 0 and peak * gain_linear > 0.99:
            gain_linear = min(gain_linear, 0.99 / peak)
    return gain_linear
