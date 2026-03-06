import type { Skill } from './types.js';

/**
 * 内置技能列表（只读，不可删除）
 *
 * 设计原则：
 *   - 每个技能专注一件事
 *   - 提示词简洁但精准，减少不必要 token 消耗
 *   - system prompt 仅在需要角色切换时才设置
 */
export const BUILTIN_SKILLS: Skill[] = [
  // ── 文本处理 ──────────────────────────────────────────────────────────────

  {
    name: 'summarize',
    description: '用3句话总结内容，突出关键信息',
    prompt: '请用3句话总结以下内容，突出最关键的信息，语言简洁：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'bullets',
    description: '将内容转换为要点列表',
    prompt: '将以下内容整理成简洁的要点列表（用 - 开头），每条不超过20字：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'expand',
    description: '展开/丰富内容细节',
    prompt: '请展开以下内容，添加更多细节、示例和背景信息，使其更完整：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'shorter',
    description: '将内容压缩到原来一半长度',
    prompt: '请将以下内容精简到原来的一半篇幅，保留核心意思，去掉冗余表达：\n\n{input}',
    source: 'builtin',
  },

  // ── 翻译 ──────────────────────────────────────────────────────────────────

  {
    name: 'en',
    description: '翻译成英文',
    prompt: '请将以下内容翻译成自然流畅的英文，保持原意：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'zh',
    description: '翻译成中文',
    prompt: '请将以下内容翻译成自然流畅的中文，保持原意：\n\n{input}',
    source: 'builtin',
  },

  // ── 代码 ──────────────────────────────────────────────────────────────────

  {
    name: 'review',
    description: '代码审查：可维护性、性能、安全',
    system: '你是一位经验丰富的高级工程师，专注于代码质量。',
    prompt: `对以下代码进行审查，从三个维度给出简洁反馈：

**可维护性**（命名、结构、注释）
**性能**（时间复杂度、内存、潜在瓶颈）
**安全**（输入验证、边界条件、潜在漏洞）

代码如下：

\`\`\`
{input}
\`\`\``,
    source: 'builtin',
  },

  {
    name: 'explain',
    description: '解释代码或概念，面向初学者',
    prompt: '请用简单易懂的语言解释以下内容，避免过多术语，如有必要可以用类比：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'fix',
    description: '查找并修复代码中的 bug',
    system: '你是一位专注于调试的工程师，给出精确、最小化的修复方案。',
    prompt: `分析以下代码，找出 bug 并给出修复方案。
请直接给出修改后的代码，附带简短说明：

\`\`\`
{input}
\`\`\``,
    source: 'builtin',
  },

  {
    name: 'test',
    description: '为代码生成单元测试',
    system: '你是一位测试工程师，写出实用、覆盖边界情况的测试用例。',
    prompt: `为以下代码生成单元测试。
覆盖：正常情况、边界值、错误处理：

\`\`\`
{input}
\`\`\``,
    source: 'builtin',
  },

  // ── 写作 ──────────────────────────────────────────────────────────────────

  {
    name: 'polish',
    description: '润色文字，使其更专业流畅',
    prompt: '请润色以下文字，使其更专业、流畅，保持原来的意思和语气：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'formal',
    description: '将文字改写为正式商务风格',
    prompt: '请将以下文字改写为正式的商务风格，语气礼貌而专业：\n\n{input}',
    source: 'builtin',
  },

  {
    name: 'casual',
    description: '将文字改写为轻松日常风格',
    prompt: '请将以下文字改写为轻松、日常的表达风格，自然亲切：\n\n{input}',
    source: 'builtin',
  },
];

/** 通过名称查找内置技能 */
export function findBuiltin(name: string): Skill | undefined {
  return BUILTIN_SKILLS.find(s => s.name === name);
}
