#!/bin/zsh

unsetopt BG_NICE 2>/dev/null

APP_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
LOG_DIR="$APP_DIR/logs"
LOG_FILE="$LOG_DIR/landingpage-builder-server.log"
URL="http://127.0.0.1:8173/"
PLIST="$HOME/Library/LaunchAgents/de.builtsmart.smart-app-landingpage-builder.plist"
LABEL="de.builtsmart.smart-app-landingpage-builder"
LAUNCH_DIR="/tmp/smart-app-landingpage-builder"

mkdir -p "$LOG_DIR"
cd "$APP_DIR" || exit 1
ln -sfn "$APP_DIR" "$LAUNCH_DIR"

xml_escape() {
  printf "%s" "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

if /usr/bin/curl -fsS "$URL" >/dev/null 2>&1; then
  /usr/bin/open "$URL"
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE_BIN="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_BIN="/usr/local/bin/node"
else
  /usr/bin/osascript -e 'display dialog "Node.js wurde nicht gefunden. Bitte Node.js installieren oder im Projektordner npm start ausfuehren." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

APP_DIR_XML="$(xml_escape "$LAUNCH_DIR")"
NODE_BIN_XML="$(xml_escape "$NODE_BIN")"
LOG_FILE_XML="/tmp/smart-app-landingpage-builder.log"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN_XML</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR_XML</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key>
    <string>8173</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$LOG_FILE_XML</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE_XML</string>
</dict>
</plist>
PLIST

/bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
/bin/launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1
/bin/launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1

for _ in {1..24}; do
  if /usr/bin/curl -fsS "$URL" >/dev/null 2>&1; then
    /usr/bin/open "$URL"
    exit 0
  fi
  sleep 0.25
done

/usr/bin/open "$URL"
