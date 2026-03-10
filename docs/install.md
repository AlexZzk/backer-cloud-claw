# bcc 部署与使用指南

本文档适用于**第一次**在本地安装和运行 backer-cloud-claw（bcc）的用户，涵盖两种使用模式：

- **CLI 模式**：命令行 REPL，适合开发调试和多 Worker 协作测试
- **Web UI 模式**：浏览器界面 + HTTP API 服务，适合日常使用和演示

---

## 环境要求

| 工具    | 最低版本 | 说明                       |
|---------|----------|----------------------------|
| Node.js | 20+      | 建议使用 LTS 版本          |
| pnpm    | 9+       | 包管理器，用于 monorepo 管理 |
| Git     | 任意     | 用于克隆仓库               |

检查版本：

```bash
node -v    # 应输出 v20.x.x 或更高
pnpm -v    # 应输出 9.x.x 或更高
```

如果未安装 pnpm：

```bash
npm install -g pnpm
```

---

## 第一步：克隆仓库并安装依赖

```bash
git clone <仓库地址>
cd backer-cloud-claw
pnpm install
pnpm build
```

构建成功后输出类似：

```
Tasks:    12 successful, 12 total
```

---

## 第二步：初始化配置

运行初始化向导，按提示完成配置：

```bash
pnpm bcc-init
```

向导分 4 步：

