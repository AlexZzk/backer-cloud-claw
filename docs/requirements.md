# backer-cloud-claw 需求文档

> 版本：v0.1.0
> 日期：2026-03-04
> 状态：草稿

---

## 一、背景与目标

### 1.1 背景

OpenClaw 是目前最流行的开源自主 AI Agent 框架，已在 GitHub 获得超过 25 万 Star。它能够连接各类 IM 平台（微信、Telegram、飞书等），调用 AI 模型（Claude、GPT、DeepSeek 等），并通过技能（Skills）系统执行文件操作、代码执行、网页浏览等真实世界任务。

然而，OpenClaw 的原始架构是**一体化（Monolithic）**设计，所有组件高度耦合，存在以下痛点：

- 部署时必须安装全量依赖，不需要的模块也会占用资源
- 第三方平台适配器（如微信、QQ、飞书）与核心逻辑绑定，难以按需组合
- 社区贡献门槛高，添加新的平台支持需要深入理解整个系统
- 无法做到轻量化部署（例如：只需要一个纯 CLI 命令行 Agent）

### 1.2 目标

构建 **backer-cloud-claw**：一个基于 OpenClaw 核心思想的**模块化、可拼装 AI Agent 框架**。

核心设计原则：
- **按需组合**：用户只安装/启用自己需要的模块
- **零耦合核心**：核心引擎不依赖任何特定平台或模型
- **开放生态**：任何人都可以通过 Issue / PR 贡献新的平台适配器
- **向下兼容**：兼容 OpenClaw 的 Skills 格式，降低迁移成本

---

## 二、OpenClaw 原始架构拆解

### 2.1 OpenClaw 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw (原始)                       │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │ Channel      │    │   Gateway    │    │  Agent    │  │
│  │ Adapters     │───▶│  (WebSocket) │───▶│ Pipeline  │  │
│  │ (IM 平台)    │    │  ws://...    │    │           │  │
│  └──────────────┘    └──────────────┘    └─────┬─────┘  │
│                                                │        │
│  ┌──────────────┐    ┌──────────────┐    ┌─────▼─────┐  │
│  │   Memory     │    │   Skills     │    │   Model   │  │
│  │   System     │◀───│   Platform   │◀───│  Adapter  │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 核心模块逐一拆解

#### 模块 1：Channel Adapter（渠道适配器）

**原始功能：**
连接外部 IM 平台，将各平台消息格式统一转换为 OpenClaw 内部标准格式（规范化），并将 Agent 响应逆向转换发回对应平台。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| 消息接收器 (Monitor) | 监听平台消息（轮询/Webhook/长连接） |
| 消息规范化器 (Normalizer) | 将平台消息转为内部统一格式 `Message` |
| 消息发送器 (Sender) | 将 Agent 回复转回平台消息格式并发送 |
| 配对管理器 (Pairing Manager) | 处理平台授权/登录（如微信扫码登录） |
| 频道配置器 (Channel Config) | 每个渠道的白名单、DM策略、触发模式 |

**当前支持的平台（15+）：**
WhatsApp、Telegram、Slack、Discord、Google Chat、Signal、iMessage、BlueBubbles、IRC、Microsoft Teams、Matrix、飞书（Feishu）、LINE、Mattermost、Nextcloud Talk、Nostr、Synology Chat、Twitch、Zalo、WebChat

**与其他模块的依赖：**
- 发送消息 → Gateway（WebSocket RPC）
- 接收 Agent 响应 → Gateway（WebSocket RPC）

---

#### 模块 2：Gateway（网关/控制平面）

**原始功能：**
单一 WebSocket 服务器（默认 `ws://127.0.0.1:18789`），是整个系统的控制中枢，负责消息路由、会话管理、多 Agent 协调。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| WebSocket RPC Server | 核心通信总线，所有客户端通过此连接 |
| 消息路由器 (Router) | 将入站消息路由到正确的 Agent 会话 |
| 会话管理器 (Session Manager) | 管理 Agent 会话生命周期（创建/销毁/列表） |
| 配置管理器 (Config Manager) | 读写 `openclaw.json`，提供 `config.get/patch` RPC |
| 控制 UI (Control UI) | 内置 Web 管理界面（Canvas） |
| Cron 调度器 (Cron) | 定时任务管理（`cron.add/edit/run`） |

