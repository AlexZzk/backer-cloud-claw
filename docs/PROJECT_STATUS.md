# backer-cloud-claw 项目状态归档

> 归档日期：2026-03-09
> 当前分支：`claude/review-project-docs-B5jK0`

---

## 一、项目定位

**backer-cloud-claw** 是一个模块化 AI Agent 框架，定位是**引擎层 SDK**，而非直接面向用户的产品。上层产品（如 OpenClaw）通过接入本 SDK 对接飞书、企业微信等渠道，提供面向用户的对话体验。

```
上层产品（OpenClaw 等）
  └─ 飞书 Channel / 企业微信 Channel / Web Channel
         ↓ 调用
backer-cloud-claw SDK（本仓库）
  └─ 提供 Worker/Company 组织层、Agent 引擎、记忆、模型路由等核心能力
         ↓ 调用
底层模型服务（Claude / OpenAI / DeepSeek / 百炼 / 私有部署）
```

---

## 二、当前包结构

```
packages/
  foundation/          @bcc/foundation        基础类型、错误、日志、MemoryStore 接口
                                               + OrgMessage / OrgThread / Participant / TokenUsage / OrgEvent
  model-core/          @bcc/model-core         ModelAdapter 接口、ModelRouter（故障转移）
  protocol-anthropic/  @bcc/protocol-anthropic   Claude 原生协议适配器（含 token 提取）
  protocol-openai/     @bcc/protocol-openai    OpenAI 兼容协议适配器（含 DeepSeek/百炼，含 token 提取）
  conversation/        @bcc/conversation       ChatSession 多轮对话管理
  memory-fs/           @bcc/memory-fs          文件系统会话持久化
  agent-engine/        @bcc/agent-engine       工具调用循环引擎（含跨迭代 token 累加）
  agents/              @bcc/agents             BccAgent、AgentRegistry、NamedAgent 接口
  org/                 @bcc/org                Worker/Company/Thread/Mailbox/Router/TokenTracker
  skills/              @bcc/skills             技能模板（builtin/user/project 三层）
  channel-cli/         @bcc/channel-cli        CLI 交互渠道（REPL + 5 个管理工具）
```

依赖层级（从底到顶，仅单向依赖）：

```
foundation
  └─ model-core
       ├─ protocol-anthropic
       ├─ protocol-openai
       └─ conversation / agent-engine / memory-fs
            ├─ agents
            ├─ org  ←─ 新增（依赖 foundation + agent-engine）
            └─ channel-cli（集成层）
```

---

## 三、已完成工作

### 3.1 P0 Bug 修复

#### Bug-1：OpenAI 适配器完全不支持工具调用
**文件**：`packages/protocol-openai/src/adapter.ts`

修复三处独立错误：
- `stream()` 新增 `delta.tool_calls` 流式分片归并，正确构建 `ToolUseContent[]`
- `convertMessages()` 重写：`tool_result` → OpenAI `role:'tool'` 消息，`tool_use` → `tool_calls` 字段
- 新增 `convertTools()`，将 `ToolDefinition[]` 映射为 OpenAI `ChatCompletionTool[]`

**影响**：修复前，所有 OpenAI/DeepSeek/百炼 模型的 Agent 工具调用完全无效。

#### Bug-2：AgentEngine 工具循环中途出错导致历史污染
**文件**：`packages/agent-engine/src/engine.ts`

- 在 `stream()` 入口保存 `snapshotLen`，catch 块改为 `this.history.length = snapshotLen` 全量回滚
- 修复前仅 `history.pop()` 移除最后一条，第 N≥2 次工具迭代出错后遗留消息污染后续上下文

#### Bug-3：模块未找到崩溃（ERR_MODULE_NOT_FOUND）
**文件**：根目录 `package.json`

- `tsx` 直接运行 `.ts` 入口，但 workspace 依赖包需要编译后的 `dist/`
- 修复：`bcc-chat` / `bcc-worker` 脚本改为先 `turbo run build --filter=@bcc/channel-cli...` 再启动

#### Bug-4：配置读取丢弃 workers/agents 字段
**文件**：`packages/channel-cli/src/config.ts`

- `migrateFromLegacy()` 新格式分支返回时未透传 `agents` / `workers` 字段
- 导致 `bcc-worker add` 写入成功，但 `bcc-chat` 仍以普通模式启动
- 修复：`LegacyConfig` 接口添加 `agents?`/`workers?`，新格式分支用条件展开透传

---

### 3.2 P1 架构重构

#### 删除 foundation 死代码
- 删除 `foundation/src/config.ts`（`BccConfig` 从未被任何包引用）

#### `Tool` 类型提升到基础层
- `Tool` 接口移入 `@bcc/foundation/src/types.ts`，消除 `@bcc/agents` 对 `@bcc/agent-engine` 的间接依赖

