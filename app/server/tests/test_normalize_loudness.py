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
    """목표 RMS로 증폭하면 피크가 1.0을 실제로 넘는 신호(사인파가 아니라, RMS 대비
    피크가 훨씬 큰 짧은 "타격" 버스트 신호 — 드럼 트랜지언트를 흉내)를 넣어
    클리핑 방지 분기가 진짜로 개입하는지 확인한다.

    모드A 피드백 2차 1라운드 C-002: 기존엔 -80dBFS 사인파를 썼는데, 사인파는
    크레스트 팩터(피크/RMS)가 항상 sqrt(2)로 고정이라 목표 -18dBFS로 맞춰도
    피크가 ~0.18에 그쳐 클리핑 방지 분기를 절대 건드리지 못했음(그 분기를
    통째로 지워도 이 테스트는 통과했을 것) — 그래서 사전에 "증폭 전 그대로
    둔다면 피크가 1.0을 넘는다"는 전제 자체를 assert로 확인하도록 다시 작성."""
    sr = 44100
    n_total = sr  # 1초
    n_burst = n_total // 1000  # 전체의 0.1%만 소리 있음 -> RMS는 아주 작지만 피크는 큼
    burst_amplitude = 0.9
    y = np.zeros(n_total, dtype=np.float64)
    y[:n_burst] = burst_amplitude

    rms = float(np.sqrt(np.mean(y**2)))
    gain_linear_unclamped = (10 ** (-18.0 / 20)) / rms
    unclamped_peak = burst_amplitude * gain_linear_unclamped
    assert unclamped_peak > 1.0  # 전제: 클리핑 방지가 없으면 실제로 넘침

    burst_path = tmp_path / "burst.wav"
    sf.write(str(burst_path), y.astype(np.float32), sr)

    out_path = normalize_loudness(burst_path, target_rms_dbfs=-18.0)
    try:
        y_out, _ = sf.read(str(out_path))
        peak_out = float(np.max(np.abs(y_out)))
        assert peak_out <= 1.0 + 1e-6  # 클리핑 방지가 실제로 캡을 걸었음
        assert peak_out > 0.5  # 과도하게 깎아버리지도 않음(0.99 근처로만 낮춤)
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