**RPC 方法完整列表：**
```
config.get / config.patch / config.apply
sessions.list / sessions.patch / sessions.delete
message.send / channels.list / pairing.approve
node.list / node.describe / node.invoke
cron.add / cron.edit / cron.run
```

---

#### 模块 3：Agent Pipeline（Agent 执行引擎）

**原始功能：**
核心 AI 处理循环。接收消息 → 加载上下文 → 调用模型 → 执行工具 → 流式响应 → 持久化历史。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| 会话路由 (Session Router) | 决定消息进入哪个会话（main/group/isolated） |
| 上下文加载器 (Context Loader) | 加载记忆、技能、系统提示（AGENTS.md/SOUL.md/TOOLS.md） |
| 工具执行器 (Tool Executor) | 解析并执行模型返回的工具调用 |
| 流式响应处理器 (Stream Handler) | 处理模型流式输出并回传渠道 |
| 历史持久化 (History Persister) | 将对话历史写入存储 |
| 错误处理 & 重试 | Tool 调用失败的处理逻辑 |

**三种会话模式：**
- `main`：默认主会话
- `group`：群组隔离会话
- `isolated`：完全独立的隔离会话

---

#### 模块 4：Model Adapter（模型适配器）

**原始功能：**
对接各种 AI 模型提供商，提供统一的调用接口，支持模型故障转移（Failover）。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| 统一模型接口 (Model Interface) | 标准化的 `complete(messages, tools)` 调用 |
| 流式输出处理 (Stream Parser) | 解析各提供商的流式响应格式差异 |
| 故障转移管理器 (Failover Manager) | 主模型失败时自动切换备用模型 |
| API Key 管理 | 安全存储和加载各提供商的密钥 |

**当前支持的模型提供商：**
| 提供商 | 模型示例 |
|--------|---------|
| Anthropic | Claude 3.5 Sonnet、Claude 3 Opus |
| OpenAI | GPT-4o、GPT-4 Turbo |
| DeepSeek | DeepSeek-V3、DeepSeek-R1 |
| Ollama | 本地部署任意开源模型 |
| Google | Gemini Pro、Gemini Flash |
| xAI | Grok |

---

#### 模块 5：Memory System（记忆系统）

**原始功能：**
双模式记忆架构，提供短期上下文保持和长期知识积累。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| 短期记忆 (Short-term Cache) | 内存缓存，72小时内保持上下文连贯性 |
| 长期记忆 - 结构化 (SQLite) | 持久化对话历史和结构化数据 |
| 长期记忆 - 非结构化 (Markdown) | 本地 Markdown 文件存储知识片段 |
| 记忆检索器 (Retriever) | 在上下文加载时检索相关记忆 |
| 记忆写入器 (Writer) | 对话结束后提取并写入长期记忆 |
| 工作区管理 (Workspace) | 管理 `~/.openclaw/agents/<agentId>/` 目录结构 |

---

#### 模块 6：Skills Platform（技能平台）

**原始功能：**
OpenClaw 的核心扩展机制，通过"技能"赋予 Agent 执行外部操作的能力（代码执行、文件操作、浏览器控制等）。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| 技能加载器 (Skill Loader) | 扫描并加载技能目录 |
| 技能解析器 (Skill Parser) | 解析 `SKILL.md` 的 YAML frontmatter |
| 技能注册表 (Skill Registry) | 维护可用技能列表，支持会话级快照 |
| 工具定义生成器 (Tool Def Generator) | 将技能转为模型可调用的工具定义 |
| 安装管理器 (Install Manager) | 处理技能依赖安装（npm/pip/brew） |
| ClawHub 客户端 | 连接技能市场，支持技能发现和下载 |

