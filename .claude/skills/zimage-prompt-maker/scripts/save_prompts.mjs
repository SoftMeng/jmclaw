#!/usr/bin/env node
/**
 * 提示词保存脚本
 * 将生成的提示词保存到 .txt 文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

function sanitizeFilename(filename) {
  const invalidChars = '<>:"/\\|?*';
  for (const char of invalidChars) {
    filename = filename.replace(char, '_');
  }
  return filename;
}

function generateFilename(theme) {
  const cleanTheme = sanitizeFilename(theme);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `prompts_${cleanTheme}_${timestamp}.txt`;
}

function formatPromptsText(theme, promptsData) {
  const lines = [];
  const now = new Date().toLocaleString('zh-CN');

  lines.push('Z-Image 提示词生成结果');
  lines.push(`生成时间：${now}`);
  lines.push(`主题：${theme}`);
  lines.push('='.repeat(50));
  lines.push('');

  for (let i = 0; i < promptsData.length; i++) {
    const promptData = promptsData[i];
    const { seed = [], content = '' } = promptData;

    lines.push(`【提示词组 ${i + 1}】`);
    lines.push(`种子数组：[${seed.join(', ')}]`);
    lines.push('');
    lines.push(content);
    lines.push('');
    lines.push('='.repeat(50));
    lines.push('');
  }

  return lines.join('\n');
}

function savePromptsToFile(theme, promptsData, outputPath) {
  if (!outputPath) {
    const filename = generateFilename(theme);
    outputPath = path.join(homedir(), filename);
  }

  const content = formatPromptsText(theme, promptsData);
  fs.writeFileSync(outputPath, content, 'utf-8');
  return outputPath;
}

// Main
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const theme = getArg('theme');
const promptsJson = getArg('prompts');
let outputPath = getArg('output');

if (!theme || !promptsJson) {
  console.error('用法: node save_prompts.mjs --theme "主题" --prompts \'JSON数据\' [--output "路径"]');
  console.error('');
  console.error('参数:');
  console.error('  --theme    提示词主题 (必填)');
  console.error('  --prompts  JSON格式的提示词数组 (必填)');
  console.error('  --output   输出文件路径 (可选)');
  process.exit(1);
}

try {
  const promptsParsed = JSON.parse(promptsJson);

  let promptsData;
  if (Array.isArray(promptsParsed)) {
    promptsData = promptsParsed;
  } else if (promptsParsed.prompts) {
    promptsData = promptsParsed.prompts;
  } else {
    console.error('错误：prompts 必须是数组格式');
    process.exit(1);
  }

  for (const prompt of promptsData) {
    if (!('seed' in prompt) || !('content' in prompt)) {
      console.error('错误：每个提示词必须包含 "seed" 和 "content" 字段');
      process.exit(1);
    }
  }

  const savedPath = savePromptsToFile(theme, promptsData, outputPath);
  console.log(`✓ 提示词已保存到：${savedPath}`);
} catch (e) {
  console.error(`错误：${e.message}`);
  process.exit(1);
}
