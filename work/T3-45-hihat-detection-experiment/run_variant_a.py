# 한 줄 요약: pretender.mp4를 Demucs로 분리한 뒤, normalize_loudness 목표 RMS를
# 여러 값(-18dBFS 기준 포함)으로 바꿔가며 ADTOF 채보를 반복 실행해 GM42(하이햇)
# 검출 건수와 스펙트럼 특징이 어떻게 달라지는지 비교한다. 운영 코드(app/server/modules/*)는
# import만 하고 수정하지 않는다.

import json
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Users\Jaewoo\드럼연습서비스")
SERVER_ROOT = PROJECT_ROOT / "app" / "server"
sys.path.insert(0, str(SERVER_ROOT))

import librosa
import numpy as np
import pretty_midi

from modules.separator.demucs_separator import pick_device, separate
from modules.transcriber.adtof_transcriber import normalize_loudness, TranscriptionError
import subprocess
import os

INPUT_MP4 = PROJECT_ROOT / "음원" / "pretender.mp4"
WORK_DIR = PROJECT_ROOT / "work" / "T3-45-hihat-detection-experiment"
SEP_DIR = WORK_DIR / "separated"
RESULT_PATH = WORK_DIR / "variant_a_result.json"

PITCH_NAMES = {35: "kick", 38: "snare", 42: "hihat_closed", 47: "tom_mid", 49: "crash"}

# 기준값(-18dBFS, 현재 운영 파이프라인 기본값) 포함 + 더 큰 목표치들
TARGETS_DBFS = [-18.0, -12.0, -8.0, -4.0]


def run_adtof(input_wav: Path, output_midi: Path, device: str) -> None:
    cmd = [
        sys.executable,
        "-m",
        "adtof_pytorch.cli",
        "--audio",
        str(input_wav),
        "--out",
        str(output_midi),
        "--device",
        device,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise TranscriptionError(f"ADTOF 채보 실패: {proc.stderr[-2000:]}")
    if not output_midi.exists():
        raise TranscriptionError(f"ADTOF가 출력 MIDI를 만들지 않음: {output_midi}")


def spectral_features(y: np.ndarray, sr: int, onset_times: list[float], window_s: float = 0.08) -> dict:
    centroids = []
    low_ratios = []
    for t in onset_times:
        start = int(t * sr)
        end = min(start + int(window_s * sr), len(y))
        if end - start < 64:
            continue
        frame = y[start:end]
        spec = np.abs(np.fft.rfft(frame))
        freqs = np.fft.rfftfreq(len(frame), d=1.0 / sr)
        total = spec.sum()
        if total <= 0:
            continue
        centroid = float((freqs * spec).sum() / total)
        low_energy = float(spec[freqs < 300].sum())
        centroids.append(centroid)
        low_ratios.append(low_energy / total)
    if not centroids:
        return {"n": 0, "centroid_mean": None, "low_ratio_mean": None}
    return {
        "n": len(centroids),
        "centroid_mean": float(np.mean(centroids)),
        "centroid_median": float(np.median(centroids)),
        "low_ratio_mean": float(np.mean(low_ratios)),
    }


def analyze_midi(midi_path: Path, drums_y: np.ndarray, sr: int) -> dict:
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    notes_by_pitch: dict[int, list[float]] = {}
    for inst in midi.instruments:
        for note in inst.notes:
            notes_by_pitch.setdefault(note.pitch, []).append(note.start)

    report = {}
    for pitch, name in PITCH_NAMES.items():
        times = sorted(notes_by_pitch.get(pitch, []))
        feats = spectral_features(drums_y, sr, times)
        report[name] = {"pitch": pitch, "count": len(times), **feats}
    unmapped_pitches = sorted(set(notes_by_pitch) - set(PITCH_NAMES))
    report["_unmapped_pitches"] = unmapped_pitches
    report["_total_notes"] = sum(len(v) for v in notes_by_pitch.values())
    return report


def main() -> None:
    SEP_DIR.mkdir(parents=True, exist_ok=True)
    device = pick_device()
    print(f"[device] {device}", flush=True)

    expected_drums = SEP_DIR / "htdemucs" / INPUT_MP4.stem / "drums.wav"
    if expected_drums.exists():
        drums_path = expected_drums
        print(f"[separate] 기존 분리 결과 재사용: {drums_path}", flush=True)
    else:
        print(f"[separate] Demucs 분리 시작: {INPUT_MP4}", flush=True)
        stems = separate(INPUT_MP4, SEP_DIR, device=device)
        drums_path = stems["drums"]
        print(f"[separate] 완료: {drums_path}", flush=True)

    # 분석용으로 원본 drums 스템 오디오를 한 번만 로드(모노로 합쳐 스펙트럼 분석에 사용)
    drums_y, sr = librosa.load(str(drums_path), sr=None, mono=True)

    results = {}
    for target_dbfs in TARGETS_DBFS:
        label = f"target_{target_dbfs:+.0f}dBFS"
        print(f"[variant {label}] normalize_loudness 시작", flush=True)
        normalized_path = normalize_loudness(drums_path, target_rms_dbfs=target_dbfs)
        try:
            midi_out = WORK_DIR / f"midi_{label}.mid"
            run_adtof(normalized_path, midi_out, device)
            report = analyze_midi(midi_out, drums_y, sr)
            results[label] = report
            print(f"[variant {label}] done - total_notes={report['_total_notes']}, "
                  f"hihat_closed count={report['hihat_closed']['count']}", flush=True)
        finally:
            normalized_path.unlink(missing_ok=True)

    RESULT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] 결과 저장: {RESULT_PATH}", flush=True)


if __name__ == "__main__":
    main()
