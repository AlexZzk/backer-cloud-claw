# bcc 首次安装指南

本文档适用于**第一次**在本地安装和运行 backer-cloud-claw（bcc）的用户。

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
git --version
```

如果未安装 pnpm：

```bash
npm install -g pnpm
```

---

## 第一步：克隆仓库

```bash
git clone <仓库地址>
cd backer-cloud-claw
```

---

## 第二步：安装依赖

```bash
pnpm install
```

这会自动安装所有 workspace 包的依赖，包括 Claude、阿里百炼、DeepSeek 的 SDK 等。

---

## 第三步：构建所有包

```bash
pnpm build
```

构建成功后输出类似：

```
Tasks:    10 successful, 10 total
```

---

## 第四步：初始化配置

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
   - 直接回车可跳过当前提供商

3. **会话存储设置**
   - 选择是否启用会话持久化（推荐开启）
   - 默认存储路径：`~/.bcc/sessions/`
   - 设置历史消息上限（推荐 50 条）

4. **确认并保存**
   - 确认配置摘要，回车保存至 `~/.bcc/config.json`

---

## 第五步：开始对话

```bash
pnpm bcc-chat
```

进入交互式 REPL，直接输入问题即可开始对话。

常用会话内命令：

| 命令            | 说明             |
|-----------------|------------------|
| `/help`         | 显示帮助         |
| `/history`      | 查看对话历史     |
| `/clear`        | 清空本次历史     |
| `/session`      | 显示当前会话信息 |
| `/exit`         | 退出             |

---

## 常见问题

**Q：pnpm bcc-chat 提示"未找到配置文件"？**

先运行 `pnpm bcc-init` 完成初始化。

**Q：pnpm bcc-chat 提示"未找到可用的 API Key"？**

配置文件中没有对应提供商的 Key，重新运行 `pnpm bcc-init` 补充设置。

**Q：想同时使用多个模型（故障切换）？**

目前向导中"两者都启用"选项支持 Claude + DeepSeek 双模型自动故障切换。也可以通过 `--model both` 参数临时启用。

**Q：配置文件在哪里？**

`~/.bcc/config.json`（macOS/Linux）或 `C:\Users\<用户名>\.bcc\config.json`（Windows）。
