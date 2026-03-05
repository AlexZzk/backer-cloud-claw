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

export const BCC_HOME          = join(homedir(), '.bcc');
export const CONFIG_PATH       = join(BCC_HOME, 'config.json');
export const DEFAULT_SESSION_DIR = join(BCC_HOME, 'sessions');

// ─── 配置 Schema ──────────────────────────────────────────────────────────────

export interface ProviderConfig {
  /** API Key（明文存储于本地文件，文件权限 600） */
  apiKey: string;
  /**
   * 使用的模型名称。
   * 不填时使用各适配器内置默认值（如 qwen-plus、deepseek-chat 等）。
   */
  model?: string;
  /**
   * 自定义 API 地址。
   * 适用于私有部署、代理中转等场景。
   * 不填时使用各适配器内置默认地址。
   */
  baseUrl?: string;
}

export interface BccConfig {
  /** schema 版本，用于未来迁移 */
  version: '1';

  providers: {
    claude?:   ProviderConfig;
    deepseek?: ProviderConfig;
    bailian?:  ProviderConfig;
  };

  defaults: {
    /** 默认使用的提供商 */
    provider: 'claude' | 'deepseek' | 'bailian' | 'both';

    /** 是否启用会话持久化 */
    enableMemory: boolean;

    /** 会话文件存储绝对路径 */
    sessionDir: string;

    /**
     * 历史消息上限（超出后截断最早的消息）。
     * 0 表示无限制。
     */
    maxMessages: number;
  };
}

// ─── 默认值 ───────────────────────────────────────────────────────────────────

export function makeDefaultConfig(): BccConfig {
  return {
    version: '1',
    providers: {},
    defaults: {
      provider:     'claude' as 'claude' | 'deepseek' | 'bailian' | 'both',
      enableMemory: true,
      sessionDir:   DEFAULT_SESSION_DIR,
      maxMessages:  50,
    },
  };
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

/**
 * 加载配置文件。
 * 如果文件不存在或解析失败，返回 null（不抛出错误）。
 */
export async function loadConfig(): Promise<BccConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BccConfig>;
    // 合并默认值，防止旧版配置缺字段
    return deepMerge(
      makeDefaultConfig() as unknown as Record<string, unknown>,
      parsed as unknown as Record<string, unknown>,
    ) as unknown as BccConfig;
  } catch {
    return null;
  }
}

/**
 * 保存配置文件。
 * 自动创建 ~/.bcc/ 目录；在 Unix 系统上设置文件权限 600（保护 API Key）。
 */
export async function saveConfig(config: BccConfig): Promise<void> {
  await mkdir(BCC_HOME, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // 在非 Windows 平台限制文件读权限
  if (platform() !== 'win32') {
    try { await chmod(CONFIG_PATH, 0o600); } catch { /* 忽略权限设置失败 */ }
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 将 ~/.bcc/sessions 路径格式化为用于显示的 "~/.bcc/sessions"。
 * 在所有平台上使用 / 作为显示分隔符。
 */
export function displayPath(absPath: string): string {
  const home = homedir();
  if (absPath.startsWith(home)) {
    return '~' + absPath.slice(home.length).replace(/\\/g, '/');
  }
  return absPath.replace(/\\/g, '/');
}

/** 简单深合并（仅合并普通对象，不合并数组） */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (isPlainObject(sv) && isPlainObject(tv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
