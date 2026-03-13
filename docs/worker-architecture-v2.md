# Worker 架构设计 v2.0

> 文档版本：2026-03-13
> 状态：**已确认，待实施**
> 目标：将 Worker 重构为真正具备身份感、主动性、记忆、成长能力的"AI 员工"基础类

---

## 一、设计理念

### 核心隐喻：Worker 是真实员工

一个员工具备以下本质特征：

1. **有身份**：有名字、职责、个性、价值观
2. **能沟通**：可以和上级（用户）、同事（其他 Worker）、团队（群聊）交互
3. **有状态**：空闲、忙碌、休眠……不同状态下行为不同
4. **主动行事**：不需要每次都等人叫，会自己检查任务、推进工作
5. **有记忆**：记得以前发生了什么、学到了什么
6. **会成长**：通过反思和学习，技能和个性都会随时间演进
7. **受约束**：只能做被授权的事，危险操作必须经过审批

### 易用性原则

- 完全不懂代码的用户，可以通过 **Web UI** 完成所有 Worker 配置
- 有技术能力的用户，可以直接修改 **配置文件（YAML）**
- 两种方式完全等价，互相同步

---

## 二、总体架构

```
Worker
│
├── Base Layer（核心层，每个 Worker 必须具备）
│   ├── Identity          身份
│   ├── Brain             大脑（LLM + AgentEngine）
│   ├── Communication     通信（1:1 用户、1:1 Worker、群聊）
│   ├── Lifecycle         生命周期状态机
│   └── Observability     可观测性（与用户账号关联）
│
├── Capability Layer（能力层，可选插件，按需组合）
│   ├── Proactivity       主动性
│   ├── Task              任务管理
│   ├── Memory            记忆
│   ├── Soul              灵魂/个性
│   ├── Reflection        反思
│   └── SkillEvolution    技能进化
│
├── Permission Layer（权限层）
│   ├── DelegationScope   委托权限（我能把任务交给谁）
│   ├── ToolAccess        工具访问白名单
│   └── PrivilegeLevel    特权等级
│
└── Governance（治理层）
    ├── AuditorWorker     审核员 Worker
    └── AdminUser         管理员（真实用户，最终决策者）
```

---

## 三、Base Layer（核心层）

所有 Worker 无条件拥有，不可省略。

### 3.1 Identity（身份）

```typescript
interface WorkerIdentity {
  id: string;           // 唯一标识，如 "pm"
  name: string;         // 显示名称，如 "产品经理 Alice"
  role: string;         // 职责描述，如 "负责需求分析和产品规划"
  avatar?: string;      // 头像（UI 展示用）
  createdAt: number;    // 创建时间
  privilegeLevel: 'normal' | 'elevated' | 'auditor';  // 特权等级
}
```

### 3.2 Brain（大脑）

- 底层：LLM 模型（Claude / DeepSeek / 百炼，可配置）
- 引擎：AgentEngine（支持工具调用循环）
- 每个 Worker 有独立的 LLM 配置，可使用不同模型

### 3.3 Communication（通信）

Worker 支持三种通信模式：

#### 模式 A：Worker ↔ 用户（1:1）
- Worker 与真实用户的私信对话
- 无需审批，直接通信

#### 模式 B：Worker ↔ Worker（1:1）
- Worker 之间的协作通信（委托任务、请示、汇报）
- **全程对管理员（Admin）可见**（透明管理，不是拦截）
- 其中涉及高危操作的指令，需经审核员审批后才可执行

#### 模式 C：群聊（Group Chat）
- 由**用户创建**群聊，选择邀请哪些 Worker 加入
- 用户可以 @特定Worker 或 @所有人 发送消息/任务
- Worker 在群里响应 @自己 的消息，也可主动在群里汇报进展

```
通信权限矩阵：
                发起方
                User  Worker
接收方  User      ✅     ✅（透明可见）
       Worker    ✅     ✅（透明可见）
       Group     ✅     ✅（仅限成员）
```

### 3.4 Lifecycle（生命周期状态机）

