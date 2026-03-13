import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditAction, TokenUsage } from '@bcc/foundation';

const DEFAULT_DIR = join(homedir(), '.bcc', 'audit');

/**
 * AuditLog：Worker 行为的不可篡改审计记录。
 *
 * 每个 Worker 对应一个 {workerId}.jsonl 文件（append-only），
 * 记录状态变化、消息收发、工具调用、审批申请等关键操作。
 *
 * 设计原则：
 * - 只追加（append-only），不允许修改或删除历史记录
 * - 写入失败时静默处理（不影响主流程）
 * - 每条记录包含唯一 ID，支持幂等性校验
 */
export class AuditLog {
  private readonly dir: string;
  private initialized = false;

  constructor(dir?: string) {
    this.dir = resolve(dir ?? DEFAULT_DIR);
  }

  /**
   * 记录一条审计条目。
   *
   * 写入失败时静默捕获（不阻断主流程）。
   */
  async record(
    entry: Omit<AuditEntry, 'id'>,
  ): Promise<AuditEntry> {
    const full: AuditEntry = { id: randomUUID(), ...entry };
    try {
      await this.ensureDir();
      const line = JSON.stringify(full) + '\n';
      await appendFile(this.pathFor(entry.workerId), line, 'utf-8');
    } catch {
      // 审计写入失败不影响主流程，静默处理
    }
    return full;
  }

  /**
   * 读取指定 Worker 的最近 N 条审计记录（按时间升序）。
   */
  async getEntries(workerId: string, limit = 100): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(this.pathFor(workerId), 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      return [];
    }
  }

  // ─── 便捷方法 ────────────────────────────────────────────────────────────────

  /** 记录状态变化。 */
  recordStateChange(
    workerId: string,
    previousState: string,
    newState: string,
  ): Promise<AuditEntry> {
    return this.record({
      timestamp: Date.now(),
      workerId,
      action: 'state:changed',
      details: { previousState, newState },
    });
  }

  /** 记录收到消息。 */
  recordMessageReceived(
    workerId: string,
    messageId: string,
    from: string,
    threadId?: string,
    chatId?: string,
  ): Promise<AuditEntry> {
    return this.record({
      timestamp: Date.now(),
      workerId,
      ...(threadId !== undefined ? { threadId } : {}),
      ...(chatId !== undefined ? { chatId } : {}),
      action: 'message:received',
      details: { messageId, from },
    });
  }

  /** 记录发出消息。 */
  recordMessageSent(
    workerId: string,
    messageId: string,
    to: string,
    threadId?: string,
    chatId?: string,
    tokenUsage?: TokenUsage,
  ): Promise<AuditEntry> {
    return this.record({
      timestamp: Date.now(),
      workerId,
      ...(threadId !== undefined ? { threadId } : {}),
      ...(chatId !== undefined ? { chatId } : {}),
      action: 'message:sent',
      details: { messageId, to },
      ...(tokenUsage !== undefined ? { tokenUsage } : {}),
    });
  }

  /** 记录收件箱审视完成。 */
  recordInboxChecked(
    workerId: string,
    pendingCount: number,
    processedChats: string[],
  ): Promise<AuditEntry> {
    return this.record({
      timestamp: Date.now(),
      workerId,
      action: 'inbox:checked',
      details: { pendingCount, processedChats },
    });
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────────────

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });
    this.initialized = true;
  }

  private pathFor(workerId: string): string {
    // 只允许安全字符，防止路径穿越
    const safe = workerId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return join(this.dir, `${safe}.jsonl`);
  }
}
