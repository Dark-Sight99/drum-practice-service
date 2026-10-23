"""T0-2 ADTOF(-pytorch) 정확도 평가 (REQ-02 경로 A).

파이프라인: full_mix.wav --[Demucs separate]--> drums.wav --[adtof-pytorch]--> output.mid
그 다음 output.mid의 온셋을 MDB Drums 정답 어노테이션(class/*.txt)과 분류별로 비교해
mir_eval.onset.f_measure(기본 window=0.05s)로 F-measure/Precision/Recall을 계산한다.

클래스 매핑 (adtof_pytorch.post_processing.LABELS_5 = [35, 38, 47, 42, 49] 기준, 소스 확인):
  35 kick -> MDB 'KD'
  38 snare -> MDB 'SD'
  47 tom(합산) -> MDB 'TT'
  42 hihat(합산) -> MDB 'HH'
  49 cymbal(합산) -> MDB 'CY'
MDB의 'OT'(기타 타악기) 클래스는 5-class 모델에 대응 클래스가 없어 평가에서 제외(원 ADTOF 논문 관례).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pretty_midi
import mir_eval

PITCH_TO_MDB = {35: "KD", 38: "SD", 47: "TT", 42: "HH", 49: "CY"}

TRACKS = [
    "MusicDelta_FreeJazz",
    "MusicDelta_FunkJazz",
    "MusicDelta_FusionJazz",
    "MusicDelta_LatinJazz",
    "MusicDelta_Grunge",
]

DATASET = Path("data/datasets/MDBDrums/MDB Drums")
WORK = Path("data/t0-2-work")
WORK.mkdir(parents=True, exist_ok=True)
VENV_PY = Path(".venv/Scripts/python.exe")
ADTOF_EXE = Path(".venv/Scripts/adtof.exe")


def load_ground_truth(track: str) -> dict:
    ann_path = DATASET / "annotations" / "class" / f"{track}_class.txt"
    gt = {cls: [] for cls in PITCH_TO_MDB.values()}
    for line in ann_path.read_text().splitlines():
        if not line.strip():
            continue
        t_str, label = line.split("\t")
        label = label.strip()
        if label in gt:
            gt[label].append(float(t_str))
    return gt


def load_estimated(midi_path: Path) -> dict:
    est = {cls: [] for cls in PITCH_TO_MDB.values()}
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    for inst in midi.instruments:
        for note in inst.notes:
            cls = PITCH_TO_MDB.get(note.pitch)
            if cls:
                est[cls].append(note.start)
    return est


def main() -> None:
    per_class_scores = {cls: [] for cls in PITCH_TO_MDB.values()}
    per_track_rows = []

    for track in TRACKS:
        full_mix = DATASET / "audio" / "full_mix" / f"{track}_MIX.wav"
        sep_out = WORK / "sep"
        drums_wav = sep_out / "htdemucs" / full_mix.stem / "drums.wav"

        if not drums_wav.exists():
            subprocess.run(
                [str(VENV_PY), "-m", "demucs", "-n", "htdemucs", "-d", "cuda", "-o", str(sep_out), str(full_mix)],
                check=True, capture_output=True, text=True,
            )

        midi_out = WORK / f"{track}.mid"
        proc = subprocess.run(
            [str(ADTOF_EXE), "--audio", str(drums_wav), "--out", str(midi_out), "--device", "cuda"],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            print(f"[{track}] adtof 실패:", proc.stderr[-1000:], file=sys.stderr)
            continue

        gt = load_ground_truth(track)
        est = load_estimated(midi_out)

        row = {"track": track}
        for cls in PITCH_TO_MDB.values():
            ref = np.array(sorted(gt[cls]))
            pred = np.array(sorted(est[cls]))
            if ref.size == 0 and pred.size == 0:
                f, p, r = None, None, None
            else:
                f, p, r = mir_eval.onset.f_measure(ref, pred)
            row[cls] = {"f": f, "p": p, "r": r, "n_ref": len(ref), "n_est": len(pred)}
            if f is not None:
                per_class_scores[cls].append(f)
        per_track_rows.append(row)

    summary = {}
    for cls, scores in per_class_scores.items():
        summary[cls] = {
            "mean_f_measure": round(sum(scores) / len(scores), 4) if scores else None,
            "n_tracks": len(scores),
        }
    overall = [v["mean_f_measure"] for v in summary.values() if v["mean_f_measure"] is not None]
    summary["OVERALL_macro"] = round(sum(overall) / len(overall), 4) if overall else None

    result = {"per_track": per_track_rows, "summary": summary}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    Path("qa-evidence/T0-2/result_raw.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
