"""alembic upgrade head가 실제로 동작하고 models.py와 일치하는지 확인.

마이그레이션 파일과 모델 정의가 어긋나는(드리프트) 걸 방지하기 위한 테스트.
"""

import subprocess
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent.parent


def test_alembic_upgrade_head(tmp_path: Path) -> None:
    db_path = tmp_path / "migration_test.db"
    env = {
        **__import__("os").environ,
        "DRUM_DB_PATH": str(db_path),
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=SERVER_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert db_path.exists()

    import sqlite3

    conn = sqlite3.connect(db_path)
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    for expected in {"users", "songs", "assets", "jobs", "practice_settings", "alembic_version"}:
        assert expected in tables
