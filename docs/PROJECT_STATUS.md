# backer-cloud-claw 项目状态归档

> 归档日期：2026-03-09
> 当前分支：`claude/openclaw-modular-design-qCmrv`

---

## 一、项目定位

**backer-cloud-claw** 是一个模块化 AI Agent 框架，定位是**引擎层 SDK**，而非直接面向用户的产品。上层产品（如 OpenClaw）通过接入本 SDK 对接飞书、企业微信等渠道，提供面向用户的对话体验。

```
上层产品（OpenClaw 等）
  └─ 飞书 Channel / 企业微信 Channel / Web Channel
         ↓ 调用
backer-cloud-claw SDK（本仓库）
  └─ 提供 Agent、记忆、模型路由、对话管理等核心能力
         ↓ 调用
底层模型服务（Claude / OpenAI / DeepSeek / 百炼 / 私有部署）
```

---

## 二、当前包结构

```
packages/
  foundation/          @bcc/foundation       基础类型、错误、日志、MemoryStore 接口
  model-core/          @bcc/model-core        ModelAdapter 接口、ModelRouter（故障转移）
  protocol-anthropic/  @bcc/protocol-anthropic  Claude 原生协议适配器
  protocol-openai/     @bcc/protocol-openai   OpenAI 兼容协议适配器（含 DeepSeek/百炼/私有）
  conversation/        @bcc/conversation      ChatSession 多轮对话管理
  memory-fs/           @bcc/memory-fs         文件系统会话持久化
  agent-engine/        @bcc/agent-engine      工具调用循环引擎、ToolRegistry
  agents/              @bcc/agents            BccAgent、AgentRegistry、NamedAgent 接口
  skills/              @bcc/skills            技能模板（builtin/user/project 三层）
  channel-cli/         @bcc/channel-cli       CLI 交互渠道（REPL + 4 个管理工具）
```

依赖层级（从底到顶，仅单向依赖）：

```
foundation
  └─ model-core
       ├─ protocol-anthropic
       ├─ protocol-openai
       └─ conversation / agent-engine / memory-fs
            └─ agents
                 └─ channel-cli（集成层）
```

---

## 三、已完成工作

### 3.1 P0 Bug 修复（commit: 676bd8d）

#### Bug-1：OpenAI 适配器完全不支持工具调用
**文件**：`packages/protocol-openai/src/adapter.ts`

修复三处独立错误：
- `stream()` 新增 `delta.tool_calls` 流式分片归并，正确构建 `ToolUseContent[]`
- `convertMessages()` 重写：`tool_result` → OpenAI `role:'tool'` 消息，`tool_use` → `tool_calls` 字段（原实现将所有工具历史过滤丢弃）
- 新增 `convertTools()`，将 `ToolDefinition[]` 映射为 OpenAI `ChatCompletionTool[]`

**影响**：修复前，所有 OpenAI/DeepSeek/百炼 模型的 Agent 工具调用完全无效。

#### Bug-2：AgentEngine 工具循环中途出错导致历史污染
**文件**：`packages/agent-engine/src/engine.ts`

- 在 `stream()` 入口保存 `snapshotLen`，catch 块改为 `this.history.length = snapshotLen` 全量回滚
- 修复前：`history.pop()` 仅移除最后一条；第 N≥2 次工具迭代出错后遗留 assistant/tool-result 消息，污染后续对话上下文

---

### 3.2 P1 架构重构（commit: b285075）

#### Issue-1：删除 foundation 死代码
- 删除 `foundation/src/config.ts`（`BccConfig` 从未被任何包引用，且指向错误的配置路径）

#### Issue-5：`Tool` 类型提升到基础层
- `Tool` 接口移入 `@bcc/foundation/src/types.ts`，与 `ToolDefinition` 同层
- `agent-engine/src/tool.ts` 改为从 foundation 导入并重新导出
- `@bcc/agents` 直接从 foundation 导入，去掉对 `@bcc/agent-engine` 的间接类型依赖

