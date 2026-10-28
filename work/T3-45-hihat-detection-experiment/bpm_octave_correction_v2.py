# 한 줄 요약: 하이햇 간격만으로는 92bpm의 16분음표와 184bpm의 8분음표가 "물리적으로
# 완전히 동일한 간격"이라 원리적으로 구분이 불가능함을 발견 — 킥/스네어가 박자
# 그리드에 얼마나 몰려있는지(위상 정렬)를 주 신호로 바꿔 재검증.

import json
from pathlib import Path

import numpy as np
import pretty_midi

WORK_DIR = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment")

MIDI_FILES = {
    "official_video_mp3(외부근거 184)": WORK_DIR / "midi_source_official_video_mp3.mid",
    "recorded_ver(참고용)": WORK_DIR / "midi_source_recorded_ver.mid",
    "original_mp4(T3-42 손글씨 악보 근거 92, 하이햇 0건)": WORK_DIR / "midi_source_original_mp4.mid",
}

PITCH_KICK = 35
PITCH_SNARE = 38
CANDIDATES = [61.523, 92.285, 123.047, 184.570]  # 실측 beat_track 수렴값(check_bpm_octave.py)


def get_onsets(midi_path: Path, pitch: int) -> np.ndarray:
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    times = [note.start for inst in midi.instruments for note in inst.notes if note.pitch == pitch]
    return np.array(sorted(times))


def grid_misalignment(onsets: np.ndarray, bpm: float) -> float:
    """onset_time mod beat_period의 원형 분산 기반 — 0에 가까울수록 한 위상에
    몰려있음(=그 bpm의 박자 그리드와 잘 맞음), 1에 가까우면 랜덤(안 맞음)."""
    if len(onsets) < 5:
        return 1.0
    beat_period = 60.0 / bpm
    phases = (onsets % beat_period) / beat_period
    angles = phases * 2 * np.pi
    r = np.sqrt(np.mean(np.cos(angles)) ** 2 + np.mean(np.sin(angles)) ** 2)
    return float(1.0 - r)


for label, path in MIDI_FILES.items():
    if not path.exists():
        continue
    kick = get_onsets(path, PITCH_KICK)
    snare = get_onsets(path, PITCH_SNARE)
    print(f"\n=== {label} ===  (kick n={len(kick)}, snare n={len(snare)})")
    scores = {}
    for c in CANDIDATES:
        k_mis = grid_misalignment(kick, c)
        s_mis = grid_misalignment(snare, c)
        combined = (k_mis + s_mis) / 2
        scores[c] = combined
        print(f"  bpm={c:>8.3f}: kick_misalign={k_mis:.4f}, snare_misalign={s_mis:.4f}, combined={combined:.4f}")
    best = min(scores, key=scores.get)
    print(f"  -> 선택: {best} bpm (combined misalign={scores[best]:.4f})")