```
          heartbeat / message
sleeping ──────────────────→ idle
                               │ 收到消息/任务
                               ↓
                           processing
                               │ 完成
                               ↓
                             idle ←── 队列有待处理消息时自动继续
                               │ 主动进入休眠
                               ↓
                           sleeping
```

| 状态 | 说明 | 收到消息时的行为 |
|------|------|--------------|
| `idle` | 空闲，可立即响应 | 立即处理 |
| `processing` | 正在处理其他任务 | 放入消息队列 |
| `sleeping` | 主动休眠 | 放入队列，等心跳或唤醒 |
| `blocked` | 等待审批 | 放入队列，审批完成后继续 |

### 3.5 Observability（可观测性）

- **Token 统计**：每次对话精确统计输入/输出 token，按 Worker 分类
- **审计日志**：所有权限申请、审批结果、高危操作记录，永久保存
- **事件总线**：每个 Worker 行为对应用户账号可见的事件流
- **状态可视化**：Web UI 实时展示每个 Worker 的当前状态

---

## 四、Capability Layer（能力层）

可选插件，通过配置文件或 Web UI 按需启用。

### 扩展依赖关系

```
Reflection ──────────────────→ Memory.Episodic（反思结果要存储）
SkillEvolution ──────────────→ Reflection（学习由反思触发）
Proactivity.Routine ─────────→ Task（晨检需要读任务列表）
Memory.LongTerm ─────────────→ Memory.Episodic（长期记忆从情节提炼）
Soul ─────────────────────────→ （无依赖，独立）
```

**启动时自动检查**：若启用的能力缺少依赖，系统拒绝启动并给出明确报错。

---

### 4.1 Proactivity（主动性）

Worker 能自发行动，无需等待外部触发。

```yaml
proactivity:
  heartbeat: "0 9 * * *"    # Cron 表达式（每天 9:00 唤醒）
  routine:                   # 唤醒后执行的晨检流程
    - checkInbox             # 扫描未读消息
    - reviewTasks            # 查看待办任务
    - planDay                # LLM 基于上述信息规划今日工作
    - notify                 # 主动给相关 Worker 发通知
```

**依赖**：`Task`（晨检需要任务列表）

---

### 4.2 Task（任务管理）

Worker 维护自己的待办列表，可以将任务安排进日程。

```
任务生命周期：
  收到任务 → 加入 TaskList → Scheduler 排期 → 执行 → 完成/转交
```

- 任务可以从消息中自动提取（LLM 解析）
- 任务可以手动在 UI 中创建并分配给 Worker
- 任务状态：`pending` / `in-progress` / `blocked` / `done` / `delegated`

---

### 4.3 Memory（记忆）

三层记忆体系：

| 层级 | 名称 | 说明 | 存储位置 |
|------|------|------|---------|
| L1 | Working Memory | 当前对话 context（**Base 层已有**） | 内存 |
| L2 | Episodic Memory | 每次对话结束后自动摘要 | `~/.bcc/episodes/{workerId}.json` |
| L3 | Long-term Memory | 从情节提炼的精华，跨月持久 | `~/.bcc/workers/{workerId}/MEMORY.md` |

**Memory 配置示例：**
```yaml
memory:
  episodic: true          # 开启情节记忆
  longTerm: true          # 开启长期记忆
  contextWindow: 10       # 启动时注入最近 N 条情节摘要
  consolidateInterval: "0 23 * * *"   # 每天 23:00 提炼长期记忆
```

**依赖**：`Memory.LongTerm` 依赖 `Memory.Episodic`

---

### 4.4 Soul（灵魂/个性）

Worker 的个性、价值观、行为风格。

```
文件结构：
~/.bcc/workers/{workerId}/
  ├── SOUL.md       个性、价值观、沟通风格、行为准则
  └── USER.md       关于用户/雇主的背景（可选）
```

**SOUL.md 的生命周期：**
- **创建时**：用户手动编写（UI 提供引导模板）
- **使用时**：Worker 每次启动自动注入 system prompt
- **成长时**：若 Worker 启用了 `Reflection`，可以自主更新 SOUL.md（有 Changelog）

