import type { OrgMessage, Participant } from '@bcc/foundation';

/**
 * MessageRouter：将 OrgMessage 路由到目标 Participant。
 *
 * 当前实现：按 `to` 字段的 id 精确匹配。
 * 未来可扩展为按角色路由（例如 to: 'role:coder' → 找到所有 role 为 coder 的 Worker）。
 */
export class MessageRouter {
  private participants = new Map<string, Participant>();

  /** 注册参与者 */
  register(participant: Participant): void {
    this.participants.set(participant.id, participant);
  }

  /** 注销参与者 */
  unregister(id: string): void {
    this.participants.delete(id);
  }

  /** 获取参与者 */
  get(id: string): Participant | undefined {
    return this.participants.get(id);
  }

  /** 列出所有参与者 */
  list(): Participant[] {
    return [...this.participants.values()];
  }

  /**
   * 路由消息到目标 Participant 并等待回复。
   * 支持单个收件人或多个收件人（并发处理）。
   */
  async route(message: OrgMessage): Promise<OrgMessage[]> {
    const targets = Array.isArray(message.to) ? message.to : [message.to];
    const replies = await Promise.all(
      targets.map(async id => {
        const participant = this.participants.get(id);
        if (!participant) return null;
        return participant.receive(message);
      }),
    );
    return replies.filter((r): r is OrgMessage => r !== null);
  }
}
