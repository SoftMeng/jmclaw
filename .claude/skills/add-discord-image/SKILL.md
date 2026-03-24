# Add Discord Image Generation

This skill adds ComfyUI image generation capability to Discord channel in NanoClaw.

## Prerequisites

- Discord channel already set up (`/add-discord` completed)
- ComfyUI server available (internal or external)

## Phase 1: Pre-flight

### Check if already applied

Check if `scripts/generate_comfyui.mjs` exists:

```bash
test -f scripts/generate_comfyui.mjs && echo "ALREADY_INSTALLED" || echo "NEEDS_INSTALL"
```

If ALREADY_INSTALLED, skip to Phase 2.

## Phase 2: Install Files

### Copy ComfyUI script

```bash
# Create scripts directory if not exists
mkdir -p scripts

# Copy the TypeScript/Node.js version (uses native fetch, no extra dependencies)
cat > scripts/generate_comfyui.mjs << 'EOF'
#!/usr/bin/env node
/**
 * ComfyUI 图片生成脚本 - NanoClaw Discord 版本
 * 使用 TypeScript/Node.js 实现
 *
 * 服务器配置:
 * - COMFYUI_MODE=host_vm (默认) -> 192.168.64.1:7860 (容器宿主机网关)
 * - COMFYUI_MODE=internal -> 192.168.31.8:7860 (内网)
 * - COMFYUI_MODE=external -> 123.56.194.98:7860 (外网)
 */

import * as fs from 'fs';
import * as path from 'path';

const COMFYUI_HOST_VM = '192.168.64.1:7860';
const COMFYUI_INTERNAL = '192.168.31.8:7860';
const COMFYUI_EXTERNAL = '123.56.194.98:7860';

function log(msg) { console.error(`[ComfyUI] ${msg}`); }

function getComfyUIserver() {
  if (process.env.COMFYUI_SERVER) return process.env.COMFYUI_SERVER;
  const mode = process.env.COMFYUI_MODE || 'host_vm';
  if (mode === 'external') { log(`使用外网服务器: ${COMFYUI_EXTERNAL}`); return COMFYUI_EXTERNAL; }
  else if (mode === 'internal') { log(`使用内网服务器: ${COMFYUI_INTERNAL}`); return COMFYUI_INTERNAL; }
  else { log(`使用宿主机网关: ${COMFYUI_HOST_VM}`); return COMFYUI_HOST_VM; }
}

function loadWorkflowTemplate() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return JSON.parse(fs.readFileSync(path.join(scriptDir, 'template.json'), 'utf-8'));
}

function buildWorkflow(template, prompt, width = 512, height = 1024, seed) {
  if (!seed) seed = Math.floor(Date.now() * Math.random()) % 1000000000;
  const replacements = {
    '${提示词}': prompt.replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' '),
    '${宽}': String(width), '${高}': String(height), '${种子}': String(seed),
  };
  function replace(obj) {
    if (typeof obj === 'string') {
      for (const [k, v] of Object.entries(replacements)) if (obj.includes(k)) return obj.replace(k, v);
      return obj;
    } else if (Array.isArray(obj)) return obj.map(replace);
    else if (typeof obj === 'object' && obj) {
      const r = {};
      for (const [k, v] of Object.entries(obj)) r[k] = replace(v);
      return r;
    }
    return obj;
  }
  return replace(template);
}

async function curlPost(url, data, timeout = 30) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: data, client_id: `nanoclaw_${Date.now()}` }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function curlGet(url, timeout = 30) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function curlDownload(url, outputPath, timeout = 60) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    fs.writeFileSync(outputPath, Buffer.from(await resp.arrayBuffer()));
    return true;
  } catch { return false; }
}

async function submitPrompt(serverAddress, workflow) {
  const result = await curlPost(`http://${serverAddress}/prompt`, workflow);
  if (!result.prompt_id) throw new Error(`No prompt_id: ${JSON.stringify(result)}`);
  return result.prompt_id;
}

async function waitForResult(serverAddress, promptId, timeout = 300) {
  const url = `http://${serverAddress}/history/${promptId}`;
  for (let i = 1; i <= timeout / 2; i++) {
    try {
      const history = await curlGet(url);
      if (promptId in history) return history[promptId];
    } catch (e) { log(`查询出错: ${e}`); }
    await new Promise(r => setTimeout(r, 2000));
    log(`等待生成中... (${i}/${timeout/2})`);
  }
  throw new Error('图片生成超时');
}

