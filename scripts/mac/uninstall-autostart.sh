#!/bin/zsh
# install-autostart.sh로 등록한 로그인 자동 시작을 해제한다. 근거: T5-4.
set -e
LABEL="com.drum-practice-service.server"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ -f "$PLIST_PATH" ]; then
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "해제 완료: $PLIST_PATH 삭제됨."
else
  echo "등록된 자동 시작이 없습니다(할 일 없음)."
fi
echo "이미 떠 있는 서버는 그대로입니다 — 지금 끄려면 stop.sh를 실행하세요."
