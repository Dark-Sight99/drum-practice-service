"""곡 목록/상세/업로드(디지털 악보·음원)/이름변경/삭제/DrumScore 조회(로그인한
사용자 자신의 곡만).

근거: REQ-07(라이브러리), REQ-08(계정 간 데이터 분리), work/T2-5/plan.md,
work/T3-1/plan.md(음원 업로드).
디지털 악보(MIDI/MusicXML/Guitar Pro) 업로드는 Phase 2 범위 — 브라우저가
T2-1 임포터로 이미 DrumScore JSON을 만들어 보내고, 서버는 원본 파일 + 그
JSON을 저장만 한다(T1-5 결정: 경로 C 파싱은 브라우저 전담).
음원(mp3/wav/m4a/flac) 업로드는 Phase 3(T3-1, REQ-01) 범위 — DrumScore 없이
원본만 저장하고 Demucs 분리 작업을 큐에 넣는다(실제 분리는 worker가 비동기 처리).
"""

import enum
import json
import mimetypes
from collections.abc import AsyncIterator
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
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import DrumScoreIn, PracticeSettingIn, PracticeSettingOut
from auth.security import utcnow_naive
from db.models import (
    AUDIO_ASSET_KINDS,
    Asset,
    AssetKind,
    Job,
    JobStatus,
    JobType,
    PracticeSetting,
    Song,
    SongSourceType,
    SongStatus,
    User,
)
from file_storage import (
    UploadTooLargeError,
    delete_song_files,
    resolve_asset_path,
    write_song_file,
    write_song_file_streaming,
)
from modules.tempo.atempo import (
    PERMILLE_MAX,
    PERMILLE_MIN,
    TempoStretchError,
    get_or_create_tempo_mp3,
)

router = APIRouter(prefix="/songs", tags=["songs"])

# T3-3(REQ-04) — `GET /songs/{id}/audio/{kind}`의 경로 파라미터 전용 enum.
# `AUDIO_ASSET_KINDS`(db/models.py)에서 자동 생성해 값이 어긋날 일이 없게 한다
# (work/T3-3/plan.md §1 — DRUMSCORE_*·SHEET_IMAGE·MIDI_EXPORT는 여기 못 들어와
# FastAPI가 자동으로 422 처리).
AudioAssetKind = enum.StrEnum(
    "AudioAssetKind", {kind.name: kind.value for kind in AUDIO_ASSET_KINDS}
)

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

# REQ-01 명시 입력 형식(mp3/wav/m4a/flac) + mp4(2026-10-26 의뢰인 요청으로 확장).
# mp4는 음원이 아니라 비디오 컨테이너지만, Demucs(ffmpeg 백엔드)가 오디오 트랙만
# 바로 추출해 분리할 수 있음을 실제 의뢰인 파일로 이미 확인해둔 상태였음
# (`qa-evidence/T3-1/demucs_mp4_spike.md` — 당시엔 "범위 밖"이라 허용 목록엔
# 안 넣었던 것뿐, 기술적으로는 이미 검증됨).
ALLOWED_AUDIO_EXTENSIONS: frozenset[str] = frozenset({".mp3", ".wav", ".m4a", ".flac", ".mp4"})
# 3~5분 음원은 수십 MB대라 디지털 악보용 20MB 상한보다 훨씬 커야 함 — REQ-01에
# 수치 명시는 없어 디스크 보호 목적으로 정한 값(work/T3-1/plan.md §2).
MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024


class SongOut(BaseModel):
    id: int
    title: str
    artist: str | None
    status: str
    original_bpm: float | None
    source_type: str
    # T3-3(REQ-04) — `Song.available_audio_kinds`(db/models.py) 프로퍼티를 그대로
    # 읽는다. 프런트가 `GET /songs/{id}/audio/{kind}`를 매 kind마다 시도해 404를
    # 흡수하지 않고, 이 목록으로 바로 알 수 있게(work/T3-3/plan.md §2).
    available_audio_kinds: list[str]

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
    """2026-10-31(REQ-07, 의뢰인 요청) — 최근에 연(재생/편집) 곡이 맨 위. 아직
    한 번도 안 연 곡은 last_opened_at이 NULL이라 업로드 시각(created_at)으로
    대체해 정렬 — 새로 올린 곡이 목록 맨 아래로 묻히지 않는다."""
    order_key = func.coalesce(Song.last_opened_at, Song.created_at)
    return (
        db.query(Song)
        .filter(Song.user_id == user.id)
        .order_by(order_key.desc())
        .all()
    )


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


