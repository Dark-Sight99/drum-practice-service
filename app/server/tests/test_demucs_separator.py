"""T3-1 Demucs 서브프로세스 호출부 단위 테스트. 근거: work/T3-1/plan.md §1.

실제 Demucs 실행은 느려서(GPU라도 수 초~수십 초) 단위 테스트로는 커맨드 조립·
반환값 구성·에러 처리만 subprocess를 monkeypatch해 검증한다. 실제 1회 실행
결과는 qa-evidence/T3-1/demucs_mp4_spike.md에 별도 기록.
"""

import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import pytest
import soundfile as sf

from modules.separator.demucs_separator import (
    SeparationError,
    _decode_to_wav_for_measurement,
    apply_gain,
    compute_playback_gain,
    encode_mp3,
    mix_stems,
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


def test_compute_playback_gain_handles_empty_decoded_audio_without_nan(tmp_path):
    """Codex 모드A 지적(Medium, 반영) — 디코딩 결과 샘플이 0개(사실상 빈
    파일)면 RMS 계산이 NaN을 낼 수 있는데, 그 NaN이 PLAYBACK_SILENCE_RMS_FLOOR
    비교를 그냥 통과해(NaN과의 비교는 전부 False) 게인으로 그대로 반환되면
    ffmpeg volume 필터에 'nan'이 들어가 스템 쓰기 전체가 실패할 수 있었다.
    빈 입력도 무음과 똑같이 게인 1.0(무변화)으로 안전하게 빠져야 한다."""
    original_path = tmp_path / "empty.wav"
    sf.write(str(original_path), np.zeros(0, dtype=np.float32), 44100)
    drums_path = tmp_path / "drums.wav"
    _write_tone(drums_path, 10 ** (-18.0 / 20))

    gain = compute_playback_gain(original_path, [drums_path], target_rms_dbfs=-18.0)

    assert gain == 1.0
    assert not np.isnan(gain)


@pytest.mark.parametrize("bad_target", [float("nan"), float("inf")])
def test_compute_playback_gain_falls_back_to_unity_for_nan_or_inf_target(tmp_path, bad_target):
    """Codex 모드A 2차 지적(Low, 반영) — 원곡 자체는 정상이어도 호출자가
    `target_rms_dbfs`를 NaN/+Inf로 넘기면 게인이 바로 비정상(NaN/Inf)이 돼
    ffmpeg volume 필터로 흘러들어갈 수 있었다. 지금의 유일한 호출자
    (handler.py)는 항상 기본값만 쓰지만, 함수 자체가 안전해야 한다."""
    original_path = tmp_path / "normal.wav"
    _write_tone(original_path, 10 ** (-30.0 / 20))
    drums_path = tmp_path / "drums.wav"
    _write_tone(drums_path, 10 ** (-30.0 / 20))

    gain = compute_playback_gain(original_path, [drums_path], target_rms_dbfs=bad_target)

    assert gain == 1.0
    assert np.isfinite(gain)


def test_compute_playback_gain_stays_finite_for_negative_infinity_target(tmp_path):
    """-Inf 타깃은 수학적으로 10**(-inf/20)=0.0(유한·안전)으로 수렴한다 —
    NaN/+Inf처럼 되돌릴 필요는 없지만(ffmpeg volume=0은 정상적으로 무음을
    만들 뿐 터지지 않음), 그래도 항상 유한해야 한다는 안전 속성 자체는
    똑같이 성립해야 한다."""
    original_path = tmp_path / "normal.wav"
    _write_tone(original_path, 10 ** (-30.0 / 20))
    drums_path = tmp_path / "drums.wav"
    _write_tone(drums_path, 10 ** (-30.0 / 20))

    gain = compute_playback_gain(
        original_path, [drums_path], target_rms_dbfs=float("-inf")
    )

    assert np.isfinite(gain)


def test_compute_playback_gain_handles_mp4_original_file(tmp_path):
    """2026-10-27(실사용 중 재현된 버그, 반영) — `librosa.load()`가 mp4
    컨테이너를 직접 못 열어(`LibsndfileError: Format not recognised`)
    mp4로 업로드한 곡의 분리 작업 전체가 실패했음(실제 업로드로 재현).
    `_decode_to_wav_for_measurement()`가 먼저 ffmpeg로 WAV를 뽑아내므로
    더 이상 터지지 않아야 한다 — 진짜 mp4 파일(오디오 트랙 포함, ffmpeg로
    직접 생성)로 회귀 검증."""
    import imageio_ffmpeg

    wav_path = tmp_path / "tone.wav"
    _write_tone(wav_path, 10 ** (-20.0 / 20))

    mp4_path = tmp_path / "original.mp4"
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    proc = subprocess.run(
        [ffmpeg_exe, "-y", "-i", str(wav_path), "-c:a", "aac", str(mp4_path)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr

    gain = compute_playback_gain(mp4_path, [], target_rms_dbfs=-18.0)

    assert np.isfinite(gain)
    assert gain > 0


def test_decode_to_wav_for_measurement_cleans_up_temp_file_if_subprocess_raises(
    tmp_path, monkeypatch
):
    """Codex 모드A 지적(Medium, 반영) — subprocess.run() 호출 자체가(반환코드가
    아니라) 예외를 던지면(ffmpeg 실행파일 손상·권한 문제 등) 이전엔 그 분기를
    아예 못 타 임시 WAV가 안 지워진 채 새고 있었다. 이제는 그 경우도
    SeparationError로 변환되고, 만든 임시 파일도 지워져야 한다."""
    import imageio_ffmpeg

    monkeypatch.setattr(imageio_ffmpeg, "get_ffmpeg_exe", lambda: "FAKE_FFMPEG")
    created_tmp_paths: list[Path] = []
    real_mkstemp = tempfile.mkstemp

    def spy_mkstemp(*args, **kwargs):
        fd, path_str = real_mkstemp(*args, **kwargs)
        created_tmp_paths.append(Path(path_str))
        return fd, path_str

    monkeypatch.setattr(tempfile, "mkstemp", spy_mkstemp)

    def raising_run(cmd, capture_output, text, encoding=None, errors=None):
        raise OSError("실행파일을 찾을 수 없음(시뮬레이션)")

    monkeypatch.setattr(subprocess, "run", raising_run)

    input_path = tmp_path / "whatever.mp4"
    input_path.write_bytes(b"x")

    with pytest.raises(SeparationError, match="디코딩 실행 실패"):
        _decode_to_wav_for_measurement(input_path)

    assert len(created_tmp_paths) == 1
    assert not created_tmp_paths[0].exists()


def _decode_mp3_bytes_peak_and_rms(data: bytes, tmp_path) -> tuple[float, float]:
    """T6-3 — `mix_stems()`가 돌려주는 MP3 바이트를 실제로 디코딩해 피크·RMS를
    잰다(이 모듈의 다른 함수들이 `librosa.load()`로 측정하는 것과 같은 방식 —
    `mix_stems()` 자신의 내부 클리핑 방지 로직과 독립적으로, 결과물을 직접
    검증하기 위함)."""
    mp3_path = tmp_path / "out.mp3"
    mp3_path.write_bytes(data)
    y, _ = librosa.load(str(mp3_path), sr=None, mono=True)
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2))) if y.size else 0.0
    return peak, rms


