"""T3-1 Demucs 서브프로세스 호출부 단위 테스트. 근거: work/T3-1/plan.md §1.

실제 Demucs 실행은 느려서(GPU라도 수 초~수십 초) 단위 테스트로는 커맨드 조립·
반환값 구성·에러 처리만 subprocess를 monkeypatch해 검증한다. 실제 1회 실행
결과는 qa-evidence/T3-1/demucs_mp4_spike.md에 별도 기록.
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from modules.separator.demucs_separator import (
    SeparationError,
    apply_gain,
    compute_playback_gain,
    encode_mp3,
    separate,
)


def _write_tone(path, rms_linear: float, duration_s: float = 1.0, sr: int = 44100) -> None:
    """T3-38 — test_normalize_loudness.py와 같은 패턴(목표 RMS를 갖는 사인파를
    만들어 wav로 저장, 사인파의 RMS = amplitude/sqrt(2))."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    amplitude = rms_linear * np.sqrt(2)
    y = amplitude * np.sin(2 * np.pi * 440 * t)
    sf.write(str(path), y.astype(np.float32), sr)


def _measure_rms_dbfs(path) -> float:
    y, _ = sf.read(str(path))
    rms = float(np.sqrt(np.mean(np.asarray(y, dtype=np.float64) ** 2)))
    return 20 * np.log10(rms + 1e-12)


class _FakeCompletedProcess:
    def __init__(self, returncode: int, stderr: str = ""):
        self.returncode = returncode
        self.stderr = stderr


def test_separate_builds_expected_command_and_returns_stem_paths(tmp_path, monkeypatch):
    captured_cmd = {}
    captured_kwargs = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured_cmd["cmd"] = cmd
        captured_kwargs["encoding"] = encoding
        captured_kwargs["errors"] = errors
        # Demucs가 성공하면 실제로 만드는 디렉터리 구조를 흉내낸다.
        track_dir = tmp_path / "out" / "htdemucs" / "song"
        track_dir.mkdir(parents=True)
        for name in ("drums", "bass", "other", "vocals"):
            (track_dir / f"{name}.wav").write_bytes(b"x")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = separate(tmp_path / "song.wav", tmp_path / "out", device="cpu")

    assert captured_cmd["cmd"][1:5] == ["-m", "demucs", "-n", "htdemucs"]
    assert "-d" in captured_cmd["cmd"] and "cpu" in captured_cmd["cmd"]
    assert set(result.keys()) == {"drums", "bass", "other", "vocals"}
    for path in result.values():
        assert path.exists()
    # 실제 end-to-end QA로 재현된 버그(qa-evidence/T3-1/manual_qa/worker_run_output.txt) —
    # 시스템 로캘(cp949)로 subprocess 출력을 디코딩하면 Demucs 진행률 표시줄의
    # 유니코드 문자에서 subprocess 내부 리더 스레드가 죽는다. encoding/errors를
    # 명시해 디코딩이 항상 안전하게 끝나야 한다.
    assert captured_kwargs["encoding"] == "utf-8"
    assert captured_kwargs["errors"] == "replace"


def test_separate_raises_on_nonzero_returncode(tmp_path, monkeypatch):
    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        return _FakeCompletedProcess(returncode=1, stderr="GPU 메모리 부족")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(SeparationError, match="GPU 메모리 부족"):
        separate(tmp_path / "song.wav", tmp_path / "out", device="cpu")


def test_separate_raises_if_expected_stem_missing(tmp_path, monkeypatch):
    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        track_dir = tmp_path / "out" / "htdemucs" / "song"
        track_dir.mkdir(parents=True)
        for name in ("drums", "bass", "other"):  # vocals.wav 누락
            (track_dir / f"{name}.wav").write_bytes(b"x")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(SeparationError, match="vocals"):
        separate(tmp_path / "song.wav", tmp_path / "out", device="cpu")


def test_separate_device_auto_uses_pick_device(tmp_path, monkeypatch):
    import modules.separator.demucs_separator as sep_module

    monkeypatch.setattr(sep_module, "pick_device", lambda: "mps")
    captured_cmd = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured_cmd["cmd"] = cmd
        track_dir = tmp_path / "out" / "htdemucs" / "song"
        track_dir.mkdir(parents=True)
        for name in ("drums", "bass", "other", "vocals"):
            (track_dir / f"{name}.wav").write_bytes(b"x")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    separate(tmp_path / "song.wav", tmp_path / "out")  # device 생략 -> auto

    d_index = captured_cmd["cmd"].index("-d")
    assert captured_cmd["cmd"][d_index + 1] == "mps"


