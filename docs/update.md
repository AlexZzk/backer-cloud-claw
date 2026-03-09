# bcc 更新指南

本文档适用于已完成首次安装、需要**将本地代码更新至最新版本**的用户。

---

## 标准更新流程

### 第一步：拉取最新代码

```bash
git pull origin main
```

如果你在本地有未提交的改动，先暂存再拉取：

```bash
git stash
git pull origin main
git stash pop
```

---

### 第二步：更新依赖

拉取代码后，如果 `pnpm-lock.yaml` 有变化（新增或升级了依赖），需要重新安装：

```bash
pnpm install
```

判断是否需要执行：运行 `git diff HEAD~1 pnpm-lock.yaml` 或 `git status`，如果 `pnpm-lock.yaml` 有变化则执行。

---

### 第三步：重新构建

```bash
pnpm build
```

构建成功标志：

```
Tasks:    10 successful, 10 total
```

---

### 第四步：检查配置是否需要更新

如果本次更新新增了功能（如新的模型提供商），可以重新运行初始化向导补充配置：

```bash
pnpm bcc-init
```

> 向导会检测已有配置文件，询问是否重新配置。
> 选择**是**可以修改或补充设置，选择**否**则保留现有配置直接退出。

---

### 第五步：开始对话

```bash
pnpm bcc-chat
```

---

## 快速更新（一行命令）

如果确认依赖和配置没有变化，可以只拉代码 + 构建：

```bash
git pull origin main && pnpm install && pnpm build
```

---

## 检查当前版本

查看本地代码对应的最新提交：

```bash
git log --oneline -5
```

查看远端是否有更新未拉取：

```bash
git fetch origin
git log HEAD..origin/main --oneline
```

如果输出为空，说明本地已是最新，无需更新。

---

## 版本变更记录

---

### v0.2.0 — Worker 架构 + Token 追踪（2026-03）

> **重大更新**：引入 Worker 模式（多员工多模型）、全链路 token 追踪、Worker CLI 管理工具。

#### 新增：`@bcc/org` 包 — Worker/Company 架构

新增 `packages/org` 包，实现组织层核心概念：

- **Worker**：有身份、职责、技能的 AI 实体，绑定一个模型实例 + System Prompt + 技能标签
- **Company**：Worker 容器，共享 TokenTracker 和 EventBus，对外实现 `Participant` 接口（支持递归嵌套）
- **Thread**：对话线索生命周期管理（open/append/close）
- **Mailbox**：异步 FIFO 消息队列，保证 Worker 单次处理
- **Router**：按 Participant ID 路由 OrgMessage
- **TokenTracker**：按 Worker 分类统计 token 消耗

#### 新增：全链路 Token 追踪

Token 数据从 API 响应一路传递到 REPL 显示：

1. `@bcc/protocol-anthropic`：从 `final.usage` 提取 `input_tokens` / `output_tokens`
2. `@bcc/protocol-openai`：新增 `stream_options: { include_usage: true }`，从流式响应末尾提取
3. `@bcc/agent-engine`：跨工具循环迭代累加 token 数
4. `WorkerSession`：Worker 级别 token 汇总，通过 `TokenTracker` 持久记录
5. REPL：每次回复后显示 `↑350 ↓128 = 478 tokens`

#### 新增：`bcc-worker` CLI — Worker 管理工具

新增完整的交互式 Worker 管理命令行：

```bash
pnpm bcc-worker list              # 列出所有 Worker
pnpm bcc-worker add               # 交互式创建新 Worker
pnpm bcc-worker show <id>         # 查看 Worker 详情 + System Prompt
pnpm bcc-worker edit <id>         # 编辑名称/模型/角色/技能/描述
pnpm bcc-worker delete <id>       # 删除，自动迁移主 Worker
pnpm bcc-worker set-primary <id>  # 设置默认 Worker
```

#### 新增：REPL Worker 命令

在 `pnpm bcc-chat` 对话中新增：