#### 用 `RoutableModel` 接口消除 `instanceof ModelRouter`
- 新增 `RoutableModel` 接口和 `isRoutableModel()` 鸭子类型守卫
- `ChatSession` 和 `AgentEngine` 对任意路由实现保持开放

#### `AgentRegistry` 解耦 `BccAgent`
- 新增 `NamedAgent` 接口（`AgentInterface` + `def` + `asTool()` + `registerTool()`）
- `AgentRegistry` 全面改用 `NamedAgent`，移除对 `BccAgent` 具体类的依赖

#### 多 Agent 模式 CLI 参数透传
- `FileMemoryStore` 创建时传入 `maxMessages`，历史修剪对全模式生效

---

### 3.3 Worker 架构（新增 @bcc/org 包）

#### 核心概念实现

| 组件 | 文件 | 说明 |
|------|------|------|
| `Participant` 接口 | `foundation/src/types.ts` | Worker / Company 共享接口 |
| `WorkerProfile` | `foundation/src/types.ts` | 员工身份：id/name/role/skills/description/modelId |
| `OrgMessage` | `foundation/src/types.ts` | 组织层消息（from/to/threadId/tokenUsage） |
| `OrgThread` | `foundation/src/types.ts` | 对话线索 |
| `TokenUsage` | `foundation/src/types.ts` | token 消耗（inputTokens/outputTokens/totalTokens） |
| `OrgEvent` | `foundation/src/types.ts` | 可观测事件（消息/状态/token 事件） |
| `Worker` | `org/src/worker.ts` | 员工实现，静态 `Worker.create()` 工厂方法 |
| `Company` | `org/src/company.ts` | 组织容器，共享 TokenTracker + EventBus |
| `TokenTracker` | `org/src/token-tracker.ts` | 按 Worker 分类统计 token，支持全量/按 ID 查询 |
| `Mailbox` | `org/src/mailbox.ts` | 异步 FIFO 消息队列，单次处理保证 |
| `Router` | `org/src/router.ts` | 按 Participant ID 路由 OrgMessage |
| `ThreadManager` | `org/src/thread.ts` | Thread 生命周期管理 |

#### Worker 配置集成

- `WorkerConfig` 接口加入 `config.ts`（id/name/role/skills/description/modelId/primary）
- `BccConfig.workers` 字段可选，兼容无 Worker 的旧配置
- `WorkerSession` 适配器：包装 `@bcc/org Worker`，实现 `AgentInterface`，REPL 无感知切换

#### 全链路 Token 追踪

```
API 响应
  → protocol-anthropic/openai（提取 token 数）
  → AgentEngine（跨工具循环累加）
  → WorkerSession（Worker 级汇总）
  → TokenTracker（持久化记录）
  → REPL（每次回复显示 ↑输入 ↓输出 = 总计）
```

---

### 3.4 Worker CLI 工具（bcc-worker）

完整的交互式 Worker 管理工具，与 `bcc-agent` 风格一致：

```bash
pnpm bcc-worker list              # 列出所有 Worker + 统计
pnpm bcc-worker add               # 交互式创建（ID/名称/模型/角色/技能/描述/主Worker）
pnpm bcc-worker show <id>         # 详情 + System Prompt 全文
pnpm bcc-worker edit <id>         # 编辑，回车保持原值
pnpm bcc-worker delete <id>       # 删除，自动迁移 primary 标记
pnpm bcc-worker set-primary <id>  # 设置默认 Worker
```

---

### 3.5 REPL 多模式支持

三模式优先级系统（高 → 低）：

1. **Worker 模式**：`config.workers` 非空时自动启用，每个 Worker 独立 TokenTracker
2. **多 Agent 模式**：`config.agents` 非空时启用（旧版兼容保留）
3. **普通模式**：ModelRouter + ChatSession（默认回退）

新增会话命令：`/workers`（列出+统计）、`/worker <id>`（切换）、`/worker <id> <msg>`（单次委托）

---

## 四、未完成 / 待处理工作

### P2 冗余清理（不影响功能，中优先级）

| 项 | 位置 | 说明 |
|---|---|---|
| 提供商预设表重复 | `bcc-chat.ts` + `bcc-init.ts` | 各维护一份，应提取到 `channel-cli/src/providers.ts` |
| `dumpHistory()` 重复 | `ChatSession` + `AgentEngine` | 实现相同，可提取到 foundation 工具函数 |
| `complete()` 模板重复 | Anthropic + OpenAI 两个适配器 | stream-to-string 收集逻辑相同，可提取为辅助函数 |
| `createAdapter()` 工厂在 CLI bin | `bcc-chat.ts` | 无法被其他渠道复用，应提取到 `channel-cli/src/` |

### P3 轻微问题（低优先级）

| 项 | 位置 | 说明 |
|---|---|---|
| `getPrimary()` 调用 `list()` 两次 | `agents/src/registry.ts:62` | 微小性能，一行可修 |
| ModelRouter 空时返回魔法字符串 `'none'` | `model-core/src/router.ts:67` | 边界情况，应抛出明确错误 |

