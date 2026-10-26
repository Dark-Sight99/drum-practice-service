import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from db.models import (
    Asset,
    AssetKind,
    Base,
    Job,
    JobStatus,
    JobType,
    PracticeSetting,
    Song,
    SongSourceType,
    SongStatus,
    User,
)
from db.session import create_sqlite_engine


@pytest.fixture
def session():
    # create_sqlite_engine를 써야 PRAGMA foreign_keys=ON이 걸려 FK 위반 테스트가 의미 있음
    # (그냥 create_engine을 쓰면 SQLite가 FK를 검사하지 않아 아래 FK 관련 테스트들이 통과해버림 —
    # Codex 모드A C-005 지적, 실제 재현 확인).
    engine = create_sqlite_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    yield db
    db.close()


def _make_user(db: Session, username: str = "jaewoo") -> User:
    user = User(username=username, password_hash="hashed", is_admin=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_create_user(session: Session) -> None:
    user = _make_user(session)
    assert user.id is not None
    assert user.is_active is True
    assert user.is_admin is True


def test_duplicate_username_rejected(session: Session) -> None:
    _make_user(session, "jaewoo")
    session.add(User(username="jaewoo", password_hash="x"))
    with pytest.raises(IntegrityError):
        session.commit()


def test_song_belongs_to_user(session: Session) -> None:
    user = _make_user(session)
    song = Song(user_id=user.id, title="Ling Ling", source_type=SongSourceType.MIDI)
    session.add(song)
    session.commit()
    session.refresh(song)

    assert song.status == SongStatus.PENDING
    assert song.needs_review is False
    assert song.user.username == "jaewoo"
    assert user.songs[0].title == "Ling Ling"


def test_asset_cascade_delete_with_song(session: Session) -> None:
    user = _make_user(session)
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    session.add(song)
    session.commit()
    session.refresh(song)

    session.add(
        Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path="data/songs/1/original.mp3")
    )
    session.commit()
    assert len(song.assets) == 1

    session.delete(song)
    session.commit()
    assert session.query(Asset).count() == 0


def test_enum_columns_store_lowercase_value_not_member_name(session: Session) -> None:
    """SQLAlchemy Enum 기본값은 .name('PENDING')을 저장함 — values_callable로 .value('pending')를
    저장하도록 한 db/models.py의 str_enum_column 설정이 실제로 적용되는지 확인."""
    user = _make_user(session)
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    session.add(song)
    session.commit()

    row = session.execute(text("SELECT status, source_type FROM songs")).fetchone()
    assert row == ("pending", "audio")


def _make_song(db: Session, user: User, title: str = "곡") -> Song:
    song = Song(user_id=user.id, title=title, source_type=SongSourceType.AUDIO)
    db.add(song)
    db.commit()
    db.refresh(song)
    return song


def test_job_queue_per_user(session: Session) -> None:
    u1 = _make_user(session, "user1")
    u2 = _make_user(session, "user2")
    s1 = _make_song(session, u1, "u1곡")
    s2 = _make_song(session, u2, "u2곡")
    session.add(
        Job(user_id=u1.id, song_id=s1.id, job_type=JobType.SEPARATE, status=JobStatus.QUEUED)
    )
    session.add(
        Job(user_id=u2.id, song_id=s2.id, job_type=JobType.TRANSCRIBE, status=JobStatus.QUEUED)
    )
    session.commit()

    u1_jobs = session.query(Job).filter(Job.user_id == u1.id).all()
    assert len(u1_jobs) == 1
    assert u1_jobs[0].job_type == JobType.SEPARATE


def test_job_cannot_reference_another_users_song(session: Session) -> None:
    """Codex 모드A C-002: user_id/song_id가 각각 독립 FK면 사용자 A의 작업이 사용자 B의 곡을
    참조할 수 있었음 — 복합 FK(song_id, user_id) -> (songs.id, songs.user_id)로 막았는지 확인."""
    u1 = _make_user(session, "user1")
    u2 = _make_user(session, "user2")
    s2 = _make_song(session, u2, "u2곡")

    # u1이 u2의 곡을 참조하는 작업을 만들려고 하면 복합 FK 위반으로 막혀야 한다.
    session.add(Job(user_id=u1.id, song_id=s2.id, job_type=JobType.SEPARATE))
    with pytest.raises(IntegrityError):
        session.commit()


def test_fk_violation_rejected_for_invalid_user(session: Session) -> None:
    """Codex 모드A C-001: SQLite는 기본적으로 FK를 검사하지 않음 —
    create_sqlite_engine의 PRAGMA foreign_keys=ON이 실제로 적용되는지 확인."""
    session.add(Song(user_id=999999, title="없는 사용자", source_type=SongSourceType.AUDIO))
    with pytest.raises(IntegrityError):
        session.commit()


def test_asset_file_path_rejects_path_traversal(session: Session) -> None:
    """Codex 모드A C-003: file_path에 '..'가 들어간 경로 조작 시도를 DB 레벨에서 거부하는지 확인."""
    user = _make_user(session)
    song = _make_song(session, user)
    session.add(
        Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path="../../etc/passwd")
    )
    with pytest.raises(IntegrityError):
        session.commit()


@pytest.mark.parametrize(
    "bad_path",
    [
        "/etc/passwd",
        "C:\\Windows\\System32\\config",
        "\\\\fileserver\\share\\secret.txt",
    ],
)
def test_asset_file_path_rejects_absolute_paths(session: Session, bad_path: str) -> None:
    """Codex 모드B C-007: '..' 없는 절대경로(유닉스/윈도우 드라이브/UNC)도 거부하는지 확인."""
    user = _make_user(session)
    song = _make_song(session, user)
    session.add(Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path=bad_path))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_asset_file_path_accepts_relative_path(session: Session) -> None:
    """정상적인 상대 경로는 막히지 않아야 한다(위 거부 테스트들의 대조군)."""
    user = _make_user(session)
    song = _make_song(session, user)
    session.add(
        Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path="data/songs/1/original.mp3")
    )
    session.commit()


def test_practice_setting_one_to_one(session: Session) -> None:
    user = _make_user(session)
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.MIDI)
    session.add(song)
    session.commit()
    session.refresh(song)

    session.add(
        PracticeSetting(
            song_id=song.id, practice_bpm=96.0, loop_start_measure=5, loop_end_measure=9
        )
    )
    session.commit()

    # 같은 song_id로 두 번째 PracticeSetting 생성 시 unique 제약 위반
    session.add(PracticeSetting(song_id=song.id, practice_bpm=100.0))
    with pytest.raises(IntegrityError):
        session.commit()
