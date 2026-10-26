"""T1-4 작업 큐 워커 테스트. 근거: REQ-10, work/T1-4/plan.md."""

import threading

import pytest
from sqlalchemy.orm import sessionmaker

import worker.runner as runner_module
from db.models import Base, Job, JobStatus, JobType, Song, SongSourceType, SongStatus, User
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


def test_job_without_registered_handler_also_rescues_song_stuck_processing(db) -> None:
    """모드A 지적(C-001) — "핸들러 없음" 분기도 _sync_song_status_with_job을 거쳐야
    한다. 핸들러가 없는 작업이라도 그 Song이 PROCESSING으로 남아있으면 FAILED로
    맞춰야 사용자 눈에 "영원히 처리중"으로 안 보인다."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.PROCESSING
    db.commit()
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job)
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.FAILED
    db.refresh(song)
    assert song.status == SongStatus.FAILED


def test_handler_exception_marks_job_failed_with_message(db) -> None:
    user, song = _make_user_and_song(db)

    def _boom(job: Job) -> None:
        raise ValueError("데모 중 터진 에러")

    register_handler(JobType.IMPORT, _boom)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.IMPORT)
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


def test_recover_orphaned_jobs_also_fails_the_songs_stuck_processing(db) -> None:
    """T3-1 모드C C-001 — 워커가 핸들러 실행 도중 죽어 Job만 PROCESSING으로
    남으면, 재시작 복구 시 그 Job의 Song도 PROCESSING이면 FAILED로 맞춰야 한다
    (안 그러면 사용자 눈엔 "영원히 처리중"으로 보임)."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.PROCESSING
    db.commit()
    stuck_job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    stuck_job.status = JobStatus.PROCESSING
    db.add(stuck_job)
    db.commit()

    recover_orphaned_jobs(db)

    db.refresh(song)
    assert song.status == SongStatus.FAILED


def test_recover_orphaned_jobs_does_not_touch_song_not_processing(db) -> None:
    """Song이 이미 COMPLETED/PENDING 등이면(이 Job과 무관한 경우) 건드리지 않는다."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.COMPLETED
    db.commit()
    stuck_job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    stuck_job.status = JobStatus.PROCESSING
    db.add(stuck_job)
    db.commit()

    recover_orphaned_jobs(db)

    db.refresh(song)
    assert song.status == SongStatus.COMPLETED


def test_sync_song_status_with_job_is_noop_when_handler_already_set_it(db) -> None:
    """정상 흐름(핸들러가 스스로 Song.status를 맞춘 경우)에선 안전망이 아무 것도
    안 바꿔야 한다."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.COMPLETED
    db.commit()

    def _handler_sets_song_completed(job: Job) -> None:
        pass  # Song은 이미 위에서 COMPLETED로 맞춰놨다고 가정(핸들러가 직접 한 것처럼)

    register_handler(JobType.SEPARATE, _handler_sets_song_completed)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    db.commit()

    process_next_job(db)

    db.refresh(song)
    assert song.status == SongStatus.COMPLETED  # 안전망이 안 건드림


def test_sync_song_status_with_job_rescues_song_stuck_processing_after_job_failed(db) -> None:
    """T3-1 모드C 3차 BLOCKING 지적 — 핸들러의 Song.FAILED 커밋 자체가 실패하는
    (여기선 핸들러가 아예 Song을 안 건드리는 것으로 시뮬레이션) 경우에도, Job이
    FAILED로 끝나면 안전망이 Song을 FAILED로 맞춰야 한다."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.PROCESSING
    db.commit()

    def _handler_fails_without_touching_song(job: Job) -> None:
        raise RuntimeError("핸들러가 Song 상태를 못 맞추고 터짐")

    register_handler(JobType.SEPARATE, _handler_fails_without_touching_song)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.FAILED
    db.refresh(song)
    assert song.status == SongStatus.FAILED


def test_sync_song_status_with_job_rescues_song_stuck_processing_after_job_completed(db) -> None:
    """Job은 COMPLETED로 끝났는데 핸들러가 Song을 못 맞춘 경우 — 성공을 낙관하지
    않고 FAILED로 맞춘다(실제 산출물이 있다는 보장이 없으므로)."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.PROCESSING
    db.commit()

    register_handler(JobType.SEPARATE, lambda job: None)  # Song을 안 건드리고 성공
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.COMPLETED
    db.refresh(song)
    assert song.status == SongStatus.FAILED


