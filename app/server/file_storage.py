"""곡 파일(원본 악보·DrumScore JSON) 저장 경로 계산.

근거: intent/03-architecture-stack.md §5 "사용자 데이터는 루트 data/ 아래 저장",
work/T2-5/plan.md §설계 1. 경로는 db/session.py의 PROJECT_ROOT 계산 패턴을 그대로
따른다(cwd 무관, 윈도우·맥 모두 동작).

Codex 모드C C-001: 업로드 원본 파일명은 신뢰하지 않는다 — 서버가 고정 파일명
(`original<확장자>`, `drumscore.json`)을 생성하므로 디스크 경로 구성에 사용자가
보낸 문자열이 전혀 섞이지 않는다. 그래도 쓰기 직전에도 최종 경로가 저장소 루트
밖으로 안 나가는지 재검증한다 — db/models.py의 Asset CheckConstraint 주석이
"실제 파일 접근 시 data/ 내부로 재검증하는 로직"을 요구하는데, 읽기(resolve_asset_path)
뿐 아니라 쓰기(write_song_file)에도 같은 방어를 둔다.
"""

import os
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = SERVER_ROOT.parent.parent
# db/session.py의 DRUM_DB_PATH와 같은 패턴 — 테스트가 실제 data/songs/를 건드리지
# 않도록 환경변수로 저장소 루트를 바꿀 수 있게 한다.
SONGS_ROOT = Path(os.environ.get("DRUM_SONGS_ROOT", str(PROJECT_ROOT / "data" / "songs")))


class PathSafetyError(Exception):
    """계산된 경로가 SONGS_ROOT 밖으로 벗어나려 할 때."""


def _ensure_within_songs_root(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(SONGS_ROOT.resolve()):
        raise PathSafetyError(f"경로가 저장소 루트 밖입니다: {path}")
    return resolved


def song_storage_dir(song_id: int) -> Path:
    """곡 하나의 저장 디렉터리를 만들고 반환한다."""
    directory = _ensure_within_songs_root(SONGS_ROOT / str(song_id))
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def write_song_file(song_id: int, fixed_filename: str, content: bytes) -> str:
    """고정 파일명(`fixed_filename`)으로 파일을 쓰고, DB에 저장할 상대 경로
    (`<song_id>/<fixed_filename>`, SONGS_ROOT 기준)를 반환한다.

    `fixed_filename`은 호출자가 allowlist로 검증한 확장자로 직접 구성해야 한다
    (예: "original.mid", "drumscore.json") — 사용자가 업로드 시 보낸 원본
    파일명 문자열을 그대로 넘기면 안 된다(Codex 모드C C-001).
    """
    directory = song_storage_dir(song_id)
    target = _ensure_within_songs_root(directory / fixed_filename)
    target.write_bytes(content)
    return f"{song_id}/{fixed_filename}"


def resolve_asset_path(file_path: str) -> Path | None:
    """DB의 Asset.file_path를 실제 파일 경로로 변환한다. 저장소 루트 밖으로
    벗어나는 경로면 None을 반환한다(호출자가 404로 처리 — 존재 여부를
    흘리지 않음, 기존 songs.py 관례와 통일)."""
    candidate = SONGS_ROOT / file_path
    try:
        return _ensure_within_songs_root(candidate)
    except PathSafetyError:
        return None


def delete_song_files(song_id: int) -> None:
    """곡 디렉터리 전체를 삭제한다. 파일이 이미 없어도 예외 없이 넘어간다
    (work/T2-5/plan.md §설계 2 — best-effort, 실패해도 DB 삭제는 이미 끝난 뒤)."""
    directory = SONGS_ROOT / str(song_id)
    try:
        resolved = _ensure_within_songs_root(directory)
    except PathSafetyError:
        return
    if not resolved.exists():
        return
    for child in resolved.iterdir():
        child.unlink(missing_ok=True)
    resolved.rmdir()
