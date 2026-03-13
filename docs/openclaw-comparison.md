# backer-cloud-claw vs OpenClaw：对标分析

> 更新日期：2026-03-13
> 目标：以 OpenClaw 为参照，明确当前系统的差距与下一步路线

---

## 一、OpenClaw 核心特性概览

OpenClaw 是一个面向"自主 AI 代理"的框架，核心理念是给每个 Agent 真正的**身份感**、**记忆**、**个性**和**自主行为能力**。其主要设计如下：

### 1.1 基于 Markdown 文件的人格与记忆系统

OpenClaw 使用一组可选的 Markdown 文件描述 Agent 的身份和记忆，在每次会话启动时注入系统提示词：

| 文件 | 作用 |
|------|------|
| `SOUL.md` | 个性、价值观、行为风格、沟通准则（最核心） |
| `AGENTS.md` | 任务指令与行为规则 |
| `TOOLS.md` | Agent 能使用的工具能力描述 |
| `IDENTITY.md` | 对外表现、角色定位 |
| `USER.md` | 当前用户/雇主的背景信息 |
| `MEMORY.md` | 长期记忆：精华摘要，跨月持久 |

每天结束后，Agent 会将当日发生的事写入 `memory/YYYY-MM-DD.md`，并不断将关键内容提炼到 `MEMORY.md`。

**效果**：Agent 每次"醒来"时读取这些文件，即使对话历史清空，它也"记得"自己是谁、在做什么项目、用户的偏好是什么。

### 1.2 自主性（Autonomy）

- **心跳机制（Heartbeat）**：Agent 按配置的时间间隔主动唤醒，无需等待用户输入
- **主动任务执行**：唤醒后检查收件箱、查看待办任务、推进进行中的工作
- **定时工作流**：可配置在特定时间（如每天早上）执行固定任务（日报、周计划等）

### 1.3 技能成长（Skill Progression）

- Agent 在执行任务过程中记录"学到了什么"
- 通过 `MEMORY.md` 积累的经验影响后续行为
- 不同 workspace 可有不同 `SOUL.md`，Agent 因此有不同"专业化方向"

### 1.4 多 Agent 协作与身份级联

- 支持多 Agent 协作，各 Agent 有独立身份
- soul（哲学）、identity（表现）、configuration（能力）三层分离
- 最具体的定义覆盖全局默认，形成级联

---

## 二、当前系统（backer-cloud-claw v0.3.0）能力评估

### 2.1 已有、且对标良好的能力

| 能力 | 我们的实现 | 对比 OpenClaw |
|------|-----------|--------------|
| Worker 身份定义 | `WorkerProfile`（id/name/role/skills/description） | ✅ 有，但无独立 SOUL 文件 |
| 多 Worker 协作 | `call_worker` 工具 + `Company.send()` 路由 | ✅ 有，消息路由更系统化 |
| Worker 间层级/委托 | `call_worker` 支持 LLM 自主调用 | ✅ 有，与 OpenClaw 类似 |
| 心跳机制 | 每个 Worker 可配 `heartbeat`，被动/主动模式 | ✅ 已实现（v0.3.0） |
| Token 追踪 | 全链路 per-Worker token 统计 | ✅ 优于 OpenClaw |
| HTTP API + Web UI | REST + SSE + Vue3 前端 | ✅ 有，OpenClaw 也有类似 |
| 会话持久化 | `FileMemoryStore`（按 workerId 保存历史） | ⚠️ 有，但是"暴力回放"，无摘要 |
| 工具调用循环 | `AgentEngine` 支持多轮工具迭代 | ✅ 有 |

### 2.2 缺失或明显不足的能力

| 能力 | OpenClaw 的做法 | 我们现状 | 差距 |
|------|----------------|---------|------|
| **Worker 个性/灵魂文件** | `SOUL.md` 独立文件，每个 workspace 可定制 | 只有 `WorkerProfile.description` 字段 | ❌ 无文件驱动的人格系统 |
| **长期记忆（MEMORY.md）** | 自动从日志提炼精华，跨月持久 | `FileMemoryStore` 仅保存原始历史对话 | ❌ 无智能摘要与提炼 |
| **日记式情节记忆** | Agent 每天写 `memory/YYYY-MM-DD.md` | `memory-episodic` 包存在但未与 Worker 集成 | ⚠️ 基础存储有了，但无自动化写入 |
| **Worker 主动自主行为** | 心跳唤醒后能主动检查任务、推进工作 | 心跳仅发送"心跳消息"，Worker 不会主动规划 | ⚠️ 骨架有了，行为层缺失 |
| **技能成长机制** | MEMORY.md 积累经验，影响后续行为 | Skills 包只是静态模板，不会动态更新 | ❌ 无成长/进化机制 |
| **用户画像（USER.md）** | 记录用户习惯、偏好、背景 | 无 | ❌ 缺失 |
| **工作流引擎（DAG）** | 任务可在多 Agent 间流转，支持条件分支 | `call_worker` 是平铺委托，无 DAG | ⚠️ 基础有了，缺结构化流转 |
| **Inbox 智能处理** | 心跳时自动扫描并处理 inbox 消息 | Inbox 存在（`@bcc/messaging`），但自动扫描未接入 | ⚠️ 基础设施有了，未接通 |

---

## 三、差距分析：优先级排序

### P0 — 核心身份感：没有灵魂的 Worker 只是"配置项"

**问题**：我们的 Worker 只有一个 `description` 字符串，无法表达复杂的价值观、沟通风格、行为准则。

**OpenClaw 方案**：`SOUL.md` 文件，在每次会话启动时注入系统提示词。

