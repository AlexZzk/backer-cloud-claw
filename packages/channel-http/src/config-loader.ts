/**
 * 配置加载（与 @bcc/channel-cli/src/config.ts 保持一致的类型，独立实现避免循环依赖）
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BCC_HOME   = join(homedir(), '.bcc');
const CONFIG_PATH = join(BCC_HOME, 'config.json');

export const DEFAULT_SESSION_DIR = join(BCC_HOME, 'sessions');

export type ProviderType = 'claude' | 'openai' | 'bailian' | 'deepseek' | 'custom';

export interface ModelInstanceConfig {
  id: string;
  provider: ProviderType;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  primary?: boolean;
  fallback?: boolean;
}

export interface WorkerConfig {
  id: string;
  name: string;
  role: string;
  tools?: string[];
  skills: string[];
  description: string;
  modelId: string;
  primary?: boolean;
}

export interface BccConfig {
  version: '1';
  models: ModelInstanceConfig[];
  workers?: WorkerConfig[];
  defaults: {
    enableMemory: boolean;
    sessionDir: string;
    maxMessages: number;
  };
}

export async function loadConfig(): Promise<BccConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as BccConfig;
    return parsed;
  } catch {
    return null;
  }
}