def test_encode_mp3_builds_expected_command_and_returns_bytes(tmp_path, monkeypatch):
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")
    captured_cmd = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured_cmd["cmd"] = cmd
        # 실제 ffmpeg가 출력 경로(cmd 마지막 인자)에 쓰는 걸 흉내낸다.
        Path(cmd[-1]).write_bytes(b"fake-mp3-bytes")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    wav_path = tmp_path / "stem_bass.wav"
    wav_path.write_bytes(b"x")
    result = encode_mp3(wav_path, bitrate_kbps=192)

    assert result == b"fake-mp3-bytes"
    assert captured_cmd["cmd"][0] == "FAKE_FFMPEG"
    assert captured_cmd["cmd"][1:4] == ["-y", "-i", str(wav_path)]
    assert "-codec:a" in captured_cmd["cmd"]
    assert "libmp3lame" in captured_cmd["cmd"]
    assert "192k" in captured_cmd["cmd"]


def test_encode_mp3_raises_on_nonzero_returncode(tmp_path, monkeypatch):
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        return _FakeCompletedProcess(returncode=1, stderr="인코딩 실패")

    monkeypatch.setattr(subprocess, "run", fake_run)

    wav_path = tmp_path / "stem_bass.wav"
    wav_path.write_bytes(b"x")
    with pytest.raises(SeparationError, match="인코딩 실패"):
        encode_mp3(wav_path)


