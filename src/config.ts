import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets (API keys, tokens) are NOT read here — they are loaded only
// by the credential proxy (credential-proxy.ts), never exposed to containers.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'COMFYUI_MODE',
  'COMFYUI_SERVER',
  'COMFYUI_HOST_VM',
  'COMFYUI_INTERNAL',
  'COMFYUI_EXTERNAL',
  'COMFYUI_WIDTH',
  'COMFYUI_HEIGHT',
  'SOCKS5_PROXY',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// ComfyUI config
export const COMFYUI_MODE = process.env.COMFYUI_MODE || envConfig.COMFYUI_MODE || 'internal';
export const COMFYUI_SERVER = process.env.COMFYUI_SERVER || envConfig.COMFYUI_SERVER || '';
export const COMFYUI_HOST_VM = process.env.COMFYUI_HOST_VM || envConfig.COMFYUI_HOST_VM || '192.168.64.1:7860';
export const COMFYUI_INTERNAL = process.env.COMFYUI_INTERNAL || envConfig.COMFYUI_INTERNAL || '192.168.31.8:7860';
export const COMFYUI_EXTERNAL = process.env.COMFYUI_EXTERNAL || envConfig.COMFYUI_EXTERNAL || '';
export const COMFYUI_WIDTH = parseInt(process.env.COMFYUI_WIDTH || envConfig.COMFYUI_WIDTH || '512', 10);
export const COMFYUI_HEIGHT = parseInt(process.env.COMFYUI_HEIGHT || envConfig.COMFYUI_HEIGHT || '1024', 10);
export const SOCKS5_PROXY = process.env.SOCKS5_PROXY || envConfig.SOCKS5_PROXY || 'socks5://127.0.0.1:7890';

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const CREDENTIAL_PROXY_PORT = parseInt(
  process.env.CREDENTIAL_PROXY_PORT || '3001',
  10,
);
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