def test_sync_song_status_with_job_leaves_song_alone_when_another_job_is_pending(db) -> None:
    """T3-19(2026-10-26, Codex 모드A 지적 Medium 반영) — 분리 성공 후 채보 작업을
    자동으로 이어 큐에 넣는 체인에서는, 분리 Job이 COMPLETED로 끝난 시점에
    Song이 아직 PROCESSING(의도된 상태)이어도 안전망이 FAILED로 강제하면 안
    된다 — 같은 곡에 대기 중인(QUEUED) 다른 Job이 있으면 체인이 정상 진행
    중이라는 뜻이라 그대로 둬야 한다."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.PROCESSING
    db.commit()

    register_handler(JobType.SEPARATE, lambda job: None)  # Song을 PROCESSING에 그대로 둠
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    # 분리 Job과 별개로, 같은 곡에 대한 TRANSCRIBE Job이 이미 큐에 있다고 가정
    # (실제로는 separate_handler가 스스로 넣음 — 여기선 안전망만 단독으로 검증).
    db.add(Job(user_id=user.id, song_id=song.id, job_type=JobType.TRANSCRIBE))
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.COMPLETED
    db.refresh(song)
    assert song.status == SongStatus.PROCESSING  # 강제로 FAILED 되지 않음


def test_sync_song_status_with_job_still_fails_when_pending_job_is_unexpected_type(db) -> None:
    """T3-19 모드A 재검토 지적(Medium, 반영) — "이 곡에 대한 다른 작업이면
    아무거나" 봐주면, 이 곡과 무관하게 남은 엉뚱한 종류의 작업 때문에 진짜
    실패를 영영 FAILED로 못 바꾸는 경우가 생길 수 있었다. SEPARATE 다음엔
    정확히 TRANSCRIBE만 "정상적으로 대기 중"이라고 인정해야 한다 — 예를 들어
    같은 곡에 또 다른 SEPARATE Job이 QUEUED로 남아있어도(체인 상 안 와야 할
    종류) 안전망은 그걸 "체인 진행 중"으로 착각하면 안 되고 그대로 FAILED로
    강제해야 한다."""
    user, song = _make_user_and_song(db)
    song.status = SongStatus.PROCESSING
    db.commit()

    register_handler(JobType.SEPARATE, lambda job: None)  # Song을 PROCESSING에 그대로 둠(버그 흉내)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    # SEPARATE 다음엔 TRANSCRIBE만 정상 — 또 다른 SEPARATE가 대기 중인 건
    # 체인의 기대 종류가 아니므로 안전망이 봐줄 이유가 안 된다.
    db.add(Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE))
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.COMPLETED
    db.refresh(song)
    assert song.status == SongStatus.FAILED  # 엉뚱한 종류라 그대로 FAILED


def test_sync_song_status_with_job_rescues_song_stuck_pending(db) -> None:
    """T3-2 모드A 지적(C-003) — 핸들러의 맨 처음 "Song.PROCESSING" 커밋 자체가
    실패하면 Song은 PENDING에 머문 채 Job만 끝날 수 있다. 안전망이
    PROCESSING뿐 아니라 PENDING도 커버해야 한다."""
    user, song = _make_user_and_song(db)
    assert song.status == SongStatus.PENDING  # 핸들러가 PROCESSING 커밋을 아예 못 한 상황을 흉내

    register_handler(JobType.SEPARATE, lambda job: None)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    db.commit()

    result = process_next_job(db)

    assert result.status == JobStatus.COMPLETED
    db.refresh(song)
    assert song.status == SongStatus.FAILED  # COMPLETED로 낙관하지 않음(C-003 반영)


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


def test_register_production_handlers_registers_separate_and_transcribe() -> None:
    """T3-1/T3-2 모드C C-001류 지적에 대한 회귀 테스트 — 프로덕션 등록 함수가
    실제로 두 작업 유형 모두에 핸들러를 연결하는지 직접 확인. 이게 빠지면
    `worker/handlers.get_handler()`가 None을 반환해 큐가 "핸들러 없음"으로
    영원히 실패 처리한다(조용한 버그가 아니라 바로 드러나긴 하지만, 그래도
    배포 전에 테스트로 잡는 게 맞음)."""
    from worker.handlers import get_handler
    from worker.runner import register_production_handlers

    register_production_handlers()
    try:
        assert get_handler(JobType.SEPARATE) is not None
        assert get_handler(JobType.TRANSCRIBE) is not None
    finally:
        clear_handlers()