**技能目录优先级（高→低）：**
1. 工作区技能（`~/.openclaw/agents/<id>/skills/`）
2. 用户全局技能（`~/.openclaw/skills/`）
3. 内置捆绑技能（随 OpenClaw 发布）
4. 额外加载目录（配置文件指定）

---

#### 模块 7：Plugin System（插件系统）

**原始功能：**
比 Skills 更深层的扩展机制，允许注册新的 Channel、自定义 Tool、生命周期 Hook。

**包含子组件：**
| 子组件 | 说明 |
|--------|------|
| 插件发现器 (Discovery) | 通过 `package.json` 中 `openclaw` 字段发现插件 |
| 插件注册器 (Registrar) | 注册插件提供的 Channel/Tool/Hook |
| 生命周期管理 | `onStart / onMessage / onEnd` 等生命周期钩子 |
| 安全沙盒 (Security Sandbox) | 路径遍历防护，阻止插件访问根目录外资源 |

---

#### 模块 8：Configuration System（配置系统）

**原始功能：**
声明式配置体系，统一管理所有模块的配置。

**核心配置文件：**
```jsonc
// ~/.openclaw/openclaw.json
{
  "models": { ... },        // 模型配置
  "channels": { ... },      // 渠道配置
  "skills": { ... },        // 技能配置
  "memory": { ... },        // 记忆配置
  "gateway": { ... }        // 网关配置
}
```

**Prompt 注入文件：**
| 文件 | 用途 |
|------|------|
| `AGENTS.md` | Agent 行为定义 |
| `SOUL.md` | Agent 人格/价值观定义 |
| `TOOLS.md` | 可用工具说明 |

---

## 三、backer-cloud-claw 模块化设计

### 3.1 核心设计理念

```
"任何模块都可以独立使用，任何模块都可以与其他模块组合"
```

用一句话描述：**乐高积木式的 AI Agent 框架**。

### 3.2 模块层次图

