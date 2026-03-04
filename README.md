# backer-cloud-claw (bcc)

自己部署一个属于我的龙虾——模块化可拼装的 AI Agent 对话框架。核心思路：每个能力是一个独立 npm 包，按需引入，不强制任何一种模型或存储方案。

---

## 包结构

```
packages/
├── foundation      核心类型 / 日志 / 错误 / 配置 / 接口定义
├── model-core      ModelAdapter 接口 + ModelRouter（故障转移 & 手动切换）
├── model-claude    Anthropic Claude 适配器（流式）
├── model-deepseek  DeepSeek 适配器（兼容 OpenAI 格式，流式）
├── conversation    ChatSession 多轮对话管理
├── memory-fs       文件系统会话持久化（无数据库依赖）
└── channel-cli     交互式命令行对话渠道（bcc-chat）

examples/
└── basic-chat      最小可运行示例
```

---

## 快速开始

### 1. 安装

需要 Node.js ≥ 20、pnpm ≥ 9。

```bash
# 克隆仓库
git clone <repo-url>
cd backer-cloud-claw

# 安装所有依赖
pnpm install

# 构建所有包
pnpm build
```

如果只想在自己项目中使用某几个包（待发布到 npm 后）：

```bash
pnpm add @bcc/conversation @bcc/model-claude @bcc/memory-fs
```

### 2. 配置 API Key

框架通过环境变量读取 Key，不写入任何配置文件：

```bash
# Anthropic Claude
export ANTHROPIC_API_KEY=sk-ant-...

# DeepSeek
export DEEPSEEK_API_KEY=sk-...
```

或者在代码中直接传入（适合多租户场景）：

```ts
new ClaudeAdapter({ apiKey: 'sk-ant-...' })
new DeepSeekAdapter({ apiKey: 'sk-...' })
```

---

## 用法

### 最简：单模型对话

```ts
import { ClaudeAdapter } from '@bcc/model-claude';
import { ChatSession } from '@bcc/conversation';

const session = new ChatSession({
  model: new ClaudeAdapter(),
  system: '你是一个简洁的助手，回复不超过两句话。',
});

const { text } = await session.chat('你好！');
console.log(text);

// 第二轮：历史自动携带
const { text: text2 } = await session.chat('我刚才说了什么？');
console.log(text2); // 模型能回答出"你好！"
```

### 流式输出

```ts
for await (const chunk of session.stream('写一首短诗')) {
  if (chunk.type === 'text') process.stdout.write(chunk.text ?? '');
}
```

### 故障转移（场景 A）

主模型不可用时自动切换到备用模型，调用方无感知：

```ts
import { ModelRouter } from '@bcc/model-core';
import { ClaudeAdapter } from '@bcc/model-claude';
import { DeepSeekAdapter } from '@bcc/model-deepseek';
import { ChatSession } from '@bcc/conversation';

const router = new ModelRouter({ enableFailover: true })
  .register(new ClaudeAdapter(), { priority: 0 })               // 主模型
  .register(new DeepSeekAdapter(), { priority: 1, fallback: true }); // 备用

const session = new ChatSession({ model: router });
await session.chat('你好'); // Claude 挂了自动用 DeepSeek
```

### 手动切换模型（场景 B）

同一个会话内，随时切换模型，历史完整保留：

```ts
const router = new ModelRouter()
  .register(new ClaudeAdapter())
  .register(new DeepSeekAdapter());

const session = new ChatSession({ model: router });

await session.chat('记住：今天是晴天');
console.log(session.currentModel); // claude:claude-sonnet-4-5

session.switchModel('deepseek:deepseek-chat');

const { text } = await session.chat('今天天气如何？');
// DeepSeek 能基于历史回答"今天是晴天"
console.log(session.currentModel); // deepseek:deepseek-chat
```

---

## 持久化历史（会话跨进程保留）

默认情况下历史仅保存在内存，进程退出后丢失。
使用 `@bcc/memory-fs` 可将历史存储到文件系统，**无需数据库**。

### 基本用法

```ts
import { ClaudeAdapter } from '@bcc/model-claude';
import { ChatSession } from '@bcc/conversation';
import { FileMemoryStore } from '@bcc/memory-fs';

// 数据存在哪里由你决定
const memory = new FileMemoryStore({
  dir: './data/sessions',             // 项目内目录
  // dir: process.env.BCC_SESSION_DIR, // 或读环境变量
  // dir: '/mnt/encrypted/sessions',   // 或加密盘
});

// 使用 ChatSession.create() 自动恢复历史
const session = await ChatSession.create({
  model: new ClaudeAdapter(),
  memory,
  sessionId: 'user-alice', // 会话唯一标识
});

await session.chat('继续上次的话题');
// 历史在每次 chat() 后自动保存，无需手动调用
```

### 查看存储的文件

每个会话存为一个独立 JSON 文件，可直接查看或备份：

```bash
cat ~/.bcc/sessions/user-alice.json
```

