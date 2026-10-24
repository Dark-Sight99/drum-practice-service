"""T3-2 ADTOF 서브프로세스 호출부 단위 테스트. 근거: work/T3-2/plan.md §1.

실제 ADTOF 실행은 느려서(GPU라도 수 초) 단위 테스트로는 커맨드 조립·에러
처리만 subprocess를 monkeypatch해 검증한다. 실제 1회 실행은 qa-evidence/T3-2/에
별도 기록.

T3-2 게이트 피드백 2차(음량 정규화, `normalize_loudness()`) 추가 후 `transcribe()`가
내부적으로 그 함수를 먼저 호출하므로, 이 파일의 테스트들(커맨드 조립·에러 처리가
목적이지 정규화 자체가 목적이 아님)은 `normalize_loudness`를 통과시키는
autouse 픽스처로 우회한다 — 정규화 로직 자체의 테스트는 별도 파일
`test_normalize_loudness.py`에 둔다(진짜 합성 오디오로 검증).
"""

import subprocess

import pytest

import modules.transcriber.adtof_transcriber as trans_module
from modules.transcriber.adtof_transcriber import TranscriptionError, transcribe


@pytest.fixture(autouse=True)
def _bypass_normalize(monkeypatch):
    """이 파일의 테스트는 커맨드 조립·에러 처리만 검증하므로, 실제 오디오 파일이
    없는 가짜 경로(`tmp_path / "drums.wav"`, 실제로 생성 안 됨)를 그대로
    `normalize_loudness`에 넘기지 않는다 — 입력 경로를 그대로 돌려주는 통과
    함수로 대체."""
    monkeypatch.setattr(trans_module, "normalize_loudness", lambda input_path, **kwargs: input_path)


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


def test_transcribe_normalizes_before_calling_adtof(tmp_path, monkeypatch):
    """모드A 대비 — transcribe()가 normalize_loudness()의 결과 경로를 ADTOF에
    넘기는지(원본 input_path를 그대로 넘기면 안 됨), 그리고 정규화 임시 파일을
    끝나고 정리하는지 확인."""
    normalized_marker = tmp_path / "normalized.wav"
    normalized_marker.write_bytes(b"fake-normalized-audio")
    calls = {"normalize": 0, "unlink": False}

    def fake_normalize(input_path, **kwargs):
        calls["normalize"] += 1
        assert input_path == tmp_path / "drums.wav"
        return normalized_marker

    monkeypatch.setattr(trans_module, "normalize_loudness", fake_normalize)

    captured = {}

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        captured["cmd"] = cmd
        (tmp_path / "out.mid").write_bytes(b"x")
        return _FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    transcribe(tmp_path / "drums.wav", tmp_path / "out.mid", device="cpu")

    assert calls["normalize"] == 1
    audio_index = captured["cmd"].index("--audio")
    assert captured["cmd"][audio_index + 1] == str(normalized_marker)
    assert not normalized_marker.exists()  # 정규화 임시 파일은 정리됨


def test_transcribe_cleans_up_normalized_file_even_on_adtof_failure(tmp_path, monkeypatch):
    normalized_marker = tmp_path / "normalized.wav"
    normalized_marker.write_bytes(b"fake-normalized-audio")
    monkeypatch.setattr(
        trans_module, "normalize_loudness", lambda input_path, **kwargs: normalized_marker
    )

    def fake_run(cmd, capture_output, text, encoding=None, errors=None):
        return _FakeCompletedProcess(returncode=1, stderr="실패")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(TranscriptionError):
        transcribe(tmp_path / "drums.wav", tmp_path / "out.mid", device="cpu")

    assert not normalized_marker.exists()
