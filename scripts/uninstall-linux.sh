#!/usr/bin/env bash
# 9Router-Sync Linux Uninstaller
set -euo pipefail

USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="9router-sync.service"
LOCK_FILE="$HOME/.9router-sync/watcher.lock"
PLUGIN="$HOME/.config/opencode/plugins/9router-sync.js"

say() { printf '\n\033[36m%s\033[0m\n' "$1"; }

say "[1/4] Stopping and disabling service..."
systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true

say "[2/4] Removing systemd unit..."
rm -f "$USER_UNIT_DIR/$UNIT_NAME"
systemctl --user daemon-reload 2>/dev/null || true

say "[3/4] Removing OpenCode plugin..."
rm -f "$PLUGIN"

say "[4/4] Clearing lock file..."
rm -f "$LOCK_FILE"

printf '\n\033[32mUninstall complete.\033[0m\n'
