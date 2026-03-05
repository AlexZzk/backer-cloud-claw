#!/usr/bin/env node
/**
 * bcc init — 初始化向导
 *
 * 引导用户完成首次配置，生成 ~/.bcc/config.json。
 * 可随时重新运行以修改配置。
 *
 * 用法（开发阶段）：
 *   pnpm bcc-init                     # 从项目根目录
 *   tsx bin/bcc-init.ts               # 在 channel-cli 包目录
 *
 * 用法（构建后）：
 *   node dist/bin/bcc-init.js
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  saveConfig,
  makeDefaultConfig,
  displayPath,
  CONFIG_PATH,
  DEFAULT_SESSION_DIR,
  type BccConfig,
} from '../src/config.js';
import {
  selectOne,
  askText,
  askSecret,
  askConfirm,
  closeWizard,
  printHeader,
  printStep,
  printSummary,
  ok,
  warn,
  fail,
} from '../src/wizard.js';

// 读 package.json 获取版本号
const VERSION = '0.1.0';

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printHeader(VERSION);

  // 检查是否已存在配置
  const existing = await loadConfig();
  if (existing) {
    console.log();
    warn(`检测到已有配置文件：${displayPath(CONFIG_PATH)}`);
    const overwrite = await askConfirm('  是否重新配置？（选 n 直接退出）', false);
    if (!overwrite) {
      console.log();
      console.log('  保持现有配置不变。运行 bcc chat 开始对话。');
      console.log();
      closeWizard();
      process.exit(0);
    }
  }

  const config = existing ?? makeDefaultConfig();

  // ── 步骤 1：选择 AI 提供商 ────────────────────────────────────────────────

  printStep(1, 4, 'AI 提供商');

  type Provider = 'claude' | 'deepseek' | 'both';
  const provider = await selectOne<Provider>(
    '你想使用哪些 AI 提供商？',
    [
      {
        label:       'Claude（Anthropic）',
        value:       'claude',
        description: '强大、安全，适合通用任务和创意写作',
      },
      {
        label:       'DeepSeek',
        value:       'deepseek',
        description: '高性价比，擅长代码和长文本推理',
      },
      {
        label:       '两者都启用',
        value:       'both',
        description: '自动故障切换：Claude 优先，失败时切换到 DeepSeek',
      },
    ],
    config.defaults.provider === 'claude' ? 0
    : config.defaults.provider === 'deepseek' ? 1 : 2,
  );
  config.defaults.provider = provider;

  // ── 步骤 2：API Key ───────────────────────────────────────────────────────

  printStep(2, 4, 'API Key');

  if (provider === 'claude' || provider === 'both') {
    await setupClaudeKey(config);
  }
  if (provider === 'deepseek' || provider === 'both') {
    await setupDeepSeekKey(config);
  }

  // ── 步骤 3：会话存储 ──────────────────────────────────────────────────────

  printStep(3, 4, '会话存储');

  console.log('  会话持久化：对话历史自动保存到磁盘，重启后可继续。');
  console.log();

  const enableMemory = await selectOne<'yes' | 'no'>(
    '是否启用会话持久化？',
    [
      { label: '启用（推荐）', value: 'yes', description: '历史自动保存到 ~/.bcc/sessions/' },
      { label: '禁用',        value: 'no',  description: '历史仅存内存，退出后清除' },
    ],
    config.defaults.enableMemory ? 0 : 1,
  );
  config.defaults.enableMemory = (enableMemory === 'yes');

  if (config.defaults.enableMemory) {
    console.log();
    const defaultDir = displayPath(DEFAULT_SESSION_DIR);
    const rawDir = await askText(
      `会话文件存储位置`,
      displayPath(config.defaults.sessionDir) || defaultDir,
    );
    // 展开 ~ 为绝对路径
    config.defaults.sessionDir = rawDir.startsWith('~')
      ? join(homedir(), rawDir.slice(1))
      : rawDir || DEFAULT_SESSION_DIR;

    console.log();
    const maxChoice = await selectOne<string>(
      '历史消息上限（超出后截断最早消息）',
      [
        { label: '50 条（推荐）',  value: '50'  },
        { label: '100 条',        value: '100' },
        { label: '200 条',        value: '200' },
        { label: '无限制',        value: '0'   },
      ],
      config.defaults.maxMessages === 50  ? 0
      : config.defaults.maxMessages === 100 ? 1
      : config.defaults.maxMessages === 200 ? 2
      : config.defaults.maxMessages === 0   ? 3 : 0,
    );
    config.defaults.maxMessages = parseInt(maxChoice, 10);
  }

  // ── 步骤 4：确认 ──────────────────────────────────────────────────────────

  printStep(4, 4, '确认');

  const summaryRows = buildSummaryRows(config);
  printSummary(summaryRows);

  const confirmed = await askConfirm('是否保存以上配置？', true);
  if (!confirmed) {
    console.log();
    console.log('  已取消，配置未保存。');
    console.log();
    closeWizard();
    process.exit(0);
  }

  // 保存
  try {
    await saveConfig(config);
    console.log();
    ok(`配置已保存至 ${displayPath(CONFIG_PATH)}`);
  } catch (err) {
    console.log();
    fail(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    closeWizard();
    process.exit(1);
  }

  // 收尾
  printNextSteps(config);
  closeWizard();
}

// ─── 提供商配置子流程 ─────────────────────────────────────────────────────────

async function setupClaudeKey(config: BccConfig): Promise<void> {
  const current = config.providers.claude?.apiKey;
  console.log('  Claude（Anthropic）API Key');
  console.log('  获取地址：https://console.anthropic.com/settings/keys');
  console.log('  Key 格式：sk-ant-api03-...');

  if (current) {
    console.log(`  当前：${'*'.repeat(8)}...${current.slice(-4)}`);
    const change = await askConfirm('  是否更换？', false);
    if (!change) return;
  }

  console.log();
  const key = await askSecret('  输入 API Key（输入时显示 *）');

  if (!key) {
    warn('未输入 Key，已跳过 Claude 配置。');
    return;
  }

  if (!key.startsWith('sk-ant')) {
    warn('Key 格式看起来不对（通常以 sk-ant 开头），已保存但请核实。');
  } else {
    ok('Key 格式正确。');
  }

  config.providers.claude = { apiKey: key };
  console.log();
}

async function setupDeepSeekKey(config: BccConfig): Promise<void> {
  const current = config.providers.deepseek?.apiKey;
  console.log('  DeepSeek API Key');
  console.log('  获取地址：https://platform.deepseek.com/api_keys');
  console.log('  Key 格式：sk-...');

  if (current) {
    console.log(`  当前：${'*'.repeat(8)}...${current.slice(-4)}`);
    const change = await askConfirm('  是否更换？', false);
    if (!change) return;
  }

  console.log();
  const key = await askSecret('  输入 API Key（输入时显示 *）');

  if (!key) {
    warn('未输入 Key，已跳过 DeepSeek 配置。');
    return;
  }

  ok('Key 已保存。');
  config.providers.deepseek = { apiKey: key };
  console.log();
}

// ─── 摘要 & 下一步 ────────────────────────────────────────────────────────────

function buildSummaryRows(config: BccConfig): Array<[string, string]> {
  const rows: Array<[string, string]> = [];

  // 提供商
  const providerLabel: Record<string, string> = {
    claude: 'Claude（Anthropic）',
    deepseek: 'DeepSeek',
    both: 'Claude + DeepSeek（双模型）',
  };
  rows.push(['提供商', providerLabel[config.defaults.provider] ?? config.defaults.provider]);

  // API Keys
  if (config.providers.claude?.apiKey) {
    const k = config.providers.claude.apiKey;
    rows.push(['Claude Key', `${k.slice(0, 10)}...${'*'.repeat(4)}`]);
  }
  if (config.providers.deepseek?.apiKey) {
    const k = config.providers.deepseek.apiKey;
    rows.push(['DeepSeek Key', `${k.slice(0, 6)}...${'*'.repeat(4)}`]);
  }

  // 存储
  rows.push(['会话存储', config.defaults.enableMemory
    ? displayPath(config.defaults.sessionDir)
    : '禁用（仅内存）']);

  if (config.defaults.enableMemory) {
    rows.push(['历史上限', config.defaults.maxMessages === 0
      ? '无限制'
      : `${config.defaults.maxMessages} 条`]);
  }

  return rows;
}

function printNextSteps(config: BccConfig): void {
  console.log();
  console.log('  ── 下一步 ──────────────────────────────────────────────');
  console.log();
  console.log('  开始对话：');

  // 根据平台显示合适的命令
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    console.log('    pnpm bcc-chat              # 从项目根目录（开发）');
    console.log('    node dist\\bin\\bcc-chat.js   # 构建后');
  } else {
    console.log('    pnpm bcc-chat              # 从项目根目录（开发）');
    console.log('    node dist/bin/bcc-chat.js  # 构建后');
  }

  console.log();
  console.log('  重新配置：');
  console.log('    pnpm bcc-init');
  console.log();

  console.log('  配置文件：');
  console.log(`    ${displayPath(CONFIG_PATH)}`);
  console.log();

  // 如果配置了 Key 但 env 中也有，提示优先级
  const hasEnvClaude   = Boolean(process.env['ANTHROPIC_API_KEY']);
  const hasEnvDeepSeek = Boolean(process.env['DEEPSEEK_API_KEY']);
  if (hasEnvClaude || hasEnvDeepSeek) {
    console.log('  提示：检测到环境变量 API Key，环境变量优先级高于配置文件。');
    console.log();
  }
}

// ─── 运行 ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n  错误：' + (err instanceof Error ? err.message : String(err)));
  closeWizard();
  process.exit(1);
});