#### Issue-2：用 `RoutableModel` 接口消除 `instanceof ModelRouter`
- `model-core/src/adapter.ts` 新增 `RoutableModel` 接口（`currentModelId` / `switchTo` / `listModels`）和 `isRoutableModel()` 鸭子类型守卫
- `ChatSession` 和 `AgentEngine` 移除 `import { ModelRouter }`，改用类型守卫，对任意路由实现保持开放

#### Issue-4：`AgentRegistry` 解耦 `BccAgent`
- `agents/src/types.ts` 新增 `NamedAgent` 接口（`AgentInterface` + `def: AgentDef` + `asTool()` + `registerTool()`）
- `AgentRegistry` 全面改用 `NamedAgent`，移除对 `@bcc/agent-engine` 和 `BccAgent` 具体类的依赖

#### Issue-3：多 Agent 模式 CLI 参数透传
- `FileMemoryStore` 创建时传入 `maxMessages`，历史修剪对全模式生效
- 多 Agent 模式下若传入 `--system`，打印明确警告

---

## 四、原规划未完成工作

### P2 冗余问题（中优先级，不影响功能）

| 项 | 位置 | 说明 |
|---|---|---|
| 提供商预设表重复 | `bcc-chat.ts` + `bcc-init.ts` | 两处各维护一份，新增提供商需改两处，应提取到 `channel-cli/src/providers.ts` |
| `dumpHistory()` 重复 | `ChatSession` + `AgentEngine` | 实现一字不差，可提取到 foundation 工具函数 |
| `complete()` 模板重复 | Anthropic + OpenAI 两个适配器 | stream-to-string 收集逻辑相同，可提取为辅助函数 |

### P3 轻微问题（低优先级）

| 项 | 位置 | 说明 |
|---|---|---|
| `getPrimary()` 调用 `list()` 两次 | `agents/src/registry.ts:62` | 微小性能，一行可修 |
| `createAdapter()` 工厂在 CLI bin | `bcc-chat.ts` | 无法被其他渠道复用，应提取到 `channel-cli/src/` |
| ModelRouter 空时返回魔法字符串 `'none'` | `model-core/src/router.ts:67` | 边界情况，应抛出明确错误 |

---

## 五、产品愿景重新定义

> 本节记录 2026-03-09 与产品负责人对齐后的新方向，是后续开发的核心依据。

### 5.1 核心概念

**当前 `BccAgent` 定义的「Agent」概念与目标愿景存在根本性偏差。**

目标系统的核心隐喻是**公司与员工**，而非「工具调用链」：

| 概念 | 含义 |
|---|---|
| **Worker（员工）** | 有身份、职责、技能的 AI 实体，有自己的「大脑」（LLM）和记忆，能主动收发消息 |
| **Company（公司）** | Worker 的集合，提供协调机制（会议、工作流、汇报），对外表现为一个 Worker（递归组合）|
| **消息（Message）** | Worker 之间传递信息的载体，有发件人、收件人、时间戳、关联 Thread |
| **Thread（对话线索）** | 一次持续对话的消息流，可以是 1-1 私信或多人群组 |
| **渠道（Channel）** | 人类接入系统的方式：CLI、飞书、企业微信、Web API 等 |

### 5.2 关键特征

1. **消息传递，而非工具调用**
   Worker 之间的通信是双向消息（有 inbox/outbox），不是函数调用返回字符串。

2. **递归组合（Composite）**
   Company 和 Worker 共享同一个 `Participant` 接口（能收发消息、自我介绍）。
   Company 可以是更大 Company 的 Worker，无限嵌套。

3. **有序的工作流**
   消息按职级/职责路由：PM → PjM → Arch → BE/UI，不是扁平的广播。

4. **员工有持久身份**
   Worker 跨时间存在，能记住「我和张三上周讨论过什么」（关系记忆），而不只是当前会话。

### 5.3 记忆体系重定义

当前记忆实现（`FileMemoryStore`）本质是**会话历史暴力回放**，把所有历史消息原封不动塞回 context window，存在 token 成本线性增长、信息硬截断等问题。

