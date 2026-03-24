#!/usr/bin/env node
/**
 * ComfyUI 图片生成脚本 - NanoClaw Discord 版本
 * 使用 Node.js 实现 (ES Modules)
 *
 * 服务器配置 (按优先级):
 * 1. COMFYUI_SERVER 环境变量或 .env (直接指定服务器地址)
 * 2. COMFYUI_MODE 环境变量或 .env:
 *    - host_vm -> 192.168.64.1:7860 (容器宿主机网关)
 *    - internal -> 192.168.31.8:7860 (内网)
 *    - external -> 123.56.194.98:7860 (外网)
 * 3. 默认使用 internal (内网)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ComfyUI 服务器配置 (可通过环境变量覆盖)
const COMFYUI_HOST_VM = process.env.COMFYUI_HOST_VM || '192.168.64.1:7860';  // 宿主机 Apple Container 网关
const COMFYUI_INTERNAL = process.env.COMFYUI_INTERNAL || '192.168.31.8:7860';    // 局域网 ComfyUI 服务器
const COMFYUI_EXTERNAL = process.env.COMFYUI_EXTERNAL || '123.56.194.98:7860';  // 外网服务器

// 默认使用局域网服务器
const COMFYUI_DEFAULT_MODE = 'internal';

// 从 .env 文件读取配置
function loadEnvFile() {
  // Check multiple possible locations for .env
  const possiblePaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
    '/workspace/project/.env',
    path.join(__dirname, '.env'),
  ];

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      console.error(`[ComfyUI] Loading .env from: ${envPath}`);
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim();
            // Only set if not already in process.env
            if (!process.env[key]) {
              process.env[key] = value;
            }
          }
        }
      }
      break;
    }
  }
}

// 初始化环境变量
loadEnvFile();

function log(message) {
  console.error(`[ComfyUI] ${message}`);
}

async function testConnection(address) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://${address}/system_stats`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

async function getComfyUIserver() {
  if (process.env.COMFYUI_SERVER) {
    log(`使用指定服务器: ${process.env.COMFYUI_SERVER}`);
    return process.env.COMFYUI_SERVER;
  }

  const mode = process.env.COMFYUI_MODE || COMFYUI_DEFAULT_MODE || 'host_vm';
  const externalHost = process.env.COMFYUI_EXTERNAL || COMFYUI_EXTERNAL;

  if (mode === 'internal') {
    const internalHost = process.env.COMFYUI_INTERNAL || COMFYUI_INTERNAL;
    log(`使用内网服务器: ${internalHost}`);
    return internalHost;
  } else if (mode === 'external') {
    log(`使用外网服务器: ${externalHost}`);
    return externalHost;
  } else {
    // Default (host_vm): try host gateway first, fall back to external if unreachable
    log(`使用宿主机网关: ${COMFYUI_HOST_VM}`);
    const reachable = await testConnection(COMFYUI_HOST_VM);
    if (reachable) {
      return COMFYUI_HOST_VM;
    }
    log(`宿主机网关不可达，切换到外网服务器: ${externalHost}`);
    return externalHost;
  }
}

function loadWorkflowTemplate() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const templatePath = path.join(scriptDir, 'template.json');
  const content = fs.readFileSync(templatePath, 'utf-8');
  return JSON.parse(content);
}

function buildWorkflow(template, prompt, width = 512, height = 1024, seed) {
  if (seed === undefined) {
    seed = Math.floor(Date.now() * Math.random()) % 1000000000;
  }

  const replacements = {
    '${提示词}': prompt.replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' '),
    '${宽}': String(width),
    '${高}': String(height),
    '${种子}': String(seed),
  };

  function replaceRecursively(obj) {
    if (typeof obj === 'string') {
      for (const [placeholder, value] of Object.entries(replacements)) {
        if (obj.includes(placeholder)) {
          return obj.replace(placeholder, value);
        }
      }
      return obj;
    } else if (Array.isArray(obj)) {
      return obj.map(replaceRecursively);
    } else if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = replaceRecursively(value);
      }
      return result;
    }
    return obj;
  }

  return replaceRecursively(template);
}

async function curlPost(url, data, timeout = 30) {
  const clientId = `nanoclaw_${Date.now()}`;
  const payload = JSON.stringify({ prompt: data, client_id: clientId });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function curlGet(url, timeout = 30) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function curlDownload(url, outputPath, timeout = 60) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    return true;
  } catch (err) {
    log(`下载失败: ${err}`);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function submitPrompt(serverAddress, workflow) {
  const url = `http://${serverAddress}/prompt`;
  const result = await curlPost(url, workflow);

  if (!result.prompt_id) {
    throw new Error(`未能获取 prompt_id，服务器响应: ${JSON.stringify(result)}`);
  }

  return result.prompt_id;
}

async function waitForResult(serverAddress, promptId, timeout = 300) {
  const maxAttempts = Math.floor(timeout / 2);
  const url = `http://${serverAddress}/history/${promptId}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const history = await curlGet(url);
      if (promptId in history) {
        return history[promptId];
      }
    } catch (err) {
      log(`查询状态时出错: ${err}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    log(`等待生成中... (${attempt}/${maxAttempts})`);
  }

  throw new Error('图片生成超时');
}

async function downloadImages(serverAddress, result, outputPath) {
  const outputs = result.outputs || {};

  fs.mkdirSync(outputPath, { recursive: true });

  for (const [nodeId, nodeData] of Object.entries(outputs)) {
    if (nodeData.images) {
      for (const imgItem of nodeData.images) {
        const { filename, subfolder = '', type = 'output' } = imgItem;
        const viewUrl = `http://${serverAddress}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
        const timestamp = Date.now();
        const ext = path.extname(filename) || '.jpg';
        const savePath = path.join(outputPath, `${timestamp}${ext}`);

        if (await curlDownload(viewUrl, savePath)) {
          return savePath;
        }
      }
    }
  }

  return null;
}

async function generateImage(prompt, serverAddress, width = 512, height = 1024, seed) {
  const startTime = Date.now();

  if (!serverAddress) {
    serverAddress = await getComfyUIserver();
  }

  log('=========================================');
  log('开始图片生成流程');
  log(`服务器: ${serverAddress}`);
  log(`提示词: ${prompt.substring(0, 50)}...`);
  log('=========================================');

  // Step 1: 加载工作流模板
  const stepStart = Date.now();
  const template = loadWorkflowTemplate();
  log(`[1/5] 工作流模板加载完成 (${Date.now() - stepStart}ms)`);

  // Step 2: 构建工作流
  const step2Start = Date.now();
  const workflow = buildWorkflow(template, prompt, width, height, seed);
  log(`[2/5] 工作流构建完成 (${Date.now() - step2Start}ms)`);

  // Step 3: 提交任务
  const step3Start = Date.now();
  const promptId = await submitPrompt(serverAddress, workflow);
  log(`[3/5] 任务已提交, ID: ${promptId} (${Date.now() - step3Start}ms)`);

  // Step 4: 等待结果
  const step4Start = Date.now();
  const result = await waitForResult(serverAddress, promptId);
  log(`[4/5] 图片生成完成 (${((Date.now() - step4Start) / 1000).toFixed(1)}s)`);

  // Step 5: 下载图片
  const step5Start = Date.now();
  const outputDir = '/workspace/group/images';
  const savedPath = await downloadImages(serverAddress, result, outputDir);

  if (savedPath) {
    log(`[5/5] 图片下载完成: ${savedPath} (${Date.now() - step5Start}ms)`);
    log('=========================================');
    log(`总耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}秒`);
    log('=========================================');
    return savedPath;
  } else {
    throw new Error('未能下载生成的图片');
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('用法: node generate_comfyui.mjs <提示词>');
    console.error('环境变量:');
    console.error('  COMFYUI_MODE=host_vm   使用宿主机网关 (默认, 192.168.64.1:7860)');
    console.error('  COMFYUI_MODE=internal  使用内网服务器');
    console.error('  COMFYUI_MODE=external  使用外网服务器');
    console.error('  COMFYUI_SERVER=地址    直接指定服务器地址 (优先级最高)');
    console.error('');
    console.error('  # 自定义地址:');
    console.error('  COMFYUI_INTERNAL=192.168.31.8:7860');
    console.error('  COMFYUI_EXTERNAL=http://your-server:7860');
    process.exit(1);
  }

  const prompt = args[0];
  const server = await getComfyUIserver();
  const width = parseInt(process.env.COMFYUI_WIDTH || '512', 10);
  const height = parseInt(process.env.COMFYUI_HEIGHT || '1024', 10);

  try {
    const imagePath = await generateImage(prompt, server, width, height);
    console.log(imagePath); // 输出路径供 Node.js 捕获
  } catch (err) {
    console.error(`错误: ${err}`);
    process.exit(1);
  }
}

main();
