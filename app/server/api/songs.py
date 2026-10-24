"""곡 목록/상세/업로드/이름변경/삭제/DrumScore 조회(로그인한 사용자 자신의 곡만).

근거: REQ-07(라이브러리), REQ-08(계정 간 데이터 분리), work/T2-5/plan.md.
업로드는 Phase 2 범위(디지털 악보: MIDI/MusicXML/Guitar Pro)만 — 브라우저가
T2-1 임포터로 이미 DrumScore JSON을 만들어 보내고, 서버는 원본 파일 + 그
JSON을 저장만 한다(T1-5 결정: 경로 C 파싱은 브라우저 전담).
"""

from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import DrumScoreIn
from db.models import Asset, AssetKind, Song, SongSourceType, SongStatus, User
from file_storage import delete_song_files, resolve_asset_path, write_song_file

router = APIRouter(prefix="/songs", tags=["songs"])

# 확장자 → DrumScore meta.source 기대값(Phase 2 범위: 디지털 악보만).
ALLOWED_EXTENSIONS: dict[str, str] = {
    ".mid": "midi",
    ".midi": "midi",
    ".musicxml": "musicxml",
    ".mxl": "musicxml",
    ".gp": "gp",
    ".gp3": "gp",
    ".gp4": "gp",
    ".gp5": "gp",
    ".gpx": "gp",
}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # work/T2-5/plan.md §설계 2 — 디스크 보호용 상한


class SongOut(BaseModel):
    id: int
    title: str
    artist: str | None
    status: str
    original_bpm: float | None
    source_type: str

    model_config = {"from_attributes": True}


class RenameSongRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    artist: str | None = None


