#!/usr/bin/env node
/**
 * bcc chat — 交互式命令行 AI 对话
 *
 * 配置优先级（高 → 低）：
 *   1. CLI 参数（--model deepseek 等）
 *   2. 环境变量（ANTHROPIC_API_KEY、DEEPSEEK_API_KEY 等）
 *   3. 配置文件（~/.bcc/config.json，由 bcc init 生成）
 *   4. 内置默认值
 *
 * 用法（开发阶段）：
 *   pnpm bcc-chat                       # 从项目根目录
 *   tsx bin/bcc-chat.ts                 # 在 channel-cli 包目录
 *
 * 用法（构建后）：
 *   node dist/bin/bcc-chat.js
 */
import { ModelRouter } from '@bcc/model-core';
import { FileMemoryStore } from '@bcc/memory-fs';
import { CliChannel } from '../src/index.js';
import { loadConfig } from '../src/config.js';

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

interface CliArgs {
  model:       'claude' | 'deepseek' | 'both' | undefined;
  sessionId:   string | undefined;
  system:      string | undefined;
  noMemory:    boolean;
  sessionDir:  string | undefined;
  maxMessages: number | undefined;
  help:        boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model:       undefined,
    sessionId:   undefined,
    system:      undefined,
    noMemory:    false,
    sessionDir:  undefined,
    maxMessages: undefined,
    help:        false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--model':        args.model      = (argv[++i] ?? 'claude') as CliArgs['model']; break;
      case '--session':      args.sessionId  = argv[++i]; break;
      case '--system':       args.system     = argv[++i]; break;
      case '--no-memory':    args.noMemory   = true;      break;
      case '--session-dir':  args.sessionDir = argv[++i]; break;
      case '--max-messages': {
        const n = parseInt(argv[++i] ?? '', 10);
        if (!isNaN(n)) args.maxMessages = n;
        break;
      }
      case '--help': case '-h': args.help = true; break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
bcc chat — backer-cloud-claw 命令行 AI 对话

用法：
  pnpm bcc-chat [选项]
  tsx bin/bcc-chat.ts [选项]         （开发阶段）
  node dist/bin/bcc-chat.js [选项]   （构建后）

选项：
  --model <id>          模型：claude | deepseek | both（双模型路由）
  --session <id>        会话 ID，用于持久化（默认：default）
  --system <prompt>     系统提示词
  --no-memory           禁用持久化（本次历史不保存）
  --session-dir <dir>   自定义会话存储目录
  --max-messages <n>    本次对话保留的最大历史消息数
  --help, -h            显示此帮助

配置文件：
  首次使用请运行 pnpm bcc-init 完成初始化配置。
  配置文件位置：~/.bcc/config.json

环境变量（覆盖配置文件）：
  ANTHROPIC_API_KEY     Claude API Key
  DEEPSEEK_API_KEY      DeepSeek API Key
  BCC_SESSION_DIR       会话存储目录
`);
}

// ─── 模型构建 ─────────────────────────────────────────────────────────────────

async function buildModel(
  provider: 'claude' | 'deepseek' | 'both',
  claudeKey: string | undefined,
  deepSeekKey: string | undefined,
): Promise<ModelRouter> {
  const router = new ModelRouter({ enableFailover: true });
  let registered = 0;

  if ((provider === 'claude' || provider === 'both') && claudeKey) {
    const { ClaudeAdapter } = await import('@bcc/model-claude');
    router.register(new ClaudeAdapter({ apiKey: claudeKey }), { priority: 0 });
    registered++;
  }

  if ((provider === 'deepseek' || provider === 'both') && deepSeekKey) {
    const { DeepSeekAdapter } = await import('@bcc/model-deepseek');
    router.register(new DeepSeekAdapter({ apiKey: deepSeekKey }), {
      priority: 1,
      fallback: provider === 'both',
    });
    registered++;
  }

  if (registered === 0) {
    const hasConfig = Boolean(await loadConfig());
    const hint = hasConfig
      ? `当前提供商为 "${provider}"，但未找到对应 API Key。\n` +
        '  请检查 ~/.bcc/config.json 或重新运行：pnpm bcc-init'
      : '尚未找到配置文件，请先运行初始化向导：\n  pnpm bcc-init';

    console.error(`\n错误：未找到可用的 API Key。\n  ${hint}\n`);
    process.exit(1);
  }

  return router;
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  // 加载配置文件（不存在时为 null，不报错）
  const config = await loadConfig();

  // 三层优先级合并
  const provider    = (args.model ?? config?.defaults.provider ?? 'claude') as 'claude' | 'deepseek' | 'both';
  const claudeKey   = process.env['ANTHROPIC_API_KEY'] || config?.providers.claude?.apiKey;
  const deepSeekKey = process.env['DEEPSEEK_API_KEY']  || config?.providers.deepseek?.apiKey;

  const sessionDir  = args.sessionDir ?? process.env['BCC_SESSION_DIR'] ?? config?.defaults.sessionDir;
  const enableMem   = args.noMemory ? false : (config?.defaults.enableMemory ?? true);
  const sessionId   = args.sessionId ?? 'default';
  const maxMessages = args.maxMessages ?? (config?.defaults.maxMessages ?? 50);
  const system      = args.system;

  const model  = await buildModel(provider, claudeKey, deepSeekKey);
  const memory = enableMem
    ? new FileMemoryStore(sessionDir ? { dir: sessionDir } : {})
    : undefined;

  const cli = await CliChannel.create({
    model,
    ...(system        !== undefined && { system }),
    ...(memory        !== undefined && { memory }),
    sessionId,
    ...(maxMessages > 0             && { maxMessages }),
  });

  await cli.start();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
