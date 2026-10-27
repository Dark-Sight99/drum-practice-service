"""T3-42(Q-40) 템포 추정 단위 테스트. 근거: intent/07-open-questions.md Q-40.

진짜 합성 오디오(클릭 트랙 — 일정한 간격의 짧은 임펄스)로 검증한다 —
test_normalize_loudness.py와 같은 원칙(실제 DSP 계산을 가짜 신호가 아니라
직접 만든 신호로 검증). 실제 곡(Pretender, 드럼 스템)으로 한 번 더
검증한 기록은 qa-evidence/T3-42/result.md 참고.
"""

import numpy as np
import pytest
import soundfile as sf

from modules.transcriber.tempo import DEFAULT_BPM, estimate_tempo


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


def test_estimate_tempo_falls_back_to_default_on_silence(tmp_path):
    """완전 무음(온셋이 전혀 없음)이면 비트 트래킹이 의미 있는 결과를 못
    내므로, 크래시 없이 안전한 기본값으로 끝나야 한다(0bpm 등 비정상 값을
    그대로 반환하지 않음)."""
    silent_path = tmp_path / "silent.wav"
    sf.write(str(silent_path), np.zeros(44100 * 5, dtype=np.float32), 44100)

    bpm = estimate_tempo(silent_path)

    assert bpm > 0
    assert np.isfinite(bpm)
