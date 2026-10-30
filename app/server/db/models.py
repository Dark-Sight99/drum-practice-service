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
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
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
    """DrumScore meta.source와 맞춤 (intent/03-architecture-stack.md §2).

    2026-10-26 — 종이 악보(OMR) 경로 드롭(의뢰인 결정, intent/01-vision.md
    "2026-10-26 갱신" 참고)으로 OMR 멤버 제거."""

    AUDIO = "audio"
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
    # T6-3(REQ-06, Q-33) — bass/vocals/other는 UI에서 이미 "음악" 슬라이더
    # 하나로 묶여 있어(T3-8) 개별 조작 기능이 없는데, 셋 다 실제 <audio>
    # 엘리먼트로 동시 디코딩되는 게 모바일 CPU를 다 써 fps를 떨어뜨리는 게
    # 실기기로 확정됨(Q-33 "2차 결과·원인 확정"). 서버에서 미리 1개 파일로
    # 섞어 동시 스트림을 4개→2개로 줄인다 — STEM_BASS/VOCALS/OTHER는 기존
    # 곡(DB에 이미 그 kind로 저장된 Asset)과의 하위 호환을 위해 값만 남겨두고
    # 새로 만들지는 않는다(work/T6-3/plan.md).
    STEM_BASS = "stem_bass"
    STEM_VOCALS = "stem_vocals"
    STEM_OTHER = "stem_other"
    STEM_MUSIC = "stem_music"
    DRUMSCORE_RAW = "drumscore_raw"
    DRUMSCORE_EDITED = "drumscore_edited"
    SHEET_IMAGE = "sheet_image"
    MIDI_EXPORT = "midi_export"


# T3-3(REQ-04) — 실제 오디오로 재생 가능한 종류만(work/T3-3/plan.md §1). 새 공개
# API(`GET /songs/{id}/audio/{kind}`)가 받을 수 있는 kind를 이 집합으로 제한한다.
# T6-3 — STEM_MUSIC 추가, STEM_BASS/VOCALS/OTHER는 기존 곡 재생 하위 호환을
# 위해 그대로 둠(work/T6-3/plan.md §5, 프런트가 STEM_MUSIC 존재 시 이 셋을
# 걸러냄).
AUDIO_ASSET_KINDS = (
    AssetKind.ORIGINAL,
    AssetKind.STEM_DRUMS,
    AssetKind.STEM_BASS,
    AssetKind.STEM_VOCALS,
    AssetKind.STEM_OTHER,
    AssetKind.STEM_MUSIC,
)


class JobType(enum.StrEnum):
    # 2026-10-26 — 종이 악보(OMR) 경로 드롭으로 OMR 멤버 제거(SongSourceType과 동일
    # 사유, 위 참고).
    SEPARATE = "separate"
    TRANSCRIBE = "transcribe"
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
    # 2026-10-27(실사용 중 재현된 버그) — cascade가 없으면 곡 삭제 시 SQLAlchemy가
    # 연결된 Job 행을 지우는 대신 FK 컬럼(song_id/user_id)을 NULL로 비우려
    # 시도하는데, 둘 다 nullable=False라 "NOT NULL constraint failed: jobs.user_id"
    # IntegrityError로 즉시 실패해 삭제 자체가 먹히지 않았다(실제 재현: 분리
    # 작업(Job)이 하나라도 있는 곡은 전부 삭제가 안 됨 — 업로드된 곡은 거의
    # 전부 해당). assets/practice_setting과 같은 원칙으로 cascade 추가 — 곡이
    # 지워지면 그 처리 기록(Job)도 같이 지워지는 게 맞다(남겨둘 이유 없음).
    jobs: Mapped[list["Job"]] = relationship(
        back_populates="song", cascade="all, delete-orphan", overlaps="jobs"
    )
    practice_setting: Mapped["PracticeSetting | None"] = relationship(
        back_populates="song", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def available_audio_kinds(self) -> list[str]:
        """T3-3(REQ-04) — 프런트가 어떤 오디오 트랙을 `GET /songs/{id}/audio/{kind}`로
        가져올 수 있는지 매 kind를 시도해보지 않고 바로 알 수 있게(work/T3-3/plan.md
        §2). SQLAlchemy 매핑 컬럼이 아닌 일반 Python 속성이라도 Pydantic이
        `from_attributes=True`일 때 getattr로 읽으므로(`SongOut` 직렬화 시 자동
        포함) 다른 엔드포인트의 반환 코드를 손댈 필요가 없다."""
        return sorted({a.kind.value for a in self.assets if a.kind in AUDIO_ASSET_KINDS})


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
        # T2-6 Codex 모드C C-001: 곡 하나당 "편집본"은 하나만 있어야 하는데
        # 애플리케이션 코드의 "찾아서 없으면 생성"만으론 동시 요청 경쟁 상태를
        # 못 막는다 — DRUMSCORE_EDITED 종류에만 적용되는 부분 유니크 인덱스로
        # DB가 직접 막는다. SHEET_IMAGE 등 한 곡에 여러 개가 정당한 종류와는
        # 겹치지 않게 kind 조건을 둬서 전역 제약이 아니라 이 종류에만 한정한다
        # (실제 SQLite에서 두 번째 삽입이 IntegrityError로 거부되고 다른 kind는
        # 영향 안 받는 것을 직접 실행으로 확인함, work/T2-6/plan.md §설계 1).
        Index(
            "uq_assets_song_id_drumscore_edited",
            "song_id",
            unique=True,
            sqlite_where=text("kind = 'drumscore_edited'"),
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


class UserMixerSetting(Base):
    """2026-10-27(의뢰인 요청) — 믹서(볼륨/음소거) 설정을 곡별이 아니라 계정
    전체로 공유한다. "1번 곡에서 맞춘 믹서값이 2번·3번 곡에서도 그대로
    유지되길" 원함 — 위 PracticeSetting(song_id 유니크)과는 별개로 user_id
    유니크인 테이블을 새로 둔다. 기존에 이미 곡별로 저장된 값들을 계정
    하나로 합치려면 "어느 곡 값을 기준으로 할지"가 모호해지므로, 기존
    테이블·엔드포인트는 그대로 두고(이미 저장된 데이터를 지우거나 재해석
    하지 않음) 새 테이블로 전환한다(work/T3-28/plan.md §범위경계). 근거:
    REQ-05."""

    __tablename__ = "user_mixer_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_user_mixer_settings_user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    volumes_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


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
