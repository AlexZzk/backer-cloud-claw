# backer-cloud-claw (bcc)

> 自己部署一个属于我的龙虾——模块化可拼装的 AI Agent 对话框架

---

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [使用模式](#使用模式)
  - [CLI 模式](#cli-模式)
  - [Web UI 模式](#web-ui-模式)
- [Worker 多员工协作](#worker-多员工协作)
- [配置参考](#配置参考)
- [模块说明](#模块说明)
- [开发者：代码集成](#开发者代码集成)
- [常见问题](#常见问题)

---

## 特性

- **多模型支持**：Claude（Anthropic）、DeepSeek、阿里百炼（Qwen），可同时启用并自动故障切换
- **Worker 多员工协作**：定义有职责和技能的 AI 员工，员工之间可真实委托任务
- **Web UI**：浏览器界面，支持实时流式对话、会话管理，对接真实 HTTP API
- **HTTP API**：REST + SSE 接口，零额外运行时依赖（纯 Node.js 内置模块）
- **配置向导**：`bcc-init` 一步完成设置，无需手动编辑配置文件
- **会话持久化**：对话历史自动保存到本地，重启后继续上次对话
- **工具调用（Agent 模式）**：注册自定义工具，让模型自动调用后继续回答
- **全链路 Token 追踪**：每个 Worker 独立统计 token 消耗，精确到每次调用

---

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | **20.0.0** | 需要 ES Modules 支持 |
| pnpm | **9.0.0** | 推荐包管理器 |
| Git | 任意 | 克隆仓库 |

获取 API Key（至少需要其中一个）：

- **Claude**：[console.anthropic.com](https://console.anthropic.com/settings/keys)
- **DeepSeek**：[platform.deepseek.com](https://platform.deepseek.com/api_keys)
- **阿里百炼**：[bailian.console.aliyun.com](https://bailian.console.aliyun.com/)

---

## 快速开始

```bash
# 1. 克隆仓库
git clone <repo-url>
cd backer-cloud-claw

# 2. 安装依赖并构建
pnpm install
pnpm build

# 3. 初始化配置（交互式向导）
pnpm bcc-init

# 4A. 启动 CLI 对话
pnpm bcc-chat

# 4B. 或启动 Web UI（需要两个终端）
pnpm bcc-server          # 终端 1：HTTP API
pnpm --filter @bcc/web dev  # 终端 2：前端，访问 http://localhost:5173
```

详细步骤见 [docs/install.md](docs/install.md)。

---

## 使用模式

### CLI 模式

```bash
pnpm bcc-chat
```

进入交互式 REPL，支持多轮对话、工具调用、Worker 切换。

可用选项：

```
--worker <id>         启动时指定默认 Worker
--model <id>          覆盖模型
--session <id>        会话 ID（默认：default）
--system <prompt>     覆盖系统提示词
--no-memory           本次不保存历史
--help, -h            显示帮助
```

**会话内命令：**

| 命令 | 说明 |
|------|------|
| `/workers` | 列出所有 Worker 及 token 消耗 |
| `/worker <id>` | 切换到指定 Worker |
| `/worker <id> <消息>` | 向指定 Worker 发送一条消息（不切换） |
| `/history` | 查看对话历史 |
| `/clear` | 清空本次历史 |
| `/session` | 显示当前会话信息 |
| `/exit` | 退出 |

### Web UI 模式

需要同时启动 HTTP 服务器和前端开发服务器：

```bash
# 终端 1
pnpm bcc-server
# → 监听 http://localhost:3000

# 终端 2
pnpm --filter @bcc/web dev
# → 访问 http://localhost:5173
```

Web UI 功能：
- 多 Worker 切换，实时流式对话
- 工具调用过程可视化
- 多会话管理（每个 Worker 可创建多个独立会话）
- Worker 信息展示（技能、绑定模型等）

---

## Worker 多员工协作

Worker 是有身份、职责和技能的 AI 实体，多个 Worker 组成一个 Company（组织）。

```bash
# 创建 Worker
pnpm bcc-worker add

# 管理 Worker
pnpm bcc-worker list
pnpm bcc-worker show <id>
pnpm bcc-worker edit <id>
pnpm bcc-worker delete <id>
pnpm bcc-worker set-primary <id>
```

多个 Worker 存在时，每个 Worker 自动获得 `call_worker` 工具，允许 LLM 将子任务委托给其他 Worker：

```
用户 → PM Worker → call_worker(coder, "实现登录接口") → coder Worker → 返回结果 → PM Worker → 用户
```

---

## 配置参考

配置文件位于 `~/.bcc/config.json`，由 `pnpm bcc-init` 自动生成：

```json
{
  "version": "1",
  "models": [
    {
      "id": "claude",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-...",
      "model": "claude-opus-4-6",
      "isPrimary": true
    },
    {
      "id": "deepseek",
      "provider": "openai",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-...",
      "model": "deepseek-chat",
      "isFallback": true
    }
  ],
  "workers": [
    {
      "id": "pm",
      "name": "产品经理",
      "role": "product_manager",
      "modelId": "claude",
      "description": "负责需求分析和产品规划",
      "skills": ["需求分析", "产品规划"],
      "primary": true
    }
  ],
  "defaults": {
    "enableMemory": true,
    "sessionDir": "~/.bcc/sessions",
    "maxMessages": 50
  }
}
```

| 字段 | 说明 |
|------|------|
| `models[].id` | 模型实例唯一 ID（供 Worker 引用） |
| `models[].provider` | `anthropic` / `openai`（兼容 DeepSeek/百炼） |
| `models[].isPrimary` | 是否为默认模型 |
| `models[].isFallback` | 是否作为故障切换备用模型 |
| `workers[].id` | Worker 唯一 ID |
| `workers[].modelId` | 引用 models 中的模型实例 |
| `workers[].primary` | 是否为主 Worker（默认接收用户消息） |
| `defaults.maxMessages` | 历史消息上限（0 = 无限制） |

### 环境变量（覆盖配置文件）

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `BCC_SESSION_DIR` | 会话存储目录 |

---

## 模块说明

```
packages/
├── foundation          核心类型 / 错误 / 接口定义（Tool、OrgMessage、Participant 等）
├── model-core          ModelAdapter 接口 + ModelRouter（故障转移）
├── protocol-anthropic  Claude 原生协议适配器（流式 + 工具调用 + token 提取）
├── protocol-openai     OpenAI 兼容适配器（DeepSeek/百炼，流式 + 工具调用）
├── conversation        ChatSession 多轮对话管理
├── agent-engine        AgentEngine 工具调用循环引擎
├── memory-fs           文件系统会话持久化（无数据库依赖）
├── memory-episodic     情节记忆（占位，待实现）
├── agents              BccAgent、AgentRegistry、NamedAgent 接口
├── org                 Worker/Company/Thread/Mailbox/Router/TokenTracker
├── skills              技能模板（builtin/user/project 三层）
├── channel-cli         CLI 渠道（bcc-chat REPL + bcc-worker 管理 + call_worker 委托）
├── channel-http        HTTP/SSE API 服务器（供 Web 前端使用，零额外依赖）
└── web                 Vue 3 + Pinia Web 管理前端（Vite 构建）
```

| 包 | 外部依赖 |
|---|---|
| `@bcc/foundation` | 无 |
| `@bcc/model-core` | 无 |
| `@bcc/protocol-anthropic` | `@anthropic-ai/sdk` |
| `@bcc/protocol-openai` | `openai`（仅作 HTTP 客户端）|
| `@bcc/conversation` | 无 |
| `@bcc/agent-engine` | 无 |
| `@bcc/memory-fs` | 无（仅 Node.js 内置 `fs/promises`）|
| `@bcc/org` | 无 |
| `@bcc/skills` | 无 |
| `@bcc/channel-cli` | 无（仅 Node.js 内置 `readline`）|
| `@bcc/channel-http` | 无（仅 Node.js 内置 `http`）|
| `@bcc/web` | Vue 3、Pinia、Vite |

---

## 开发者：代码集成

### 简单对话

```ts
import { AnthropicAdapter } from '@bcc/protocol-anthropic';
import { ChatSession } from '@bcc/conversation';

const session = await ChatSession.create({
  model: new AnthropicAdapter({ apiKey: 'sk-ant-...' }),
  system: '你是一个简洁的助手，回复不超过两句话。',
});

const { text } = await session.chat('你好！');
console.log(text);
```

### Agent 模式（工具调用）

```ts
import { AgentEngine } from '@bcc/agent-engine';
import { AnthropicAdapter } from '@bcc/protocol-anthropic';

const engine = await AgentEngine.create({
  model: new AnthropicAdapter({ apiKey: 'sk-ant-...' }),
  tools: [{
    definition: {
      name: 'calculator',
      description: '计算数学表达式',
      inputSchema: {
        type: 'object' as const,
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
    },
    handler: async ({ expression }: Record<string, unknown>) =>
      String(Function(`"use strict"; return (${expression as string})`)()),
  }],
  maxIterations: 10,
});

const answer = await engine.chat('2 的 10 次方是多少？');
// 模型自动调用 calculator 工具后回答："1024"
```

### Worker 组织模式

```ts
import { Company } from '@bcc/org';
import { Worker } from '@bcc/org';
import { AnthropicAdapter } from '@bcc/protocol-anthropic';

const model = new AnthropicAdapter({ apiKey: 'sk-ant-...' });
const company = new Company();

const pm = await Worker.create({
  profile: { id: 'pm', name: '产品经理', role: 'pm', skills: [], description: '负责需求' },
  model,
  company,
});

// 发消息给 Worker
const thread = company.openThread('main', ['pm']);
const replies = await company.send('pm', '分析这个需求：用户登录功能', thread.id);
console.log(replies[0].content);
```

### 双模型路由（故障切换）

```ts
import { ModelRouter } from '@bcc/model-core';
import { AnthropicAdapter } from '@bcc/protocol-anthropic';
import { OpenAICompatAdapter } from '@bcc/protocol-openai';

const router = new ModelRouter({ enableFailover: true })
  .register(new AnthropicAdapter({ apiKey: 'sk-ant-...' }), { priority: 0 })
  .register(new OpenAICompatAdapter({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-...' }), { priority: 1, fallback: true });

const session = await ChatSession.create({ model: router });
await session.chat('你好'); // Claude 挂了自动用 DeepSeek
```

---

## 常见问题

**Q：运行 `pnpm bcc-chat` 提示"未找到 API Key"**

运行 `pnpm bcc-init` 完成初始化，或设置环境变量：`ANTHROPIC_API_KEY=sk-ant-... pnpm bcc-chat`

**Q：Web 页面显示"服务离线"**

确保 `pnpm bcc-server` 已在另一个终端运行（默认端口 3000）。

**Q：两个 Worker 之间消息没有真正传递**

v0.3.0 已修复。多 Worker 时系统自动为每个 Worker 注入 `call_worker` 工具，LLM 可通过工具调用把任务委托给其他 Worker，委托结果作为工具返回值传回。

**Q：如何查看 token 消耗？**

CLI：在 REPL 中输入 `/workers`
每次回复后也会显示本次消耗：`↑350 ↓128 = 478 tokens`

**Q：如何彻底清除所有数据？**

```bash
# macOS/Linux:
rm -rf ~/.bcc

# Windows PowerShell:
Remove-Item -Recurse -Force $env:USERPROFILE\.bcc
```

**Q：配置文件在哪里？**

`~/.bcc/config.json`（macOS/Linux）或 `C:\Users\<用户名>\.bcc\config.json`（Windows）。
