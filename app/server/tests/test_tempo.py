"""T3-42(Q-40) 템포 추정 단위 테스트. 근거: intent/07-open-questions.md Q-40.

진짜 합성 오디오(클릭 트랙 — 일정한 간격의 짧은 임펄스)로 검증한다 —
test_normalize_loudness.py와 같은 원칙(실제 DSP 계산을 가짜 신호가 아니라
직접 만든 신호로 검증). 실제 곡(Pretender, 드럼 스템)으로 한 번 더
검증한 기록은 qa-evidence/T3-42/result.md 참고.
"""

import numpy as np
import pytest
import soundfile as sf

import modules.transcriber.tempo as tempo_module
from modules.transcriber.tempo import DEFAULT_BPM, estimate_downbeat_offset_seconds, estimate_tempo


def _write_click_track(path, bpm: float, duration_s: float = 20.0, sr: int = 44100) -> None:
    """`bpm` 간격으로 짧은 임펄스(클릭)가 찍힌 신호를 만들어 wav로 저장한다
    — 리듬이 또렷해 비트 트래커가 모호함 없이 그 bpm을 그대로 찾아낼 수
    있는 가장 단순한 입력(사람 연주의 미세한 흔들림·옥타브 모호성이 섞인
    실제 드럼과 달리, 여기선 "제대로 동작하는지"만 본다)."""
    y = np.zeros(int(sr * duration_s), dtype=np.float64)
    click_interval_s = 60.0 / bpm
    click_len = int(sr * 0.01)  # 10ms짜리 짧은 클릭
    t = np.arange(click_len) / sr
    click = np.sin(2 * np.pi * 1000 * t) * np.exp(-t * 200)  # 감쇠하는 1kHz 톤
    pos = 0.0
    while pos < duration_s:
        start = int(pos * sr)
        end = min(start + click_len, len(y))
        y[start:end] += click[: end - start]
        pos += click_interval_s
    sf.write(str(path), y.astype(np.float32), sr)


def test_estimate_tempo_recovers_known_click_track_bpm(tmp_path):
    click_path = tmp_path / "click_100bpm.wav"
    _write_click_track(click_path, bpm=100.0)

    bpm = estimate_tempo(click_path, start_bpm=100.0)

    assert bpm == pytest.approx(100.0, abs=2.0)


def test_estimate_tempo_recovers_a_different_known_bpm(tmp_path):
    """하나의 값에 과적합된 구현이 아님을 확인 — 다른 bpm도 복원되는지."""
    click_path = tmp_path / "click_140bpm.wav"
    _write_click_track(click_path, bpm=140.0)

    bpm = estimate_tempo(click_path, start_bpm=140.0)

    assert bpm == pytest.approx(140.0, abs=3.0)


def test_estimate_tempo_falls_back_to_default_on_decode_failure(tmp_path):
    """오디오로 디코딩할 수 없는 파일(손상·빈 파일 등)이어도 예외를 던지지
    않고 DEFAULT_BPM으로 안전하게 폴백해야 한다 — 템포 추정 실패가 채보
    작업 전체를 실패시키면 안 되므로(보조 메타데이터일 뿐)."""
    garbage_path = tmp_path / "not_audio.wav"
    garbage_path.write_bytes(b"this is not a real wav file")

    bpm = estimate_tempo(garbage_path)

    assert bpm == DEFAULT_BPM


def test_estimate_tempo_rounds_to_nearest_integer(tmp_path, monkeypatch):
    """Q-40 추가(의뢰인 발견) — librosa가 92.28515625처럼 소수점 긴 값을
    내더라도, 실제 사람이 보는 bpm 표기(악보·메트로놈)는 항상 정수라
    반올림해서 반환해야 한다."""
    monkeypatch.setattr(
        tempo_module.librosa, "load", lambda *a, **k: (np.zeros(1000, dtype=np.float32), 44100)
    )
    monkeypatch.setattr(
        tempo_module.librosa.beat,
        "beat_track",
        lambda *a, **k: (np.array(92.28515625), None),
    )

    bpm = estimate_tempo(tmp_path / "dummy.wav")

    assert bpm == 92.0
    assert bpm == round(bpm)


