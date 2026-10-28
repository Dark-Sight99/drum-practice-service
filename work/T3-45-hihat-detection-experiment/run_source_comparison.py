# 한 줄 요약: pretender를 서로 다른 경로로 입수한 3개 소스(pretender.mp4/녹화버전/공식영상 mp3)에
# 기존 운영 파이프라인(Demucs 분리 + ADTOF 기본 설정)을 그대로 돌려 노트 결과와 하이햇 원시
# 활성값을 비교한다. 운영 코드는 import만 하고 수정하지 않음.

import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(r"C:\Users\Jaewoo\드럼연습서비스")
SERVER_ROOT = PROJECT_ROOT / "app" / "server"
sys.path.insert(0, str(SERVER_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "data" / "repos" / "ADTOF-pytorch" / "src"))

import numpy as np
import pretty_midi

from modules.separator.demucs_separator import pick_device, separate
from modules.transcriber.adtof_transcriber import normalize_loudness, TARGET_RMS_DBFS
from adtof_pytorch import transcribe_to_midi, LABELS_5, FRAME_RNN_THRESHOLDS

WORK_DIR = PROJECT_ROOT / "work" / "T3-45-hihat-detection-experiment"
SOURCES = {
    "original_mp4": PROJECT_ROOT / "음원" / "pretender.mp4",
    "recorded_ver": PROJECT_ROOT / "음원" / "pretender_녹화버전.mp4",
    "official_video_mp3": PROJECT_ROOT / "음원" / "Official髭男dism - Pretender［Official Video］ (1).mp3",
}

PITCH_NAMES = {35: "kick", 38: "snare", 47: "tom", 42: "hihat", 49: "crash"}


def main() -> None:
    device = pick_device()
    print(f"[device] {device}", flush=True)

    results = {}
    for label, src_path in SOURCES.items():
        print(f"\n=== {label}: {src_path.name} ===", flush=True)
        sep_dir = WORK_DIR / "separated_compare" / label
        sep_dir.mkdir(parents=True, exist_ok=True)

        expected_drums = sep_dir / "htdemucs" / src_path.stem / "drums.wav"
        if expected_drums.exists():
            drums_path = expected_drums
            print(f"[separate] 기존 결과 재사용: {drums_path}", flush=True)
        else:
            print("[separate] Demucs 분리 시작", flush=True)
            stems = separate(src_path, sep_dir, device=device)
            drums_path = stems["drums"]
            print(f"[separate] 완료: {drums_path}", flush=True)

        # 운영 기본값(-18dBFS)과 동일하게 정규화 후 ADTOF로 원시 활성값까지 뽑는다
        normalized_path = normalize_loudness(drums_path, target_rms_dbfs=TARGET_RMS_DBFS)
        try:
            pred = transcribe_to_midi(normalized_path, "unused.mid", return_activations=True, device=device)
        finally:
            normalized_path.unlink(missing_ok=True)
        pred = np.asarray(pred)[0]  # [time, 5], LABELS_5 순서

        # 임계값까지 적용한 실제 노트도 생성(운영과 동일 절차)
        midi_out = WORK_DIR / f"midi_source_{label}.mid"
        normalized_path2 = normalize_loudness(drums_path, target_rms_dbfs=TARGET_RMS_DBFS)
        try:
            transcribe_to_midi(normalized_path2, midi_out, device=device)
        finally:
            normalized_path2.unlink(missing_ok=True)

        midi = pretty_midi.PrettyMIDI(str(midi_out))
        counts: dict[int, int] = {}
        for inst in midi.instruments:
            for note in inst.notes:
                counts[note.pitch] = counts.get(note.pitch, 0) + 1

        activation_summary = {}
        for i, pitch in enumerate(LABELS_5):
            name = PITCH_NAMES[pitch]
            col = pred[:, i]
            activation_summary[name] = {
                "threshold": FRAME_RNN_THRESHOLDS[i],
                "max_activation": float(col.max()),
                "note_count": counts.get(pitch, 0),
            }

        results[label] = {
            "file": str(src_path),
            "total_notes": sum(counts.values()),
            "by_class": activation_summary,
        }
        print(f"[{label}] total_notes={results[label]['total_notes']}, "
              f"hihat={activation_summary['hihat']}", flush=True)

    out_path = WORK_DIR / "source_comparison_result.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[done] 결과 저장: {out_path}", flush=True)


if __name__ == "__main__":
    main()