**我们应该做的**：
- 为 Worker 支持 `soulFile` 配置项，指向一个 Markdown 文件路径
- Worker 启动时读取 `SOUL.md` 并拼入 system prompt
- 提供预设模板（职场专业型、创意型、技术精确型等）

---

### P1 — 智能记忆：让 Worker 真正"记住事情"

**问题**：当前 `FileMemoryStore` 是原始对话历史暴力回放。token 消耗随历史线性增长，且没有"知识提炼"。

**OpenClaw 方案**：
1. 日志（`memory/YYYY-MM-DD.md`）：每次对话结束后自动摘要写入
2. 长期记忆（`MEMORY.md`）：周期性提炼，只保留真正重要的内容

**我们应该做的**：
- `memory-episodic` 包已有存储层 (`FileEpisodicStore`) 和生成器 (`EpisodeGenerator`)，但未与 Worker 生命周期集成
- Worker 对话结束后，自动调用 `EpisodeGenerator` 生成摘要写入 episodic store
- Worker 启动时，从 episodic store 拉取最近 N 条摘要注入 context
- 长期维护一个 `MEMORY.md` 文件（由 LLM 定期提炼 episodic 记录）

---

### P2 — 主动自主：心跳不只是"发心跳消息"

**问题**：Worker 心跳目前只是向自己发一条消息，Worker 并不会真正主动思考和规划。

**OpenClaw 方案**：心跳唤醒 → 检查 inbox → 查看任务列表 → 推进未完成工作 → 主动发消息给相关 Worker

**我们应该做的**：
- 心跳触发时，Worker 执行一个"晨检流程"（Morning Routine）：
  1. 调用 `AsyncInboxService.getPendingMessages()` 获取未读消息
  2. 调用 `AsyncTaskService.list()` 获取待办任务
  3. 将上述信息拼入 prompt，让 LLM 决定下一步行动
  4. LLM 可以通过 `call_worker`、`post_message`、`update_task` 等工具主动执行

---

### P3 — 技能成长：Worker 应该越用越好

**问题**：Skills 包目前是静态模板（builtin/user/project 三层），Worker 无法在使用中"学习新技能"。

**OpenClaw 方案**：通过 MEMORY.md 积累的经验改变 Agent 的行为模式。

**我们应该做的**：
- 短期：Worker 的 episodic memory 可以记录"解决了什么问题、用了什么方法"
- 中期：LLM 周期性总结经验到 `MEMORY.md`，影响后续 system prompt
- 长期：Worker 可以自主新增 `user_skills`（写入 Skills 包的 user 层），沉淀为可复用的技能模板

---

## 四、与 OpenClaw 的架构对比总结

```
OpenClaw 架构                         backer-cloud-claw 架构
─────────────────────────────         ────────────────────────────────────
Agent                                 Worker
  SOUL.md      ← 个性文件               description (string)     ← 简陋
  IDENTITY.md  ← 身份文件               WorkerProfile            ← 结构化但无文件
  MEMORY.md    ← 长期记忆               (缺失)
  USER.md      ← 用户画像               (缺失)

心跳 → 主动扫描 inbox → 自主执行        心跳 → 发心跳消息 → Worker 被动响应

每日日记 → 自动提炼 → 长期记忆          FileMemoryStore → 暴力回放对话历史

技能来自 MEMORY.md 积累               技能来自静态配置文件

多 Agent 协作（平铺）                   call_worker 委托（平铺）
无 DAG 工作流引擎                        无 DAG 工作流引擎（两者都没有）
```

---

## 五、推荐实施路线

### 第一阶段（立即可做，影响最大）

1. **Worker SOUL 文件支持**
   - `WorkerProfile` 新增 `soulFile?: string`
   - Worker 启动时加载 `SOUL.md` 并注入 system prompt
   - 提供默认模板

2. **情节记忆接入 Worker 生命周期**
   - Worker 对话结束 → `EpisodeGenerator` 生成摘要 → `FileEpisodicStore.append()`
   - Worker 启动时注入最近 10 条 episodic 摘要

### 第二阶段（中期，提升自主性）

3. **心跳主动行为（Morning Routine）**
   - 心跳时自动执行 inbox 扫描 + 任务查看
   - 让 LLM 基于上下文自主决策下一步

4. **长期记忆（MEMORY.md 提炼）**
   - 周期性（如每日）调用 LLM 提炼 episodic 记录
   - 生成结构化 `MEMORY.md` 并持久化

### 第三阶段（长期，实现"一人公司"愿景）

5. **用户画像（USER.md）**
   - 记录用户/雇主的偏好、习惯、项目背景

6. **DAG 工作流引擎**
   - PM → PjM → Arch → BE/FE 的结构化任务流
   - 支持并行执行、条件分支、失败重试

7. **技能自动沉淀**
   - Worker 可以通过 LLM 自主写入 user_skills
   - Skills 从静态模板升级为动态可进化的知识库

---

## 六、结论

backer-cloud-claw 的**架构基础扎实**（消息路由、工具调用、token 追踪等优于 OpenClaw），但在 Worker 的**身份感、记忆深度、主动自主性**三个维度上与 OpenClaw 有明显差距。

差距的本质不是技术实现难度，而是**缺乏"让 Worker 成为真正有生命力的实体"的设计理念落地**：
- 没有灵魂文件（SOUL.md）
- 没有自动化的记忆积累
- 心跳是骨架但没有行为

按照第一、二阶段的路线，我们可以用相对小的工作量大幅缩短差距，让 Worker 真正接近 OpenClaw 中"有个性、有记忆、能自主"的 Agent 形态。
