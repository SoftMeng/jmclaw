#!/bin/bash
# NanoClaw startup with SOCKS proxy support

export https_proxy=socks5://127.0.0.1:7890
export http_proxy=socks5://127.0.0.1:7890

cd "$(dirname "$0")"

# Load nvm and use Node 22
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1

# Build first
npm run build

# Run with proxy preload using compiled JS
node --require ./proxy-preload.cjs dist/index.js
