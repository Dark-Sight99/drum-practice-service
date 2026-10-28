# 한 줄 요약: Beat This!(CPJKU)로 3개 소스의 비트·다운비트를 뽑아 librosa beat_track과
# 비교 — 추정 BPM, 옥타브 오류 여부, 곡 전반부/후반부 로컬 템포 변화(어긋남), 다운비트가
# 우리가 이미 검출한 킥 온셋과 얼마나 맞는지까지 확인.

import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\Jaewoo\드럼연습서비스\app\server")

import librosa
import numpy as np
import pretty_midi

import subprocess
import tempfile

import imageio_ffmpeg

from beat_this.inference import File2Beats


def _decode_to_wav(input_path: Path) -> Path:
    """beat_this/soundfile가 mp4(AAC) 컨테이너를 직접 못 읽어서(libsndfile
    한계, demucs_separator.py의 같은 문제와 동일) ffmpeg로 먼저 WAV로
    디코딩한다. 호출자가 정리할 책임을 진다."""
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    fd, tmp_path_str = tempfile.mkstemp(suffix=".wav")
    import os

    os.close(fd)
    tmp_path = Path(tmp_path_str)
    cmd = [ffmpeg_exe, "-y", "-i", str(input_path), str(tmp_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 디코딩 실패: {proc.stderr[-1000:]}")
    return tmp_path

WORK_DIR = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment")
PROJECT_ROOT = Path(r"C:\Users\Jaewoo\드럼연습서비스")

SOURCES = {
    "official_video_mp3(외부근거 184)": {
        "audio": PROJECT_ROOT / "음원" / "Official髭男dism - Pretender［Official Video］ (1).mp3",
        "midi": WORK_DIR / "midi_source_official_video_mp3.mid",
    },
    "recorded_ver(참고용)": {
        "audio": PROJECT_ROOT / "음원" / "pretender_녹화버전.mp4",
        "midi": WORK_DIR / "midi_source_recorded_ver.mid",
    },
    "original_mp4(T3-42 근거 92)": {
        "audio": PROJECT_ROOT / "음원" / "pretender.mp4",
        "midi": WORK_DIR / "midi_source_original_mp4.mid",
    },
}

PITCH_KICK = 35


def get_kick_onsets(midi_path: Path) -> np.ndarray:
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    times = [note.start for inst in midi.instruments for note in inst.notes if note.pitch == PITCH_KICK]
    return np.array(sorted(times))


def local_bpm(beat_times: np.ndarray, start_s: float, end_s: float) -> float | None:
    window = beat_times[(beat_times >= start_s) & (beat_times < end_s)]
    if len(window) < 4:
        return None
    iois = np.diff(window)
    return float(60.0 / np.median(iois))


def kick_alignment_rms_ms(beat_times: np.ndarray, kick_onsets: np.ndarray) -> float | None:
    """각 킥 온셋에서 제일 가까운 비트까지 거리(ms)의 RMS — 작을수록 다운비트/비트
    그리드가 실제 킥 타이밍과 잘 맞는다는 뜻."""
    if len(beat_times) == 0 or len(kick_onsets) == 0:
        return None
    diffs = []
    for k in kick_onsets:
        idx = np.searchsorted(beat_times, k)
        candidates = beat_times[max(0, idx - 1):idx + 1]
        if len(candidates) == 0:
            continue
        diffs.append(np.min(np.abs(candidates - k)))
    if not diffs:
        return None
    return float(np.sqrt(np.mean(np.square(diffs))) * 1000.0)


CHECKPOINT_PATH = WORK_DIR / "beat_this_checkpoints" / "final0.ckpt"
file2beats = File2Beats(checkpoint_path=str(CHECKPOINT_PATH), device="cuda", dbn=False)

results = {}
for label, paths in SOURCES.items():
    audio_path = paths["audio"]
    midi_path = paths["midi"]
    if not audio_path.exists():
        print(f"[skip] {label}: {audio_path} 없음")
        continue
    print(f"\n=== {label} ===")

    decoded_path = None
    try:
        feed_path = audio_path
        if audio_path.suffix.lower() == ".mp4":
            decoded_path = _decode_to_wav(audio_path)
            feed_path = decoded_path

        beats, downbeats = file2beats(str(feed_path))
        beats = np.asarray(beats)
        downbeats = np.asarray(downbeats)

        overall_bpm = float(60.0 / np.median(np.diff(beats))) if len(beats) > 4 else None
        downbeat_bpm = float(60.0 / np.median(np.diff(downbeats))) if len(downbeats) > 4 else None

        duration_s = float(beats[-1]) if len(beats) else 0.0
        early_bpm = local_bpm(beats, 0, 30)
        late_bpm = local_bpm(beats, max(0, duration_s - 30), duration_s)

        # librosa 비교용(기존 운영 방식) — feed_path(디코딩된 경로)로 동일하게 읽음(mp4
        # 직접 읽기는 libsndfile 한계로 실패함, demucs_separator.py와 같은 문제)
        y, sr = librosa.load(str(feed_path), sr=None, mono=True)
        librosa_tempo, _ = librosa.beat.beat_track(y=y, sr=sr, start_bpm=100.0)
        librosa_bpm = float(np.asarray(librosa_tempo).reshape(-1)[0])
    finally:
        if decoded_path is not None:
            decoded_path.unlink(missing_ok=True)

    kick_onsets = get_kick_onsets(midi_path) if midi_path.exists() else np.array([])
    beat_kick_rms_ms = kick_alignment_rms_ms(beats, kick_onsets)
    downbeat_kick_rms_ms = kick_alignment_rms_ms(downbeats, kick_onsets)

    r = {
        "n_beats": len(beats),
        "n_downbeats": len(downbeats),
        "overall_bpm_from_beats": overall_bpm,
        "overall_bpm_from_downbeats(x4 if 4/4)": downbeat_bpm,
        "early_30s_local_bpm": early_bpm,
        "late_30s_local_bpm": late_bpm,
        "drift_early_vs_late_bpm": (late_bpm - early_bpm) if (early_bpm and late_bpm) else None,
        "librosa_beat_track_bpm(start_bpm=100)": librosa_bpm,
        "beat_vs_kick_alignment_rms_ms": beat_kick_rms_ms,
        "downbeat_vs_kick_alignment_rms_ms": downbeat_kick_rms_ms,
        "n_kick_onsets_used": len(kick_onsets),
    }
    results[label] = r
    for k, v in r.items():
        print(f"  {k}: {v}")

out_path = WORK_DIR / "beat_this_vs_librosa_result.json"
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n[done] {out_path}")