def test_encode_mp3_adds_volume_filter_when_gain_not_unity(tmp_path, monkeypatch):
    """T3-38 — gain_linear!=1.0이면 같은 ffmpeg 호출에 볼륨 필터가 끼워져야
    한다(재인코딩을 추가로 거치지 않는다는 설계의 핵심 — handler.py 코멘트
    참고)."""
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")
    captured_cmd = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured_cmd["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"fake-mp3-bytes")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    wav_path = tmp_path / "stem_bass.wav"
    wav_path.write_bytes(b"x")
    encode_mp3(wav_path, gain_linear=1.5)

    assert "-filter:a" in captured_cmd["cmd"]
    filter_index = captured_cmd["cmd"].index("-filter:a")
    assert captured_cmd["cmd"][filter_index + 1] == "volume=1.5"


def test_encode_mp3_omits_volume_filter_when_gain_is_unity(tmp_path, monkeypatch):
    """T3-38 — gain_linear 기본값(1.0, 무변화)일 땐 필터를 아예 안 넣는다
    (기존 호출부·테스트와 100% 동일하게 동작해야 함 — 회귀 방지)."""
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")
    captured_cmd = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured_cmd["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"fake-mp3-bytes")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    wav_path = tmp_path / "stem_bass.wav"
    wav_path.write_bytes(b"x")
    encode_mp3(wav_path, gain_linear=1.0)

    assert "-filter:a" not in captured_cmd["cmd"]


def test_apply_gain_builds_expected_command_and_returns_bytes(tmp_path, monkeypatch):
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")
    captured_cmd = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured_cmd["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"fake-wav-bytes")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    wav_path = tmp_path / "stem_drums.wav"
    wav_path.write_bytes(b"x")
    result = apply_gain(wav_path, 0.8)

    assert result == b"fake-wav-bytes"
    assert captured_cmd["cmd"][0] == "FAKE_FFMPEG"
    assert captured_cmd["cmd"][1:4] == ["-y", "-i", str(wav_path)]
    filter_index = captured_cmd["cmd"].index("-filter:a")
    assert captured_cmd["cmd"][filter_index + 1] == "volume=0.8"
    # encode_mp3()와 달리 코덱 변환이 없어야 함(무손실 WAV→WAV).
    assert "-codec:a" not in captured_cmd["cmd"]


def test_apply_gain_raises_on_nonzero_returncode(tmp_path, monkeypatch):
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        return _FakeCompletedProcess(returncode=1, stderr="필터 적용 실패")

    monkeypatch.setattr(subprocess, "run", fake_run)

    wav_path = tmp_path / "stem_drums.wav"
    wav_path.write_bytes(b"x")
    with pytest.raises(SeparationError, match="필터 적용 실패"):
        apply_gain(wav_path, 0.8)


def test_compute_playback_gain_boosts_quiet_song(tmp_path):
    """T3-38(의뢰인 요청) — 조용한 원곡은 게인이 1보다 커야(증폭) 한다."""
    original_path = tmp_path / "original.wav"
    _write_tone(original_path, 10 ** (-40.0 / 20))
    drums_path = tmp_path / "drums.wav"
    _write_tone(drums_path, 10 ** (-40.0 / 20))

    gain = compute_playback_gain(original_path, [drums_path], target_rms_dbfs=-18.0)

    assert gain > 1.0


def test_compute_playback_gain_attenuates_loud_song(tmp_path):
    """이미 목표보다 큰 원곡은 게인이 1보다 작아야(감쇠) 한다 — 일방적 증폭만이
    아님(normalize_loudness()와 같은 원칙)."""
    original_path = tmp_path / "original.wav"
    _write_tone(original_path, 10 ** (-6.0 / 20))
    drums_path = tmp_path / "drums.wav"
    _write_tone(drums_path, 10 ** (-6.0 / 20))

    gain = compute_playback_gain(original_path, [drums_path], target_rms_dbfs=-18.0)

    assert gain < 1.0


def test_compute_playback_gain_same_gain_moves_both_toward_target(tmp_path):
    """원곡과 스템(원곡과 같은 음량이라고 가정 — 실제로도 원곡에서 분리된
    것이라 자연스러운 상황) 양쪽 다 이 게인을 곱하면 목표 음량 근처로
    맞춰져야 한다(핵심 효과 검증)."""
    original_path = tmp_path / "original.wav"
    rms_linear = 10 ** (-35.0 / 20)
    _write_tone(original_path, rms_linear)
    drums_path = tmp_path / "drums.wav"
    _write_tone(drums_path, rms_linear)

    gain = compute_playback_gain(original_path, [drums_path], target_rms_dbfs=-18.0)
    result_db = 20 * np.log10(rms_linear * gain)

    assert result_db == pytest.approx(-18.0, abs=0.5)


def test_compute_playback_gain_caps_to_avoid_clipping_a_loud_stem(tmp_path):
    """원곡 기준으로 계산한 게인을 그대로 적용하면 클리핑이 나는(피크가 1.0을
    넘는) 스템이 있으면, 그 스템 기준으로 게인을 낮춰야 한다 — 드럼처럼
    타격이 몰려 크레스트 팩터(피크/RMS)가 원곡보다 훨씬 큰 스템을 흉내."""
    sr = 44100
    n_total = sr
    original_path = tmp_path / "original.wav"
    # 원곡은 조용한 사인파(크레스트 팩터 sqrt(2) 고정) — 그대로면 큰 게인이 나옴.
    _write_tone(original_path, 10 ** (-40.0 / 20), sr=sr)

    # 드럼 스템은 짧은 버스트(피크는 크지만 RMS는 작음 — 크레스트 팩터가 큼).
    n_burst = n_total // 1000
    burst_amplitude = 0.9
    y = np.zeros(n_total, dtype=np.float64)
    y[:n_burst] = burst_amplitude
    drums_path = tmp_path / "drums.wav"
    sf.write(str(drums_path), y.astype(np.float32), sr)

    # 전제: 원곡 기준 게인을 그대로 적용하면 실제로 넘친다.
    gain_unclamped = compute_playback_gain(
        original_path, [], target_rms_dbfs=-18.0
    )
    assert burst_amplitude * gain_unclamped > 1.0

    gain_capped = compute_playback_gain(
        original_path, [drums_path], target_rms_dbfs=-18.0
    )
    assert burst_amplitude * gain_capped <= 1.0 + 1e-6
    assert gain_capped < gain_unclamped


def test_compute_playback_gain_leaves_near_silent_song_unboosted(tmp_path):
    """사실상 무음인 원곡은 증폭하지 않는다(normalize_loudness()와 같은 원칙
    — 증폭해봐야 노이즈만 커짐)."""
    original_path = tmp_path / "original.wav"
    y = np.zeros(44100, dtype=np.float32)
    sf.write(str(original_path), y, 44100)
    drums_path = tmp_path / "drums.wav"
    sf.write(str(drums_path), y, 44100)

    gain = compute_playback_gain(original_path, [drums_path], target_rms_dbfs=-18.0)

    assert gain == 1.0