完整的记忆体系应分三层：

```
工作记忆（Working Memory）
  当前 Thread 的实时消息流
  → 已有 FileMemoryStore 雏形，但无压缩/摘要

情节记忆（Episodic Memory）
  过去 Thread 的压缩摘要
  → 「2026-03，与 PM 讨论了登录功能，结论是用 OAuth」
  → 当前缺失，需会话结束后自动生成摘要并存储

语义记忆 / 知识库（Semantic Memory）
  向量化存储，按相关性检索
  → 「从所有历史中找与当前问题最相关的片段」
  → 当前缺失，需引入向量数据库（或本地嵌入方案）
```

---

## 六、新方向架构设计草案

### 6.1 核心接口

```typescript
// ─── 参与者（Worker 和 Company 共享的接口）───────────────────────────────

interface Participant {
  readonly id: string;
  readonly profile: ParticipantProfile;   // 身份：名字、职责、技能描述
  receive(message: Message): Promise<void>; // 收到消息后的处理
  describe(): string;                       // 自我介绍（供其他 Worker 了解）
}

interface ParticipantProfile {
  name: string;
  role: string;         // 例："产品经理"、"后端工程师"
  skills: string[];     // 例：["需求分析", "原型设计"]
  description: string;  // 详细描述，注入 system prompt
}

// ─── 消息 ──────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  threadId: string;           // 所属对话线索
  from: string;               // Participant.id
  to: string | string[];      // 收件人（单个或群组）
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ─── Worker（员工）─────────────────────────────────────────────────────────

interface Worker extends Participant {
  // 大脑：LLM 执行（复用现有 AgentEngine）
  think(context: WorkerContext): AsyncIterable<AgentChunk>;
  // 工具能力
  registerTool(tool: Tool): void;
  // 记忆
  readonly memory: WorkerMemory;
  // 消息收件箱（异步处理）
  readonly inbox: Mailbox;
}

// ─── Company（公司 / 组织）─────────────────────────────────────────────────

interface Company extends Participant {
  addMember(participant: Participant, role?: OrgRole): void;
  removeMember(id: string): void;
  getMembers(): Participant[];
  // 创建内部 Thread（群组会议）
  openThread(topic: string, members: string[]): Thread;
  // 工作流定义（可选）
  readonly workflow?: WorkflowDef;
}

// ─── Thread（对话线索）─────────────────────────────────────────────────────

interface Thread {
  id: string;
  topic: string;
  participants: string[];       // Participant.id 列表
  messages: Message[];
  status: 'active' | 'closed';
}
```

### 6.2 建议包结构（新增 / 重构）

```
packages/
  foundation/          @bcc/foundation   （已有，基本稳定）
    types.ts           + 新增 Message、Thread、Participant 基础类型
    memory.ts          + 新增 EpisodicStore、SemanticStore 接口

  model-core/          @bcc/model-core   （已有，稳定）

  protocol-*/          （已有，稳定）

  agent-engine/        @bcc/agent-engine （已有，稳定，作为 Worker 的「大脑」）

  memory-fs/           @bcc/memory-fs    （已有）
  memory-episodic/     @bcc/memory-episodic  【新包】
    - 会话结束后调用 LLM 自动生成摘要
    - 摘要存为结构化 JSON（时间 + 参与者 + 关键决策 + 摘要文本）
    - 提供按时间/参与者查询接口
  memory-semantic/     @bcc/memory-semantic  【新包，可选】
    - 本地向量嵌入（使用轻量嵌入模型）或调用 Embedding API
    - 提供 search(query, topK) 接口
    - 实现 SemanticStore 接口

  org/                 @bcc/org              【新包，核心重构】
    worker.ts          Worker 类（替代 BccAgent，基于 AgentEngine）
    company.ts         Company 类（实现 Composite 模式）
    thread.ts          Thread 管理（消息流、参与者、状态）
    mailbox.ts         Mailbox（收件箱，消息队列）
    router.ts          消息路由（按角色/层级）
    workflow.ts        工作流定义（DAG：PM→PjM→Arch→Dev）
    registry.ts        全局 Participant 注册表

  skills/              @bcc/skills       （已有，稳定）

  channel-cli/         @bcc/channel-cli  （已有，接入 Worker/Company 作为对话对象）
  channel-feishu/      @bcc/channel-feishu  【新包】（接入飞书 Bot API）
  channel-webhook/     @bcc/channel-webhook 【新包】（HTTP Webhook 通用接入）
```

