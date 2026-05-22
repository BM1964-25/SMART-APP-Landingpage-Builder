#!/bin/zsh

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$APP_DIR/logs"
LOG_FILE="$LOG_DIR/landingpage-builder-server.log"
URL="http://127.0.0.1:8173/"

mkdir -p "$LOG_DIR"
cd "$APP_DIR" || exit 1

if /usr/bin/curl -fsS "$URL" >/dev/null 2>&1; then
  /usr/bin/open "$URL"
  exit 0
fi

if command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
elif [ -x "/opt/homebrew/bin/npm" ]; then
  NPM_BIN="/opt/homebrew/bin/npm"
elif [ -x "/usr/local/bin/npm" ]; then
  NPM_BIN="/usr/local/bin/npm"
else
  /usr/bin/osascript -e 'display dialog "npm wurde nicht gefunden. Bitte Node.js installieren oder im Projektordner npm start ausfuehren." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

/usr/bin/nohup /usr/bin/env PORT=8173 "$NPM_BIN" start >> "$LOG_FILE" 2>&1 &
echo $! > "$LOG_DIR/landingpage-builder-server.pid"

for _ in {1..24}; do
  if /usr/bin/curl -fsS "$URL" >/dev/null 2>&1; then
    /usr/bin/open "$URL"
    exit 0
  fi
  sleep 0.25
done

/usr/bin/open "$URL"
