import pytest
from sqlalchemy import create_engine, text
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


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
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
    song = Song(user_id=user.id, title="Ling Ling", source_type=SongSourceType.OMR)
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


def test_job_queue_per_user(session: Session) -> None:
    u1 = _make_user(session, "user1")
    u2 = _make_user(session, "user2")
    session.add(Job(user_id=u1.id, job_type=JobType.SEPARATE, status=JobStatus.QUEUED))
    session.add(Job(user_id=u2.id, job_type=JobType.TRANSCRIBE, status=JobStatus.QUEUED))
    session.commit()

    u1_jobs = session.query(Job).filter(Job.user_id == u1.id).all()
    assert len(u1_jobs) == 1
    assert u1_jobs[0].job_type == JobType.SEPARATE


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
