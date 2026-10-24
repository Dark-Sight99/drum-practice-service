"""ADTOF-pytorch 기반 드럼 채보. 근거: REQ-02 경로 A, work/T3-2/plan.md §1.

`intent/03-architecture-stack.md`가 이미 "교체 가능한 DrumTranscriber 인터페이스"를
명시해뒀다 — 구현체가 ADTOF-pytorch 1개뿐인 지금은 별도 추상 클래스 없이 이 함수
시그니처 자체가 그 인터페이스 역할을 한다(과한 설계 방지, T3-1 Separator와 동일 원칙).
"""

import subprocess
import sys
from pathlib import Path

from modules.separator.demucs_separator import pick_device


class TranscriptionError(Exception):
    """ADTOF 서브프로세스가 실패했을 때."""


def transcribe(input_path: Path, output_path: Path, device: str | None = None) -> None:
    """`input_path`(드럼만 분리된 오디오, T3-1의 `stem_drums.wav`)를 ADTOF-pytorch로
    채보해 `output_path`에 MIDI 파일로 쓴다. 반환값 없음 — 호출자가 `output_path`를
    직접 파싱한다(`pretty_midi`로).

    모드C C-008: `device`가 `None`이면 실제 문자열로 먼저 확정한 뒤에만 서브프로세스
    인자에 넣는다(`demucs_separator.separate()`와 동일 패턴).
    """
    chosen_device = device or pick_device()
    cmd = [
        sys.executable,
        "-m",
        "adtof_pytorch.cli",
        "--audio",
        str(input_path),
        "--out",
        str(output_path),
        "--device",
        chosen_device,
    ]
    # encoding/errors 명시 이유: T3-1에서 실제로 재현된 cp949 콘솔 디코딩 크래시
    # (qa-evidence/T3-1/result.md) — 이번엔 처음부터 반영.
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise TranscriptionError(
            f"ADTOF 채보 실패(returncode={proc.returncode}): {proc.stderr[-2000:]}"
        )
    if not output_path.exists():
        raise TranscriptionError(f"ADTOF가 출력 MIDI를 만들지 않음(예상 경로: {output_path})")
