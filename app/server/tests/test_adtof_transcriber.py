"""T3-2 ADTOF 서브프로세스 호출부 단위 테스트. 근거: work/T3-2/plan.md §1.

실제 ADTOF 실행은 느려서(GPU라도 수 초) 단위 테스트로는 커맨드 조립·에러
처리만 subprocess를 monkeypatch해 검증한다. 실제 1회 실행은 qa-evidence/T3-2/에
별도 기록.
"""

import subprocess

import pytest

from modules.transcriber.adtof_transcriber import TranscriptionError, transcribe


class _FakeCompletedProcess:
    def __init__(self, returncode: int, stderr: str = ""):
        self.returncode = returncode
        self.stderr = stderr


def test_transcribe_builds_expected_command(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured["cmd"] = cmd
        captured["encoding"] = encoding
        captured["errors"] = errors
        out = tmp_path / "out.mid"
        out.write_bytes(b"x")  # transcribe()는 output_path.exists()만 확인
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    transcribe(tmp_path / "drums.wav", tmp_path / "out.mid", device="cpu")

    assert captured["cmd"][1:3] == ["-m", "adtof_pytorch.cli"]
    assert "--device" in captured["cmd"] and "cpu" in captured["cmd"]
    assert captured["encoding"] == "utf-8"
    assert captured["errors"] == "replace"


def test_transcribe_raises_on_nonzero_returncode(tmp_path, monkeypatch):
    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        return _FakeCompletedProcess(returncode=1, stderr="CUDA 메모리 부족")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(TranscriptionError, match="CUDA 메모리 부족"):
        transcribe(tmp_path / "drums.wav", tmp_path / "out.mid", device="cpu")


def test_transcribe_raises_if_output_missing(tmp_path, monkeypatch):
    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        return _FakeCompletedProcess(returncode=0)  # out.mid를 안 만듦

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(TranscriptionError, match="만들지 않음"):
        transcribe(tmp_path / "drums.wav", tmp_path / "out.mid", device="cpu")


def test_transcribe_device_auto_uses_pick_device(tmp_path, monkeypatch):
    import modules.transcriber.adtof_transcriber as trans_module

    monkeypatch.setattr(trans_module, "pick_device", lambda: "mps")
    captured = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured["cmd"] = cmd
        (tmp_path / "out.mid").write_bytes(b"x")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    transcribe(tmp_path / "drums.wav", tmp_path / "out.mid")  # device 생략 -> auto

    d_index = captured["cmd"].index("--device")
    assert captured["cmd"][d_index + 1] == "mps"
