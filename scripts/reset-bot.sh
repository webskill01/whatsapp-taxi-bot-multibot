#!/usr/bin/env bash
# ============================================================================
# reset-bot.sh — full re-pair reset for one bot, in one go.
# ============================================================================
# Stops the bot, wipes its WhatsApp auth + fingerprint cache, restarts it, then
# tails its pm2 logs (so you can scan the new QR / watch it reconnect).
#
# Usage:
#   ./scripts/reset-bot.sh bot-sachin
#   bash scripts/reset-bot.sh bot-delhi
#
# WARNING: removing baileys_auth logs the bot out of WhatsApp — you WILL need to
# re-scan the QR code at the bot's QR endpoint after this runs.
# ============================================================================
set -uo pipefail

BOT="${1:-}"
if [ -z "$BOT" ]; then
  echo "Usage: $0 <bot-name>    e.g. $0 bot-sachin"
  exit 1
fi

# Resolve project root from this script's location (independent of caller's cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOT_DIR="$ROOT/bots/$BOT"

if [ ! -d "$BOT_DIR" ]; then
  echo "ERROR: bot directory not found: $BOT_DIR"
  echo "Available bots:"
  ls -1 "$ROOT/bots" 2>/dev/null | sed 's/^/  /'
  exit 1
fi

echo "==> [1/4] Stopping $BOT"
pm2 stop "$BOT" || echo "    (pm2 stop reported an issue — continuing)"

echo "==> [2/4] Clearing auth + fingerprints in $BOT_DIR"
rm -rf "$BOT_DIR/baileys_auth"
# Per-bot fingerprint files are named fingerprints_<botId>_<phone>.json — glob covers
# every phone/noPhone variant. Also clear legacy .forwarded-messages.json if present.
rm -f "$BOT_DIR"/fingerprints_*.json
rm -f "$BOT_DIR/.forwarded-messages.json"
echo "    cleared baileys_auth, fingerprints_*.json, .forwarded-messages.json"

echo "==> [3/4] Starting $BOT"
pm2 start "$BOT"

echo "==> [4/4] Tailing logs for $BOT  (Ctrl-C to exit — the bot keeps running)"
exec pm2 logs "$BOT"
