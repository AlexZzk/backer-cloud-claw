/**
 * 配置加载（与 @bcc/channel-cli/src/config.ts 保持类型一致，独立实现避免循环依赖）
 *
 * 支持与 CLI 完全相同的 config.json 格式，包括旧版 providers 字段迁移。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BCC_HOME    = join(homedir(), '.bcc');
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
  /** 可选：心跳/收件箱审视用的轻量模型 ID */
  reviewModelId?: string;
  primary?: boolean;
}

export interface BccConfig {
  version: '1';
  models: ModelInstanceConfig[];
  /** 旧版 Agent 字段，HTTP 服务器透传不使用 */
  agents?: unknown[];
  workers?: WorkerConfig[];
  defaults: {
    enableMemory: boolean;
    sessionDir: string;
    maxMessages: number;
  };
}

// ─── 旧版格式兼容（与 CLI config.ts 保持相同迁移逻辑）────────────────────────

interface LegacyProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface LegacyConfig {
  version?: '1';
  providers?: {
    claude?:   LegacyProviderConfig;
    deepseek?: LegacyProviderConfig;
    bailian?:  LegacyProviderConfig;
  };
  defaults?: {
    provider?:     string;
    enableMemory?: boolean;
    sessionDir?:   string;
    maxMessages?:  number;
  };
  models?:   ModelInstanceConfig[];
  agents?:   unknown[];
  workers?:  WorkerConfig[];
}

function makeDefaultDefaults(): BccConfig['defaults'] {
  return {
    enableMemory: true,
    sessionDir:   DEFAULT_SESSION_DIR,
    maxMessages:  50,
  };
}

function migrate(raw: LegacyConfig): BccConfig {
  const defaults: BccConfig['defaults'] = {
    enableMemory: raw.defaults?.enableMemory ?? true,
    sessionDir:   raw.defaults?.sessionDir   ?? DEFAULT_SESSION_DIR,
    maxMessages:  raw.defaults?.maxMessages  ?? 50,
  };

  // 新格式：直接使用，透传 agents / workers
  if (raw.models && raw.models.length > 0) {
    return {
      version:  '1',
      models:   raw.models,
      ...(raw.agents  && raw.agents.length  > 0 && { agents:  raw.agents  }),
      ...(raw.workers && raw.workers.length > 0 && { workers: raw.workers }),
      defaults,
    };
  }

  // 旧版 providers 格式迁移
  const legacyProvider = raw.defaults?.provider ?? 'claude';
  const models: ModelInstanceConfig[] = [];

  if (raw.providers?.claude?.apiKey) {
    models.push({
      id: 'claude', provider: 'claude',
      apiKey:  raw.providers.claude.apiKey,
      ...(raw.providers.claude.model && { model: raw.providers.claude.model }),
      primary:  legacyProvider === 'claude' || legacyProvider === 'both',
      fallback: false,
    });
  }
  if (raw.providers?.bailian?.apiKey) {
    models.push({
      id: 'bailian', provider: 'bailian',
      apiKey:  raw.providers.bailian.apiKey,
      ...(raw.providers.bailian.model   && { model:   raw.providers.bailian.model }),
      ...(raw.providers.bailian.baseUrl && { baseUrl: raw.providers.bailian.baseUrl }),
      primary:  legacyProvider === 'bailian',
      fallback: false,
    });
  }
  if (raw.providers?.deepseek?.apiKey) {
    models.push({
      id: 'deepseek', provider: 'deepseek',
      apiKey:   raw.providers.deepseek.apiKey,
      primary:  legacyProvider === 'deepseek',
      fallback: legacyProvider === 'both',
    });
  }

  if (models.length > 0 && !models.some(m => m.primary)) {
    models[0]!.primary = true;
  }

  return { version: '1', models, defaults };
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<BccConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LegacyConfig;
    const config = migrate(parsed);
    // 防御性兜底：确保 defaults 存在
    if (!config.defaults) {
      (config as BccConfig & { defaults: BccConfig['defaults'] }).defaults = makeDefaultDefaults();
    }
    return config;
  } catch {
    return null;
  }
}

export async function saveConfig(config: BccConfig): Promise<void> {
  await mkdir(BCC_HOME, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