def get_owned_song(
    song_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Song:
    """Codex 모드C C-006: PATCH·DELETE·drumscore 조회·상세조회가 전부 이 하나의
    의존성을 공유해, 소유자 검사를 엔드포인트마다 따로 구현하다 하나 빠뜨리는
    실수를 구조적으로 막는다. 다른 사용자 소유 곡이어도 403이 아니라 404(존재
    자체를 흘리지 않음, REQ-08 "계정 간 완전 분리" 취지)."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == user.id).first()
    if song is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "곡을 찾을 수 없습니다")
    return song


@router.get("", response_model=list[SongOut])
def list_songs(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Song]:
    return db.query(Song).filter(Song.user_id == user.id).all()


@router.get("/{song_id}", response_model=SongOut)
def get_song(song: Song = Depends(get_owned_song)) -> Song:
    return song


@router.post("", response_model=SongOut, status_code=status.HTTP_201_CREATED)
async def upload_song(
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1),
    artist: str | None = Form(None),
    drumscore: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Song:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"지원하지 않는 파일 형식: {ext or '(확장자 없음)'}"
        )

    # Codex 모드B 권장 C-002: file.read()를 인자 없이 호출하면 크기 제한 검사 전에
    # 파일 전체를 먼저 읽어버려(UploadFile 공식 타입 정의 — read(size=-1)) 20MB
    # 제한이 메모리 사용량을 못 막는다. 청크 단위로 읽으며 누적 크기가 상한을
    # 넘는 순간 바로 멈춘다(전체를 다 읽지 않음).
    chunks: list[bytes] = []
    total_bytes = 0
    chunk_size = 1024 * 1024
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "파일이 너무 큽니다(20MB 제한)")
        chunks.append(chunk)
    content = b"".join(chunks)

    try:
        parsed = DrumScoreIn.model_validate_json(drumscore)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"잘못된 DrumScore: {exc}"
        ) from exc

    if ALLOWED_EXTENSIONS[ext] != parsed.meta.source:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"파일 확장자({ext})와 DrumScore meta.source({parsed.meta.source})가 일치하지 않습니다",
        )
    source_type = SongSourceType(parsed.meta.source)

    song = Song(
        user_id=user.id,
        title=title,
        artist=artist,
        original_bpm=parsed.meta.bpm,
        source_type=source_type,
        status=SongStatus.COMPLETED,  # 비동기 작업 없음 — 브라우저가 이미 다 파싱해서 보냄
    )
    db.add(song)
    db.commit()
    db.refresh(song)

    # Codex 모드C C-004: 파일 쓰기·Asset 생성 중 어느 단계든 실패하면 그때까지
    # 디스크에 쓴 파일을 전부 지우고 Song 행도 롤백 — 고아 DB 행도, 고아 파일도 안 남김.
    try:
        original_path = write_song_file(song.id, f"original{ext}", content)
        drumscore_path = write_song_file(song.id, "drumscore.json", drumscore.encode("utf-8"))
        db.add(Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path=original_path))
        db.add(Asset(song_id=song.id, kind=AssetKind.DRUMSCORE_RAW, file_path=drumscore_path))
        db.commit()
    except Exception as exc:
        db.rollback()
        delete_song_files(song.id)
        db.query(Song).filter(Song.id == song.id).delete()
        db.commit()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "업로드 처리 중 오류가 발생했습니다"
        ) from exc

    db.refresh(song)
    return song


@router.patch("/{song_id}", response_model=SongOut)
def rename_song(
    body: RenameSongRequest,
    song: Song = Depends(get_owned_song),
    db: Session = Depends(get_db),
) -> Song:
    if body.title is not None:
        song.title = body.title
    if "artist" in body.model_fields_set:
        song.artist = body.artist
    db.commit()
    db.refresh(song)
    return song


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(song: Song = Depends(get_owned_song), db: Session = Depends(get_db)) -> None:
    song_id = song.id
    db.delete(song)
    db.commit()
    delete_song_files(song_id)


@router.get("/{song_id}/drumscore")
def get_song_drumscore(song: Song = Depends(get_owned_song)) -> Response:
    asset = None
    for kind in (AssetKind.DRUMSCORE_EDITED, AssetKind.DRUMSCORE_RAW):
        asset = next((a for a in song.assets if a.kind == kind), None)
        if asset is not None:
            break
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DrumScore를 찾을 수 없습니다")

    path = resolve_asset_path(asset.file_path)
    if path is None or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DrumScore를 찾을 수 없습니다")
    return Response(content=path.read_bytes(), media_type="application/json")


def _find_edited_asset(db: Session, song_id: int) -> Asset | None:
    return (
        db.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.DRUMSCORE_EDITED)
        .first()
    )


@router.put("/{song_id}/drumscore", status_code=status.HTTP_204_NO_CONTENT)
async def save_song_drumscore(
    request: Request,
    song: Song = Depends(get_owned_song),
    db: Session = Depends(get_db),
) -> None:
    """T2-6(REQ-03) — 편집기가 수정한 DrumScore를 저장한다. 원문 바이트 그대로
    저장(재직렬화 안 함, T2-5 업로드와 같은 원칙). `DrumScoreIn`으로 업로드와
    동일한 구조+수치 불변식을 검증(work/T2-6/plan.md §설계 1).
    """
    raw_body = await request.body()
    try:
        DrumScoreIn.model_validate_json(raw_body)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"잘못된 DrumScore: {exc}"
        ) from exc

    file_path = write_song_file(song.id, "drumscore_edited.json", raw_body)

    existing = _find_edited_asset(db, song.id)
    if existing is not None:
        existing.file_path = file_path
        db.commit()
        return

    # Codex 모드C C-001(+2차 반영): 동시 요청이 그 사이 먼저 행을 만들었으면
    # DRUMSCORE_EDITED 전용 부분 유니크 인덱스(db/models.py)가 두 번째 INSERT를
    # IntegrityError로 거부한다 — 이 세션은 rollback() 전까지 추가 쿼리를 할 수
    # 없으므로(PendingRollbackError, 실제 실행으로 확인) 먼저 rollback한 뒤
    # 다시 조회해 UPDATE로 재시도한다(낙관적 upsert).
    try:
        db.add(Asset(song_id=song.id, kind=AssetKind.DRUMSCORE_EDITED, file_path=file_path))
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _find_edited_asset(db, song.id)
        if existing is None:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "저장 처리 중 오류가 발생했습니다"
            ) from None
        existing.file_path = file_path
        db.commit()