### 6.3 消息流示例（产品需求→开发交付）

```
用户（通过 Channel）
  └─ 发送："做一个用户登录功能"
       ↓ 路由到
  产品经理 Worker（PM）
    LLM 分析 → 输出需求文档
       ↓ PM.send(to: PjM, content: 需求文档)
  项目经理 Worker（PjM）
    LLM 分析可行性 → 拆解任务
       ├─ PjM.send(to: Arch, content: 技术要求)
       └─ PjM.send(to: PM, content: "预计3周，可行")
  架构师 Worker（Arch）
    LLM 设计架构 → 输出接口文档 + 设计稿需求
       ├─ Arch.send(to: BE, content: 接口文档)
       └─ Arch.send(to: UI, content: 设计稿需求)
  后端 Worker（BE）
    LLM 实现 → 输出代码
  UI Worker（UI）
    LLM 设计 → 输出设计稿
```

### 6.4 记忆注入机制（新方向）

```
每次 Worker 开始处理消息时：

1. 从工作记忆加载当前 Thread 历史（当前 context）
2. 从情节记忆检索：「我和消息发件人的历史」「关于此话题的历史 Thread」
3. 从语义记忆检索：「与当前消息最相关的历史片段」（topK）
4. 将检索结果压缩注入 system prompt 或 context 头部

Thread 结束时：
5. 自动调用摘要 LLM，生成情节记忆条目
6. 重要决策/事实写入语义记忆
```

### 6.5 当前代码迁移策略

现有代码不需要大规模重写，而是**向上扩展**：

| 现有代码 | 新角色 | 迁移策略 |
|---|---|---|
| `AgentEngine` | Worker 的「大脑」 | 保持不变，作为 Worker 内部实现 |
| `BccAgent` | 过渡期兼容层 | 新增 `Worker` 类复用 AgentEngine，`BccAgent` 保留向后兼容 |
| `AgentRegistry` | Company 的成员表 | Company 内部复用 AgentRegistry，扩展递归能力 |
| `FileMemoryStore` | 工作记忆实现 | 保持不变，`memory-episodic` 在其上层封装 |
| `CliChannel` | 第一个 Channel 实现 | 对接新 `Worker`/`Company` 接口，保持 REPL 功能 |
| `NamedAgent` 接口 | 过渡期统一接口 | 新 `Participant` 接口稳定后，`NamedAgent` 可作为其子集 |

---

## 七、下一步行动建议

### 立即可做（不依赖架构重构）

1. **P2 冗余清理**：提供商预设表提取、`dumpHistory` / `complete()` 去重
2. **`createAdapter()` 提取**：从 bin 移到 `channel-cli/src/`，为未来多渠道复用准备
3. **EpisodicMemory 基础**：在 `memory-fs` 上增加「会话摘要」写入/读取接口，无需引入新包

### 中期（核心架构）

4. **新增 `@bcc/org` 包**：定义 `Participant`、`Worker`、`Company`、`Thread`、`Mailbox` 核心接口和实现
5. **消息路由器**：实现 `MessageRouter`（按 id/role 路由），替代当前的工具调用委托
6. **情节记忆包**：`@bcc/memory-episodic`，会话结束后自动摘要

### 长期（产品化）

7. **`@bcc/channel-feishu`**：飞书 Bot Channel 接入，接通上层产品
8. **工作流引擎**：`workflow.ts` 实现 DAG 式任务流转（PM→PjM→Arch→Dev）
9. **语义记忆**：`@bcc/memory-semantic`，向量检索历史

---

*本文档记录截止 2026-03-09，后续重大架构决策请同步更新此文件。*
