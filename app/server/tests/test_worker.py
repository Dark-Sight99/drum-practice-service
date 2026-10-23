"""T1-4 작업 큐 워커 테스트. 근거: REQ-10, work/T1-4/plan.md."""

import pytest
from sqlalchemy.orm import sessionmaker

from db.models import Base, Job, JobStatus, JobType, Song, SongSourceType, User
from db.session import create_sqlite_engine
from worker.handlers import clear_handlers, register_handler
from worker.runner import process_next_job, recover_orphaned_jobs


@pytest.fixture
def db():
    engine = create_sqlite_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _reset_handlers():
    clear_handlers()
    yield
    clear_handlers()


def _make_user_and_song(db) -> tuple[User, Song]:
    user = User(username="jaewoo", password_hash="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db.add(song)
    db.commit()
    db.refresh(song)
    return user, song


def test_jobs_processed_in_fifo_order(db) -> None:
    user, song = _make_user_and_song(db)
    processed_order: list[int] = []
    register_handler(JobType.SEPARATE, lambda job: processed_order.append(job.id))

    job1 = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job1)
    db.commit()
    job2 = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job2)
    db.commit()

    first = process_next_job(db)
    second = process_next_job(db)

    assert first.id == job1.id
    assert second.id == job2.id
    assert processed_order == [job1.id, job2.id]
    assert first.status == JobStatus.COMPLETED
    assert second.status == JobStatus.COMPLETED


def test_empty_queue_returns_none(db) -> None:
    assert process_next_job(db) is None


def test_job_without_registered_handler_fails_cleanly(db) -> None:
    user, song = _make_user_and_song(db)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job)
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.FAILED
    assert "구현되지 않았습니다" in result.error_message
    assert result.completed_at is not None


def test_handler_exception_marks_job_failed_with_message(db) -> None:
    user, song = _make_user_and_song(db)

    def _boom(job: Job) -> None:
        raise ValueError("데모 중 터진 에러")

    register_handler(JobType.OMR, _boom)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.OMR)
    db.add(job)
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.FAILED
    assert "데모 중 터진 에러" in result.error_message


def test_recover_orphaned_jobs_marks_stuck_processing_as_failed(db) -> None:
    """서버/워커가 죽어서 PROCESSING 상태로 멈춘 작업을 재시작 시 FAILED로 표시 — REQ-10."""
    user, song = _make_user_and_song(db)
    stuck_job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    stuck_job.status = JobStatus.PROCESSING
    db.add(stuck_job)
    db.commit()

    recovered_count = recover_orphaned_jobs(db)

    db.refresh(stuck_job)
    assert recovered_count == 1
    assert stuck_job.status == JobStatus.FAILED
    assert "재시작" in stuck_job.error_message


def test_recover_orphaned_jobs_does_not_touch_queued_or_completed(db) -> None:
    user, song = _make_user_and_song(db)
    queued = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(queued)
    db.commit()

    recovered_count = recover_orphaned_jobs(db)

    db.refresh(queued)
    assert recovered_count == 0
    assert queued.status == JobStatus.QUEUED
