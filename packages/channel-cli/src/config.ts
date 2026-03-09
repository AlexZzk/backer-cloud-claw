/**
 * bcc 配置系统
 *
 * 配置文件位置（全平台统一）：
 *   macOS / Linux : ~/.bcc/config.json
 *   Windows       : C:\Users\<用户名>\.bcc\config.json
 *
 * 优先级（高 → 低）：
 *   1. CLI 参数（如 --model deepseek）
 *   2. 环境变量（ANTHROPIC_API_KEY 等）
 *   3. 配置文件（~/.bcc/config.json）
 *   4. 内置默认值
 */

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

// ─── 路径常量 ─────────────────────────────────────────────────────────────────

export const BCC_HOME            = join(homedir(), '.bcc');
export const CONFIG_PATH         = join(BCC_HOME, 'config.json');
export const DEFAULT_SESSION_DIR = join(BCC_HOME, 'sessions');

// ─── 配置 Schema ──────────────────────────────────────────────────────────────

export type ProviderType = 'claude' | 'openai' | 'bailian' | 'deepseek' | 'custom';

/**
 * 单个模型实例配置。
 * 支持同一提供商配置多个实例（例如两个不同 Key 的 Claude 账号）。
 */
export interface ModelInstanceConfig {
  /**
   * 实例唯一标识，用于 /model 命令和日志。
   * 例如："claude-main"、"bailian-qwen"、"local-llama"
   */
  id: string;

  /** 提供商类型 */
  provider: ProviderType;

  /** API Key */
  apiKey: string;

  /**
   * 模型名称，留空时各提供商使用内置默认值：
   *   claude   → claude-sonnet-4-5
   *   bailian  → qwen-plus
   *   deepseek → deepseek-chat
   *   custom   → 必须填写
   */
  model?: string;

  /**
   * 自定义 API 地址：
   *   custom   → 必须填写
   *   其他     → 不填时使用官方地址，填写时覆盖（代理/私有部署）
   */
  baseUrl?: string;

  /** 是否为默认主模型（对话时默认使用此模型） */
  primary?: boolean;

  /** 是否为故障转移备用（仅当更高优先级模型失败时自动切换） */
  fallback?: boolean;
}

/**
 * Agent 配置（可序列化到 config.json）。
 * 每个 Agent 有独立角色、system prompt 和可选的首选模型。
 */
export interface AgentConfig {
  /** 唯一 ID，用于 /agent 命令和 Agent 间委托（如 "orchestrator"、"coder"） */
  id: string;
  /** 显示名称（如"研究员"） */
  name: string;
  /** 能力描述 — 当此 Agent 被其他 Agent 作为 Tool 调用时，告知模型何时使用它 */
  description: string;
  /** System Prompt — 定义角色、行为边界 */
  system: string;
  /** 引用 config.models 中的实例 ID；不填则使用全局主模型 */
  model?: string;
  /** 是否为主 Agent（用户默认对话对象）；多 Agent 时有且只有一个 */
  primary?: boolean;
  /** 技能标签（元数据，表明擅长领域，不影响运行行为） */
  skills?: string[];
}

/**
 * Worker 配置（可序列化到 config.json）。
 *
 * 一个 Worker = 一个模型实例（modelId）+ 一个身份（name/role）+ 一组技能标签（skills）。
 * 示例：
 *   { id: 'coder',  name: '代码工程师 Claude', role: '你是一位专注后端开发的工程师…',
 *     modelId: 'claude',   skills: ['编写代码', '代码审查'], description: '…' }
 *   { id: 'writer', name: '文案策划 Qwen',     role: '你是一位擅长营销文案的策划师…',
 *     modelId: 'bailian', skills: ['文本生成', '内容润色'], description: '…' }
 */
export interface WorkerConfig {
  /** 唯一 ID，用于 /worker <id> 命令 */
  id: string;
  /** 显示名称，例如"代码工程师 Claude" */
  name: string;
  /**
   * System Prompt — 定义员工的角色、职责、行为边界。
   * 会作为 AgentEngine 的 system 参数注入。
   */
  role: string;
  /** 技能标签（元数据），例如 ["编写代码", "代码审查"] */
  skills: string[];
  /** 对其他 Worker 的能力自述（供 /workers 命令展示） */
  description: string;
  /** 引用 config.models 中的实例 ID，例如 "claude"、"bailian" */
  modelId: string;
  /** 是否为默认 Worker（不传 --worker 参数时使用） */
  primary?: boolean;
}

export interface BccConfig {
  /** schema 版本 */
  version: '1';