async function downloadImages(serverAddress, result, outputPath) {
  fs.mkdirSync(outputPath, { recursive: true });
  const outputs = result.outputs || {};
  for (const [, nodeData] of Object.entries(outputs)) {
    if (nodeData.images) {
      for (const img of nodeData.images) {
        const { filename, subfolder = '', type = 'output' } = img;
        const url = `http://${serverAddress}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
        const savePath = path.join(outputPath, `${Date.now()}${path.extname(filename) || '.jpg'}`);
        if (await curlDownload(url, savePath)) return savePath;
      }
    }
  }
  return null;
}

async function generateImage(prompt, serverAddress, width = 512, height = 1024, seed) {
  const start = Date.now();
  if (!serverAddress) serverAddress = getComfyUIserver();
  log('=========================================');
  log('开始图片生成流程');
  log(`服务器: ${serverAddress}`);

  const t1 = Date.now();
  const template = loadWorkflowTemplate();
  log(`[1/5] 工作流模板加载完成 (${Date.now()-t1}ms)`);

  const t2 = Date.now();
  const workflow = buildWorkflow(template, prompt, width, height, seed);
  log(`[2/5] 工作流构建完成 (${Date.now()-t2}ms)`);

  const t3 = Date.now();
  const promptId = await submitPrompt(serverAddress, workflow);
  log(`[3/5] 任务已提交, ID: ${promptId} (${Date.now()-t3}ms)`);

  const t4 = Date.now();
  const result = await waitForResult(serverAddress, promptId);
  log(`[4/5] 图片生成完成 (${((Date.now()-t4)/1000).toFixed(1)}s)`);

  const t5 = Date.now();
  const savedPath = await downloadImages(serverAddress, result, '/workspace/group/images');
  if (savedPath) {
    log(`[5/5] 图片下载完成: ${savedPath} (${Date.now()-t5}ms)`);
    log(`总耗时: ${((Date.now()-start)/1000).toFixed(1)}秒`);
    return savedPath;
  }
  throw new Error('未能下载生成的图片');
}

const [,, prompt] = process.argv;
if (!prompt) {
  console.error('用法: node generate_comfyui.mjs <提示词>');
  process.exit(1);
}
const server = getComfyUIserver();
generateImage(prompt, server).then(p => console.log(p)).catch(e => { console.error(`错误: ${e}`); process.exit(1); });
EOF

chmod +x scripts/generate_comfyui.mjs
```

### Copy Z-Image template

```bash
# Copy the Z-Image workflow template (template.json)
# Should contain your ComfyUI workflow definition
```

### Create images directory

```bash
mkdir -p groups/discord_main/images
```

## Phase 3: Update Discord Channel

Same as before - the Discord channel already handles image sending via curl.

## Phase 4: Update Agent Instructions

Update `groups/discord_main/CLAUDE.md`:

```markdown
# Andy - Discord 助手

你是一个助手，可以回答问题、生成图片和对话。

## 图片生成能力

当用户在消息中 **@Andy** 并发送包含"生成图片"、"画一张"的内容时，根据参数决定执行模式：

### 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--optimize` | 使用 zimage-prompt-maker 深度优化提示词 | 否（直接生成） |

### 模式一：直接生成（默认）

当用户没有指定 `--optimize` 时，直接使用用户输入生成图片：

```bash
node /workspace/project/scripts/generate_comfyui.mjs "用户的原始提示词"
```

回复格式：
```
[描述图片内容...]

📁 图片路径：`/workspace/group/images/时间戳.jpg`
```

### 模式二：深度优化生成

当用户指定 `--optimize` 时，先使用 zimage-prompt-maker 优化提示词，再生成图片：

**第一步：读取优化技能**
```bash
cat /workspace/project/.claude/skills/zimage-prompt-maker/SKILL.md
```

**第二步：解析参数并生成优化后的提示词**
```bash
# 解析 --count 参数（默认1）
COUNT=1
if [[ "$用户输入" == *"--count"* ]]; then
  COUNT=$(echo "$用户输入" | grep -oP '(?<=--count\s)\d+' | head -1)
fi

# 生成优化后的提示词
node /workspace/project/.claude/skills/zimage-prompt-maker/scripts/generate_weights.mjs $COUNT
# ... 根据 SKILL.md 生成提示词 ...
```

**第三步：用优化后的提示词生成图片**
```bash
node /workspace/project/scripts/generate_comfyui.mjs "优化后的提示词"
```

**第四步：回复必须包含优化后的提示词**
```
**优化后的提示词：**
[优化后的提示词内容...]

📁 图片路径：`/workspace/group/images/时间戳.jpg`
```

### ComfyUI 服务器配置

| 模式 | 环境变量 | 服务器地址 |
|------|----------|------------|
| **宿主机网关（默认）** | `COMFYUI_MODE=host_vm` | 192.168.64.1:7860 |
| 内网 | `COMFYUI_MODE=internal` | 192.168.31.8:7860 |
| 外网 | `COMFYUI_MODE=external` | 123.56.194.98:7860 |

### 使用示例

- `@Andy 生成图片：美女` → 直接生成
- `@Andy 生成图片：美女 --optimize` → 优化后生成（返回优化提示词）
- `@Andy 生成图片：美女 --optimize --count 3` → 生成3组优化提示词并生成3张图

## 重要路径

- ComfyUI 脚本：`/workspace/project/scripts/generate_comfyui.mjs`
- 提示词优化技能：`/workspace/project/.claude/skills/zimage-prompt-maker/SKILL.md`
```

## Phase 5: Copy Prompt Optimization Skill

```bash
mkdir -p .claude/skills/zimage-prompt-maker
# Copy the SKILL.md content there
```

## Phase 6: Validate

```bash
npm run build
```

Test by sending **"@jmclaw 生成图片 一只猫"** in Discord.

## Phase 7: Rebuild Container

```bash
./container/build.sh
```

## Troubleshooting

**Image not sent:**
1. Check agent response contains `/workspace/group/images/*.jpg`
2. Check images directory exists and has correct permissions
3. Check curl command works: `curl --socks5 127.0.0.1:7890 https://discord.com/api/v10/channels/...`

**ComfyUI connection failed:**
1. Check server is accessible from container
2. Try external server: `COMFYUI_MODE=external node scripts/generate_comfyui.mjs "test"`

## Summary of Changed Files

| File | Type of Change |
|------|----------------|
| `scripts/generate_comfyui.mjs` | New - ComfyUI integration (TypeScript/Node.js, uses native fetch) |
| `scripts/template.json` | Existing - ComfyUI workflow template |
| `groups/discord_main/images/` | New - Image output directory |
| `src/channels/discord.ts` | Existing - Added image sending |
| `groups/discord_main/CLAUDE.md` | Modified - Updated script path |
| `.claude/skills/zimage-prompt-maker/` | Existing - Prompt optimization skill |
