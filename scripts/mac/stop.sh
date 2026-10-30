#!/bin/zsh
# 서버 수동 중지(맥). 근거: T5-4. 실제 로직은 scripts/stop.py(파이썬, OS 공용).
set -e
SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON="$PROJECT_ROOT/app/server/.venv/bin/python"
"$PYTHON" "$PROJECT_ROOT/scripts/stop.py"
