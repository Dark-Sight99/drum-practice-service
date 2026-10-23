"""T1-4 작업 큐 워커 테스트. 근거: REQ-10, work/T1-4/plan.md."""

import threading

import pytest
from sqlalchemy.orm import sessionmaker

import worker.runner as runner_module
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


def test_concurrent_workers_cannot_claim_the_same_job(tmp_path, monkeypatch) -> None:
    """Codex 모드A C-001 회귀 테스트: 워커 두 개가 동시에 돌아도 같은 작업을
    둘 다 처리하면 안 된다(파일 기반 DB + 별도 커넥션으로 실제 멀티프로세스 상황을 흉내냄).

    Codex 모드B 지적: 실제 스레드 타이밍에만 맡기면 SELECT와 UPDATE 사이의 경쟁 구간이
    너무 좁아 두 워커가 실제로 같은 후보를 동시에 집으려는 상황이 매번 재현되지 않고
    테스트가 비결정적으로 통과할 수 있음(재현: 수정 전 코드로 30회 반복 시 약 70%만
    실패, 나머지는 우연히 순차 처리돼 버그가 있어도 통과). `_race_window_hook`을
    monkeypatch해서 두 워커가 SELECT 직후·UPDATE 직전에 반드시 동시에 멈추도록 강제해
    경쟁을 매번 결정적으로 만든다.
    """
    db_path = tmp_path / "race.db"
    engine = create_sqlite_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    setup_db = SessionLocal()
    user, song = _make_user_and_song(setup_db)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    setup_db.add(job)
    setup_db.commit()
    job_id = job.id
    setup_db.close()

    register_handler(JobType.SEPARATE, lambda j: None)

    race_barrier = threading.Barrier(2)
    monkeypatch.setattr(runner_module, "_race_window_hook", lambda: race_barrier.wait(timeout=5))

    claimed: list[int] = []
    errors: list[BaseException] = []
    result_lock = threading.Lock()
    start_barrier = threading.Barrier(2)

    def worker_sim() -> None:
        try:
            worker_engine = create_sqlite_engine(f"sqlite:///{db_path}")
            worker_db = sessionmaker(bind=worker_engine)()
            start_barrier.wait()
            result = process_next_job(worker_db)
            if result is not None:
                with result_lock:
                    claimed.append(result.id)
            worker_db.close()
            worker_engine.dispose()
        except BaseException as exc:  # noqa: BLE001 — 아래에서 명시적으로 검증·실패 처리
            with result_lock:
                errors.append(exc)

    threads = [threading.Thread(target=worker_sim) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Codex 모드B C-003: 워커 스레드에서 예외(예: SQLite 잠금 오류)가 나면 그 스레드는
    # claimed에 아무것도 안 남기고 조용히 끝나버려서, claimed == [job_id]만 보면 "정상
    # 동작"과 "한쪽이 깨짐"을 구분 못할 수 있음 — 예외를 모아 명시적으로 검증한다.
    assert errors == []
    assert claimed == [job_id]  # 둘 중 정확히 하나만 작업을 가져가야 함
