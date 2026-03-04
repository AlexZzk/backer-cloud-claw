import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

export interface BccConfig {
  // 默认模型 id（对应 ModelRouter 中注册的 id）
  defaultModel?: string;
  // 工作区目录
  workspaceDir?: string;
  // 日志级别
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  // 各模块自定义配置（透传）
  [key: string]: unknown;
}

const DEFAULT_CONFIG_PATH = join(homedir(), '.bcc', 'bcc.json');

export function loadConfig(configPath?: string): BccConfig {
  const path = configPath ?? DEFAULT_CONFIG_PATH;
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(resolve(path), 'utf-8');
    return JSON.parse(raw) as BccConfig;
  } catch {
    return {};
  }
}

export function mergeConfig(base: BccConfig, override: Partial<BccConfig>): BccConfig {
  return { ...base, ...override };
}
