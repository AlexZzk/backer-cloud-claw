#!/usr/bin/env node
/**
 * bcc-discord — Discord Bot 渠道启动器
 *
 * 将 BCC Worker 接入 Discord，用户可在频道中 @Bot 与 AI 员工对话。
 *
 * 用法：
 *   DISCORD_BOT_TOKEN=xxx pnpm bcc-discord [选项]
 *
 * 环境变量：
 *   DISCORD_BOT_TOKEN       必填。Bot Token（在 Discord Developer Portal 获取）
 *   DISCORD_ALLOWED_CHANNELS 可选。允许响应的频道 ID，逗号分隔
 *
 * 准备工作（Discord Developer Portal）：
 *   1. 前往 https://discord.com/developers/applications 创建 Application
 *   2. 在 Bot 页面开启以下 Privileged Intents：MESSAGE CONTENT INTENT
 *   3. 复制 Bot Token 设为 DISCORD_BOT_TOKEN 环境变量
 *   4. 使用 OAuth2 URL Generator 生成邀请链接（勾选 bot scope + Send Messages 权限）
 *
 * 配置文件：~/.bcc/config.json（由 bcc-init 生成）
 */

import { DiscordChannel } from '../src/channel.js';
import { AgentEngine } from '@bcc/agent-engine';

// ─── 读取环境变量 ──────────────────────────────────────────────────────────────

const token = process.env['DISCORD_BOT_TOKEN'];
if (!token) {
  console.error(`
错误：未设置 DISCORD_BOT_TOKEN 环境变量。

用法：
  DISCORD_BOT_TOKEN=<your-bot-token> pnpm bcc-discord

如何获取 Bot Token：
  1. 访问 https://discord.com/developers/applications
  2. 创建 New Application，进入 Bot 页面
  3. 点击 Reset Token 获取 Token
  4. 确保开启 MESSAGE CONTENT INTENT（Privileged Gateway Intents）
`);
  process.exit(1);
}

const allowedChannelIds = process.env['DISCORD_ALLOWED_CHANNELS']
  ? process.env['DISCORD_ALLOWED_CHANNELS'].split(',').map(s => s.trim()).filter(Boolean)
  : [];

// ─── 帮助信息 ──────────────────────────────────────────────────────────────────

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
bcc-discord — BCC Discord Bot 渠道

用法：
  DISCORD_BOT_TOKEN=<token> pnpm bcc-discord [选项]

环境变量：
  DISCORD_BOT_TOKEN         必填。Bot Token
  DISCORD_ALLOWED_CHANNELS  可选。允许响应的频道 ID，逗号分隔

选项：
  --help, -h    显示此帮助

说明：
  启动后，Bot 会响应以下消息：
    - 在允许的频道中 @Bot 发送的消息
    - 以 ! 开头的命令（!help / !clear / !status）

  按 Ctrl+C 停止服务。
`);
  process.exit(0);
}

// ─── 加载配置 ──────────────────────────────────────────────────────────────────

const { readFile } = await import('node:fs/promises');
const { join }     = await import('node:path');
const { homedir }  = await import('node:os');

const configPath = join(homedir(), '.bcc', 'config.json');
let config: { models?: Array<{ id: string; provider: string; apiKey: string; model?: string; baseUrl?: string; primary?: boolean }> } = {};

try {
  const raw = await readFile(configPath, 'utf-8');
  config = JSON.parse(raw) as typeof config;
} catch {
  console.error(`⚠️  无法读取配置文件 ${configPath}，使用空配置。`);
}

const modelInstance = config.models?.find(m => m.primary) ?? config.models?.[0];
if (!modelInstance) {
  console.error(`错误：配置中没有可用的模型。请先运行 pnpm bcc-init。`);
  process.exit(1);
}

// ─── 初始化模型适配器 ──────────────────────────────────────────────────────────

const PROVIDER_PROTOCOL: Record<string, 'anthropic' | 'openai'> = {
  claude: 'anthropic', openai: 'openai', deepseek: 'openai', bailian: 'openai', custom: 'openai',
};
const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};
const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  claude: 'claude-sonnet-4-5', openai: 'gpt-4o', deepseek: 'deepseek-chat', bailian: 'qwen-plus',
};
const PROVIDER_ENV_KEY: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', bailian: 'DASHSCOPE_API_KEY',
};

const protocol = PROVIDER_PROTOCOL[modelInstance.provider] ?? 'openai';
const envKey = PROVIDER_ENV_KEY[modelInstance.provider];
const apiKey = (envKey ? process.env[envKey] : undefined) || modelInstance.apiKey;

let adapter;
if (protocol === 'anthropic') {
  const { AnthropicAdapter } = await import('@bcc/protocol-anthropic');
  adapter = new AnthropicAdapter({
    name: modelInstance.id, apiKey,
    ...(modelInstance.model   && { model:   modelInstance.model }),
    ...(modelInstance.baseUrl && { baseURL: modelInstance.baseUrl }),
  });
} else {
  const { OpenAIAdapter } = await import('@bcc/protocol-openai');
  adapter = new OpenAIAdapter({
    name: modelInstance.id, apiKey,
    baseUrl: modelInstance.baseUrl || PROVIDER_DEFAULT_BASE_URL[modelInstance.provider] || '',
    model: modelInstance.model || PROVIDER_DEFAULT_MODEL[modelInstance.provider] || '',
    provider: modelInstance.provider,
    supportTools: true,
  });
}

// ─── 创建 AgentEngine ─────────────────────────────────────────────────────────

const engine = await AgentEngine.create({
  model: adapter,
  system: '你是一名通过 Discord 提供服务的 AI 助手。请简洁、友好地回答用户的问题。',
});

// ─── 启动 Discord 渠道 ────────────────────────────────────────────────────────

console.log(`\n  🚀 BCC Discord Bot 正在启动…`);
console.log(`     模型：${modelInstance.id}（${modelInstance.provider}）\n`);

const channel = await DiscordChannel.create({
  token,
  defaultAgent: engine,
  onlyWhenMentioned: true,
  ...(allowedChannelIds.length > 0 && { allowedChannelIds }),
});

process.on('SIGINT',  () => { console.log('\n  👋 正在停止 Discord Bot…'); channel.stop(); process.exit(0); });
process.on('SIGTERM', () => { channel.stop(); process.exit(0); });

await channel.start();
