"""T6-11(REQ-04, Q-33) modules/tempo/atempo.py 단위 테스트.

근거: work/T6-11/plan.md "백엔드 설계 요약". test_demucs_separator.py의
`_write_tone()` 패턴을 그대로 재사용해 실제 ffmpeg로 돌려본다(mock으로
"호출했다"만 확인하지 않음 — CLAUDE.md §1-3 "완료 주장 전에 증거 첨부").
"""

import threading
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import file_storage
from modules.tempo.atempo import (
    PERMILLE_MAX,
    PERMILLE_MIN,
    TempoStretchError,
    _evict_if_over_budget,
    _lock_for_key,
    time_stretch_mp3,
)


def _write_tone(path: Path, duration_s: float = 0.5, sr: int = 44100) -> None:
    """test_demucs_separator.py의 같은 이름 헬퍼와 같은 패턴(440Hz 사인파) —
    ffmpeg가 실제로 열 수 있는 유효한 WAV를 만든다."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    y = 0.3 * np.sin(2 * np.pi * 440 * t)
    sf.write(str(path), y.astype(np.float32), sr)


def _mp3_duration_seconds(mp3_bytes: bytes, tmp_path: Path, name: str) -> float:
    p = tmp_path / name
    p.write_bytes(mp3_bytes)
    y, sr = sf.read(str(p))
    return len(y) / sr


def test_time_stretch_mp3_produces_valid_nonempty_mp3(tmp_path: Path) -> None:
    wav_path = tmp_path / "tone.wav"
    _write_tone(wav_path, duration_s=0.5)

    result = time_stretch_mp3(wav_path, 1000)

    assert len(result) > 0
    # 디코딩까지 실제로 돼야 "유효한 MP3"라고 주장할 수 있음.
    duration = _mp3_duration_seconds(result, tmp_path, "out_1000.mp3")
    assert duration > 0


def test_time_stretch_mp3_faster_permille_shortens_output(tmp_path: Path) -> None:
    """1.5배속(permille=1500)으로 변환하면 결과 길이가 원본의 약 1/1.5가
    돼야 한다 — atempo 필터가 실제로 적용됐는지 길이로 직접 확인."""
    wav_path = tmp_path / "tone.wav"
    _write_tone(wav_path, duration_s=1.0)

    normal = time_stretch_mp3(wav_path, 1000)
    fast = time_stretch_mp3(wav_path, 1500)

    normal_duration = _mp3_duration_seconds(normal, tmp_path, "normal.mp3")
    fast_duration = _mp3_duration_seconds(fast, tmp_path, "fast.mp3")
    # MP3 프레임 경계·atempo 자체 오프셋(plan.md "실측으로 발견한 주의점")
    # 때문에 정확히 1/1.5는 아니라, 넉넉한 허용 오차로 "빨라지긴 했다"만 확인.
    assert fast_duration < normal_duration * 0.8


def test_time_stretch_mp3_rejects_out_of_range_permille(tmp_path: Path) -> None:
    wav_path = tmp_path / "tone.wav"
    _write_tone(wav_path)

    with pytest.raises(ValueError):
        time_stretch_mp3(wav_path, PERMILLE_MIN - 1)
    with pytest.raises(ValueError):
        time_stretch_mp3(wav_path, PERMILLE_MAX + 1)


def test_time_stretch_mp3_clamps_below_ffmpeg_atempo_floor(tmp_path: Path) -> None:
    """Codex 검수 C-002(2026-10-31) — 원곡 BPM이 정수가 아닌 곡에서는 프론트가
    계산하는 최저 속도 permille이 496~499대로 자주 떨어지는데(직접 시뮬레이션
    확인), 이 값을 그대로 ffmpeg atempo에 넘기면 ffmpeg 자체 유효 범위
    [0.5, 100] 미만이라 하드 실패했다(실측 재현: "Value 0.498 ... out of range
    [0.5 - 100]"). PERMILLE_MIN(490)은 그대로 통과시키되 실제 atempo rate는
    0.5로 clamp해 더 이상 터지지 않아야 한다."""
    wav_path = tmp_path / "tone.wav"
    _write_tone(wav_path, duration_s=1.0)

    # permille=498은 PERMILLE_MIN(490)~PERMILLE_MAX 범위 안이라 ValueError는
    # 안 나야 하고, 예전처럼 TempoStretchError(ffmpeg 실패)도 안 나야 한다.
    result = time_stretch_mp3(wav_path, 498)
    assert len(result) > 0

    # clamp된 rate(0.5)로 실제 변환됐는지 길이로 교차 검증 — permille=500과
    # 거의 같은 길이가 나와야 한다(498 그대로 적용됐다면 미세하게 더 길어짐).
    clamped = _mp3_duration_seconds(result, tmp_path, "clamped_498.mp3")
    floor = time_stretch_mp3(wav_path, 500)
    floor_duration = _mp3_duration_seconds(floor, tmp_path, "floor_500.mp3")
    assert clamped == pytest.approx(floor_duration, abs=0.05)


def test_time_stretch_mp3_raises_on_ffmpeg_failure(tmp_path: Path) -> None:
    missing_path = tmp_path / "does-not-exist.wav"

    with pytest.raises(TempoStretchError):
        time_stretch_mp3(missing_path, 1200)


def test_get_or_create_tempo_mp3_caches_second_call(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")
    import modules.tempo.atempo as atempo_module

    monkeypatch.setattr(atempo_module, "SONGS_ROOT", tmp_path / "songs")
    source = tmp_path / "source.wav"
    _write_tone(source)

    call_count = 0
    real_time_stretch = time_stretch_mp3

    def _counting_time_stretch(path: Path, permille: int) -> bytes:
        nonlocal call_count
        call_count += 1
        return real_time_stretch(path, permille)

    monkeypatch.setattr(atempo_module, "time_stretch_mp3", _counting_time_stretch)

    first = atempo_module.get_or_create_tempo_mp3(1, "stem_drums", 1200, source)
    second = atempo_module.get_or_create_tempo_mp3(1, "stem_drums", 1200, source)

    assert first == second
    assert first.exists()
    assert call_count == 1  # 두 번째 호출은 캐시 적중 — 재변환 안 함


def test_get_or_create_tempo_mp3_different_permille_creates_separate_files(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")
    import modules.tempo.atempo as atempo_module

    monkeypatch.setattr(atempo_module, "SONGS_ROOT", tmp_path / "songs")
    source = tmp_path / "source.wav"
    _write_tone(source)

    slow = atempo_module.get_or_create_tempo_mp3(1, "stem_drums", 800, source)
    fast = atempo_module.get_or_create_tempo_mp3(1, "stem_drums", 1200, source)

    assert slow != fast
    assert slow.name == "tempo_stem_drums_800.mp3"
    assert fast.name == "tempo_stem_drums_1200.mp3"


def test_lock_for_key_returns_same_lock_for_same_key_different_for_other() -> None:
    a1 = _lock_for_key(1, "stem_drums", 1200)
    a2 = _lock_for_key(1, "stem_drums", 1200)
    b = _lock_for_key(1, "stem_drums", 1300)
    c = _lock_for_key(2, "stem_drums", 1200)

    assert a1 is a2
    assert a1 is not b
    assert a1 is not c
    assert isinstance(a1, type(threading.Lock()))


def test_evict_if_over_budget_deletes_oldest_first(tmp_path: Path, monkeypatch) -> None:
    import modules.tempo.atempo as atempo_module

    songs_root = tmp_path / "songs"
    song_dir = songs_root / "1"
    song_dir.mkdir(parents=True)
    old_file = song_dir / "tempo_stem_drums_800.mp3"
    new_file = song_dir / "tempo_stem_drums_1200.mp3"
    old_file.write_bytes(b"x" * 1000)
    new_file.write_bytes(b"y" * 1000)
    # mtime을 명시적으로 벌려둬야 유효한 "오래된 것부터" 순서를 보장(파일
    # 시스템 타임스탬프 해상도가 짧은 테스트 안에서 자연히 갈리지 않을 수
    # 있어서 — os.utime으로 직접 지정).
    import os
    import time

    now = time.time()
    os.utime(old_file, (now - 100, now - 100))
    os.utime(new_file, (now, now))

    monkeypatch.setattr(atempo_module, "SONGS_ROOT", songs_root)
    monkeypatch.setattr(atempo_module, "TOTAL_CACHE_BUDGET_BYTES", 1500)

    _evict_if_over_budget()

    assert not old_file.exists()
    assert new_file.exists()


def test_evict_if_over_budget_noop_when_under_budget(tmp_path: Path, monkeypatch) -> None:
    import modules.tempo.atempo as atempo_module

    songs_root = tmp_path / "songs"
    song_dir = songs_root / "1"
    song_dir.mkdir(parents=True)
    f = song_dir / "tempo_stem_drums_800.mp3"
    f.write_bytes(b"x" * 1000)

    monkeypatch.setattr(atempo_module, "SONGS_ROOT", songs_root)
    monkeypatch.setattr(atempo_module, "TOTAL_CACHE_BUDGET_BYTES", 10_000)

    _evict_if_over_budget()

    assert f.exists()
