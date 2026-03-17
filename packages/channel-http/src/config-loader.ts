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
  /** 跳过 HTTPS 证书验证（自签名证书 / 私有 CA 场景） */
  insecure?: boolean;
  /** 绕过系统代理，直连该地址（填写需直连的地址，留空表示不启用） */
  noProxy?: string;
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
  /**
   * 心跳检测间隔（毫秒）。
   * - 未设置：默认 30 秒主动轮询
   * - 0：被动模式，不启动定时器，仅在收到消息时被唤起
   * - >0：主动轮询，按指定间隔定时审视收件箱
   */
  heartbeatIntervalMs?: number;
  primary?: boolean;
  /**
   * 工作空间目录（绝对路径）。
   * 未设置时默认为 `${defaults.workspaceBaseDir}/${id}`。
   */
  workspace?: string;
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
    /** Worker 工作空间根目录，默认 ~/.bcc/workspaces */
    workspaceBaseDir: string;
    /** 共享目录（所有 Worker 只读访问），默认 ~/.bcc/shared */
    sharedDir: string;
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

export const DEFAULT_WORKSPACE_BASE_DIR = join(BCC_HOME, 'workspaces');
export const DEFAULT_SHARED_DIR         = join(BCC_HOME, 'shared');

function makeDefaultDefaults(): BccConfig['defaults'] {
  return {
    enableMemory:     true,
    sessionDir:       DEFAULT_SESSION_DIR,
    maxMessages:      50,
    workspaceBaseDir: DEFAULT_WORKSPACE_BASE_DIR,
    sharedDir:        DEFAULT_SHARED_DIR,
  };
}

function migrate(raw: LegacyConfig): BccConfig {
  const rawDefaults = raw.defaults as (typeof raw.defaults & { workspaceBaseDir?: string; sharedDir?: string }) | undefined;
  const defaults: BccConfig['defaults'] = {
    enableMemory:     rawDefaults?.enableMemory     ?? true,
    sessionDir:       rawDefaults?.sessionDir       ?? DEFAULT_SESSION_DIR,
    maxMessages:      rawDefaults?.maxMessages      ?? 50,
    workspaceBaseDir: rawDefaults?.workspaceBaseDir ?? DEFAULT_WORKSPACE_BASE_DIR,
    sharedDir:        rawDefaults?.sharedDir        ?? DEFAULT_SHARED_DIR,
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
