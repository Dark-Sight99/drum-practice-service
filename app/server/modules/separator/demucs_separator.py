"""Demucs 기반 오디오 분리. 근거: REQ-01, work/T3-1/plan.md §1.

`intent/03-architecture-stack.md` §2가 "교체 가능한 모듈: Separator... 인터페이스"라고
이미 명시해뒀다 — 구현체가 Demucs 1개뿐인 지금은 별도 추상 클래스 없이 이 함수 시그니처
자체가 그 인터페이스 역할을 한다(과한 설계 방지).
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path


class SeparationError(Exception):
    """Demucs 서브프로세스가 실패했을 때."""


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


def encode_mp3(wav_path: Path, bitrate_kbps: int = 192) -> bytes:
    """T3-16-feedback(REQ-06 아님, 네트워크 스트리밍) — WAV를 MP3로 인코딩해
    바이트로 돌려준다. `imageio-ffmpeg`가 pip 패키지에 번들로 넣어 배포하는
    ffmpeg 바이너리(`libmp3lame` 인코더 포함 — `imageio_ffmpeg.get_ffmpeg_exe()`로
    받은 실행파일을 `-encoders`로 실제 실행해 확인함, 2026-10-26)를 쓴다 —
    시스템에 ffmpeg가 PATH로 설치돼 있는지에 의존하지 않는다(이 PC에서
    `Get-Command ffmpeg`가 못 찾는 것으로 실측 확인).

    ⚠ 번들 ffmpeg 바이너리 자체는 `--enable-gpl --enable-version3` 빌드라
    GPLv3 — `imageio-ffmpeg` 패키지 자체(BSD-2-Clause)와는 별개. 의뢰인
    승인 받음(2026-10-26), 라이선스는 `intent/03-architecture-stack.md`
    라이선스 표에 기록."""
    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    fd, tmp_path_str = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    tmp_path = Path(tmp_path_str)
    try:
        cmd = [
            ffmpeg_exe,
            "-y",
            "-i",
            str(wav_path),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            f"{bitrate_kbps}k",
            str(tmp_path),
        ]
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
