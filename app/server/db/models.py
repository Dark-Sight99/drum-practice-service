"""SQLAlchemy 2.0 ORM 모델. 근거: intent/05-todo.md T1-2, REQ-07/08/10."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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


class Song(Base):
    __tablename__ = "songs"

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
    jobs: Mapped[list["Job"]] = relationship(back_populates="song")
    practice_setting: Mapped["PracticeSetting | None"] = relationship(
        back_populates="song", uselist=False, cascade="all, delete-orphan"
    )


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), nullable=False, index=True)
    kind: Mapped[AssetKind] = mapped_column(str_enum_column(AssetKind), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    song: Mapped["Song"] = relationship(back_populates="assets")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    song_id: Mapped[int | None] = mapped_column(ForeignKey("songs.id"), nullable=True, index=True)
    job_type: Mapped[JobType] = mapped_column(str_enum_column(JobType), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        str_enum_column(JobStatus), default=JobStatus.QUEUED, nullable=False, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="jobs")
    song: Mapped["Song | None"] = relationship(back_populates="jobs")


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
