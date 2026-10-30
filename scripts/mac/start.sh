#!/bin/zsh
# 서버 수동 시작(맥). 근거: T5-4, intent/03-architecture-stack.md §3 "수동 시작 스크립트".
# 실제 로직은 scripts/start.py(파이썬, OS 공용)에 있음 — 이 .sh는 "venv 파이썬으로 그걸
# 실행"만 담당. 실행: `./start.sh` (먼저 `chmod +x start.sh` 한 번 필요할 수 있음)
set -e
SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON="$PROJECT_ROOT/app/server/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "가상환경을 찾을 수 없습니다: $PYTHON" >&2
  echo "app/server에서 'python3 -m venv .venv' 후 의존성을 설치해주세요." >&2
  exit 1
fi

"$PYTHON" "$PROJECT_ROOT/scripts/start.py" "$@"
