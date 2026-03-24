#!/bin/bash
# start_glmclaw.sh - Start NanoClaw (glmclaw instance) with proper cleanup

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Starting NanoClaw (glmclaw) ==="

# Use Node 22
NODE_BIN="/opt/homebrew/opt/node@22/bin/node"
if [ ! -x "$NODE_BIN" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    NODE_BIN=$(nvm which 22)
fi
echo "Using Node: $NODE_BIN ($($NODE_BIN --version))"

# 1. Kill only glmclaw processes (not jmclaw)
echo "Stopping existing glmclaw processes..."
pkill -f "glmclaw.*proxy-preload.*dist/index.js" 2>/dev/null || true
pkill -f "glmclaw.*dist/index.js" 2>/dev/null || true

# 2. Kill stuck container stop commands for glmclaw
pkill -f "glmclaw.*container stop" 2>/dev/null || true

# 3. Wait for cleanup
sleep 2

# 4. Force stop old container if exists
OLD_CONTAINER=$(container ps -a --format "{{.Names}}" 2>/dev/null | grep "glmclaw" | head -1)
if [ -n "$OLD_CONTAINER" ]; then
    echo "Stopping old container: $OLD_CONTAINER"
    timeout 10 container rm -f "$OLD_CONTAINER" 2>/dev/null || true
    sleep 2
fi

# 5. Clear stale session locks if any
rm -f data/sessions/*/.claude/session-env/lock 2>/dev/null || true

# 6. Start NanoClaw
echo "Starting NanoClaw..."
export https_proxy=socks5://127.0.0.1:7890
export http_proxy=socks5://127.0.0.1:7890
export ASSISTANT_NAME=glmclaw
export CREDENTIAL_PROXY_PORT=3003

nohup "$NODE_BIN" --require ./proxy-preload.cjs dist/index.js > glmclaw.log 2>&1 &
NODE_PID=$!

echo "NanoClaw started with PID: $NODE_PID"

# 7. Wait and verify
sleep 8

if ps -p $NODE_PID > /dev/null 2>&1; then
    echo "=== NanoClaw (glmclaw) is running with PID: $NODE_PID ==="
    tail -10 glmclaw.log
else
    echo "Error: Process failed to start"
    echo "Log output:"
    tail -50 glmclaw.log
fi

echo "Done!"
