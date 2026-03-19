/**
 * ContextCompactor：对话历史压缩器。
 *
 * 对标 OpenClaw 的 history compaction 和 Claude Code 的 context compaction：
 * - 当消息数量超过阈值时，对旧消息调用 LLM 生成结构化摘要
 * - 保留最近 N 条消息的完整内容（保证对话连贯性）
 * - 增量摘要：检测已有 [CONVERSATION SUMMARY]，仅对新增消息增量压缩
 *
 * 工具输出截断：
 * - 单个工具调用结果超过 toolOutputMaxChars 时自动截断
 * - 防止单次文件读取/搜索结果撑爆 context window
 */

import type { Message, ModelAdapter } from '@bcc/foundation';

export interface CompactorOptions {
  /**
   * 触发压缩的消息轮数阈值（超过后触发摘要）。
   * 默认 40 条（约 20 轮对话）。
   */
  maxMessages?: number;

  /**
   * 压缩后保留的最近完整消息数量。
   * 默认 10 条（最近 5 轮对话保持完整）。
   */
  recentKeep?: number;

  /**
   * 单个工具输出的最大字符数。
   * 超过后截断中间部分，保留首尾。
   * 默认 8000 字符（约 2600 tokens）。
   */
  toolOutputMaxChars?: number;
}

/** 摘要消息的标识前缀，用于检测已有摘要 */
const SUMMARY_PREFIX = '[CONVERSATION SUMMARY]';

export class ContextCompactor {
  readonly maxMessages: number;
  readonly recentKeep: number;
  readonly toolOutputMaxChars: number;

  constructor(options: CompactorOptions = {}) {
    this.maxMessages = options.maxMessages ?? 40;
    this.recentKeep = options.recentKeep ?? 10;
    this.toolOutputMaxChars = options.toolOutputMaxChars ?? 8000;
  }

  /**
   * 估算 token 数（中英混合保守估算）。
   * 中文约 2 字符/token，英文约 4 字符/token，取中间值 3 字符/token。
   * 偏保守，实际压缩触发点略早，更安全。
   */
  estimateTokens(messages: Message[], system?: string): number {
    const msgChars = messages.reduce((sum, m) => {
      const text = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      return sum + text.length;
    }, 0);
    return Math.ceil((msgChars + (system?.length ?? 0)) / 3);
  }

  /** 是否需要压缩 */
  needsCompaction(messages: Message[]): boolean {
    return messages.length > this.maxMessages;
  }

  /**
   * 对消息历史执行压缩。
   *
   * 流程：
   * 1. 检测历史开头是否已有 [CONVERSATION SUMMARY]（增量摘要）
   * 2. 取 messages[0..cutPoint-1] 作为待压缩区间
   * 3. 调用 model 生成结构化摘要（失败时降级为简单截断）
   * 4. 返回：[摘要 user 消息, 摘要 ack assistant 消息, ...最近 recentKeep 条消息]
   */
  async compact(messages: Message[], model: ModelAdapter): Promise<Message[]> {
    if (messages.length <= this.recentKeep * 2) return messages;

    const cutPoint = messages.length - this.recentKeep;
    const toSummarize = messages.slice(0, cutPoint);
    const toKeep = messages.slice(cutPoint);

    // 检测是否已有摘要（增量摘要：在已有摘要基础上叠加新内容）
    const firstMsg = toSummarize[0];
    const existingSummary =
      firstMsg?.role === 'user' &&
      typeof firstMsg.content === 'string' &&
      firstMsg.content.startsWith(SUMMARY_PREFIX)
        ? firstMsg.content
        : '';

    // 构建摘要输入：已有摘要 + 新增对话
    const newMessages = existingSummary
      ? toSummarize.slice(2)  // 跳过摘要消息和 ack 消息
      : toSummarize;

    const conversationText = newMessages
      .map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const text = typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content);
        return `${role}: ${text.slice(0, 600)}`;
      })
      .join('\n\n');

    const summaryInstruction = existingSummary
      ? `You have an existing conversation summary. Update it by incorporating the new messages below.\n\nEXISTING SUMMARY:\n${existingSummary.replace(SUMMARY_PREFIX + '\n', '')}\n\nNEW MESSAGES TO ADD:\n${conversationText}`
      : `Summarize this conversation. Preserve: key decisions, important facts, task status, and open questions.\n\nCONVERSATION:\n${conversationText}`;

    const prompt = `${summaryInstruction}

OUTPUT FORMAT (structured markdown):
## Key Decisions & Agreements
- ...

## Important Information
- ...

## Tasks & Actions
- ...

## Current Status / Next Steps
- ...

Be concise. Focus on actionable information.`;

    let summaryText = '';
    try {
      const chunks: string[] = [];
      for await (const chunk of model.stream({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1000,
      })) {
        if (chunk.type === 'text' && chunk.text) {
          chunks.push(chunk.text);
        }
      }
      summaryText = chunks.join('');
    } catch {
      // 压缩失败时降级：直接截断，不阻断主对话
      summaryText = `（Earlier ${toSummarize.length} messages condensed due to context length）`;
    }

    return [
      {
        role: 'user',
        content: `${SUMMARY_PREFIX}\n${summaryText}`,
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our previous conversation captured in the summary above.',
      },
      ...toKeep,
    ];
  }

  /**
   * 截断工具输出，防止单个大输出（文件读取、搜索结果等）占满 context。
   * 保留首尾内容，截断中间部分（首尾往往最重要）。
   */
  truncateToolOutput(output: string): string {
    if (output.length <= this.toolOutputMaxChars) return output;
    const headChars = Math.floor(this.toolOutputMaxChars * 0.75);
    const tailChars = this.toolOutputMaxChars - headChars;
    const omitted = output.length - this.toolOutputMaxChars;
    return (
      output.slice(0, headChars) +
      `\n\n...[已截断 ${omitted} 字符，原始输出共 ${output.length} 字符]...\n\n` +
      output.slice(-tailChars)
    );
  }
}