```json
{
  "sessionId": "user-alice",
  "updatedAt": "2026-03-04T10:00:00.000Z",
  "messages": [
    { "role": "user",      "content": "你好" },
    { "role": "assistant", "content": "你好！有什么可以帮你？" }
  ]
}
```

### 会话管理

```ts
// 列出所有已保存的会话
const ids = await memory.list();
console.log(ids); // ['user-alice', 'user-bob', ...]

// 删除会话
await memory.delete('user-alice');

// 查看文件存储路径（方便备份）
console.log(memory.storageDir);             // /path/to/sessions/
console.log(memory.pathFor('user-alice'));   // /path/to/sessions/user-alice.json
```

### 自定义存储后端

实现 `MemoryStore` 接口即可接入任意存储（Redis、SQLite、向量数据库等）：

```ts
import type { MemoryStore, Message } from '@bcc/foundation';

class MyRedisStore implements MemoryStore {
  async save(sessionId: string, messages: Message[]) { /* ... */ }
  async load(sessionId: string): Promise<Message[]> { /* ... */ }
  async list(): Promise<string[]> { /* ... */ }
  async delete(sessionId: string) { /* ... */ }
}

// 用法与 FileMemoryStore 完全一致
const session = await ChatSession.create({
  model: new ClaudeAdapter(),
  memory: new MyRedisStore(),
  sessionId: 'user-123',
});
```

---

## 命令行 Agent（bcc-chat）

`@bcc/channel-cli` 提供开箱即用的交互式命令行 Agent。

```bash
# 最简启动（默认 Claude，历史自动保存到 ~/.bcc/sessions/）
ANTHROPIC_API_KEY=sk-ant-... \
pnpm --filter @bcc/channel-cli exec tsx bin/bcc-chat.ts

# 使用 DeepSeek
DEEPSEEK_API_KEY=sk-... \
pnpm --filter @bcc/channel-cli exec tsx bin/bcc-chat.ts --model deepseek

# 双模型路由（Claude 主 + DeepSeek 故障转移）
ANTHROPIC_API_KEY=sk-ant-... DEEPSEEK_API_KEY=sk-... \
pnpm --filter @bcc/channel-cli exec tsx bin/bcc-chat.ts --model both

# 指定系统提示词和会话 ID
ANTHROPIC_API_KEY=sk-ant-... \
pnpm --filter @bcc/channel-cli exec tsx bin/bcc-chat.ts \
  --system "你是一个 Python 专家，回答要简洁" \
  --session python-tutor

# 自定义存储目录
ANTHROPIC_API_KEY=sk-ant-... \
pnpm --filter @bcc/channel-cli exec tsx bin/bcc-chat.ts \
  --session-dir ./my-sessions

# 禁用持久化（纯内存模式，退出后历史丢失）
ANTHROPIC_API_KEY=sk-ant-... \
pnpm --filter @bcc/channel-cli exec tsx bin/bcc-chat.ts --no-memory
```

**会话内可用命令：**

| 命令 | 说明 |
|---|---|
| `/help` | 显示所有命令 |
| `/clear` | 清空当前对话历史 |
| `/history` | 查看完整对话历史 |
| `/models` | 列出可用模型 |
| `/model <id>` | 切换到指定模型 |
| `/save` | 手动保存历史 |
| `/session` | 查看当前会话信息 |
| `/exit` 或 `Ctrl+C` | 退出 |

---

## 运行示例（代码验证）

```bash
# 无 API Key：结构验证模式（不发起真实请求）
pnpm --filter @bcc-examples/basic-chat exec tsx src/index.ts

# 有 API Key：真实对话
ANTHROPIC_API_KEY=sk-ant-... \
pnpm --filter @bcc-examples/basic-chat exec tsx src/index.ts
```

---

## 注意事项

### API Key 安全
- 始终通过环境变量传入，不要硬编码到代码或提交到 git
- `.env` 文件已在 `.gitignore` 中

### 会话数据安全
- `FileMemoryStore` 将历史以 JSON 明文存储，存储路径由你完全控制
- 如需加密：将 `dir` 指向加密盘，或实现自定义 `MemoryStore`
- 每个会话独立文件，方便单独删除或迁移

### Token 用量控制
- 多轮对话会将完整历史发送给模型，历史越长费用越高
- 用 `maxMessages` 限制保留条数：
  ```ts
  new ChatSession({ model, history: { maxMessages: 20 } })
  ```
- `session.clearHistory()` 手动清空（不影响持久化文件）

### 模型兼容性
- Claude 适配器：需要 `ANTHROPIC_API_KEY`，支持流式和工具调用
- DeepSeek 适配器：需要 `DEEPSEEK_API_KEY`，兼容 OpenAI API 格式

---

## 依赖一览

| 包 | 外部依赖 |
|---|---|
| `@bcc/foundation` | 无 |
| `@bcc/model-core` | 无 |
| `@bcc/model-claude` | `@anthropic-ai/sdk` |
| `@bcc/model-deepseek` | `openai`（仅用作 HTTP 客户端）|
| `@bcc/conversation` | 无 |
| `@bcc/memory-fs` | 无（仅 Node.js 内置 `fs/promises`）|
