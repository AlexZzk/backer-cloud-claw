# BCC 渠道适配器贡献指南

本指南帮助开发者为 backer-cloud-claw 贡献新的渠道适配器（Channel Adapter），将 BCC AI 员工接入更多通信平台（微信、飞书、钉钉、WhatsApp 等）。

---

## 现有渠道一览

| 包名 | 平台 | 状态 | 维护方式 |
|------|------|------|---------|
| `@bcc/channel-cli` | 命令行（交互式 REPL） | ✅ 已发布 | 官方维护 |
| `@bcc/channel-http` | HTTP/SSE REST API | ✅ 已发布 | 官方维护 |
| `@bcc/channel-telegram` | Telegram Bot | ✅ 已发布 | 官方维护 |
| `@bcc/channel-discord` | Discord Bot（Gateway） | ✅ 已发布 | 官方维护 |
| `@bcc/channel-slack` | Slack Bolt API | 🔜 规划中 | 官方维护 |
| `@bcc/channel-wechat` | 微信公众号 / 企业微信 | 🙋 待认领 | 社区贡献 |
| `@bcc/channel-feishu` | 飞书（Feishu）机器人 | 🙋 待认领 | 社区贡献 |
| `@bcc/channel-dingtalk` | 钉钉机器人 | 🙋 待认领 | 社区贡献 |
| `@bcc/channel-whatsapp` | WhatsApp Business API | 🙋 待认领 | 社区贡献 |
| `@bcc/channel-line` | LINE Messaging API | 🙋 待认领 | 社区贡献 |
| `@bcc/channel-teams` | Microsoft Teams | 🙋 待认领 | 社区贡献 |
| `@bcc/channel-qq` | QQ 机器人 | 🙋 待认领 | 社区贡献 |

---

## 快速开始

### 1. 认领任务

在 GitHub Issues 中找到对应平台的 issue（标签：`channel: <platform>`、`help wanted`），
评论 "I'd like to work on this" 认领任务，防止重复劳动。

### 2. 克隆仓库并创建分支

```bash
git clone https://github.com/your-org/backer-cloud-claw.git
cd backer-cloud-claw
git checkout -b feat/channel-<platform-name>
pnpm install
```

### 3. 使用脚手架创建包

```bash
# 复制模板目录
cp -r packages/channel-telegram packages/channel-<your-platform>

# 修改 package.json 中的包名和描述
# 修改 tsconfig.json（无需改动，直接继承 tsconfig.base.json）
```

---

## 包目录结构

每个渠道适配器遵循统一的目录规范：

```
packages/channel-{name}/
├── src/
│   ├── index.ts          # 公开 API 导出（ChannelClass + 类型）
│   ├── channel.ts        # 渠道主类（实现核心逻辑）
│   ├── types.ts          # 平台特有类型（API 响应体等）
│   └── <platform>-api.ts # 平台 SDK 封装（REST 客户端等）
├── bin/
│   └── bcc-<name>.ts     # CLI 入口（可选）
├── package.json
└── tsconfig.json
```

---

## 核心接口规范

### AgentInterface（已定义于 `@bcc/foundation`）

渠道不需要实现此接口，而是**接收**实现该接口的对象（Worker 或 AgentEngine）：

```typescript
import type { AgentInterface } from '@bcc/foundation';

// AgentInterface 核心方法
interface AgentInterface {
  stream(userInput: string): AsyncIterable<AgentChunk>;
  clearHistory(): void;
  readonly currentModel: string;
}

// AgentChunk 类型
type AgentChunk =
  | { type: 'text';        text: string }
  | { type: 'tool_call';   tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string; isError: boolean }
  | { type: 'done';        tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } };
```

### ChannelOptions 标准字段

所有渠道的 Options 对象建议包含以下标准字段（可选但推荐）：

```typescript
export interface MyChannelOptions {
  /** 默认 Worker（处理未配置专属 Worker 的会话） */
  defaultAgent?: AgentInterface;

  /** 会话 ID / Chat ID → Worker 映射（多 Worker 场景） */
  workerMap?: Map<string, AgentInterface>;

  /** Worker 名称映射（用于多 Worker 场景的发言人前缀） */
  workerNames?: Map<AgentInterface, string>;

  /** 平台 Token / API Key */
  token: string;

  // ── 安全配置 ──
  /** 允许响应的用户/会话 ID 白名单（不填则响应所有） */
  allowedIds?: string[];
}
```

### 最小实现示例

