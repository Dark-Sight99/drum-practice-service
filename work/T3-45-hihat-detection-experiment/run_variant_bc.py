# 한 줄 요약: 변형 B(6갈래 분리 후 스템별 ADTOF)/C(분리+음량업)를 pretender 드럼 스템으로
# 실행해, 특히 hh(하이햇) 스템을 ADTOF에 단독으로 넣었을 때 GM42 검출이 늘어나는지,
# 그리고 그 스템에 실제로 타격이 존재하는지(독립 onset 검출)를 비교한다. 운영 코드는
# import만 하고 수정하지 않는다.

import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Users\Jaewoo\드럼연습서비스")
SERVER_ROOT = PROJECT_ROOT / "app" / "server"
sys.path.insert(0, str(SERVER_ROOT))

import librosa
import numpy as np
import pretty_midi
from mdxnet_infer import separate as separate_drums

from modules.separator.demucs_separator import pick_device
from modules.transcriber.adtof_transcriber import normalize_loudness, TranscriptionError, TARGET_RMS_DBFS

WORK_DIR = PROJECT_ROOT / "work" / "T3-45-hihat-detection-experiment"
DRUMS_PATH = WORK_DIR / "separated" / "htdemucs" / "pretender" / "drums.wav"
STEMS_DIR = WORK_DIR / "drumsep_stems"
RESULT_PATH = WORK_DIR / "variant_bc_result.json"

PITCH_NAMES = {35: "kick", 38: "snare", 42: "hihat_closed", 47: "tom_mid", 49: "crash"}
BOOSTED_TARGET_DBFS = -8.0  # 변형 A에서 쓴 값 중 하나(그래도 영향 없었던 값) 재사용


def run_adtof(input_wav: Path, output_midi: Path, device: str) -> None:
    cmd = [
        sys.executable, "-m", "adtof_pytorch.cli",
        "--audio", str(input_wav), "--out", str(output_midi), "--device", device,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise TranscriptionError(f"ADTOF 채보 실패: {proc.stderr[-2000:]}")
    if not output_midi.exists():
        raise TranscriptionError(f"ADTOF가 출력 MIDI를 만들지 않음: {output_midi}")


def count_notes(midi_path: Path) -> dict:
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    counts: dict[int, int] = {}
    for inst in midi.instruments:
        for note in inst.notes:
            counts[note.pitch] = counts.get(note.pitch, 0) + 1
    named = {name: counts.get(pitch, 0) for pitch, name in PITCH_NAMES.items()}
    unmapped = {str(p): c for p, c in counts.items() if p not in PITCH_NAMES}
    return {"by_class": named, "unmapped_pitches": unmapped, "total": sum(counts.values())}


def independent_onset_count(stem_path: Path) -> dict:
    y, sr = librosa.load(str(stem_path), sr=None, mono=True)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False)
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2))) if y.size else 0.0
    return {"onset_count": int(len(onsets)), "rms_dbfs": float(20 * np.log10(rms)) if rms > 0 else None}


def main() -> None:
    if not DRUMS_PATH.exists():
        raise SystemExit(f"드럼 스템이 없음(변형 A를 먼저 실행해야 함): {DRUMS_PATH}")

    device = pick_device()
    print(f"[device] {device}", flush=True)

    print("[drumsep] 6갈래 분리 시작(mdxnet-infer, drumsep-6stem)", flush=True)
    stems = separate_drums(
        DRUMS_PATH, output_dir=STEMS_DIR, model_name="drumsep-6stem",
        combine_cymbals=False, device=device,
    )
    print(f"[drumsep] 완료: {list(stems.keys())}", flush=True)

    results = {}
    for stem_name, stem_path in stems.items():
        print(f"[stem {stem_name}] 분석 시작: {stem_path}", flush=True)
        ground_truth = independent_onset_count(stem_path)

        # 변형 B: 이 스템을 기존 운영 기본값(-18dBFS 정규화)으로 ADTOF에 단독 입력
        # (transcribe()가 내부에서 하는 것과 동일한 정규화를 여기서 직접 재현)
        normalized_default_path = normalize_loudness(stem_path, target_rms_dbfs=TARGET_RMS_DBFS)
        try:
            midi_b = WORK_DIR / f"midi_B_{stem_name}.mid"
            run_adtof(normalized_default_path, midi_b, device)
            counts_b = count_notes(midi_b)
        finally:
            normalized_default_path.unlink(missing_ok=True)

        # 변형 C: 같은 스템을 변형 A에서 쓴 것보다 더 세게(-8dBFS) 정규화 후 ADTOF
        normalized_path = normalize_loudness(stem_path, target_rms_dbfs=BOOSTED_TARGET_DBFS)
        try:
            midi_c = WORK_DIR / f"midi_C_{stem_name}.mid"
            run_adtof(normalized_path, midi_c, device)
            counts_c = count_notes(midi_c)
        finally:
            normalized_path.unlink(missing_ok=True)

        results[stem_name] = {
            "independent_onset_ground_truth": ground_truth,
            "variant_B_isolated_default_gain": counts_b,
            "variant_C_isolated_boosted_gain": counts_c,
        }
        print(f"[stem {stem_name}] ground_truth_onsets={ground_truth['onset_count']}, "
              f"B_total={counts_b['total']}, C_total={counts_c['total']}", flush=True)

    RESULT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] 결과 저장: {RESULT_PATH}", flush=True)


if __name__ == "__main__":
    main()
