#!/usr/bin/env node
/**
 * bcc-telegram — Telegram Bot 渠道启动器
 *
 * 将 BCC Worker 接入 Telegram，用户可通过 Telegram Bot 与 AI 员工对话。
 *
 * 用法：
 *   TELEGRAM_BOT_TOKEN=xxx pnpm bcc-telegram [选项]
 *
 * 环境变量：
 *   TELEGRAM_BOT_TOKEN       必填。Bot Token（由 @BotFather 创建）
 *   TELEGRAM_ALLOWED_CHATS   可选。允许响应的 Chat ID，逗号分隔（如 "12345,67890"）
 *
 * 配置文件：~/.bcc/config.json（由 bcc-init 生成）
 */

import { TelegramChannel } from '../src/channel.js';
import { AgentEngine } from '@bcc/agent-engine';

// ─── 读取环境变量 ──────────────────────────────────────────────────────────────

const token = process.env['TELEGRAM_BOT_TOKEN'];
if (!token) {
  console.error(`
错误：未设置 TELEGRAM_BOT_TOKEN 环境变量。

用法：
  TELEGRAM_BOT_TOKEN=<your-bot-token> pnpm bcc-telegram

如何获取 Bot Token：
  1. 在 Telegram 中搜索 @BotFather
  2. 发送 /newbot 命令并按提示操作
  3. BotFather 会返回一串 Token（格式：123456789:AAH…）
`);
  process.exit(1);
}

const allowedChatIds = process.env['TELEGRAM_ALLOWED_CHATS']
  ? process.env['TELEGRAM_ALLOWED_CHATS']
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n))
  : [];

// ─── 参数解析 ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--help' || args[i] === '-h')) {
    console.log(`
bcc-telegram — BCC Telegram Bot 渠道

用法：
  TELEGRAM_BOT_TOKEN=<token> pnpm bcc-telegram [选项]

环境变量：
  TELEGRAM_BOT_TOKEN       必填。Bot Token（由 @BotFather 创建）
  TELEGRAM_ALLOWED_CHATS   可选。允许响应的 Chat ID，逗号分隔（如 "12345,67890"）

选项：
  --config <path>   配置文件路径（默认 ~/.bcc/config.json）
  --worker <id>     指定使用的 Worker ID（默认使用 primary Worker）
  --help, -h        显示此帮助

说明：
  启动后，Bot 会持续监听 Telegram 消息并路由给 BCC Worker 处理。
  按 Ctrl+C 停止服务。
`);
    process.exit(0);
  }
}

// ─── 加载配置，初始化模型适配器 ───────────────────────────────────────────────

// 配置加载（与 @bcc/channel-cli 相同格式）
const { readFile } = await import('node:fs/promises');
const { join }     = await import('node:path');
const { homedir }  = await import('node:os');

const configPath = join(homedir(), '.bcc', 'config.json');
let config: { models?: Array<{ id: string; provider: string; apiKey: string; model?: string; baseUrl?: string; primary?: boolean }> } = {};

try {
  const raw = await readFile(configPath, 'utf-8');
  config = JSON.parse(raw) as typeof config;
} catch {
  console.error(`⚠️  无法读取配置文件 ${configPath}，使用空配置（需要环境变量提供 API Key）。`);
}

const modelInstance = config.models?.find(m => m.primary) ?? config.models?.[0];
if (!modelInstance) {
  console.error(`错误：配置中没有可用的模型。请先运行 pnpm bcc-init。`);
  process.exit(1);
}

// 动态加载模型适配器（与 bcc-chat.ts 相同的适配器工厂逻辑）
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
    model: modelInstance.model   || PROVIDER_DEFAULT_MODEL[modelInstance.provider]   || '',
    provider: modelInstance.provider,
    supportTools: true,
  });
}

// ─── 创建 AgentEngine（作为默认 Worker）─────────────────────────────────────

const engine = await AgentEngine.create({
  model: adapter,
  system: '你是一名通过 Telegram 提供服务的 AI 助手。请简洁、友好地回答用户的问题。',
});

// ─── 启动 Telegram 渠道 ──────────────────────────────────────────────────────

console.log(`\n  🚀 BCC Telegram Bot 正在启动…`);
console.log(`     模型：${modelInstance.id}（${modelInstance.provider}）\n`);

const channel = await TelegramChannel.create({
  token,
  defaultAgent: engine,
  ...(allowedChatIds.length > 0 && { allowedChatIds }),
});

// 优雅退出
process.on('SIGINT',  () => { console.log('\n  👋 正在停止 Telegram Bot…'); channel.stop(); });
process.on('SIGTERM', () => { channel.stop(); });

await channel.start();
