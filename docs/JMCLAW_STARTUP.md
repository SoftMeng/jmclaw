# jmclaw 启动指南

## 1. 启动命令

```bash
cd /Users/xiangyuanmeng/Documents/jmclaw

# 使用 Node v22（重要！避免 ERR_DLOPEN_FAILED）
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

# 启动（需要 SOCKS5 代理补丁）
node --require ./proxy-preload.cjs dist/index.js
```

## 2. 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        主机 (macOS)                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  NanoClaw 主进程 (Node v22)                               │   │
│  │                                                          │   │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐  │   │
│  │  │  proxy-preload  │    │  credential-proxy (3001)   │  │   │
│  │  │  补丁 WebSocket  │    │  注入 API Key/OAuth Token  │  │   │
│  │  │  和 Undici HTTP  │    │  供容器使用                 │  │   │
│  │  └────────┬────────┘    └─────────────┬─────────────┘  │   │
│  │           │                             │                 │   │
│  │           ▼                             ▼                 │   │
│  │  ┌─────────────────────────────────────────────────┐     │   │
│  │  │            Discord.js WebSocket                   │     │   │
│  │  │            (走 SOCKS5 代理 127.0.0.1:7890)       │     │   │
│  │  └─────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Apple Container Runtime                                 │   │
│  │  容器网络: bridge100 (192.168.64.x)                      │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  nanoclaw-agent:latest                             │  │   │
│  │  │  ┌─────────────────────────────────────────────┐    │  │   │
│  │  │  │  Claude Code Agent SDK                      │    │  │   │
│  │  │  │  (通过 credential-proxy 访问 API)           │    │  │   │
│  │  │  └─────────────────────────────────────────────┘    │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 关键依赖

| 依赖 | 用途 | 配置位置 |
|------|------|----------|
| **Node v22** | 运行环境，避免 native 模块错误 | `/opt/homebrew/opt/node@22/bin/node` |
| **SOCKS5 Proxy** | Discord WebSocket 代理 (中国网络环境) | `127.0.0.1:7890` (ClashX Pro) |
| **proxy-preload.cjs** | 补丁 WebSocket + Undici 支持 SOCKS5 | 启动时 `--require` |
| **Apple Container** | 容器运行时 | `container` 命令 |
| **nanoclaw-agent:latest** | Agent 容器镜像 | `container/build.sh` 构建 |

## 4. proxy-preload.cjs 补丁内容

```
┌─────────────────────────────────────────────────────────────┐
│ proxy-preload.cjs                                           │
├─────────────────────────────────────────────────────────────┤
│ 1. WebSocket 补丁 ───▶ 使用 SOCKS5 Agent                  │
│ 2. Undici fetch 补丁 ──▶ 使用 HTTP Proxy Agent            │
│ 3. Module._load 拦截 ──▶ 动态补丁 undici                   │
└─────────────────────────────────────────────────────────────┘
```

**为什么要补丁？**
- Discord.js 使用 `globalThis.WebSocket`，需要走 SOCKS5 代理
- Undici (Node.js 内置 HTTP 客户端) 需要 HTTP 代理
- 补丁在模块加载前注入，确保所有网络请求都走代理

## 5. Credential Proxy (端口 3001)

```
容器内 Agent
    │
    │ 发送请求到 http://192.168.64.1:3001
    ▼
┌─────────────────────────────────────────┐
│  credential-proxy                        │
│  - 注入 ANTHROPIC_API_KEY / OAuth Token │
│  - 转发请求到 upstream ANTHROPIC_BASE_URL│
└─────────────────────────────────────────┘
    │
    ▼
  Claude API (api.anthropic.com)
```

**作用：**
- 容器内 Agent 永远不直接接触 API Key
- 凭证通过 proxy 注入，隔离安全

## 6. 容器镜像构建 (`container/build.sh`)

```bash
# 基础镜像
FROM node:22-slim

# 系统依赖 (Chromium 浏览器自动化)
RUN apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git

# 全局安装
RUN npm install -g agent-browser @anthropic-ai/claude-code

# 项目依赖
COPY agent-runner/package*.json ./
RUN npm install
RUN npm run build

# 入口脚本 (shadow .env, 权限降级)
ENTRYPOINT ["/app/entrypoint.sh"]
```

## 7. 常用命令

```bash
# 编译 TypeScript
npm run build

# 构建容器镜像
./container/build.sh

# 清理容器缓存后重新构建
container builder prune && ./container/build.sh

# 查看日志
tail -f nanoclaw.log

# 后台运行
nohup node --require ./proxy-preload.cjs dist/index.js > nanoclaw.log 2>&1 &
```

## 8. 故障排查

### ERR_DLOPEN_FAILED
- **原因**：better-sqlite3 native 模块与 Node v25 不兼容
- **解决**：使用 Node v22
  ```bash
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  ```

### Discord 连接失败
- **原因**：中国网络环境无法直连 Discord Gateway
- **解决**：确保 SOCKS5 代理 (127.0.0.1:7890) 正常运行

### Container 启动失败
- **原因**：Apple Container 未运行
- **解决**：
  ```bash
  container system start
  ```
