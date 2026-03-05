import type { Message } from './types.js';

/**
 * 会话记忆持久化接口。
 *
 * 任何实现此接口的类都可以作为 ChatSession 的记忆后端：
 *   - @bcc/memory-fs   — 文件系统（默认，无需数据库）
 *   - @bcc/memory-vec  — 向量数据库（未来扩展）
 *   - 自定义实现       — 实现此接口即可即插即用
 *
 * 存储位置由用户在创建实例时自行决定，框架不做任何假设。
 */
export interface MemoryStore {
  /**
   * 将当前会话的消息历史保存到持久化存储。
   * 若 sessionId 已存在则覆盖。
   */
  save(sessionId: string, messages: Message[]): Promise<void>;

  /**
   * 从持久化存储加载指定会话的消息历史。
   * 若 sessionId 不存在，返回空数组。
   */
  load(sessionId: string): Promise<Message[]>;

  /**
   * 列出所有已保存的 sessionId。
   */
  list(): Promise<string[]>;

  /**
   * 删除指定会话的持久化数据。
   */
  delete(sessionId: string): Promise<void>;
}
