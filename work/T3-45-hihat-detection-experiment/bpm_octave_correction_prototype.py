# 한 줄 요약: 하이햇 온셋 간격(IOI)의 최빈값을 이용해 beat_track의 옥타브 후보 중
# "진짜 박자"에 가장 가까운 걸 고르는 알고리즘 프로토타입. 기존 3개 MIDI(공식영상/
# 녹화버전/기존mp4)로 검증 — 운영 코드는 아직 건드리지 않음.

import json
from pathlib import Path

import numpy as np
import pretty_midi

WORK_DIR = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment")

# T3-45에서 이미 만들어둔 소스별 MIDI(기존 운영 파이프라인 결과) 재사용
MIDI_FILES = {
    "official_video_mp3(외부근거 184)": WORK_DIR / "midi_source_official_video_mp3.mid",
    "recorded_ver(참고용, 정답 미상)": WORK_DIR / "midi_source_recorded_ver.mid",
    "original_mp4(T3-42 손글씨 악보 근거 92)": WORK_DIR / "midi_source_original_mp4.mid",
}

PITCH_HIHAT = 42
PITCH_KICK = 35
PITCH_SNARE = 38

# check_bpm_octave.py에서 이미 확인한 옥타브 후보 배수(2배/3배/4배 정도까지 커버)
CANDIDATE_START_BPMS = [60, 80, 100, 120, 150, 184, 220]


def get_onsets(midi_path: Path, pitch: int) -> np.ndarray:
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    times = []
    for inst in midi.instruments:
        for note in inst.notes:
            if note.pitch == pitch:
                times.append(note.start)
    return np.array(sorted(times))


def dominant_ioi(onsets: np.ndarray, bin_ms: float = 5.0, min_ms: float = 60.0, max_ms: float = 600.0) -> float | None:
    """온셋 간격 중 가장 흔한 값(최빈값)을 ms 단위 히스토그램으로 찾는다."""
    if len(onsets) < 10:
        return None
    iois = np.diff(onsets) * 1000.0  # ms
    iois = iois[(iois >= min_ms) & (iois <= max_ms)]
    if len(iois) < 5:
        return None
    bins = np.arange(min_ms, max_ms + bin_ms, bin_ms)
    hist, edges = np.histogram(iois, bins=bins)
    peak_idx = int(np.argmax(hist))
    return float((edges[peak_idx] + edges[peak_idx + 1]) / 2)


def score_candidate(bpm_candidate: float, dominant_ioi_ms: float) -> tuple[float, int]:
    """이 bpm 후보의 박자(1박)를 n등분했을 때 dominant_ioi와 제일 가까운 n과 오차(%)."""
    beat_period_ms = 60000.0 / bpm_candidate
    best_err = float("inf")
    best_n = 1
    # n=2,4(8분/16분음표)를 우선시 — 동률이면 더 "자연스러운" 쪽을 고르도록 작은 가중치
    preference_penalty = {1: 0.0, 2: 0.0, 3: 0.03, 4: 0.0, 8: 0.05}
    for n in (1, 2, 3, 4, 8):
        implied_ioi = beat_period_ms / n
        rel_err = abs(implied_ioi - dominant_ioi_ms) / dominant_ioi_ms
        adjusted = rel_err + preference_penalty.get(n, 0.1)
        if adjusted < best_err:
            best_err = adjusted
            best_n = n
    return best_err, best_n


def beat_grid_alignment_score(onsets: np.ndarray, bpm: float) -> float:
    """킥/스네어 같은 온셋이 이 bpm의 박자 그리드 위상에 얼마나 몰려있는지(0=완전정렬,
    0.5=랜덤에 가까움)를 간단히 측정 — onset_time mod beat_period의 분산 기반 정렬 지표."""
    if len(onsets) < 5:
        return 1.0
    beat_period = 60.0 / bpm
    phases = (onsets % beat_period) / beat_period  # 0~1
    # 원형 통계: 평균 결과 벡터 길이(1에 가까울수록 한 지점에 몰림=잘 정렬됨)
    angles = phases * 2 * np.pi
    r = np.sqrt(np.mean(np.cos(angles)) ** 2 + np.mean(np.sin(angles)) ** 2)
    return float(1.0 - r)  # 작을수록 더 잘 정렬됨


def pick_bpm(midi_path: Path, candidates: list[float]) -> dict:
    hihat_onsets = get_onsets(midi_path, PITCH_HIHAT)
    kick_onsets = get_onsets(midi_path, PITCH_KICK)
    snare_onsets = get_onsets(midi_path, PITCH_SNARE)

    dom_ioi = dominant_ioi(hihat_onsets)
    report = {"hihat_n": len(hihat_onsets), "dominant_hihat_ioi_ms": dom_ioi, "candidates": {}}

    if dom_ioi is None:
        report["chosen_bpm"] = None
        report["reason"] = "하이햇 온셋 부족 — 보정 불가(안전망으로 기존 방식 유지해야 함)"
        return report

    scored = []
    for c in candidates:
        err, n = score_candidate(c, dom_ioi)
        kick_align = beat_grid_alignment_score(kick_onsets, c) if len(kick_onsets) >= 5 else None
        snare_align = beat_grid_alignment_score(snare_onsets, c) if len(snare_onsets) >= 5 else None
        report["candidates"][c] = {
            "hihat_subdivision_n": n,
            "hihat_err": round(err, 4),
            "kick_grid_misalign": round(kick_align, 4) if kick_align is not None else None,
            "snare_grid_misalign": round(snare_align, 4) if snare_align is not None else None,
        }
        scored.append((err, c))

    scored.sort(key=lambda x: x[0])
    report["chosen_bpm"] = scored[0][1]
    report["reason"] = f"하이햇 간격 기반 최소 오차(err={scored[0][0]:.4f})"
    return report


if __name__ == "__main__":
    results = {}
    for label, path in MIDI_FILES.items():
        if not path.exists():
            print(f"[skip] {label}: {path} 없음")
            continue
        r = pick_bpm(path, CANDIDATE_START_BPMS)
        results[label] = r
        print(f"\n=== {label} ===")
        print(f"하이햇 온셋 수: {r['hihat_n']}, 최빈 간격: {r['dominant_hihat_ioi_ms']}ms")
        for c, info in sorted(r["candidates"].items()):
            print(f"  bpm={c:>5}: n={info['hihat_subdivision_n']}, hihat_err={info['hihat_err']}, "
                  f"kick_misalign={info['kick_grid_misalign']}, snare_misalign={info['snare_grid_misalign']}")
        print(f"  → 선택: {r['chosen_bpm']} bpm ({r['reason']})")

    out_path = WORK_DIR / "bpm_octave_correction_result.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