  /**
   * 模型实例列表。
   * 支持任意数量、任意提供商的实例，每个实例独立 API Key + baseUrl + 模型名。
   */
  models: ModelInstanceConfig[];

  /**
   * Agent 配置列表（可选，旧版多 Agent 模式）。
   * 若为空，bcc-chat 使用默认的 ModelRouter 单对话模式。
   */
  agents?: AgentConfig[];

  /**
   * Worker 配置列表（新 Org 架构）。
   * 若配置了 workers，bcc-chat 优先使用 Worker 模式对话。
   * 每个 Worker 绑定一个模型 + 一个身份 + 一组技能。
   */
  workers?: WorkerConfig[];

  defaults: {
    /** 是否启用会话持久化 */
    enableMemory: boolean;
    /** 会话文件存储绝对路径 */
    sessionDir: string;
    /** 历史消息上限（0 = 无限制） */
    maxMessages: number;
  };
}

// ─── 旧格式（兼容迁移用）────────────────────────────────────────────────────

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
  models?: ModelInstanceConfig[];
  /** 新格式字段，透传不迁移 */
  agents?:  AgentConfig[];
  workers?: WorkerConfig[];
}

// ─── 默认值 ───────────────────────────────────────────────────────────────────

export function makeDefaultConfig(): BccConfig {
  return {
    version: '1',
    models: [],
    defaults: {
      enableMemory: true,
      sessionDir:   DEFAULT_SESSION_DIR,
      maxMessages:  50,
    },
  };
}

// ─── 旧格式迁移 ───────────────────────────────────────────────────────────────

function migrateFromLegacy(raw: LegacyConfig): BccConfig {
  const defaultCfg = makeDefaultConfig();

  const defaults: BccConfig['defaults'] = {
    enableMemory: raw.defaults?.enableMemory ?? defaultCfg.defaults.enableMemory,
    sessionDir:   raw.defaults?.sessionDir   ?? defaultCfg.defaults.sessionDir,
    maxMessages:  raw.defaults?.maxMessages  ?? defaultCfg.defaults.maxMessages,
  };

  // 新格式：直接使用，同时透传 agents / workers
  if (raw.models && raw.models.length > 0) {
    return {
      version: '1',
      models: raw.models,
      ...(raw.agents  && raw.agents.length  > 0 && { agents:  raw.agents  }),
      ...(raw.workers && raw.workers.length > 0 && { workers: raw.workers }),
      defaults,
    };
  }

  // 旧格式：从 providers 迁移
  const legacyProvider = raw.defaults?.provider ?? 'claude';
  const models: ModelInstanceConfig[] = [];

  if (raw.providers?.claude?.apiKey) {
    models.push({
      id: 'claude', provider: 'claude',
      apiKey: raw.providers.claude.apiKey,
      ...(raw.providers.claude.model && { model: raw.providers.claude.model }),
      primary:  legacyProvider === 'claude' || legacyProvider === 'both',
      fallback: false,
    });
  }
  if (raw.providers?.bailian?.apiKey) {
    models.push({
      id: 'bailian', provider: 'bailian',
      apiKey: raw.providers.bailian.apiKey,
      ...(raw.providers.bailian.model   && { model:   raw.providers.bailian.model }),
      ...(raw.providers.bailian.baseUrl && { baseUrl: raw.providers.bailian.baseUrl }),
      primary:  legacyProvider === 'bailian',
      fallback: false,
    });
  }
  if (raw.providers?.deepseek?.apiKey) {
    models.push({
      id: 'deepseek', provider: 'deepseek',
      apiKey: raw.providers.deepseek.apiKey,
      primary:  legacyProvider === 'deepseek',
      fallback: legacyProvider === 'both',
    });
  }

  if (models.length > 0 && !models.some(m => m.primary)) {
    models[0]!.primary = true;
  }

  return { version: '1', models, defaults };
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<BccConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return migrateFromLegacy(JSON.parse(raw) as LegacyConfig);
  } catch {
    return null;
  }
}

export async function saveConfig(config: BccConfig): Promise<void> {
  await mkdir(BCC_HOME, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  if (platform() !== 'win32') {
    try { await chmod(CONFIG_PATH, 0o600); } catch { /* 忽略 */ }
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

export function displayPath(absPath: string): string {
  const home = homedir();
  if (absPath.startsWith(home)) {
    return '~' + absPath.slice(home.length).replace(/\\/g, '/');
  }
  return absPath.replace(/\\/g, '/');
}

/** 获取主模型（primary = true 的第一个，否则列表第一个） */
export function getPrimaryModel(models: ModelInstanceConfig[]): ModelInstanceConfig | undefined {
  return models.find(m => m.primary) ?? models[0];
}
