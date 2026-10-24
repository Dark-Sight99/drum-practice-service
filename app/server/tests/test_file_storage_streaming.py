"""T3-1 write_song_file_streaming(). 근거: REQ-01, work/T3-1/plan.md 모드A C-002.

이전 버전(호출자가 청크를 리스트로 모아서 넘김)이 사실상 스트리밍이 아니었다는
Codex 모드A 지적을 반영한 뒤의 동작을 직접 검증한다 — 청크가 도착하는 대로
디스크에 쓰이고, 크기 상한을 넘으면 즉시 중단·정리되는지가 핵심.

pytest-asyncio는 이 프로젝트의 의존성이 아니라서(stdlib만으로 충분한 범위라
새로 추가하지 않음) 일반 동기 테스트 함수 안에서 asyncio.run()으로 코루틴을
직접 실행한다.
"""

import asyncio

import pytest

import file_storage
from file_storage import UploadTooLargeError, write_song_file_streaming


@pytest.fixture(autouse=True)
def _isolate_songs_root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")


async def _chunks(*parts: bytes):
    for p in parts:
        yield p


def test_writes_all_chunks_to_final_file():
    rel_path = asyncio.run(
        write_song_file_streaming(1, "original.wav", _chunks(b"ab", b"cd", b"ef"))
    )

    final = file_storage.resolve_asset_path(rel_path)
    assert final is not None
    assert final.read_bytes() == b"abcdef"
    # 임시 파일은 안 남아있어야 함
    leftovers = [p for p in final.parent.iterdir() if p.name != final.name]
    assert leftovers == []


def test_raises_and_cleans_up_when_exceeding_max_bytes():
    with pytest.raises(UploadTooLargeError):
        asyncio.run(
            write_song_file_streaming(
                2, "original.wav", _chunks(b"a" * 5, b"b" * 5, b"c" * 5), max_bytes=8
            )
        )

    final = file_storage.resolve_asset_path("2/original.wav")
    assert final is not None
    assert not final.exists()  # 최종 파일로 교체되기 전에 중단됨
    assert not final.parent.exists() or list(final.parent.iterdir()) == []  # 임시 파일도 정리됨


def test_no_limit_means_unbounded():
    big_chunk = b"x" * (1024 * 1024)  # 1MB짜리 청크 10개 = 10MB, max_bytes 생략
    rel_path = asyncio.run(
        write_song_file_streaming(3, "original.wav", _chunks(*([big_chunk] * 10)))
    )
    final = file_storage.resolve_asset_path(rel_path)
    assert final.stat().st_size == 10 * 1024 * 1024