def test_estimate_tempo_falls_back_to_default_when_rounding_produces_zero(tmp_path, monkeypatch):
    """Codex 모드A 지적(T3-44) — 0보다 크지만 0.5 미만인 유효한 추정값은
    유한·양수 검사를 통과한 뒤 반올림되면 0.0이 된다. 이 함수의 약속은
    "비정상 값이면 DEFAULT_BPM으로 폴백"이므로, 반올림 후에도 0이 되는
    경우를 안전하게 막아야 한다."""
    monkeypatch.setattr(
        tempo_module.librosa, "load", lambda *a, **k: (np.zeros(1000, dtype=np.float32), 44100)
    )
    monkeypatch.setattr(
        tempo_module.librosa.beat,
        "beat_track",
        lambda *a, **k: (np.array(0.4), None),
    )

    bpm = estimate_tempo(tmp_path / "dummy.wav")

    assert bpm == DEFAULT_BPM


def test_estimate_tempo_falls_back_to_default_on_silence(tmp_path):
    """완전 무음(온셋이 전혀 없음)이면 비트 트래킹이 의미 있는 결과를 못
    내므로, 크래시 없이 안전한 기본값으로 끝나야 한다(0bpm 등 비정상 값을
    그대로 반환하지 않음)."""
    silent_path = tmp_path / "silent.wav"
    sf.write(str(silent_path), np.zeros(44100 * 5, dtype=np.float32), 44100)

    bpm = estimate_tempo(silent_path)

    assert bpm > 0
    assert np.isfinite(bpm)


# T3-72(REQ-02, intent/07-open-questions.md Q-43) — 다운비트 위상 추정.
# estimate_tempo()와 달리 librosa.beat.beat_track()·librosa.frames_to_time()을
# 직접 monkeypatch해 beat_times 배열을 완전히 통제한다 — 원형평균 자체의
# 수학적 정확성(특히 위상이 0/period 경계에 걸친 경우)을 검증하는 게
# 목적이라, 실제 클릭 트랙보다 정확한 합성 위상 데이터가 더 적합하다.


def _patch_beat_times(monkeypatch, beat_times) -> None:
    monkeypatch.setattr(
        tempo_module.librosa, "load", lambda *a, **k: (np.zeros(1000, dtype=np.float32), 44100)
    )
    monkeypatch.setattr(
        tempo_module.librosa.beat,
        "beat_track",
        lambda *a, **k: (None, np.arange(len(beat_times))),
    )
    monkeypatch.setattr(
        tempo_module.librosa, "frames_to_time", lambda frames, sr=None: np.asarray(beat_times)
    )


def _circular_distance(a: float, b: float, period: float) -> float:
    diff = abs(a - b) % period
    return min(diff, period - diff)


def test_estimate_downbeat_offset_recovers_clean_phase(tmp_path, monkeypatch):
    """bpm=120(period=0.5초), 모든 비트가 정확히 위상 0.1초에 있는 깨끗한
    데이터 — 원형평균이 당연히 그 값을 그대로 복원해야 한다."""
    beat_times = [0.1, 0.6, 1.1, 1.6, 2.1, 2.6]
    _patch_beat_times(monkeypatch, beat_times)

    t0 = estimate_downbeat_offset_seconds(tmp_path / "dummy.wav", bpm=120.0)

    assert t0 == pytest.approx(0.1, abs=1e-6)


