"""SQLAlchemy 2.0 ORM 모델. 근거: intent/05-todo.md T1-2, REQ-07/08/10."""

import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


def str_enum_column(enum_cls: type[enum.Enum]) -> Enum:
    """DB에 enum 멤버의 .name('PENDING')이 아니라 .value('pending')를 저장하도록 하는 공통 설정.

    실제 실행으로 확인: values_callable 없이 쓰면 SQLAlchemy가 기본으로 .name을 저장함
    (예: SongStatus.PENDING -> 'PENDING'). DrumScore 포맷(소문자, 03-architecture-stack.md §2)과
    맞추기 위해 .value를 저장하도록 명시한다.
    """
    return Enum(enum_cls, native_enum=False, values_callable=lambda x: [e.value for e in x])


class SongSourceType(enum.StrEnum):
    """DrumScore meta.source와 맞춤 (intent/03-architecture-stack.md §2)."""

    AUDIO = "audio"
    OMR = "omr"
    MIDI = "midi"
    MUSICXML = "musicxml"
    GP = "gp"


class SongStatus(enum.StrEnum):
    """REQ-01 수용 기준의 "대기·처리중·완료·실패" 그대로."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class AssetKind(enum.StrEnum):
    ORIGINAL = "original"
    STEM_DRUMS = "stem_drums"
    STEM_BASS = "stem_bass"
    STEM_VOCALS = "stem_vocals"
    STEM_OTHER = "stem_other"
    DRUMSCORE_RAW = "drumscore_raw"
    DRUMSCORE_EDITED = "drumscore_edited"
    SHEET_IMAGE = "sheet_image"
    MIDI_EXPORT = "midi_export"


class JobType(enum.StrEnum):
    SEPARATE = "separate"
    TRANSCRIBE = "transcribe"
    OMR = "omr"
    IMPORT = "import"


class JobStatus(enum.StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    songs: Mapped[list["Song"]] = relationship(back_populates="user")
    jobs: Mapped[list["Job"]] = relationship(back_populates="user")
    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Song(Base):
    __tablename__ = "songs"
    __table_args__ = (
        # Job.song_id+user_id 복합 FK가 "이 곡의 소유자"를 DB 레벨에서 검증할 수 있게 하는 대상
        # (Codex 모드A C-002). id는 이미 PK로 유일하지만, 복합 FK의 참조 대상이 되려면
        # SQLite에 (id, user_id) 쌍에 대한 유일 인덱스가 별도로 있어야 한다.
        UniqueConstraint("id", "user_id", name="uq_songs_id_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    artist: Mapped[str | None] = mapped_column(String(200), nullable=True)
    original_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_type: Mapped[SongSourceType] = mapped_column(
        str_enum_column(SongSourceType), nullable=False
    )
    status: Mapped[SongStatus] = mapped_column(
        str_enum_column(SongStatus), default=SongStatus.PENDING, nullable=False
    )
    needs_review: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="songs")
    assets: Mapped[list["Asset"]] = relationship(
        back_populates="song", cascade="all, delete-orphan"
    )
    # overlaps: Job이 user_id를 (users FK)와 (songs 복합 FK) 양쪽에서 쓰는 것에 대해
    # SQLAlchemy가 경고를 내는데, 의도한 설계(Job.user_id는 항상 Job.song.user_id와 같아야 함)라
    # 실제 실행 결과(SAWarning 문구)가 안내한 대로 overlaps를 달아 경고를 끈다.
    jobs: Mapped[list["Job"]] = relationship(back_populates="song", overlaps="jobs")
    practice_setting: Mapped["PracticeSetting | None"] = relationship(
        back_populates="song", uselist=False, cascade="all, delete-orphan"
    )


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        # Codex 모드A C-003 + 모드B C-007: 상위 디렉터리 이동("..")뿐 아니라
        # 절대경로(유닉스 "/...", 윈도우 드라이브 "C:...", UNC "\\server\...")도 막는다.
        # 그래도 이건 최소한의 DB 레벨 방어선이고, 실제 파일 접근 시 data/ 내부로 재검증하는
        # 로직은 Phase 3 파일 저장 코드에서 추가로 둔다(여기서 "완전히 안전"을 주장하지 않음).
        CheckConstraint(
            "file_path NOT LIKE '%..%' "
            "AND file_path NOT LIKE '/%' "
            "AND file_path NOT LIKE '\\%' "
            "AND file_path NOT LIKE '_:%'",
            name="ck_assets_file_path_no_traversal",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), nullable=False, index=True)
    kind: Mapped[AssetKind] = mapped_column(str_enum_column(AssetKind), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    song: Mapped["Song"] = relationship(back_populates="assets")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        # Codex 모드A C-002: user_id/song_id를 각각 독립 FK로 두면
        # "다른 사용자의 곡을 참조하는 작업"이 DB에 그냥 저장될 수 있음.
        # 복합 FK로 (song_id, user_id)가 songs의 (id, user_id)와 정확히 일치해야만
        # 저장되게 해서, 작업의 소유자가 곡의 소유자와 다를 수 없게 한다.
        ForeignKeyConstraint(
            ["song_id", "user_id"],
            ["songs.id", "songs.user_id"],
            name="fk_jobs_song_user_match",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # REQ-10의 모든 작업 유형(분리/채보/OMR/가져오기)은 특정 곡에 대한 처리라 song_id는 필수로 둔다.
    song_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    job_type: Mapped[JobType] = mapped_column(str_enum_column(JobType), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        str_enum_column(JobStatus), default=JobStatus.QUEUED, nullable=False, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(
        back_populates="jobs", foreign_keys=[user_id], overlaps="jobs"
    )
    song: Mapped["Song"] = relationship(back_populates="jobs", overlaps="jobs,user")


class PracticeSetting(Base):
    __tablename__ = "practice_settings"
    __table_args__ = (UniqueConstraint("song_id", name="uq_practice_settings_song_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), nullable=False)
    practice_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    volumes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    loop_start_measure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    loop_end_measure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    song: Mapped["Song"] = relationship(back_populates="practice_setting")


class UserSession(Base):
    """T1-3: HttpOnly 세션 쿠키(intent/03-architecture-stack.md §3). 쿠키엔 무작위 토큰만 담고
    DB엔 그 토큰의 SHA-256 해시만 저장한다(auth/security.py의 hash_session_token)."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped["User"] = relationship(back_populates="sessions")