**UI 提供预设模板：**
- 职场专业型（formal-professional）
- 技术精确型（technical-precise）
- 创意型（creative）
- 执行型（task-executor，无个性，机械完成指令）

---

### 4.5 Reflection（反思）

Worker 通过反思更新自我认知（改变"我是谁"）。

**两种触发方式：**

#### A. 自主反思（Self-Initiated）
- 触发时机：任务完成后、每日定时
- 内容：我做得好/不好的地方？下次可以如何改进？
- 结果：写入 Episodic Memory，可能触发 SOUL.md 更新

#### B. 接收外部反馈（Feedback Inbox）
- 来源：用户直接给的建议、其他 Worker 在群里的评价
- 流程：
  ```
  收到反馈 → Worker LLM 评估"是否采纳" → 接受/拒绝 → 记录决策理由
                                              ↓ 接受
                                         更新 SOUL.md
  ```
- Worker **有权拒绝**反馈，但必须记录拒绝理由（可观测性）

**反思不会直接触发技能变化**，技能变化由 `SkillEvolution` 处理。

**依赖**：`Memory.Episodic`

---

### 4.6 SkillEvolution（技能进化）

Worker 的能力工具箱可以随时间增长。

**技能分层：**

| 层级 | 名称 | 可见范围 | 可修改方 |
|------|------|---------|---------|
| Builtin | 内置技能（系统提供） | 所有 Worker | 系统维护 |
| Shared | 团队技能（用户创建/晋升） | 所有 Worker | 用户 + 审核员审批 |
| Private | 私有技能（Worker 自主演进） | **仅创建者本人** | Worker 自己（有 Changelog） |

**技能申请流程（获取新技能）：**
```
Worker 识别能力缺口（Reflection 触发）
  ↓
创建"技能申请"（描述：需要什么、为什么需要）
  ↓
Auditor Worker 审核（中风险：自主审批）
  ↓ 若涉及系统权限
Admin（用户）最终审批
  ↓ 通过
技能加入 Worker 的 PrivateSkills
```

**私有技能晋升为团队技能：**
- 触发方：**Worker 主动向 Admin 提建议**（"我的这个技能可能对团队有价值"）
- 流程：Worker 提建议 → Admin 在 UI 中查看私有技能内容 → Admin 决策是否提升为 Shared
- 私有技能默认**不可被其他 Worker 读取**，提升才能共享

**依赖**：`Reflection`（反思触发技能需求识别）

---

## 五、Permission Layer（权限层）

### 5.1 委托权限（Delegation Scope）

**初始化阶段**：Worker 不知道可以委托给谁。有三种方式获得指导：
1. **直接问 Admin**："这个任务应该交给谁？"
2. **读取 Skill 文件**：存在描述组织结构的 Skill（如 `org-chart` 技能）
3. **历史经验**：通过 Episodic Memory 逐步学习委托关系

**配置（Company 层，非 Worker 层）：**
```yaml
company:
  delegationGraph:
    pm:   [pjm, arch]          # PM 可委托给 PjM 和 Arch
    pjm:  [be, fe, qa]
    arch: [be, fe]
    be:   []                   # 开发不再向下委托
    fe:   []
    qa:   []
```

**规则：**
- 默认不允许越级委托（PM 不能直接委托给 BE）
- 下级可以向上级"请示"（不是委托，是提问）
- 委托图在 UI 中以可视化组织架构图展示和编辑

### 5.2 工具访问（Tool Access）

- Worker 创建时配置初始工具白名单
- 初始之外的工具需通过技能申请流程获得
- 工具按风险等级分类（见第六章治理层）

### 5.3 特权等级

| 等级 | 适用对象 | 特殊权限 |
|------|---------|---------|
| `normal` | 普通 Worker | 仅执行白名单工具 |
| `elevated` | 高级 Worker | 可自主审批低风险申请 |
| `auditor` | 审核员 | 可审批中/高风险，上报 Admin |

---

## 六、Governance（治理层）

### 6.1 危险操作分级

