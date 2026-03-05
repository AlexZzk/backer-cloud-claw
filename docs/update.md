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

## 本次更新包含的变更（v0.1.x）

### 新增：阿里百炼（Qwen）模型支持

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

### 修复：初始化向导 Bug

| 问题 | 修复说明 |
|------|----------|
| API Key 不支持粘贴 | 现已支持 Ctrl+V / Cmd+V 粘贴，输入显示为 `*` |
| 输入 Key 后步骤 3/4 被跳过 | 已修复，现在所有步骤均正常执行 |
| 无法跳过模型配置 | 新增"跳过（稍后配置）"选项，聊天前会自动检查并提示 |

---

## 配置文件迁移

本次更新**无需手动修改**已有的 `~/.bcc/config.json`。

如果需要添加百炼配置，运行 `pnpm bcc-init` 重新配置即可，向导会自动保留现有设置。
