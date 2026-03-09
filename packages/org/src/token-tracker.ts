import type { TokenUsage } from '@bcc/foundation';

/**
 * TokenRecord：某个 Worker 某条 Thread 内的一次 token 消耗记录。
 */
export interface TokenRecord {
  workerId: string;
  threadId: string;
  timestamp: number;
  usage: TokenUsage;
}

/**
 * WorkerTokenSummary：某个 Worker 的汇总用量。
 */
export interface WorkerTokenSummary {
  workerId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  callCount: number;
}

/**
 * TokenTracker：组织级 Token 消耗追踪器。
 *
 * Worker 每次完成一轮回复后调用 record()，管理后台通过
 * getSummary() / getAllSummaries() / getRecords() 查询用量。
 */
export class TokenTracker {
  private records: TokenRecord[] = [];

  /** 记录一次 token 消耗 */
  record(workerId: string, threadId: string, usage: TokenUsage): void {
    this.records.push({ workerId, threadId, timestamp: Date.now(), usage });
  }

  /** 获取指定 Worker 的汇总用量 */
  getSummary(workerId: string): WorkerTokenSummary {
    const workerRecords = this.records.filter(r => r.workerId === workerId);
    return {
      workerId,
      totalInputTokens: workerRecords.reduce((s, r) => s + r.usage.inputTokens, 0),
      totalOutputTokens: workerRecords.reduce((s, r) => s + r.usage.outputTokens, 0),
      totalTokens: workerRecords.reduce((s, r) => s + r.usage.totalTokens, 0),
      callCount: workerRecords.length,
    };
  }

  /** 获取所有已知 Worker 的汇总用量列表 */
  getAllSummaries(): WorkerTokenSummary[] {
    const workerIds = [...new Set(this.records.map(r => r.workerId))];
    return workerIds.map(id => this.getSummary(id));
  }

  /** 获取原始记录（可按 workerId / threadId 过滤） */
  getRecords(filter?: { workerId?: string; threadId?: string }): TokenRecord[] {
    if (!filter) return [...this.records];
    return this.records.filter(r => {
      if (filter.workerId && r.workerId !== filter.workerId) return false;
      if (filter.threadId && r.threadId !== filter.threadId) return false;
      return true;
    });
  }

  /** 清空所有记录（测试用途） */
  clear(): void {
    this.records = [];
  }
}