| 风险等级 | 示例 | 执行条件 |
|---------|------|---------|
| ⬜ 无风险 | 读取文件、查询 API、对话 | Worker 直接执行 |
| 🟡 低风险 | 写文件（workspace 内）、发消息 | Worker 直接执行 |
| 🟠 中风险 | 新增技能申请、调用外部服务 | Auditor 自主审批 |
| 🔴 高风险 | `rm` 删除、写 Shell 脚本、外网请求 | Auditor 上报 → Admin 审批 |
| 🚫 紧急阻断 | 修改审核员配置、修改权限系统 | 直接阻断 + 立即告警 Admin |

### 6.2 Auditor Worker（审核员）

审核员本质是一个 Worker，但有特殊约束：

**特殊权限：**
- 可以审批中/高风险操作申请
- 可以看到所有 Worker 间通信（透明审计）
- 高风险操作结果必须上报 Admin

**约束（防止被攻破）：**
- SOUL.md 由 Admin 直接维护，**不允许其他 Worker 通过反馈修改**
- Reflection 能力**不允许开启**（防止被"说服"改变价值观）
- SkillEvolution **不允许开启**（能力固定，防止自我扩权）
- 所有审批操作写入**不可篡改的审计日志**

**人类不在线时的策略（已确认：选项 A）：**
- 高风险操作：进入等待队列，任务标记为 `blocked`，**不超时、不自动失败**
- Admin 上线后，审批中心集中展示所有待审批项
- 可预配置"快速白名单"：指定路径/操作不需审批（如 `rm ./tmp/` 内文件）

**Auditor 数量：**
- **由用户自行配置**，可以是一个或多个
- 多 Auditor 场景：任意一个 Auditor 审批通过即可执行（不要求全员同意）
- 高危操作（需上报 Admin）：任何 Auditor 均可发起上报，Admin 最终决策

### 6.3 Admin（管理员/你）

- 最终决策权：高风险操作审批、私有技能晋升、组织架构调整
- 所有 Worker 间通信透明可见（不是干预，是可见）
- 可以通过 UI 实时查看每个 Worker 的状态、任务、审计日志

---

## 七、配置格式示例

### 完整 Worker 配置（YAML）

```yaml
# ~/.bcc/config.yaml

company:
  delegationGraph:
    pm:   [pjm, arch]
    pjm:  [be, fe, qa]
    arch: [be, fe]

workers:
  - id: pm
    name: 产品经理 Alice
    role: 负责需求分析、用户调研、产品规划
    model: claude-opus-4-6
    privilegeLevel: normal

    capabilities:
      soul:
        file: ./workers/pm/SOUL.md
        userContext: ./workers/pm/USER.md

      memory:
        episodic: true
        longTerm: true
        contextWindow: 10
        consolidateInterval: "0 23 * * *"

      proactivity:
        heartbeat: "0 9 * * *"
        routine: [checkInbox, reviewTasks, planDay]

      task: true

      reflection:
        selfReflect: true          # 任务结束后自主反思
        feedbackInbox: true        # 接受外部反馈

      skillEvolution:
        privateSkills: true        # 允许生成私有技能
        canShareRequest: true      # 允许申请公开私有技能

    tools:                         # 初始工具白名单
      - search
      - read_file
      - call_worker

  - id: auditor
    name: 审核员
    role: 审核 Worker 的权限申请和高危操作，维护系统安全
    model: claude-sonnet-4-6
    privilegeLevel: auditor

    capabilities:
      soul:
        file: ./workers/auditor/SOUL.md
        # 注意：reflection 和 skillEvolution 不允许开启

    tools:
      - approve_request
      - reject_request
      - notify_admin
      - read_audit_log
```

### Web UI 等效配置

UI 中每个字段对应上述 YAML 的一个配置项，通过表单填写，保存后自动同步到 config.yaml。

---

## 八、UI 交互规划（非技术用户视角）

### Worker 创建向导（5步）

```
Step 1: 基本信息    → 名字、职责、头像
Step 2: 选择能力    → 开关列表（主动性/任务/记忆/灵魂/反思/学习）
Step 3: 设置个性    → SOUL.md 模板选择 + 自定义编辑
Step 4: 权限配置    → 工具白名单、委托关系（可视化组织架构图）
Step 5: 确认创建    → 预览 + 启动
```