### 中期：情节记忆（@bcc/memory-episodic）

当前 `FileMemoryStore` 是工作记忆（暴力回放所有历史），缺少会话结束后的自动摘要：

- 会话结束后调用 LLM 生成结构化摘要（时间 + 参与者 + 关键决策 + 摘要文本）
- 下次对话时检索相关历史摘要注入 context
- 解决 token 成本随历史线性增长的问题

### 中期：飞书渠道（@bcc/channel-feishu）

- 接入飞书 Bot API，Worker 可通过飞书群接收消息、回复消息
- 实现 `Participant` 接口，对接现有 Company/Worker 架构
- 配合管理后台，可视化展示多 Worker 在飞书群中协作

### 长期：管理后台 / 可视化 UI

- 独立 Web 应用或桌面 App
- 可视化创建/编辑 Worker，查看 token 消耗仪表板
- 实时展示多 Worker 协作消息流（"看到员工在群里沟通工作"）
- Worker 下线/重启、工作流暂停/恢复等管理操作
- 技术基础：`OrgEvent` 事件总线（已实现），管理服务器订阅 Company.onEvent() 推送 WebSocket

### 长期：工作流引擎（workflow.ts）

- DAG 式任务流转：PM → PjM → Arch → BE/UI
- 支持条件分支、并行执行、失败重试
- 与 Thread 系统集成，每个工作流节点对应一个 Thread

### 长期：语义记忆（@bcc/memory-semantic）

- 本地向量嵌入或调用 Embedding API
- 提供 `search(query, topK)` 接口，按相关性检索历史片段
- 与情节记忆配合，构建完整三层记忆体系

---

## 五、产品愿景与核心概念

### 5.1 核心隐喻：公司与员工

目标系统的核心是**公司与员工**的组织协作模型：

| 概念 | 含义 |
|---|---|
| **Worker（员工）** | 有身份、职责、技能的 AI 实体，有自己的「大脑」（LLM）和记忆，能主动收发消息 |
| **Company（公司）** | Worker 的集合，提供协调机制，对外表现为一个 Worker（递归组合）|
| **消息（OrgMessage）** | Worker 之间传递信息的载体，有发件人、收件人、时间戳、关联 Thread |
| **Thread（对话线索）** | 一次持续对话的消息流，可以是 1-1 私信或多人群组 |
| **渠道（Channel）** | 人类接入系统的方式：CLI、飞书、企业微信、Web API 等 |

### 5.2 架构关键设计决策

1. **消息传递，而非工具调用**
   Worker 之间的通信是双向消息（有 inbox/outbox），不是函数调用返回字符串。

2. **递归组合（Composite Pattern）**
   Company 和 Worker 共享同一个 `Participant` 接口。Company 可以是更大 Company 的 Worker。

3. **Token 按模型独立计算**
   每个 Provider 从 API 原始响应提取 token 数（不估算），精确反映各模型实际消耗。未来可在 `WorkerConfig` 中加入 `pricePerMillionTokens` 实现费用估算。

4. **适配器模式兼容旧 REPL**
   `WorkerSession` 包装 `Worker`，实现 `AgentInterface`，REPL 代码无需修改即可支持 Worker 模式。

### 5.3 记忆体系（规划）

```
工作记忆（Working Memory）        ← 已有 FileMemoryStore（暴力回放，待优化）
情节记忆（Episodic Memory）       ← 未实现：会话结束后 LLM 自动摘要
语义记忆（Semantic Memory）       ← 未实现：向量检索历史相关片段
```

### 5.4 消息流示例（产品需求→开发交付）

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
    LLM 设计架构 → 输出接口文档
       ├─ Arch.send(to: BE, content: 接口文档)
       └─ Arch.send(to: UI, content: 设计稿需求)
```

---

## 六、代码迁移策略

现有代码不需要大规模重写，而是**向上扩展**：

| 现有代码 | 新角色 | 迁移策略 |
|---|---|---|
| `AgentEngine` | Worker 的「大脑」 | 保持不变，作为 Worker 内部实现 |
| `BccAgent` | 过渡期兼容层 | 新增 `Worker` 类复用 AgentEngine，`BccAgent` 保留向后兼容 |
| `AgentRegistry` | Company 的成员表 | Company 内部复用 AgentRegistry，扩展递归能力 |
| `FileMemoryStore` | 工作记忆实现 | 保持不变，`memory-episodic` 在其上层封装 |
| `CliChannel` | 第一个 Channel 实现 | 已对接新 Worker 接口（v0.2.0 完成） |
| `NamedAgent` 接口 | 过渡期统一接口 | 新 `Participant` 接口稳定后，`NamedAgent` 可作为其子集 |

---

*本文档记录截止 2026-03-09，后续重大架构决策请同步更新此文件。*
