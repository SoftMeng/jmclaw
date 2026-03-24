#!/usr/bin/env node
/**
 * 主题库随机选择脚本
 * 从 themes.txt 中随机选择一行作为主题
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function getScriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function loadThemes() {
  const scriptDir = getScriptDir();
  const themesFile = path.join(scriptDir, '..', 'data', 'themes.txt');

  if (!fs.existsSync(themesFile)) {
    return ['未来城市', '星空下的古老城堡', '梦幻森林'];
  }

  const content = fs.readFileSync(themesFile, 'utf-8');
  return content.split('\n').map(line => line.trim()).filter(line => line);
}

function getRandomTheme() {
  const themes = loadThemes();
  return themes[Math.floor(Math.random() * themes.length)];
}

// Main
const args = process.argv.slice(2);

if (args.includes('--json')) {
  const themes = loadThemes();
  console.log(JSON.stringify({
    random_theme: getRandomTheme(),
    total_themes: themes.length,
  }, null, 2));
} else {
  console.log(getRandomTheme());
}