class AudioUploadOut(BaseModel):
    song: SongOut
    job_id: int


async def _iter_upload_chunks(
    file: UploadFile, chunk_size: int = 1024 * 1024
) -> AsyncIterator[bytes]:
    """`UploadFile.read()`를 청크 단위 비동기 이터레이터로 감싼다 — 호출자가
    청크를 리스트에 모으지 않고 `write_song_file_streaming`에 그대로 넘겨
    도착하는 즉시 디스크에 쓸 수 있게 한다(모드A C-002)."""
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        yield chunk


@router.post("/audio", response_model=AudioUploadOut, status_code=status.HTTP_201_CREATED)
async def upload_audio(
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1),
    artist: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AudioUploadOut:
    """REQ-01(T3-1) — 음원을 올려 Demucs 분리 작업을 큐에 넣는다. DrumScore는
    아직 없음(분리·채보 전) — `upload_song`과 달리 Song.status는 PENDING에서
    시작해 워커가 분리를 마치면 COMPLETED/FAILED로 바뀐다(진행률은 GET
    /songs/{id}·GET /jobs/{id}로 조회, work/T3-1/plan.md).
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"지원하지 않는 음원 형식: {ext or '(확장자 없음)'}"
        )

    song = Song(
        user_id=user.id,
        title=title,
        artist=artist,
        source_type=SongSourceType.AUDIO,
        status=SongStatus.PENDING,
    )
    db.add(song)
    db.commit()
    db.refresh(song)

    try:
        # 모드A 지적 C-002: 이전 버전은 청크를 리스트에 전부 모았다가 넘겨서
        # write_song_file_streaming이 받기 전에 이미 파일 크기만큼 메모리에
        # 올라가 있었다(스트리밍이 이름뿐이었음) — 이제 file.read()를 그대로
        # 비동기 제너레이터로 감싸 청크가 도착하는 즉시 디스크에 쓰고, 크기
        # 초과 검사도 write_song_file_streaming 내부에서 같은 루프 중에 한다.
        original_path = await write_song_file_streaming(
            song.id,
            f"original{ext}",
            _iter_upload_chunks(file),
            max_bytes=MAX_AUDIO_UPLOAD_BYTES,
        )
        db.add(Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path=original_path))
        job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
        db.add(job)
        db.commit()
    except UploadTooLargeError:
        db.rollback()
        delete_song_files(song.id)
        db.query(Song).filter(Song.id == song.id).delete()
        db.commit()
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, "파일이 너무 큽니다(100MB 제한)"
        ) from None
    except Exception as exc:
        db.rollback()
        delete_song_files(song.id)
        db.query(Song).filter(Song.id == song.id).delete()
        db.commit()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "업로드 처리 중 오류가 발생했습니다"
        ) from exc

    db.refresh(song)
    db.refresh(job)
    return AudioUploadOut(song=SongOut.model_validate(song), job_id=job.id)


class TranscribeOut(BaseModel):
    job_id: int


@router.post(
    "/{song_id}/transcribe", response_model=TranscribeOut, status_code=status.HTTP_201_CREATED
)
def transcribe_song(
    song: Song = Depends(get_owned_song),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TranscribeOut:
    """REQ-02 경로 A(T3-2) — 이미 분리된(T3-1) 곡의 drums 스템으로 자동 채보
    작업을 큐에 넣는다. T3-1과 자동 연결 안 함(명시적 트리거, work/T3-2/plan.md
    "T3-1과의 관계" 참조) — 프런트엔드가 생기면 "분리 완료" 버튼으로 이걸 호출.
    """
    stem_asset = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind.STEM_DRUMS)
        .first()
    )
    if stem_asset is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "먼저 음원 분리를 완료해야 합니다"
        )
    # 모드C C-006: 에셋 행 존재만 보지 않고 실제 파일도 확인(행은 있는데 파일이
    # 지워졌거나 경로가 안전 범위 밖이면 Job을 큐에 넣지 않고 바로 거부).
    stem_path = resolve_asset_path(stem_asset.file_path)
    if stem_path is None or not stem_path.exists():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "드럼 스템 파일을 찾을 수 없습니다"
        )

    # 모드A 지적 C-001: 같은 곡에 아직 안 끝난 TRANSCRIBE 작업이 있으면 새로
    # 만들지 않고 그 Job을 그대로 돌려준다 — 중복 클릭으로 같은 곡에 작업이
    # 여러 개 쌓이는 걸 막는다(Q-17 "워커 1개만 운영" 전제에서 핸들러의
    # find-or-create가 순차 재채보는 이미 안전하게 처리하지만, 큐에 여러 개가
    # 쌓이는 것 자체는 막는 게 더 안전함).
    pending_job = (
        db.query(Job)
        .filter(
            Job.song_id == song.id,
            Job.job_type == JobType.TRANSCRIBE,
            Job.status.in_((JobStatus.QUEUED, JobStatus.PROCESSING)),
        )
        .first()
    )
    if pending_job is not None:
        return TranscribeOut(job_id=pending_job.id)

    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job)
    db.commit()
    db.refresh(job)
    return TranscribeOut(job_id=job.id)


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
    # Codex 모드A 지적(필수, 반영) — Song.jobs에 cascade를 추가(위 모델 변경)한
    # 뒤로 삭제 자체는 더 이상 실패하지 않지만, 워커가 바로 지금 이 곡의 Job을
    # PROCESSING 중이면 경합이 생긴다: 워커는 이미 메모리에 들고 있는 Job
    # 객체로 계속 파일을 쓰고 Asset을 커밋하려 드는데(modules/separator/
    # handler.py), 그 사이 여기서 DB 행(Song·cascade된 Job)과 파일(아래
    # delete_song_files)을 먼저 지워버리면 — 핸들러의 커밋이 FK 위반으로
    # 실패하거나(해롭지 않음, Job.status=FAILED로 넘어감), 더 나쁘게는 방금
    # 지운 곡 폴더에 핸들러가 파일을 다시 써 넣어(디스크에 고아 파일로 영구
    # 남음) 버릴 수 있다. QUEUED 작업은 아직 아무도 안 집어서 안전(워커가
    # 집으려 할 때 이미 없는 행이라 그냥 건너뜀) — PROCESSING만 막는다.
    has_processing_job = (
        db.query(Job)
        .filter(Job.song_id == song.id, Job.status == JobStatus.PROCESSING)
        .first()
        is not None
    )
    if has_processing_job:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "처리 중인 곡은 삭제할 수 없습니다 — 처리가 끝난 뒤 다시 시도해주세요",
        )
    song_id = song.id
    db.delete(song)
    db.commit()
    delete_song_files(song_id)


@router.get("/{song_id}/drumscore")
def get_song_drumscore(
    song: Song = Depends(get_owned_song), db: Session = Depends(get_db)
) -> Response:
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

    # 2026-10-31(REQ-07, 의뢰인 요청) — 연습 화면(열기)·편집 화면(편집) 둘 다
    # 이 엔드포인트를 거치므로(App.tsx handleOpen/handleEdit → fetchSongDrumScore)
    # 여기 한 곳에서만 "사용한 시각"을 찍으면 라이브러리 정렬(list_songs)에
    # 반영된다.
    song.last_opened_at = utcnow_naive()
    db.commit()

    return Response(content=path.read_bytes(), media_type="application/json")


@router.get("/{song_id}/audio/{kind}")
def get_song_audio(
    kind: AudioAssetKind, song: Song = Depends(get_owned_song), db: Session = Depends(get_db)
) -> FileResponse:
    """T3-3(REQ-04) — 분리된 스템·원본을 브라우저 `<audio>`가 재생할 수 있게
    서빙한다(work/T3-3/plan.md §1). `kind`가 `AudioAssetKind`가 아니면 FastAPI가
    자동으로 422 처리(DRUMSCORE_*·SHEET_IMAGE·MIDI_EXPORT는 이 enum에 없음).

    `FileResponse`가 Range 요청(iOS Safari의 `<audio>` 재생에 중요)을 이미
    처리한다 — `app/server/.venv`에 실제로 설치된 Starlette 1.9.0의
    `FileResponse.__call__` 소스를 직접 읽어 `Range`/`If-Range` 헤더를 파싱해
    206으로 응답하는 로직이 내장돼 있음을 확인했고(`_parse_range_header` 등),
    `tests/test_songs_audio.py`가 실제 `TestClient`로 `Range` 요청을 보내
    206+`Content-Range`를 받는지까지 검증한다 — 소스를 읽어봤다는 것만으로
    끝내지 않음."""
    asset = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind(kind.value))
        .first()
    )
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "오디오 트랙을 찾을 수 없습니다")
    path = resolve_asset_path(asset.file_path)
    if path is None or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "오디오 트랙을 찾을 수 없습니다")
    # T3-16-feedback-2(네트워크 스트리밍) — 등록된 자산이 WAV면(현재
    # stem_drums만 해당 — 채보 파이프라인이 이 Asset 경로를 그대로 읽으므로
    # Asset 자체는 WAV로 유지) 옆에 재생 전용 MP3 사이드카가 있는지 먼저
    # 본다(`modules/separator/handler.py`가 best-effort로 만들어둠). 있으면
    # 그걸 대신 서빙 — 맥 원격 접속 실측으로 38.7MB WAV가 반복·중도취소
    # 재요청되며 끊기는 걸 확인(이 사이드카로 해결). 사이드카가 없으면(아직
    # 생성 안 됐거나 실패) 기존 WAV를 그대로 서빙 — 동작 자체는 안 깨짐.
    if path.suffix == ".wav":
        sidecar = path.with_suffix(".mp3")
        if sidecar.exists():
            path = sidecar
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    # T3-16-feedback-5(네트워크, 2026-10-26) — 기본값은 Cache-Control이 아예
    # 없어 브라우저가 재생(Range 요청) 때마다 서버에 재확인하러 감(최소
    # 304 재검증이라도 왕복 발생) — 원격(Tailscale) 네트워크에서 이 왕복마다
    # 끊길 여지가 생긴다. 이 song_id의 이 kind 파일은 **절대 안 바뀐다**는
    # 걸 코드로 확인함(`POST /songs/audio`가 새 Song 생성 시 JobType.SEPARATE를
    # 딱 한 번만 큐에 넣음 — 기존 곡을 재분리해 같은 경로를 덮어쓰는 엔드포인트
    # 자체가 없음, grep으로 전체 API 확인).
    # 모드A 지적(필수, 반영함) — 1년 `immutable`은 `private`라도 "로그인한
    # 이 브라우저의 로컬 캐시"엔 그대로 남는다(RFC 9111 §5.2.2.7 — private는
    # 공유 캐시 금지일 뿐 비공개를 보장 안 함). 관리자가 계정을 정지하면
    # "다음 요청부터 바로" 막혀야 한다는 기존 요구(REQ-08, wiki/architecture.md)와
    # 충돌 — 로그아웃·계정 정지 후에도 캐시된 오디오를 계속 재생할 수 있게
    # 됨. `max-age`를 한 연습 세션(수십 분) 정도로 짧게 줄이고 `immutable`은
    # 뺌 — 세션 내 재생 중 재요청은 여전히 막으면서, 정지 뒤 노출 창을 1시간
    # 으로 제한.
    headers = {"Cache-Control": "private, max-age=3600"}
    return FileResponse(path, media_type=media_type, headers=headers)


@router.get("/{song_id}/audio/{kind}/tempo/{permille}")
def get_song_audio_tempo(
    kind: AudioAssetKind,
    permille: int,
    song: Song = Depends(get_owned_song),
    db: Session = Depends(get_db),
) -> FileResponse:
    """T6-11(REQ-04, Q-33) — 음정을 유지한 배속 변환본을 서빙한다(work/T6-11/
    plan.md "API 계약"). `original`은 배속 변환 대상이 아니라 명시 거부한다
    (연습 화면은 스템만 배속 변경 — AudioAssetKind는 `get_song_audio`와 공유하는
    enum이라 `original`도 타입상 들어올 수 있어 여기서 직접 막아야 함).

    캐시 미스면 요청 처리 중 바로 ffmpeg `atempo`로 변환한다(동기 `def` 라우트 —
    FastAPI가 스레드풀에서 실행해 이벤트 루프를 안 막음, **비동기 202/폴링
    없음**, 실측 최악 5.5초). 200 응답 헤더의 `X-Tempo-Permille`로 실제 적용된
    permille(요청값 그대로 — Codex 모드C 1차 C-003)을 알려준다."""
    if kind == AudioAssetKind.ORIGINAL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "원본은 배속 변환 대상이 아닙니다")
    if not PERMILLE_MIN <= permille <= PERMILLE_MAX:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"permille 범위를 벗어남({PERMILLE_MIN}~{PERMILLE_MAX})",
        )

    asset = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind(kind.value))
        .first()
    )
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "오디오 트랙을 찾을 수 없습니다")
    source_path = resolve_asset_path(asset.file_path)
    if source_path is None or not source_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "오디오 트랙을 찾을 수 없습니다")

    # work/T6-11/plan.md "API 계약" — 1000(배속 변경 없음)이면 atempo조차 안
    # 거치고 원본 스템을 그대로 서빙한다. atempo=1.0도 자체 시작 오프셋(~8ms)을
    # 만든다는 게 실측으로 확인됐기 때문(plan.md "실측으로 발견한 주의점") —
    # 불필요한 변환·그 오프셋을 둘 다 피한다. `get_song_audio`와 같은 WAV
    # 사이드카 우선 로직도 그대로 적용(둘 다 "일반 재생용 파일을 그대로
    # 준다"는 같은 의미이므로).
    if permille == 1000:
        path = source_path
        if path.suffix == ".wav":
            sidecar = path.with_suffix(".mp3")
            if sidecar.exists():
                path = sidecar
        # 모드C 1라운드 자체 테스트로 발견 — 사이드카가 없어 WAV 그대로
        # 서빙되는 경우까지 있으므로 `get_song_audio`와 똑같이 실제 확장자로
        # media_type을 판정해야 한다(고정 "audio/mpeg"면 WAV를 mp3라고
        # 거짓 응답하게 됨).
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        headers = {"Cache-Control": "private, max-age=3600", "X-Tempo-Permille": "1000"}
        return FileResponse(path, media_type=media_type, headers=headers)

    try:
        cache_path = get_or_create_tempo_mp3(song.id, kind.value, permille, source_path)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except TempoStretchError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

    headers = {"Cache-Control": "private, max-age=3600", "X-Tempo-Permille": str(permille)}
    return FileResponse(cache_path, media_type="audio/mpeg", headers=headers)


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


def _find_practice_setting(db: Session, song_id: int) -> PracticeSetting | None:
    return db.query(PracticeSetting).filter(PracticeSetting.song_id == song_id).first()


@router.get("/{song_id}/practice-setting", response_model=PracticeSettingOut)
def get_practice_setting(
    song: Song = Depends(get_owned_song), db: Session = Depends(get_db)
) -> PracticeSettingOut:
    """T3-4(REQ-05) — 곡별 믹서 설정 조회. work/T3-4/plan.md §1: 저장된 게
    없으면(행 자체가 없거나 `volumes_json`이 비어있으면) `volumes=None`을 그대로
    돌려준다 — 기본값은 프런트(`defaultMixerState()`)가 채운다."""
    setting = _find_practice_setting(db, song.id)
    if setting is None or not setting.volumes_json:
        return PracticeSettingOut(volumes=None)
    return PracticeSettingOut(volumes=json.loads(setting.volumes_json))


@router.put("/{song_id}/practice-setting", status_code=status.HTTP_204_NO_CONTENT)
def save_practice_setting(
    body: PracticeSettingIn, song: Song = Depends(get_owned_song), db: Session = Depends(get_db)
) -> None:
    """T3-4(REQ-05) — 곡별 믹서 설정 저장. `volumes_json`만 갱신하고
    `practice_bpm`/루프 컬럼은 안 건드림(work/T3-4/plan.md §1·§범위경계 —
    이번 작업 범위 밖, 기존 값이 있으면 그대로 둠)."""
    volumes_json = json.dumps({k: v.model_dump() for k, v in body.volumes.items()})

    existing = _find_practice_setting(db, song.id)
    if existing is not None:
        existing.volumes_json = volumes_json
        db.commit()
        return

    # work/T3-4/plan.md §1(모드C 1라운드 C-005) — T2-6 `_find_edited_asset`과
    # 동일한 "낙관적 upsert": song_id 유니크 제약 때문에 동시에 최초 PUT 2개가
    # 오면 하나는 INSERT가 IntegrityError로 거부될 수 있어, rollback 후
    # 재조회해 UPDATE로 재시도한다.
    try:
        db.add(PracticeSetting(song_id=song.id, volumes_json=volumes_json))
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _find_practice_setting(db, song.id)
        if existing is None:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "저장 처리 중 오류가 발생했습니다"
            ) from None
        existing.volumes_json = volumes_json
        db.commit()