def test_mix_stems_sums_without_normalizing_when_no_clipping_risk(tmp_path):
    """T6-3(Codex 모드C C-002 반영) — `amix`의 기본 `normalize=1`이면 입력을
    자동으로 줄여버리는데, 이 함수는 `normalize=0`을 명시해 순수 합산이어야
    한다 — "여러 <audio> 엘리먼트가 동시에 재생되며 물리적으로 그냥 더해지는"
    지금 체감 음량과 같은 결과를 내는 게 핵심(work/T6-3/plan.md). 같은 주파수·
    위상의 사인파 2개를 더하면 진폭이 정확히 2배가 돼야 한다(정규화가 켜져
    있었다면 평균이 돼 1배 그대로였을 것) — 피크가 안전 범위 안에 들게 아주
    조용한 톤을 써서 클리핑 방지 로직이 개입하지 않게 한다."""
    rms_linear = 10 ** (-40.0 / 20)  # 매우 조용함 — 2배가 돼도 클리핑과 무관
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    _write_tone(path_a, rms_linear)
    _write_tone(path_b, rms_linear)

    result = mix_stems([path_a, path_b])

    peak, rms = _decode_mp3_bytes_peak_and_rms(result, tmp_path)
    # MP3 손실 압축 오차를 감안해 넉넉한 허용오차(상대 10%).
    assert rms == pytest.approx(rms_linear * 2, rel=0.1)


