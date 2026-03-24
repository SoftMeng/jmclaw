#!/bin/bash
# start_jmclaw.sh - Start NanoClaw with proper cleanup

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Starting NanoClaw ==="

# Use Node 22 (required for better-sqlite3 native module)
NODE_BIN="/opt/homebrew/opt/node@22/bin/node"
if [ ! -x "$NODE_BIN" ]; then
    echo "Error: Node 22 not found at $NODE_BIN"
    echo "Install with: brew install node@22"
    exit 1
fi
echo "Using Node: $NODE_BIN ($($NODE_BIN --version))"

# 1. Kill any existing nanoclaw processes
echo "Stopping existing processes..."
pkill -f "jmclaw.*proxy-preload.*dist/index.js" 2>/dev/null || true
pkill -f "jmclaw.*dist/index.js" 2>/dev/null || true

# 2. Kill stuck container stop commands
pkill -f "container stop" 2>/dev/null || true

# 3. Wait for cleanup
sleep 2

# 4. Force stop old container if exists (use -f to force remove)
OLD_CONTAINER=$(container ps -a --format "{{.Names}}" 2>/dev/null | grep "nanoclaw-discord" | head -1)
if [ -n "$OLD_CONTAINER" ]; then
    echo "Stopping old container: $OLD_CONTAINER"
    timeout 10 container rm -f "$OLD_CONTAINER" 2>/dev/null || true
    sleep 2
fi

# 5. Clear stale session locks if any
rm -f data/sessions/discord_main/.claude/session-env/lock 2>/dev/null || true

# 6. Build TypeScript
echo "Building TypeScript..."
"$NODE_BIN" "$SCRIPT_DIR/node_modules/.bin/tsc" || { echo "Build failed"; exit 1; }

# 7. Start NanoClaw
echo "Starting NanoClaw..."
export https_proxy=socks5://127.0.0.1:7890
export http_proxy=socks5://127.0.0.1:7890
export ASSISTANT_NAME=jmclaw

nohup "$NODE_BIN" --require ./proxy-preload.cjs dist/index.js > nanoclaw.log 2>&1 &
NODE_PID=$!

echo "NanoClaw started with PID: $NODE_PID"

# 7. Wait and verify
sleep 8

if lsof -i :3001 >/dev/null 2>&1; then
    echo "=== NanoClaw is running (API on :3001) ==="
    tail -10 nanoclaw.log
else
    echo "Warning: API not responding on :3001"
    echo "Log output:"
    tail -50 nanoclaw.log
fi

echo "Done!"
