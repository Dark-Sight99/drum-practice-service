"""DB 엔진·세션 팩토리.

경로는 pathlib로 구성(윈도우·맥 모두 동작, intent/03-architecture-stack.md §3).
"""

import os
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

SERVER_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SERVER_ROOT.parent.parent
# intent/03-architecture-stack.md §5: 사용자 데이터는 루트 data/ (git 제외) 아래 저장
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "db" / "app.db"


def get_database_url(db_path: Path | None = None) -> str:
    path = db_path or Path(os.environ.get("DRUM_DB_PATH", str(DEFAULT_DB_PATH)))
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


def create_sqlite_engine(url: str, **kwargs) -> Engine:
    """SQLite는 기본적으로 FK 제약을 검사하지 않는다(Codex 모드A C-001 지적, 실제 확인됨).

    연결마다 PRAGMA foreign_keys=ON을 실행해 FK 위반이 실제로 막히도록 한다.
    출처: SQLAlchemy 공식 문서 "Foreign Key Support" (SQLite는 연결별로 PRAGMA를 켜야 함).
    """
    eng = create_engine(url, **kwargs)

    @event.listens_for(eng, "connect")
    def _enable_sqlite_fk(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return eng


engine = create_sqlite_engine(get_database_url(), connect_args={"check_same_thread": False})
# expire_on_commit=False: 기본값(True)이면 commit() 직후 객체의 속성이 "만료"되고, 세션이
# 닫힌 뒤 그 속성을 읽으면 DetachedInstanceError가 난다 — worker/runner.py의 run_once()가
# 세션을 닫고 반환한 Job의 .id를 읽다가 실제로 재현됨(수동 QA 중 발견). commit 후에도 이미
# 읽은 값은 그대로 메모리에 남겨두도록 끈다.
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_session() -> Session:
    return SessionLocal()
