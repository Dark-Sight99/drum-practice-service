"""T3-2 게이트 피드백 2차 — normalize_loudness(). 근거: 실측으로 확인된 ADTOF의
음량 민감도(qa-evidence/T3-2-feedback-2/result.md) — 조용한 드럼 스템(RMS
-43.7dBFS)에서 37개 노트만 나오던 게, -18dBFS로 증폭한 뒤 460개로 늘고 스네어도
새로 잡힌 실측 결과를 재현한 회귀 테스트.

진짜 합성 오디오(soundfile로 직접 wav 파일을 만듦)로 검증 — subprocess나
ADTOF 자체는 안 건드림(그건 test_adtof_transcriber.py의 영역).
"""

import numpy as np
import pytest
import soundfile as sf

from modules.transcriber.adtof_transcriber import SILENCE_RMS_FLOOR, normalize_loudness


def _write_tone(path, rms_linear: float, duration_s: float = 1.0, sr: int = 44100) -> None:
    """목표 RMS(선형 스케일)를 갖는 사인파를 만들어 wav로 저장한다.
    사인파의 RMS = amplitude/sqrt(2)이므로 amplitude = rms_linear*sqrt(2)."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    amplitude = rms_linear * np.sqrt(2)
    y = amplitude * np.sin(2 * np.pi * 440 * t)
    sf.write(str(path), y.astype(np.float32), sr)


def _measure_rms_dbfs(path) -> float:
    y, _ = sf.read(str(path))
    rms = float(np.sqrt(np.mean(np.asarray(y, dtype=np.float64) ** 2)))
    return 20 * np.log10(rms + 1e-12)


def test_normalize_boosts_quiet_audio_to_target(tmp_path):
    """실제로 재현된 상황(-43.7dBFS 근처의 조용한 스템)을 그대로 흉내 — 목표
    -18dBFS로 올라가는지 확인."""
    quiet_path = tmp_path / "quiet.wav"
    quiet_rms_linear = 10 ** (-43.7 / 20)
    _write_tone(quiet_path, quiet_rms_linear)

    out_path = normalize_loudness(quiet_path, target_rms_dbfs=-18.0)
    try:
        result_db = _measure_rms_dbfs(out_path)
        assert result_db == pytest.approx(-18.0, abs=0.5)
    finally:
        out_path.unlink(missing_ok=True)


def test_normalize_attenuates_loud_audio_to_target(tmp_path):
    """이미 목표보다 큰 소리도 목표 수준으로 낮춘다(일방적 증폭만이 아님)."""
    loud_path = tmp_path / "loud.wav"
    loud_rms_linear = 10 ** (-6.0 / 20)
    _write_tone(loud_path, loud_rms_linear)

    out_path = normalize_loudness(loud_path, target_rms_dbfs=-18.0)
    try:
        result_db = _measure_rms_dbfs(out_path)
        assert result_db == pytest.approx(-18.0, abs=0.5)
    finally:
        out_path.unlink(missing_ok=True)


def test_normalize_does_not_clip(tmp_path):
    """목표 게인을 그대로 적용하면 피크가 1.0을 넘을 극단적으로 조용한 신호도
    클리핑 없이(최대 절대값 <= 1.0) 처리돼야 한다."""
    very_quiet_path = tmp_path / "very_quiet.wav"
    very_quiet_rms_linear = 10 ** (-80.0 / 20)
    _write_tone(very_quiet_path, very_quiet_rms_linear)

    out_path = normalize_loudness(very_quiet_path, target_rms_dbfs=-18.0)
    try:
        y, _ = sf.read(str(out_path))
        assert np.max(np.abs(y)) <= 1.0 + 1e-6
    finally:
        out_path.unlink(missing_ok=True)


def test_normalize_leaves_near_silent_audio_unboosted(tmp_path):
    """사실상 무음(RMS가 SILENCE_RMS_FLOOR 미만)인 입력은 증폭하지 않고 그대로
    둔다 — 증폭해봐야 디지털 노이즈만 커지므로."""
    silent_path = tmp_path / "silent.wav"
    y = np.zeros(44100, dtype=np.float32)
    sf.write(str(silent_path), y, 44100)

    out_path = normalize_loudness(silent_path, target_rms_dbfs=-18.0)
    try:
        y_out, _ = sf.read(str(out_path))
        assert np.max(np.abs(y_out)) < SILENCE_RMS_FLOOR * 10  # 여전히 사실상 무음
    finally:
        out_path.unlink(missing_ok=True)


def test_normalize_returns_new_temp_file_not_original(tmp_path):
    """원본 파일 경로를 그대로 돌려주면 안 됨(원본을 안 건드려야 호출자가
    나중에 정리하기 안전함) — 항상 새 임시 파일 경로를 반환."""
    input_path = tmp_path / "input.wav"
    _write_tone(input_path, 10 ** (-18.0 / 20))

    out_path = normalize_loudness(input_path)
    try:
        assert out_path != input_path
        assert out_path.exists()
        assert input_path.exists()  # 원본은 그대로 남아있음
    finally:
        out_path.unlink(missing_ok=True)


