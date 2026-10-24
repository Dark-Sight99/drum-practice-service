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
import uuid
from collections.abc import Iterable
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
    파일명 문자열을 그대로 넘기면 안 된다(T2-5 Codex 모드C C-001).

    T2-6 Codex 모드C C-002(+3차: 임시 파일명 충돌): 같은 디렉터리에 요청마다
    고유한 임시 파일(`<fixed_filename>.<uuid4>.tmp`)로 먼저 쓴 뒤 `Path.replace()`로
    원자적으로 교체한다 — 같은 곡에 동시 저장 요청이 와도 서로 다른 임시 파일을
    쓰므로 간섭하지 않고(각자 자기 임시 파일만 만들고 정리), 쓰기 도중 실패해도
    "반쯤 쓰인 파일"이 최종 이름으로 남지 않는다(Path.replace는 같은 디렉터리=
    같은 볼륨이라 POSIX rename()/Windows MoveFileEx로 원자적 — Python 공식 문서).
    """
    directory = song_storage_dir(song_id)
    target = _ensure_within_songs_root(directory / fixed_filename)
    tmp_target = _ensure_within_songs_root(directory / f"{fixed_filename}.{uuid.uuid4().hex}.tmp")
    try:
        tmp_target.write_bytes(content)
        tmp_target.replace(target)
    finally:
        tmp_target.unlink(missing_ok=True)  # replace() 성공 후엔 이미 없음 — 실패 시에만 의미 있음
    return f"{song_id}/{fixed_filename}"


def write_song_file_streaming(
    song_id: int, fixed_filename: str, chunks: Iterable[bytes]
) -> str:
    """`write_song_file()`과 같은 보장(요청별 고유 임시 파일 → 전체를 다 쓴 뒤에만
    `Path.replace()`로 원자적 교체 → 예외 시 임시 파일 정리)을 그대로 따르되,
    `content: bytes` 하나를 받는 대신 청크 이터러블을 받아 메모리에 전체를 모으지
    않고 임시 파일에 순차적으로 쓴다(T3-1 REQ-01, 100MB 음원 업로드가 메모리에
    두 번(청크 리스트+join) 안 올라가게 하기 위함 — work/T3-1/plan.md 모드C C-005).

    업로드가 중간에(예: 크기 상한 초과) 중단돼 호출자가 예외를 던지면, 이 함수는
    아직 `replace()`하기 전이므로 `fixed_filename`엔 아무 영향이 없고 임시 파일만
    `finally`에서 지워진다 — 불완전한 최종 파일이 남지 않는다(모드C C-012).
    """
    directory = song_storage_dir(song_id)
    target = _ensure_within_songs_root(directory / fixed_filename)
    tmp_target = _ensure_within_songs_root(directory / f"{fixed_filename}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp_target.open("wb") as f:
            for chunk in chunks:
                f.write(chunk)
        tmp_target.replace(target)
    finally:
        tmp_target.unlink(missing_ok=True)
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
