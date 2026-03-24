#!/bin/bash
# stop_jmclaw.sh - Fully stop NanoClaw

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Stopping NanoClaw ==="

# 1. Stop launchd service
echo "Stopping launchd service..."
launchctl unload ~/Library/LaunchAgents/com.jmclaw.plist 2>/dev/null || true

# 2. Kill by port 3001
echo "Stopping process on port 3001..."
lsof -ti :3001 | xargs kill -15 2>/dev/null || true
sleep 1

# 3. Force kill any running processes
echo "Stopping running processes..."
pkill -f "node.*dist/index.js" 2>/dev/null || true
pkill -f "proxy-preload" 2>/dev/null || true

# 4. Wait and try kill -9 if still running
sleep 2
lsof -ti :3001 | xargs kill -9 2>/dev/null || true

# 5. Force kill any stuck container commands for jmclaw
pkill -f "container stop.*jmclaw" 2>/dev/null || true

# 6. Force remove any stuck containers
echo "Cleaning up containers..."
container ps -a --format "{{.Names}}" 2>/dev/null | grep "jmclaw" | while read name; do
    echo "  Removing container: $name"
    container rm -f "$name" 2>/dev/null || true
done

# 7. Wait for cleanup
sleep 2

# 8. Final check and force kill
if lsof -i :3001 >/dev/null 2>&1; then
    echo "Warning: Port 3001 still in use, forcing kill..."
    lsof -ti :3001 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# 9. Verify
if lsof -i :3001 >/dev/null 2>&1; then
    echo "Warning: Port 3001 still in use"
    lsof -i :3001
else
    echo "=== NanoClaw fully stopped ==="
fi