```typescript
import type { AgentInterface } from '@bcc/foundation';
import type { MyChannelOptions } from './types.js';

export class MyChannel {
  private constructor(
    private readonly options: MyChannelOptions,
    private readonly defaultAgent: AgentInterface | undefined,
  ) {}

  /** 工厂方法：验证配置、初始化连接 */
  static async create(options: MyChannelOptions): Promise<MyChannel> {
    const channel = new MyChannel(options, options.defaultAgent);
    // 验证 Token / 测试连通性
    await channel._validateToken();
    return channel;
  }

  /** 启动消息监听（阻塞直到 stop() 被调用） */
  async start(): Promise<void> {
    // 实现轮询 / WebSocket 监听 / Webhook 服务器
  }

  /** 停止渠道（优雅退出） */
  stop(): void {
    // 关闭连接、清理资源
  }

  private async _handleIncomingMessage(
    sessionId: string,
    userText: string,
  ): Promise<void> {
    const agent = this.options.workerMap?.get(sessionId) ?? this.defaultAgent;
    if (!agent) return;

    let reply = '';
    for await (const chunk of agent.stream(userText)) {
      if (chunk.type === 'text') reply += chunk.text;
    }

    await this._sendReply(sessionId, reply);
  }

  private async _sendReply(sessionId: string, text: string): Promise<void> {
    // 调用平台 API 发送消息
  }

  private async _validateToken(): Promise<void> {
    // 验证 Token 有效性
  }
}
```

---

## 开发规范

### 依赖原则

| 原则 | 说明 |
|------|------|
| **零外部依赖优先** | 优先使用 Node.js 内置模块（`fetch`、`WebSocket`、`crypto`、`http`） |
| **工作区依赖** | 使用 `@bcc/foundation`、`@bcc/org` 等工作区包 |
| **平台 SDK 作为可选 peer** | 若必须使用平台官方 SDK，设为 `peerDependencies` + `optionalTrue` |
| **禁止重量级框架** | 不引入 Express、Fastify、discord.js 等 |

### 安全规范

- **凭证处理**：永远不在代码中硬编码 Token，统一读取环境变量
- **白名单过滤**：实现 `allowedIds` / `allowedChannelIds` 等白名单配置
- **消息长度限制**：遵守平台限制，超长消息自动分段发送
- **防并发**：同一会话不并发处理两条消息（使用 `processingSet`）
- **错误处理**：网络错误时重试（指数退避），不将内部错误泄露给用户

### 代码风格

- TypeScript 严格模式（继承 `tsconfig.base.json`）
- 文件顶部注释说明工作流程和特性
- 中文注释（与项目其他包保持一致）
- 使用 `exactOptionalPropertyTypes`，可选字段用展开运算符赋值：
  ```typescript
  // ✅ 正确
  new SomeClient({ ...(value !== undefined && { key: value }) });

  // ❌ 错误（会触发 TS2379）
  new SomeClient({ key: value });  // value 可能为 undefined
  ```

### 测试要求

提供基础单元测试（测试文件放在 `tests/` 目录）：

```typescript
// tests/channel.test.ts
import { MyChannel } from '../src/channel.js';
import type { AgentInterface } from '@bcc/foundation';

// Mock AgentInterface
const mockAgent: AgentInterface = {
  currentModel: 'test-model',
  listModels: () => ['test-model'],
  getHistory: () => [],
  clearHistory: () => {},
  dumpHistory: () => '',
  async *stream(input: string) {
    yield { type: 'text' as const, text: `Echo: ${input}` };
    yield { type: 'done' as const };
  },
};

// 基本测试用例...
```

---

## 提交 PR

1. 确保所有文件构建通过：
   ```bash
   pnpm --filter @bcc/channel-<name> build
   ```

2. 在 PR 描述中包含：
   - 实现的平台 + 认证方式（Bot Token / OAuth / Webhook）
   - 已测试的场景（私聊 / 群聊 / @mention 等）
   - 已知限制和注意事项

3. PR 标题格式：`feat(channel): add @bcc/channel-<platform>`

---

## 渠道 Issue 标签规范

在 GitHub Issues 创建渠道相关 issue 时，使用以下标签：

| 标签 | 用途 |
|------|------|
| `channel: wechat` | 微信渠道适配器 |
| `channel: feishu` | 飞书渠道适配器 |
| `channel: dingtalk` | 钉钉渠道适配器 |
| `channel: whatsapp` | WhatsApp 渠道适配器 |
| `channel: slack` | Slack 渠道适配器 |
| `help wanted` | 欢迎社区贡献 |
| `good first issue` | 适合新手（通常是补全文档或简单修复） |

---

## 联系与支持

- 遇到问题？在对应的 GitHub Issue 下留言
- 架构设计建议？发起 Discussion 讨论
- 参考实现：`@bcc/channel-telegram`（轮询模式）、`@bcc/channel-discord`（WebSocket Gateway 模式）
