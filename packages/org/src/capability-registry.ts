import type { WorkerCapabilityConfig, WorkerPrivilegeLevel } from '@bcc/foundation';

// ─── 依赖声明 ─────────────────────────────────────────────────────────────────

/**
 * 能力依赖映射表：capability key → 必须同时启用的 capability keys。
 *
 * 命名规则：
 *   'memory.episodic'   → capabilities.memory.episodic = true
 *   'memory.longTerm'   → capabilities.memory.longTerm = true
 *   'proactivity.routine' → capabilities.proactivity.routine 非空
 */
const CAPABILITY_DEPS: Record<string, string[]> = {
  'memory.longTerm':      ['memory.episodic'],
  'reflection':           ['memory.episodic'],
  'skillEvolution':       ['reflection'],
  'proactivity.routine':  ['task'],
};

/** Auditor 级别不允许开启的能力（防止被"说服"改变行为） */
const AUDITOR_FORBIDDEN: string[] = ['reflection', 'skillEvolution'];

// ─── 解析工具 ─────────────────────────────────────────────────────────────────

/**
 * 将 WorkerCapabilityConfig 展开为一组已启用的 capability key 集合。
 */
function resolveEnabledCapabilities(config: WorkerCapabilityConfig): Set<string> {
  const caps = new Set<string>();

  if (config.task) caps.add('task');
  if (config.soul) caps.add('soul');
  if (config.reflection) caps.add('reflection');
  if (config.skillEvolution) caps.add('skillEvolution');
  if (config.browser) caps.add('browser');

  const mem = config.memory;
  if (mem) {
    if (mem === true) {
      caps.add('memory.episodic');
    } else {
      if (mem.episodic) caps.add('memory.episodic');
      if (mem.longTerm) caps.add('memory.longTerm');
    }
  }

  const pro = config.proactivity;
  if (pro) {
    caps.add('proactivity');
    if (
      typeof pro === 'object' &&
      pro.routine &&
      pro.routine.length > 0
    ) {
      caps.add('proactivity.routine');
    }
  }

  return caps;
}

// ─── 公开接口 ─────────────────────────────────────────────────────────────────

/** 单条依赖校验错误。 */
export interface CapabilityValidationError {
  /** 存在依赖缺失的能力名称 */
  capability: string;
  /** 缺少的依赖能力名称 */
  requires: string;
  /** 人类可读的错误说明 */
  message: string;
}

/**
 * validateCapabilities：在 Worker 启动前验证能力依赖是否满足。
 *
 * @param config         Worker 的能力配置
 * @param privilegeLevel Worker 的特权等级（影响哪些能力被禁止）
 * @returns 错误列表，为空表示验证通过
 */
export function validateCapabilities(
  config: WorkerCapabilityConfig,
  privilegeLevel: WorkerPrivilegeLevel = 'normal',
): CapabilityValidationError[] {
  const errors: CapabilityValidationError[] = [];
  const enabled = resolveEnabledCapabilities(config);

  // 1. 检查依赖关系
  for (const cap of enabled) {
    const deps = CAPABILITY_DEPS[cap] ?? [];
    for (const dep of deps) {
      if (!enabled.has(dep)) {
        errors.push({
          capability: cap,
          requires: dep,
          message: `能力 "${cap}" 依赖 "${dep}"，但 "${dep}" 未启用`,
        });
      }
    }
  }

  // 2. 检查 auditor 禁止项
  if (privilegeLevel === 'auditor') {
    for (const forbidden of AUDITOR_FORBIDDEN) {
      if (enabled.has(forbidden)) {
        errors.push({
          capability: forbidden,
          requires: '(auditor 限制)',
          message: `审核员不允许开启 "${forbidden}" 能力（防止价值观被篡改）`,
        });
      }
    }
  }

  return errors;
}

/**
 * assertCapabilities：在 Worker 启动时断言能力配置合法。
 * 有任何错误时直接抛出，阻止 Worker 实例化。
 */
export function assertCapabilities(
  workerId: string,
  config: WorkerCapabilityConfig,
  privilegeLevel: WorkerPrivilegeLevel = 'normal',
): void {
  const errors = validateCapabilities(config, privilegeLevel);
  if (errors.length === 0) return;

  const detail = errors.map((e) => `  • ${e.message}`).join('\n');
  throw new Error(
    `Worker "${workerId}" 能力配置验证失败：\n${detail}`,
  );
}
