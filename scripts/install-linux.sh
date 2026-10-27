#!/usr/bin/env bash
# 9Router-Sync Linux Installer
# Installs deps, optional OpenCode plugin, and a systemd --user service.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="9router-sync.service"
LOCK_FILE="$HOME/.9router-sync/watcher.lock"

say() { printf '\n\033[36m%s\033[0m\n' "$1"; }

if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH. Install Node.js >= 18 first." >&2
  exit 1
fi

say "[1/4] Installing npm dependencies..."
( cd "$REPO_DIR" && npm install --omit=dev )

say "[2/4] Setting up OpenCode plugin (if OpenCode detected)..."
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
if [ -d "$OPENCODE_DIR" ]; then
  mkdir -p "$OPENCODE_DIR/plugins"
  cp "$REPO_DIR/plugins/opencode-plugin.js" "$OPENCODE_DIR/plugins/9router-sync.js"
  echo "      Installed plugin to: $OPENCODE_DIR/plugins/9router-sync.js"
else
  echo "      OpenCode not detected. Skipping plugin setup."
fi

say "[3/4] Installing systemd --user service..."
mkdir -p "$USER_UNIT_DIR"
sed -e "s|__NODE__|$NODE_BIN|g" -e "s|__REPO__|$REPO_DIR|g" \
  "$REPO_DIR/scripts/$UNIT_NAME" > "$USER_UNIT_DIR/$UNIT_NAME"

say "[4/4] Enabling and starting service..."
systemctl --user daemon-reload
# Clear a stale lock so the service can acquire it cleanly.
if [ -f "$LOCK_FILE" ]; then
  OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$LOCK_FILE"
fi
systemctl --user enable --now "$UNIT_NAME"

printf '\n\033[32mSetup complete. 9router-sync is running as a systemd --user service.\033[0m\n'
echo "Status:  systemctl --user status $UNIT_NAME"
echo "Logs:    journalctl --user -u $UNIT_NAME -f"
echo "Note:    run 'loginctl enable-linger $USER' to keep it running after logout."