def test_mix_stems_prevents_clipping_via_peak_based_gain_reduction(tmp_path):
    """T6-3 — 개별 스템은 전부 안전해도(0.99 피크 제한 통과) 합치면 피크가
    1.0을 넘을 수 있다(실제 위험, work/T6-3/plan.md 리스크 항목) — 이 함수
    자신이 합친 결과의 실제 피크를 재측정해 넘으면 게인을 더 낮춰야 한다."""
    # 각각 피크 0.6 — 개별로는 완전히 안전(0.99 밑)이지만 둘을 더하면 1.2라
    # clip_peak_limit(기본 0.99)를 넘음.
    sr = 44100
    t = np.linspace(0, 1.0, sr, endpoint=False)
    y = 0.6 * np.sin(2 * np.pi * 440 * t)
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    sf.write(str(path_a), y.astype(np.float32), sr)
    sf.write(str(path_b), y.astype(np.float32), sr)

    result = mix_stems([path_a, path_b])

    peak, _ = _decode_mp3_bytes_peak_and_rms(result, tmp_path)
    # MP3 인코딩 자체가 피크를 살짝 넘길 수 있어(손실 압축 오버슈트) 아주 약간의
    # 여유를 둔다 — 그래도 보정 없이 더한 피크(1.2)보다는 확실히 낮아야 함.
    assert peak <= 0.99 + 0.02
    assert peak < 1.2


def test_mix_stems_applies_gain_linear_when_no_clipping_risk(tmp_path):
    """T6-3 — 클리핑 위험이 없을 때는 호출자가 넘긴 `gain_linear`가 그대로
    적용돼야 한다(`compute_playback_gain()`이 계산한 음량 맞춤 게인 전달 경로,
    handler.py)."""
    rms_linear = 10 ** (-40.0 / 20)
    path_a = tmp_path / "a.wav"
    _write_tone(path_a, rms_linear)

    result = mix_stems([path_a], gain_linear=0.5)

    _, rms = _decode_mp3_bytes_peak_and_rms(result, tmp_path)
    assert rms == pytest.approx(rms_linear * 0.5, rel=0.1)


def test_mix_stems_raises_on_empty_input(tmp_path):
    with pytest.raises(SeparationError, match="합칠 WAV가 1개도 없음"):
        mix_stems([])


def test_mix_stems_handles_single_input(tmp_path):
    """amix는 입력이 1개면 그대로 통과한다(ffmpeg 공식 동작) — 스템이 1개뿐인
    (예: 보컬이 감지 안 된) 드문 곡에서도 안전해야 한다."""
    rms_linear = 10 ** (-30.0 / 20)
    path_a = tmp_path / "a.wav"
    _write_tone(path_a, rms_linear)

    result = mix_stems([path_a])

    assert len(result) > 0
    _, rms = _decode_mp3_bytes_peak_and_rms(result, tmp_path)
    assert rms == pytest.approx(rms_linear, rel=0.1)