### 主要 UI 视图

| 视图 | 功能 |
|------|------|
| 员工列表 | 所有 Worker 状态、当前任务、今日 Token 消耗 |
| 组织架构图 | 可视化委托关系，拖拽编辑 |
| 消息中心 | 所有 Worker 间通信记录（Admin 透明可见） |
| 任务看板 | 每个 Worker 的任务列表，Kanban 视图 |
| 审批中心 | 待审批的权限申请、高危操作 |
| 审计日志 | 所有操作历史，不可篡改 |
| 技能库 | Builtin / Shared / 各 Worker 私有技能管理 |

---

## 九、实施路线

### 第一阶段：重构 Worker Base Layer

**目标**：Worker 有完整的身份、状态机、可观测性

- [ ] 重写 `Worker` 接口和基础实现
- [ ] 实现状态机（idle/processing/sleeping/blocked）
- [ ] 升级 Communication（1:1 用户、1:1 Worker 可见性标记、群聊）
- [ ] 完善 Observability（审计日志接口）
- [ ] 实现扩展依赖检查机制

### 第二阶段：实现 Capability 插件系统

**目标**：能力按需组合，配置驱动

- [ ] 设计 `Capability` 接口和注册机制
- [ ] 实现 `Soul`（SOUL.md 加载 + 注入 system prompt）
- [ ] 实现 `Memory`（Episodic 接入 Worker 生命周期 + LongTerm 提炼）
- [ ] 实现 `Task`（TaskList + Scheduler）
- [ ] 实现 `Proactivity`（Heartbeat + MorningRoutine 升级）
- [ ] 实现 `Reflection`（自主反思 + 反馈接受/拒绝）
- [ ] 实现 `SkillEvolution`（私有技能 + 申请流程）

### 第三阶段：实现 Permission + Governance

**目标**：安全可信的 Worker 生态

- [ ] 实现危险操作拦截中间件（工具调用前的风险评估）
- [ ] 实现 Auditor Worker 特殊约束
- [ ] 实现审批流程（申请 → 审核 → 结果通知）
- [ ] 实现不可篡改审计日志
- [ ] 委托图配置 + 越级检查

### 第四阶段：Web UI 升级

**目标**：非技术用户可独立使用

- [ ] Worker 创建向导
- [ ] 组织架构图可视化编辑
- [ ] 消息中心（透明通信视图）
- [ ] 审批中心
- [ ] 审计日志视图

---

## 十、待明确的设计决策

> 在实施前需要最终确认以下两个问题：

### D1：私有技能晋升为团队技能 ✅ 已确认

**Worker 主动向 Admin 提建议** → Admin 在审批中心查看内容 → Admin 决策是否提升为 Shared 技能。

### D2：Worker-Worker 1:1 通信可见程度 ✅ 已确认

**所有消息记录对 Admin 可见 + 危险关键词实时告警，但不拦截正常通信。**

- Admin 可在消息中心查看任意 Worker 间的完整对话历史
- 系统检测到危险关键词（如 `rm`、`delete`、`shell`、`exec`）时，主动推送告警给 Admin
- 正常通信不受干预，不增加延迟

---

## 十一、架构定稿说明

> 更新于 2026-03-13，所有设计决策已确认。

| 决策项 | 结论 |
|--------|------|
| 配置方式 | UI + YAML 双轨，完全等价 |
| 扩展依赖 | 启动时自动检查，缺依赖拒绝启动 |
| SOUL 文件 | 用户创建，有成长能力的 Worker 可自主更新（有 Changelog）|
| 人类不在线 | 高危操作排队等待，Admin 上线后统一审批 |
| Auditor 数量 | 用户自行配置，多 Auditor 任一通过即可 |
| 私有技能晋升 | Worker 提建议 → Admin 决策 |
| Worker 通信可见性 | 全量可见 + 危险关键词实时告警，不拦截正常通信 |

**状态：✅ 架构定稿，可开始第一阶段重构**

*实施进度请在 `PROJECT_STATUS.md` 同步更新。*
