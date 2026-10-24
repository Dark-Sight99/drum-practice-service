"""T3-1 Demucs 서브프로세스 호출부 단위 테스트. 근거: work/T3-1/plan.md §1.

실제 Demucs 실행은 느려서(GPU라도 수 초~수십 초) 단위 테스트로는 커맨드 조립·
반환값 구성·에러 처리만 subprocess를 monkeypatch해 검증한다. 실제 1회 실행
결과는 qa-evidence/T3-1/demucs_mp4_spike.md에 별도 기록.
"""

import subprocess

import pytest

from modules.separator.demucs_separator import SeparationError, separate


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