1. **选择 AI 提供商**
   - `Claude（Anthropic）` — 需要 [Anthropic API Key](https://console.anthropic.com/settings/keys)
   - `阿里百炼（Qwen）` — 需要 [DashScope API Key](https://bailian.console.aliyun.com/)，国内访问友好
   - `DeepSeek` — 需要 [DeepSeek API Key](https://platform.deepseek.com/api_keys)
   - `跳过（稍后配置）` — 暂不设置，后续再运行 `pnpm bcc-init`

2. **输入 API Key**
   - 支持直接粘贴（Ctrl+V / Cmd+V），输入内容以 `*` 遮蔽显示

3. **会话存储设置**
   - 选择是否启用会话持久化（推荐开启）
   - 默认存储路径：`~/.bcc/sessions/`
   - 设置历史消息上限（推荐 50 条）

4. **确认并保存**
   - 配置保存至 `~/.bcc/config.json`

---

## 第三步：（可选）创建 Worker

Worker 是有身份、职责和技能的 AI 实体。多 Worker 场景下，Worker 之间可以通过 `call_worker` 工具互相委托任务。

```bash
pnpm bcc-worker add
```

向导会引导你填写：
- **Worker ID**：唯一标识符（如 `pm`、`coder`、`writer`）
- **显示名称**：例如"产品经理"、"代码工程师"
- **绑定模型**：选择配置文件中已有的模型实例
- **角色描述（System Prompt）**：定义员工的职责与行为边界
- **技能标签**：例如 `需求分析,产品规划`（逗号分隔）
- **是否为主 Worker**：用户消息默认路由到主 Worker

查看所有 Worker：

```bash
pnpm bcc-worker list
```

> 若只有单一模型、暂时不需要多员工，可跳过此步骤。

---

## 使用方式 A：CLI 模式

适合开发调试、脚本自动化、多 Worker 协作测试。

```bash
pnpm bcc-chat
```

如果配置了 Worker，启动时会显示：

```
Worker 模式 — 3 位员工就绪
  ★ pm       产品经理 Claude  (claude)
    coder    代码工程师 DeepSeek  (deepseek)
    writer   文案策划 Qwen    (bailian)
```

使用 `--worker` 指定启动时默认员工：

```bash
pnpm bcc-chat --worker coder
```

### 常用会话内命令

| 命令                    | 说明                             |
|-------------------------|----------------------------------|
| `/help`                 | 显示帮助                         |
| `/history`              | 查看对话历史                     |
| `/clear`                | 清空本次历史                     |
| `/session`              | 显示当前会话信息                 |
| `/workers`              | 列出所有 Worker 及 token 消耗    |
| `/worker <id>`          | 切换到指定 Worker                |
| `/worker <id> <消息>`   | 向指定 Worker 发送一条消息（不切换）|
| `/exit`                 | 退出                             |

### Token 消耗显示

每次对话结束后，REPL 会显示本次 token 消耗：

```
  ↑350 ↓128 = 478 tokens
```

---

## 使用方式 B：Web UI 模式

适合日常使用、演示、可视化查看多 Worker 状态。需要**同时启动两个进程**：HTTP API 服务器 + Vite 前端开发服务器。

### 方式 B-1：分两个终端启动（推荐用于开发）

**终端 1 — 启动 HTTP API 服务器：**

```bash
pnpm bcc-server
```

服务器默认监听 `http://localhost:3000`，输出：

```
[bcc-server] HTTP API 已启动，监听 http://localhost:3000
[bcc-server] 已加载 3 个 Worker
```

**终端 2 — 启动 Web 前端：**

```bash
pnpm --filter @bcc/web dev
```

Vite 启动后访问 `http://localhost:5173`（端口可能不同，以终端输出为准）。

> 前端已配置 `/api` → `http://localhost:3000` 的反向代理，开发时无需跨域配置。

### 方式 B-2：指定 API 服务端口

```bash
pnpm bcc-server -- --port 8080
```

修改 `packages/web/vite.config.ts` 中 proxy target 为 `http://localhost:8080`，再启动前端。

### Web UI 功能

- **对话界面**：选择 Worker、发送消息、实时流式显示 AI 回复、支持工具调用过程可视化
- **Worker 管理**：查看所有 Worker 的信息（模型、技能、工具列表）
- **多会话**：每个 Worker 可创建多个独立会话，历史互不干扰

---

## Worker 管理命令

| 命令                              | 说明                       |
|-----------------------------------|----------------------------|
| `pnpm bcc-worker list`            | 列出所有 Worker            |
| `pnpm bcc-worker add`             | 交互式创建新 Worker        |
| `pnpm bcc-worker show <id>`       | 查看 Worker 详情           |
| `pnpm bcc-worker edit <id>`       | 编辑已有 Worker            |
| `pnpm bcc-worker delete <id>`     | 删除 Worker                |
| `pnpm bcc-worker set-primary <id>`| 设置默认 Worker            |

---

## 配置文件格式（v0.2.0+）

配置文件位于 `~/.bcc/config.json`，包含模型实例和 Worker 定义：

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
      "model": "deepseek-chat"
    }
  ],
  "workers": [
    {
      "id": "pm",
      "name": "产品经理",
      "role": "product_manager",
      "modelId": "claude",
      "description": "负责需求分析和产品规划",
      "skills": ["需求分析", "产品规划", "用户研究"],
      "primary": true
    },
    {
      "id": "coder",
      "name": "代码工程师",
      "role": "software_engineer",
      "modelId": "deepseek",
      "description": "负责代码实现和技术评审",
      "skills": ["TypeScript", "代码审查", "系统设计"]
    }
  ],
  "defaults": {
    "enableMemory": true,
    "sessionDir": "~/.bcc/sessions",
    "maxMessages": 50
  }
}
```

> **说明**：`models` 数组取代了旧版 `providers` 对象。每个模型实例有唯一 `id`，Worker 通过 `modelId` 引用。

---

## 常见问题

**Q：`pnpm bcc-chat` 提示"未找到配置文件"？**

先运行 `pnpm bcc-init` 完成初始化。

**Q：`pnpm bcc-server` 提示找不到 Worker？**

确保 `~/.bcc/config.json` 中有 `workers` 字段，先运行 `pnpm bcc-worker add` 创建至少一个 Worker。

**Q：启动后显示"会话：default"而不是"Worker 模式"？**

说明配置文件中没有 `workers` 字段，请先运行 `pnpm bcc-worker add` 创建至少一个 Worker。

**Q：Web 页面无法连接 API，显示"服务离线"？**

确保 `pnpm bcc-server` 已在另一个终端运行，且监听端口与 `vite.config.ts` 中的 proxy target 一致（默认均为 3000）。

**Q：两个 Worker 之间没有真正通信？**

v0.3.0 已修复，多 Worker 时每个 Worker 自动获得 `call_worker` 工具，LLM 可以通过该工具把任务委托给其他 Worker。确保使用最新版本。

**Q：Worker 的 token 消耗如何查看？**

CLI 模式：在 REPL 中输入 `/workers`。
Web UI 模式：稍后将在 Analytics 页面提供可视化展示。

**Q：配置文件在哪里？**

`~/.bcc/config.json`（macOS/Linux）或 `C:\Users\<用户名>\.bcc\config.json`（Windows）。
