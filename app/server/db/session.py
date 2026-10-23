"""DB 엔진·세션 팩토리.

경로는 pathlib로 구성(윈도우·맥 모두 동작, intent/03-architecture-stack.md §3).
"""

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

SERVER_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SERVER_ROOT.parent.parent
# intent/03-architecture-stack.md §5: 사용자 데이터는 루트 data/ (git 제외) 아래 저장
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "db" / "app.db"


def get_database_url(db_path: Path | None = None) -> str:
    path = db_path or Path(os.environ.get("DRUM_DB_PATH", str(DEFAULT_DB_PATH)))
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


engine = create_engine(get_database_url(), connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_session() -> Session:
    return SessionLocal()