| 命令                     | 说明                               |
|--------------------------|------------------------------------|
| `/workers`               | 列出所有 Worker 及累计 token 消耗  |
| `/worker <id>`           | 切换到指定 Worker                  |
| `/worker <id> <消息>`    | 向指定 Worker 发送一条消息（不切换）|

#### 新增：三模式优先级系统

`bcc-chat` 启动时自动检测并选择对话模式（高优先级覆盖低优先级）：

1. **Worker 模式**（最高）：检测到 `config.workers` 非空时启用
2. **多 Agent 模式**：检测到 `config.agents` 非空时启用（旧版兼容）
3. **普通 ModelRouter 模式**（默认）

新增 `--worker <id>` CLI 参数，强制指定启动时的默认 Worker。

#### 修复：配置文件 workers 字段丢失

**问题**：运行 `pnpm bcc-worker add` 成功后，`pnpm bcc-chat` 仍显示"普通模式"而非"Worker 模式"。

**根因**：`config.ts` 中 `migrateFromLegacy()` 的新格式分支未透传 `agents` / `workers` 字段，导致读取配置时这两个字段被静默丢弃。

**修复**：
- 在 `LegacyConfig` 接口添加 `agents?` 和 `workers?` 字段
- 新格式分支返回时使用条件展开（`...(raw.workers && ...)` ）传递这两个字段

#### 修复：模块未找到崩溃（ERR_MODULE_NOT_FOUND）

**问题**：`pnpm bcc-chat` 启动时报 `Cannot find module '@bcc/agents/dist/index.js'`。

**根因**：`tsx` 直接运行 `.ts` 入口文件，但 workspace 依赖包（`@bcc/agents` 等）需要编译后的 `dist/` 目录。

**修复**：根目录 `package.json` 中 `bcc-chat` 脚本改为先构建依赖链再启动：

```bash
turbo run build --filter=@bcc/channel-cli... && pnpm --filter @bcc/channel-cli run start
```

---

### v0.1.x — 阿里百炼 + 向导修复（2026-03 早期）

#### 新增：阿里百炼（Qwen）模型支持

新增 `@bcc/model-bailian` 包，支持通义千问系列模型：

- 默认模型：`qwen-plus`
- 上下文窗口：128k tokens
- API 兼容 OpenAI 格式，国内访问无需代理

**更新后的配置步骤：**

1. 运行 `pnpm bcc-init`
2. 步骤 1 选择 `阿里百炼（Qwen）`
3. 步骤 2 粘贴 DashScope API Key（获取地址：https://bailian.console.aliyun.com/）
4. 保存配置后运行 `pnpm bcc-chat`

也可以通过环境变量直接使用，无需重新运行向导：

```bash
export DASHSCOPE_API_KEY=sk-xxxxxxxx
pnpm bcc-chat --model bailian
```

#### 修复：初始化向导 Bug

| 问题 | 修复说明 |
|------|----------|
| API Key 不支持粘贴 | 现已支持 Ctrl+V / Cmd+V 粘贴，输入显示为 `*` |
| 输入 Key 后步骤 3/4 被跳过 | 已修复，现在所有步骤均正常执行 |
| 无法跳过模型配置 | 新增"跳过（稍后配置）"选项，聊天前会自动检查并提示 |

---

## 配置文件迁移说明

### 从 v0.1.x 升级到 v0.2.0

**无需手动修改**已有的 `~/.bcc/config.json`。

- 原有模型配置（`models` 字段）完全兼容，旧格式（`providers` 字段）自动迁移
- Worker 模式为**可选增量功能**，不创建 Worker 时行为与旧版一致
- 若需要使用 Worker 模式，运行 `pnpm bcc-worker add` 创建第一个 Worker 即可

### 旧版 `providers` 格式（兼容说明）

如果你的 `~/.bcc/config.json` 使用了旧版格式：

```json
{
  "providers": {
    "claude": { "apiKey": "sk-ant-..." }
  }
}
```

系统会自动迁移为新格式，无需手动操作。