def test_estimate_downbeat_offset_handles_phase_straddling_the_boundary(tmp_path, monkeypatch):
    """위상이 0초/period 경계에 걸쳐 흩어진 경우 — 산술평균이면 완전히
    엉뚱한 값(경계 반대편, 중간 어딘가)이 나오지만 원형평균은 "경계
    근처에 모여 있다"는 걸 정확히 복원해야 한다(work/T3-72/plan.md §2
    설명 그대로). bpm=60(period=1.0초), 진짜 위상은 0.99초 근처."""
    beat_times = [0.97, 1.98, 3.01, 4.02, 4.99]  # mod 1.0 => 0.97,0.98,0.01,0.02,0.99
    _patch_beat_times(monkeypatch, beat_times)
    naive_mean = float(np.mean([t % 1.0 for t in beat_times]))
    assert naive_mean == pytest.approx(0.594, abs=0.01)  # 산술평균은 완전히 틀림(대조군)

    t0 = estimate_downbeat_offset_seconds(tmp_path / "dummy.wav", bpm=60.0)

    assert _circular_distance(t0, 0.99, period=1.0) < 0.03


def test_estimate_downbeat_offset_falls_back_to_zero_when_phases_scattered(tmp_path, monkeypatch):
    """위상이 한 박 안에 고르게 흩어져 있으면(비트 트래킹 자체가 못 믿을
    곡) 신뢰도(합성 벡터 길이)가 MIN_RESULTANT_LENGTH 미만이 돼 0.0(보정
    없음)으로 안전하게 폴백해야 한다."""
    period = 0.5
    beat_times = [i * period / 8 for i in range(8)]  # 한 박 안에 고르게 8등분
    _patch_beat_times(monkeypatch, beat_times)

    t0 = estimate_downbeat_offset_seconds(tmp_path / "dummy.wav", bpm=120.0)

    assert t0 == 0.0


def test_estimate_downbeat_offset_falls_back_to_zero_with_too_few_beats(tmp_path, monkeypatch):
    """비트 3개 이하면 통계를 신뢰할 수 없어 0.0으로 폴백."""
    _patch_beat_times(monkeypatch, [0.1, 0.6, 1.1])

    t0 = estimate_downbeat_offset_seconds(tmp_path / "dummy.wav", bpm=120.0)

    assert t0 == 0.0


def test_estimate_downbeat_offset_falls_back_to_zero_on_decode_failure(tmp_path):
    """오디오로 디코딩할 수 없는 파일이어도 예외 없이 0.0(보정 없음)으로
    안전하게 폴백해야 한다 — estimate_tempo()와 같은 원칙."""
    garbage_path = tmp_path / "not_audio.wav"
    garbage_path.write_bytes(b"this is not a real wav file")

    t0 = estimate_downbeat_offset_seconds(garbage_path, bpm=120.0)

    assert t0 == 0.0


@pytest.mark.parametrize("bad_bpm", [0.0, -10.0, float("nan"), float("inf")])
def test_estimate_downbeat_offset_falls_back_to_zero_for_invalid_bpm(tmp_path, bad_bpm):
    """0 나눗셈(period = 60/bpm)을 막기 위해, bpm 자체가 비정상이면 오디오를
    읽기도 전에 0.0으로 안전하게 폴백해야 한다."""
    t0 = estimate_downbeat_offset_seconds(tmp_path / "dummy.wav", bpm=bad_bpm)

    assert t0 == 0.0


def test_estimate_downbeat_offset_result_is_always_within_one_beat(tmp_path, monkeypatch):
    """반환값은 항상 [0, period) 범위여야 한다(api/schemas.py의 검증 범위와
    정확히 일치시켜야 하므로) — 위상이 음수로 계산되는 경우(atan2가 음수를
    반환할 때)도 period를 더해 양수 범위로 감싸는지 확인."""
    beat_times = [0.05, 0.55, 1.05, 1.55]  # bpm=120(period=0.5) 기준 위상 0.05
    _patch_beat_times(monkeypatch, beat_times)

    t0 = estimate_downbeat_offset_seconds(tmp_path / "dummy.wav", bpm=120.0)

    assert 0.0 <= t0 < 0.5
