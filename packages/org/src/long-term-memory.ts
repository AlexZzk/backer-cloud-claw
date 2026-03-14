import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Episode } from '@bcc/foundation';

const DEFAULT_BASE = join(homedir(), '.bcc', 'workers');

/**
 * LongTermMemory：管理 Worker 的长期记忆文件（MEMORY.md）。
 *
 * 文件位置：~/.bcc/workers/{workerId}/MEMORY.md
 *
 * 这是跨会话持久保留的知识精华，通过定期提炼情节记忆（EpisodicStore）更新，
 * 在 Worker 启动时注入 system prompt，让 Worker 在对话历史清空后仍"记得"
 * 用户偏好、重要决策、项目背景等核心信息。
 */
export class LongTermMemory {
  private basePath: string;

  constructor(
    private readonly workerId: string,
    basePath?: string,
  ) {
    this.basePath = basePath ?? DEFAULT_BASE;
  }

  /** MEMORY.md 的完整文件路径 */
  get filePath(): string {
    // 安全字符过滤，防止路径穿越
    const safe = this.workerId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return join(this.basePath, safe, 'MEMORY.md');
  }

  /**
   * 加载 MEMORY.md。文件不存在时返回空字符串（安全读取）。
   */
  async load(): Promise<string> {
    try {
      return await readFile(this.filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 将新内容写入 MEMORY.md（自动创建父目录）。
   */
  async save(content: string): Promise<void> {
    const safe = this.workerId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    const dir = join(this.basePath, safe);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, content, 'utf-8');
  }
}

// ─── LLM Prompt 构建 ──────────────────────────────────────────────────────────

/**
 * 构建长期记忆提炼 Prompt。
 *
 * 输入：现有 MEMORY.md 内容（可为空） + 最近情节记忆列表。
 * 输出：供 LLM 生成/更新 MEMORY.md 的完整指令。
 */
export function buildConsolidationPrompt(
  existingMemory: string,
  episodes: Episode[],
): string {
  const episodeLines = episodes
    .map(ep => {
      const date = new Date(ep.createdAt).toLocaleDateString('zh-CN');
      const kps =
        ep.keyPoints.length > 0
          ? '\n  关键点：' + ep.keyPoints.join('；')
          : '';
      return `- [${date}] ${ep.summary}${kps}`;
    })
    .join('\n');

  const existingSection = existingMemory.trim()
    ? `## 现有长期记忆\n\n${existingMemory.trim()}\n\n`
    : '';

  return `${existingSection}## 最近的情节记忆（最新在前）\n\n${episodeLines}

---

请基于以上信息，生成或更新 MEMORY.md 长期记忆文件。

MEMORY.md 是 AI 员工的核心知识库，跨会话持久保留，用于在每次启动时恢复记忆。请遵循以下原则：

1. **精华提炼**：只保留真正重要、有复用价值的信息（用户偏好、重要决策、关键背景、已学到的教训）
2. **结构清晰**：使用 Markdown 标题 / 列表，让读者能快速定位信息
3. **合并去重**：将相似信息合并，删除过时或已失效的内容
4. **控制篇幅**：整体不超过 800 字，聚焦最重要的内容

请直接输出 Markdown 格式的 MEMORY.md 正文（不要添加任何额外说明或代码围栏）：`;
}
