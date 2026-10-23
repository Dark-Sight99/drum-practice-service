"""T0-1 Demucs 분리 시간 벤치마크 (윈도우/맥 공용).

REQ-01 근거: "3~5분 곡 업로드 -> 분리 완료" 수용 기준 측정용.
사용법:
    python bench_demucs.py <입력 오디오 경로> [--device cuda|mps|cpu] [--model htdemucs]

출력: 처리 시간(초), 입력 길이(초), 배속(입력길이/처리시간), 사용 디바이스를 stdout에 JSON으로 출력.
"""
import argparse
import json
import subprocess
import sys
import time
import wave
from pathlib import Path


def audio_duration_seconds(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="입력 wav 파일 경로")
    parser.add_argument("--device", default="cuda", choices=["cuda", "mps", "cpu"])
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--out", default="bench_out")
    args = parser.parse_args()

    duration = audio_duration_seconds(args.input)

    cmd = [
        sys.executable, "-m", "demucs",
        "-n", args.model,
        "-d", args.device,
        "-o", args.out,
        args.input,
    ]

    start = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.perf_counter() - start

    result = {
        "input": args.input,
        "input_duration_sec": round(duration, 2),
        "device": args.device,
        "model": args.model,
        "elapsed_sec": round(elapsed, 2),
        "speed_ratio_input_over_elapsed": round(duration / elapsed, 3) if elapsed > 0 else None,
        "returncode": proc.returncode,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if proc.returncode != 0:
        print("--- demucs stderr (마지막 2000자) ---", file=sys.stderr)
        print(proc.stderr[-2000:], file=sys.stderr)
        sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
