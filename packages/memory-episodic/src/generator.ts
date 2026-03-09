import { randomUUID } from 'node:crypto';
import type { Episode, Message } from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';

/**
 * EpisodeGenerator：调用 LLM 对会话历史生成情节记忆摘要。
 *
 * 依赖 ModelAdapter（定义于 @bcc/model-core），与具体模型无关。
 * 通常复用 Worker 自身的模型，也可以传入专用的轻量模型以节省成本。
 */
export class EpisodeGenerator {
  constructor(private model: ModelAdapter) {}

  /**
   * 根据会话历史生成一条情节记忆。
   *
   * @param workerId  Worker ID（用于 Episode 归属）
   * @param sessionId 来源会话 ID
   * @param history   LLM 协议层消息历史（Message[]）
   * @returns         生成的 Episode，若历史太短（<2 条）则返回 null
   */
  async generate(
    workerId: string,
    sessionId: string,
    history: Message[],
  ): Promise<Episode | null> {
    // 过滤出 user/assistant 消息（排除 system、tool_result 等）
    const conversational = history.filter(
      m => m.role === 'user' || m.role === 'assistant',
    );

    if (conversational.length < 2) return null;

    const turnCount = Math.floor(conversational.length / 2);
    const prompt = buildSummaryPrompt(conversational);

    let raw: string;
    try {
      raw = await this.model.complete({
        messages: [{ role: 'user', content: prompt }],
        // 不传 system，让摘要模型用默认行为
      });
    } catch {
      return null;
    }

    return parseEpisode(workerId, sessionId, turnCount, raw);
  }
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

/**
 * 构建摘要 prompt。
 * 要求 LLM 返回严格的 JSON 格式，便于解析。
 */
function buildSummaryPrompt(history: Message[]): string {
  const lines: string[] = [];
  for (const msg of history) {
    const role = msg.role === 'user' ? '用户' : 'AI';
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((c): c is { type: 'text'; text: string } => typeof c === 'object' && c.type === 'text')
            .map(c => c.text)
            .join('')
        : '';
    if (text.trim()) {
      lines.push(`[${role}]: ${text.trim()}`);
    }
  }

  const dialogue = lines.join('\n');

  return `以下是一段对话记录，请生成结构化摘要，严格按 JSON 格式回复（不要添加任何额外说明）：

---
${dialogue}
---

请返回如下 JSON：
{
  "summary": "一到两句话概括本次对话的主要内容和结论",
  "keyPoints": ["关键点1", "关键点2", "关键点3（最多5条，没有可以为空数组）"]
}`;
}

/**
 * 解析 LLM 返回的 JSON，生成 Episode 对象。
 * 若解析失败，回退到纯文本摘要（保证不丢记忆）。
 */
function parseEpisode(
  workerId: string,
  sessionId: string,
  turnCount: number,
  raw: string,
): Episode {
  const base: Episode = {
    id: randomUUID(),
    workerId,
    sessionId,
    summary: '',
    keyPoints: [],
    turnCount,
    createdAt: Date.now(),
  };

  try {
    // 提取 JSON（LLM 有时会在 ``` 块中包裹）
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no json found');

    const parsed = JSON.parse(jsonMatch[0]) as { summary?: unknown; keyPoints?: unknown };

    base.summary = typeof parsed.summary === 'string' && parsed.summary
      ? parsed.summary
      : raw.trim().slice(0, 200);

    base.keyPoints = Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.filter((k): k is string => typeof k === 'string')
      : [];
  } catch {
    // 回退：直接把 LLM 输出截断作为摘要
    base.summary = raw.trim().slice(0, 300);
  }

  return base;
}
