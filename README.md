# backer-cloud-claw (bcc)

> 自己部署一个属于我的龙虾——模块化可拼装的 AI Agent 对话框架

---

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [初始化配置](#初始化配置-bcc-init)
- [开始对话](#开始对话-bcc-chat)
- [配置参考](#配置参考)
- [会话内命令](#会话内命令)
- [平台说明](#平台说明)
- [开发者：代码集成](#开发者代码集成)
- [模块说明](#模块说明)
- [常见问题](#常见问题)

---

## 特性

- **多模型支持**：Claude（Anthropic）、DeepSeek，可同时启用并自动故障切换
- **配置向导**：`bcc init` 一步完成设置，无需手动编辑配置文件
- **会话持久化**：对话历史自动保存到本地，重启后继续上次对话
- **工具调用（Agent 模式）**：注册自定义工具，让模型自动调用后继续回答
- **零外部依赖**：框架核心包均为纯 Node.js，无额外运行时要求
- **全平台支持**：macOS、Linux、Windows（CMD / PowerShell / Windows Terminal / Git Bash / WSL）

---

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | **20.0.0** | 需要 ES Modules 支持 |
| pnpm | **9.0.0** | 推荐包管理器（也可用 npm/yarn）|
| Git | 任意 | 克隆仓库 |

获取 API Key（至少需要其中一个）：

- **Claude**：[console.anthropic.com](https://console.anthropic.com/settings/keys)  →  Key 格式 `sk-ant-api03-...`
- **DeepSeek**：[platform.deepseek.com](https://platform.deepseek.com/api_keys)  →  Key 格式 `sk-...`

---

## 安装

```bash
# 1. 克隆仓库
git clone <repo-url>
cd backer-cloud-claw

# 2. 安装依赖
pnpm install

# 3. 构建所有包
pnpm build
```

---

## 初始化配置（bcc init）

首次使用请运行初始化向导，它会引导你完成所有配置并生成 `~/.bcc/config.json`：

```bash
pnpm bcc-init
```

向导将逐步引导你完成以下配置：

```
  ╔══════════════════════════════════════════════╗
  ║    bcc · backer-cloud-claw  v0.1.0          ║
  ║    初始化向导                                ║
  ╚══════════════════════════════════════════════╝

  欢迎！这个向导将引导你完成初次配置。
  配置保存至 ~/.bcc/config.json，可随时重新运行修改。
  按 Ctrl+C 随时退出。

  ── 步骤 1/4：AI 提供商 ──────────────────────────

  你想使用哪些 AI 提供商？
  ▶ 1) Claude（Anthropic）    强大、安全，适合通用任务和创意写作
    2) DeepSeek              高性价比，擅长代码和长文本推理
    3) 两者都启用             自动故障切换：Claude 优先，失败时切换到 DeepSeek

  请输入编号 [1]:

  ── 步骤 2/4：API Key ────────────────────────────

  Claude（Anthropic）API Key
  获取地址：https://console.anthropic.com/settings/keys
  Key 格式：sk-ant-api03-...

  输入 API Key（输入时显示 *）: ****************************
  ✓ Key 格式正确。

  ── 步骤 3/4：会话存储 ──────────────────────────

  ...（是否保存 / 存储路径 / 历史上限）

  ── 步骤 4/4：确认 ──────────────────────────────

  ┌────────────────────────────────────────────────┐
  │  提供商      Claude（Anthropic）               │
  │  Claude Key  sk-ant-api03...****               │
  │  会话存储    ~/.bcc/sessions                   │
  │  历史上限    50 条                             │
  └────────────────────────────────────────────────┘

  是否保存以上配置？(Y/n):

  ✓ 配置已保存至 ~/.bcc/config.json
```

### 重新配置

随时重新运行向导修改配置（现有配置会预填充为默认值）：

```bash
pnpm bcc-init
```

---

## 开始对话（bcc chat）

初始化完成后，直接启动：

```bash
pnpm bcc-chat
```

可用选项（均为可选，不填则读取配置文件的值）：

```
选项：
  --model <id>          覆盖模型：claude | deepseek | both
  --session <id>        会话 ID（默认：default）
  --system <prompt>     覆盖系统提示词
  --no-memory           本次不保存历史（临时禁用持久化）
  --session-dir <dir>   覆盖会话存储目录
  --max-messages <n>    覆盖历史消息上限
  --help, -h            显示帮助
```

示例：

```bash
# 使用默认配置开始对话
pnpm bcc-chat

# 临时切换到 DeepSeek（不修改配置文件）
pnpm bcc-chat --model deepseek

# 指定角色和独立会话
pnpm bcc-chat --system "你是一个 Python 专家，回答要简洁" --session python-tutor

# 临时禁用保存（本次对话不写磁盘）
pnpm bcc-chat --no-memory

# 获取帮助
pnpm bcc-chat --help
```

---

## 配置参考

### 配置文件（`~/.bcc/config.json`）

由 `bcc init` 自动生成，也可手动编辑：

```json
{
  "version": "1",
  "providers": {
    "claude": {
      "apiKey": "sk-ant-api03-..."
    },
    "deepseek": {
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "provider": "claude",
    "enableMemory": true,
    "sessionDir": "/Users/yourname/.bcc/sessions",
    "maxMessages": 50
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `providers.claude.apiKey` | string | Claude API Key |
| `providers.deepseek.apiKey` | string | DeepSeek API Key |
| `defaults.provider` | `"claude"` \| `"deepseek"` \| `"both"` | 默认提供商 |
| `defaults.enableMemory` | boolean | 是否启用会话持久化 |
| `defaults.sessionDir` | string（绝对路径） | 会话文件存储目录 |
| `defaults.maxMessages` | number（0=无限制） | 历史消息上限 |

> **安全说明**：配置文件在 macOS/Linux 上会自动设置权限 `600`（仅当前用户可读）。
> Windows 下文件位于用户主目录（`C:\Users\<用户名>\.bcc\config.json`），
> 请确保只有当前用户有访问权限。

### 环境变量（覆盖配置文件）

适合 CI/CD 或不想修改配置文件的场景：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API Key（优先级高于配置文件） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（优先级高于配置文件） |
| `BCC_SESSION_DIR` | 会话存储目录（优先级高于配置文件） |

### 优先级

```
CLI 参数 > 环境变量 > 配置文件 > 内置默认值
```

---

## 会话内命令

在对话界面中，输入斜杠命令控制行为：

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有命令 |
| `/clear` | 清空当前对话历史 |
| `/history` | 查看完整对话历史 |
| `/models` | 列出当前可用模型 |
| `/model <id>` | 切换到指定模型（需启用多模型路由） |
| `/save` | 手动立即保存历史 |
| `/session` | 查看会话信息（模型 / 历史条数） |
| `/exit` 或 `Ctrl+C` | 退出 |

---

## 平台说明

### macOS

推荐使用 [Homebrew](https://brew.sh/) 安装 Node.js 和 pnpm：

```bash
brew install node pnpm
```

首次配置：

```bash
pnpm bcc-init
pnpm bcc-chat
```

### Linux

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 安装 Node.js：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
npm install -g pnpm
```

首次配置：

```bash
pnpm bcc-init
pnpm bcc-chat
```

### Windows

**推荐方案（按优先级）：**

1. **Windows Terminal + PowerShell**（现代 Windows 自带）

   安装 Node.js：https://nodejs.org/en/download/

   ```powershell
   npm install -g pnpm
   pnpm bcc-init
   pnpm bcc-chat
   ```

2. **WSL 2**（Windows Subsystem for Linux）

   在 WSL 内按 Linux 流程操作，体验与 Linux 完全一致。

3. **Git Bash**

   使用 [Git for Windows](https://git-scm.com/download/win) 自带的 Bash：

   ```bash
   pnpm bcc-init
   pnpm bcc-chat
   ```

**Windows 注意事项：**

- API Key 输入时密码遮蔽功能在 Windows Terminal / PowerShell / Git Bash 中正常工作
- 在极旧版本的 CMD.exe 中，密码输入会自动降级为明文显示（功能正常，仅无遮蔽）
- 配置文件位置：`C:\Users\<用户名>\.bcc\config.json`
- 会话文件位置：`C:\Users\<用户名>\.bcc\sessions\`

---

## 开发者：代码集成

如果你想在自己的项目中以编程方式使用 bcc 组件：

### 简单对话

```ts
import { ClaudeAdapter } from '@bcc/model-claude';
import { ChatSession } from '@bcc/conversation';

const session = await ChatSession.create({
  model: new ClaudeAdapter({ apiKey: 'sk-ant-...' }),
  system: '你是一个简洁的助手，回复不超过两句话。',
});

const { text } = await session.chat('你好！');
console.log(text);

// 第二轮：历史自动携带
const { text: text2 } = await session.chat('我刚才说了什么？');
```

### 流式输出

```ts
for await (const chunk of session.stream('写一首短诗')) {
  if (chunk.type === 'text') process.stdout.write(chunk.text ?? '');
}
```

### 双模型路由（故障切换）

```ts
import { ModelRouter } from '@bcc/model-core';
import { ClaudeAdapter } from '@bcc/model-claude';
import { DeepSeekAdapter } from '@bcc/model-deepseek';

const router = new ModelRouter({ enableFailover: true })
  .register(new ClaudeAdapter(),   { priority: 0 })               // 主模型
  .register(new DeepSeekAdapter(), { priority: 1, fallback: true }); // 备用

const session = await ChatSession.create({ model: router });
await session.chat('你好'); // Claude 挂了自动用 DeepSeek
```

### Agent 模式（工具调用）

```ts
import { AgentEngine } from '@bcc/agent-engine';
import { ClaudeAdapter } from '@bcc/model-claude';

const calculatorTool = {
  definition: {
    name: 'calculator',
    description: '计算数学表达式，返回结果',
    inputSchema: {
      type: 'object' as const,
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  handler: async ({ expression }: Record<string, unknown>) =>
    String(Function(`"use strict"; return (${expression})`)()),
};

const engine = await AgentEngine.create({
  model: new ClaudeAdapter({ apiKey: 'sk-ant-...' }),
  tools: [calculatorTool],
  contextFiles: ['./AGENTS.md'],  // 可选：从文件加载系统提示
  maxIterations: 10,
});

const answer = await engine.chat('2 的 10 次方是多少？');
// 模型自动调用 calculator 工具后回答："2 的 10 次方是 1024。"

// 流式（实时看到工具调用过程）
for await (const chunk of engine.stream('计算 fibonacci(10)')) {
  if (chunk.type === 'text')        process.stdout.write(chunk.text ?? '');
  if (chunk.type === 'tool_call')   console.log(`\n⚙ 调用 ${chunk.tool}:`, chunk.input);
  if (chunk.type === 'tool_result') console.log(`✓ 结果: ${chunk.result}`);
}
```

### 持久化历史

```ts
import { FileMemoryStore } from '@bcc/memory-fs';

const memory = new FileMemoryStore({ dir: '~/.bcc/sessions' });

const session = await ChatSession.create({
  model: new ClaudeAdapter({ apiKey: '...' }),
  memory,
  sessionId: 'user-alice',
});
// 历史在每次 chat() 后自动保存
```

自定义存储后端（Redis、SQLite 等）——实现 `MemoryStore` 接口即可：

```ts
import type { MemoryStore, Message } from '@bcc/foundation';

class MyRedisStore implements MemoryStore {
  async save(id: string, msgs: Message[]) { /* ... */ }
  async load(id: string): Promise<Message[]> { /* ... */ }
  async list(): Promise<string[]> { /* ... */ }
  async delete(id: string) { /* ... */ }
}
```

---

## 模块说明

```
packages/
├── foundation      核心类型 / 错误 / 接口定义（AgentInterface、AgentChunk 等）
├── model-core      ModelAdapter 接口 + ModelRouter（故障转移 & 手动切换）
├── model-claude    Anthropic Claude 适配器（流式 + 工具调用）
├── model-deepseek  DeepSeek 适配器（兼容 OpenAI 格式，流式）
├── conversation    ChatSession 多轮对话管理（无工具调用）
├── agent-engine    AgentEngine 执行引擎（工具调用循环 + 上下文文件加载）
├── memory-fs       文件系统会话持久化（无数据库依赖）
└── channel-cli     交互式命令行对话渠道（bcc-init + bcc-chat）

examples/
└── basic-chat      最小可运行示例
```

| 包 | 外部依赖 |
|---|---|
| `@bcc/foundation` | 无 |
| `@bcc/model-core` | 无 |
| `@bcc/model-claude` | `@anthropic-ai/sdk` |
| `@bcc/model-deepseek` | `openai`（仅用作 HTTP 客户端）|
| `@bcc/conversation` | 无 |
| `@bcc/agent-engine` | 无 |
| `@bcc/memory-fs` | 无（仅 Node.js 内置 `fs/promises`）|
| `@bcc/channel-cli` | 无（仅 Node.js 内置 `readline`）|

---

## 常见问题

**Q：运行 `pnpm bcc-chat` 提示"未找到 API Key"**

A：有两种解决方案：
1. 运行 `pnpm bcc-init` 完成初始化配置（推荐）
2. 设置环境变量：`ANTHROPIC_API_KEY=sk-ant-... pnpm bcc-chat`

---

**Q：Windows 上输入 API Key 时密码没有被遮蔽**

A：在极旧版本的 CMD.exe 中，`stdin.setRawMode()` 不可用，会自动降级为明文输入。
推荐使用 Windows Terminal、PowerShell 或 Git Bash，均支持密码遮蔽。

---

**Q：如何查看或修改配置文件？**

```bash
# 查看
cat ~/.bcc/config.json

# 重新配置（向导）
pnpm bcc-init

# 直接编辑（高级用户）
# macOS/Linux:
nano ~/.bcc/config.json

# Windows PowerShell:
notepad $env:USERPROFILE\.bcc\config.json
```

---

**Q：如何彻底清除所有数据？**

```bash
# macOS/Linux:
rm -rf ~/.bcc

# Windows PowerShell:
Remove-Item -Recurse -Force $env:USERPROFILE\.bcc
```

---

**Q：对话历史文件在哪里？**

默认存储在 `~/.bcc/sessions/<会话ID>.json`。

每个会话是独立的 JSON 文件，可以直接查看、备份或删除：

```bash
# 查看所有会话
ls ~/.bcc/sessions/

# 查看具体会话内容
cat ~/.bcc/sessions/default.json

# 删除某个会话
rm ~/.bcc/sessions/default.json
```

---

**Q：Token 费用怎么控制？**

- 使用 `--max-messages <n>` 限制历史长度（默认 50 条）
- 开始新话题时用 `/clear` 清空历史
- 简单测试时用 `--no-memory` 避免积累长历史

---

**Q：如何在构建后全局安装 bcc 命令？**

```bash
# 构建完成后，从项目根目录：
pnpm build
cd packages/channel-cli
npm link

# 之后就可以全局使用：
bcc-init
bcc-chat
```
