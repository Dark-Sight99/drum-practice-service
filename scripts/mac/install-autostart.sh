#!/bin/zsh
# 맥 로그인 시 서버 자동 시작 등록. 근거: T5-4, intent/03-architecture-stack.md §3
# "서버는 사용자 로그인 시 자동 시작".
#
# 방식: launchd(맥 표준 자동 실행 데몬) LaunchAgent로 등록 — 관리자 권한 없이 현재
# 사용자 로그인 세션에서만 적용된다. RunAtLoad=로그인 시 1회 실행, KeepAlive=false
# (우리 start.py가 서버·워커를 백그라운드로 띄우고 바로 끝나는 구조라, launchd가 그
# "시작시키는 역할" 자체를 계속 살려둘 필요는 없음 — 뜬 뒤의 서버·워커는 launchd와
# 무관하게 독립적으로 계속 돈다).
#
# `launchctl bootstrap`/`bootout`은 Apple이 현재 권장하는 방식(구 load/unload는
# 레거시, 출처: `man launchctl`의 "LEGACY SUBCOMMANDS" 설명 — macOS 10.11+ 기준).
#
# 실행: `./install-autostart.sh` (먼저 `chmod +x *.sh` 한 번 필요할 수 있음)
# 해제: `./uninstall-autostart.sh`

set -e
SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON="$PROJECT_ROOT/app/server/.venv/bin/python"
START_SCRIPT="$PROJECT_ROOT/scripts/start.py"
LABEL="com.drum-practice-service.server"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
LOG_DIR="$PROJECT_ROOT/data/logs"

if [ ! -x "$PYTHON" ]; then
  echo "가상환경을 찾을 수 없습니다: $PYTHON" >&2
  echo "app/server에서 'python3 -m venv .venv' 후 의존성을 설치해주세요." >&2
  exit 1
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$START_SCRIPT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/autostart.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/autostart.log</string>
</dict>
</plist>
PLIST

UID_NUM="$(id -u)"
# 이미 등록돼 있으면 한 번 내렸다가 다시 올린다(설정 바뀐 채로 재등록할 때도 안전).
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"

echo "등록 완료: $PLIST_PATH"
echo "다음 로그인부터 서버가 자동으로 시작됩니다. 지금 바로 시작하려면 start.sh를 실행하세요."