```
┌─────────────────────────────────────────────────────────────────┐
│                    backer-cloud-claw                            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   【应用层 (App Layer)】                  │    │
│  │  CLI App  │  Web App  │  API Server  │  自定义 App      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ▲                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                【集成层 (Integration Layer)】              │    │
│  │  微信     │  QQ     │  飞书   │  钉钉  │  Telegram │ .. │    │
│  │  插件     │  插件   │  插件   │  插件  │  插件     │    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ▲                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  【核心层 (Core Layer)】                   │    │
│  │                                                         │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  │    │
│  │  │ Agent   │  │  Model  │  │ Memory  │  │  Skills  │  │    │
│  │  │ Engine  │  │ Adapter │  │ System  │  │ Platform │  │    │
│  │  └─────────┘  └─────────┘  └─────────┘  └──────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ▲                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                【基础层 (Foundation Layer)】               │    │
│  │  Event Bus  │  Config Manager  │  Logger  │  Storage   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 各模块包定义

#### @bcc/foundation（基础层）- 必选

所有其他模块的基础依赖，零外部依赖。

```
@bcc/foundation
├── event-bus/          # 内部事件总线（替代 WebSocket Gateway）
├── config/             # 配置加载、校验、热更新
├── logger/             # 统一日志
├── storage/            # 抽象存储接口（本地文件/SQLite/云存储）
└── types/              # 核心 TypeScript 类型定义
```

**关键类型定义：**
```typescript
// 统一消息格式
interface Message {
  id: string;
  from: string;          // 发送者标识
  channel: string;       // 来源渠道
  content: MessageContent;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// 统一工具调用格式
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

---

#### @bcc/agent-engine（Agent 执行引擎）- 核心必选

```
@bcc/agent-engine
├── pipeline/           # Agent 处理流水线
├── session/            # 会话管理（main/group/isolated）
├── context/            # 上下文加载（记忆+技能+系统提示）
├── tool-executor/      # 工具执行器
└── stream-handler/     # 流式响应处理
```

**最小化使用示例：**
```typescript
import { AgentEngine } from '@bcc/agent-engine';
import { ClaudeAdapter } from '@bcc/model-claude';

const agent = new AgentEngine({
  model: new ClaudeAdapter({ apiKey: '...' }),
});

const response = await agent.chat('你好，请帮我写一首诗');
```

---

#### @bcc/model-*（模型适配器）- 按需选一或多个

每个模型提供商对应一个独立包：

| 包名 | 对应提供商 |
|------|-----------|
| `@bcc/model-claude` | Anthropic Claude |
| `@bcc/model-openai` | OpenAI GPT 系列 |
| `@bcc/model-deepseek` | DeepSeek |
| `@bcc/model-gemini` | Google Gemini |
| `@bcc/model-ollama` | Ollama（本地模型） |
| `@bcc/model-xai` | xAI Grok |

**统一模型接口：**
```typescript
interface ModelAdapter {
  complete(params: CompletionParams): AsyncIterable<CompletionChunk>;
  getModelInfo(): ModelInfo;
}
```

---

#### @bcc/memory-*（记忆系统）- 按需选择

| 包名 | 说明 |
|------|------|
| `@bcc/memory-local` | 本地文件 + SQLite（默认，零依赖） |
| `@bcc/memory-redis` | Redis 支持（适合多实例部署） |
| `@bcc/memory-pg` | PostgreSQL 支持 |
| `@bcc/memory-rag` | 向量检索增强（接入向量数据库） |

---

#### @bcc/skills（技能平台）- 按需选择

```
@bcc/skills
├── loader/             # 技能文件加载（兼容 OpenClaw SKILL.md 格式）
├── registry/           # 技能注册表
├── bundled/            # 内置技能集合
│   ├── shell/          # Shell 命令执行
│   ├── file-ops/       # 文件操作
│   ├── browser/        # 网页浏览
│   ├── code-runner/    # 代码执行
│   └── http/           # HTTP 请求
└── marketplace/        # 技能市场客户端（兼容 ClawHub）
```

---

#### @bcc/channel-*（渠道适配器）- 按需选择，社区可扩展

这是**最重要的扩展点**，任何人都可以通过 PR 贡献新的渠道适配器。

**官方维护：**

| 包名 | 平台 | 状态 |
|------|------|------|
| `@bcc/channel-telegram` | Telegram | 计划中 |
| `@bcc/channel-discord` | Discord | 计划中 |
| `@bcc/channel-slack` | Slack | 计划中 |
| `@bcc/channel-cli` | 命令行（内置终端） | 计划中 |
| `@bcc/channel-http` | HTTP API（RESTful） | 计划中 |
| `@bcc/channel-websocket` | WebSocket | 计划中 |

**社区贡献（通过 Issue/PR 认领）：**

| 包名 | 平台 | 状态 |
|------|------|------|
| `@bcc/channel-wechat` | 微信 | 待认领 |
| `@bcc/channel-qq` | QQ | 待认领 |
| `@bcc/channel-feishu` | 飞书 | 待认领 |
| `@bcc/channel-dingtalk` | 钉钉 | 待认领 |
| `@bcc/channel-whatsapp` | WhatsApp | 待认领 |
| `@bcc/channel-line` | LINE | 待认领 |
| `@bcc/channel-teams` | Microsoft Teams | 待认领 |

**渠道适配器标准接口：**
```typescript
interface ChannelAdapter {
  name: string;
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  sendMessage(to: string, content: MessageContent): Promise<void>;
}
```

---

#### @bcc/gateway（网关）- 可选，多实例部署时使用

当需要管理多个 Agent 实例或提供 Web 管理界面时使用。

```
@bcc/gateway
├── ws-server/          # WebSocket RPC 服务器
├── router/             # 消息路由
├── session-manager/    # 会话管理
├── admin-ui/           # 管理界面（可选）
└── rpc-handlers/       # RPC 方法处理器
```

---

### 3.4 典型使用场景与拼装方案

#### 场景 A：最小化 CLI Agent（只要模型）

```bash
npm install @bcc/foundation @bcc/agent-engine @bcc/model-claude @bcc/channel-cli
```

```typescript
import { BCC } from '@bcc/foundation';
import { AgentEngine } from '@bcc/agent-engine';
import { ClaudeAdapter } from '@bcc/model-claude';
import { CliChannel } from '@bcc/channel-cli';

const app = new BCC()
  .useModel(new ClaudeAdapter({ apiKey: process.env.CLAUDE_API_KEY }))
  .useChannel(new CliChannel())
  .build();

await app.start();
```

---

#### 场景 B：微信机器人

```bash
npm install @bcc/foundation @bcc/agent-engine @bcc/model-deepseek @bcc/channel-wechat @bcc/memory-local
```

```typescript
const app = new BCC()
  .useModel(new DeepSeekAdapter({ apiKey: '...' }))
  .useChannel(new WechatChannel({ ... }))
  .useMemory(new LocalMemory())
  .build();
```

---

#### 场景 C：多平台统一 Agent（完整部署）

```bash
npm install @bcc/foundation @bcc/agent-engine \
  @bcc/model-claude @bcc/model-openai \
  @bcc/channel-telegram @bcc/channel-feishu @bcc/channel-dingtalk \
  @bcc/memory-local @bcc/skills @bcc/gateway
```

```typescript
const app = new BCC()
  .useModels([
    new ClaudeAdapter({ apiKey: '...' }),
    new OpenAIAdapter({ apiKey: '...', fallback: true }), // 故障转移
  ])
  .useChannels([
    new TelegramChannel({ token: '...' }),
    new FeishuChannel({ appId: '...', appSecret: '...' }),
    new DingTalkChannel({ ... }),
  ])
  .useMemory(new LocalMemory())
  .useSkills({ bundled: true, dir: './my-skills' })
  .useGateway({ port: 18789, adminUI: true })
  .build();
```

---

#### 场景 D：无 IM 的 HTTP API Agent

```bash
npm install @bcc/foundation @bcc/agent-engine @bcc/model-ollama @bcc/channel-http
```

适合作为后端 AI 服务，通过 HTTP 接口对外提供能力。

---

### 3.5 模块依赖关系

```
@bcc/foundation          （无依赖，基础）
    ↑
@bcc/agent-engine        （依赖 foundation）
    ↑                ↑              ↑
@bcc/model-*        @bcc/memory-*  @bcc/skills
    ↑
@bcc/channel-*      （依赖 foundation + agent-engine）
    ↑
@bcc/gateway        （可选，依赖所有核心模块）
```

---

## 四、社区贡献机制

### 4.1 渠道适配器贡献流程

1. **认领**：在 GitHub Issues 中找到对应平台的 Issue，评论认领
2. **开发**：按照 Channel Adapter 标准接口开发
3. **测试**：提供最小化集成测试
4. **文档**：提供 README.md（含配置说明和使用示例）
5. **PR**：提交 Pull Request，等待 Review

### 4.2 渠道适配器模板

```
packages/channel-{name}/
├── src/
│   ├── index.ts          # 导出 ChannelAdapter 实现
│   ├── types.ts          # 平台特有类型
│   ├── normalizer.ts     # 消息格式规范化
│   └── client.ts         # 平台 SDK 封装
├── tests/
│   └── integration.test.ts
├── package.json
└── README.md
```

### 4.3 Issue 标签约定

| 标签 | 说明 |
|------|------|
| `channel: wechat` | 微信渠道适配器 |
| `channel: qq` | QQ 渠道适配器 |
| `channel: feishu` | 飞书渠道适配器 |
| `model: xxx` | 模型适配器 |
| `skill: xxx` | 新技能 |
| `help wanted` | 欢迎贡献 |
| `good first issue` | 适合新手 |

---

## 五、项目结构（Monorepo）

```
backer-cloud-claw/
├── packages/
│   ├── foundation/         # @bcc/foundation
│   ├── agent-engine/       # @bcc/agent-engine
│   ├── model-claude/       # @bcc/model-claude
│   ├── model-openai/       # @bcc/model-openai
│   ├── model-deepseek/     # @bcc/model-deepseek
│   ├── model-gemini/       # @bcc/model-gemini
│   ├── model-ollama/       # @bcc/model-ollama
│   ├── memory-local/       # @bcc/memory-local
│   ├── memory-redis/       # @bcc/memory-redis
│   ├── skills/             # @bcc/skills
│   ├── channel-cli/        # @bcc/channel-cli
│   ├── channel-http/       # @bcc/channel-http
│   ├── channel-telegram/   # @bcc/channel-telegram
│   ├── channel-discord/    # @bcc/channel-discord
│   ├── channel-slack/      # @bcc/channel-slack
│   └── gateway/            # @bcc/gateway（可选）
├── apps/
│   ├── cli/                # 命令行应用（开箱即用）
│   └── web/                # Web 管理界面
├── docs/
│   ├── requirements.md     # 本文档
│   ├── architecture.md     # 详细架构设计
│   └── contributing.md     # 贡献指南
├── examples/
│   ├── minimal-cli/        # 最小化 CLI 示例
│   ├── wechat-bot/         # 微信机器人示例
│   └── multi-channel/      # 多渠道示例
├── package.json            # Monorepo 根配置（pnpm workspaces）
└── turbo.json              # Turborepo 构建配置
```

---

## 六、技术选型

| 方面 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型安全，与 OpenClaw 生态兼容 |
| 包管理 | pnpm + workspaces | Monorepo 最佳实践 |
| 构建工具 | Turborepo | 增量构建，适合 Monorepo |
| 运行时 | Node.js 20+ | 稳定的 LTS 版本 |
| 测试 | Vitest | 快速，ESM 友好 |
| 发布 | Changesets | 自动化版本管理和 CHANGELOG |

---

## 七、里程碑规划

### Phase 1：基础骨架（MVP）
- [ ] `@bcc/foundation` 基础层
- [ ] `@bcc/agent-engine` Agent 引擎
- [ ] `@bcc/model-claude` Claude 适配器
- [ ] `@bcc/channel-cli` CLI 渠道
- [ ] `@bcc/memory-local` 本地记忆
- [ ] 最小化 CLI 应用可运行

### Phase 2：模型生态
- [ ] `@bcc/model-openai`
- [ ] `@bcc/model-deepseek`
- [ ] `@bcc/model-ollama`
- [ ] 多模型故障转移

### Phase 3：渠道生态
- [ ] `@bcc/channel-telegram`
- [ ] `@bcc/channel-discord`
- [ ] `@bcc/channel-http`（HTTP API 模式）
- [ ] 社区渠道贡献框架建立

### Phase 4：技能与扩展
- [ ] `@bcc/skills` 内置技能
- [ ] Skills 市场对接
- [ ] `@bcc/gateway` 管理界面

### Phase 5：社区生态
- [ ] 文档站点
- [ ] 微信/飞书/钉钉等国内平台渠道（社区贡献）
- [ ] 插件市场

---

## 八、与 OpenClaw 的对比

| 特性 | OpenClaw（原始） | backer-cloud-claw |
|------|----------------|-------------------|
| 架构 | 一体化 Monolithic | 模块化 Modular |
| 最小部署 | 全量安装 | 仅安装所需模块 |
| 平台扩展 | 内部贡献 | 任何人通过 Issue/PR |
| 配置方式 | JSON 配置文件 | 代码优先 + 配置文件 |
| 技能兼容 | 原生 SKILL.md | 兼容 OpenClaw SKILL.md |
| 部署模式 | 单机 | 单机 + 分布式 |
| 定位 | 个人 AI 助手 | 可嵌入的 AI Agent SDK |

---

*文档持续更新中，欢迎通过 Issue 提出改进建议。*
