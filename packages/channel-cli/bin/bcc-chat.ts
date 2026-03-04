#!/usr/bin/env node
/**
 * bcc-chat：backer-cloud-claw 交互式命令行 Agent
 *
 * 用法：
 *   tsx bin/bcc-chat.ts [选项]
 *
 * 选项：
 *   --model <id>        指定模型（claude | deepseek，默认 claude）
 *   --session <id>      会话 ID，用于持久化（默认 default）
 *   --system <prompt>   系统提示词
 *   --no-memory         禁用持久化（默认启用，保存到 ~/.bcc/sessions/）
 *   --session-dir <dir> 自定义会话存储目录
 *   --max-messages <n>  保留的最大历史消息数
 *
 * 环境变量：
 *   ANTHROPIC_API_KEY   Anthropic Claude API Key
 *   DEEPSEEK_API_KEY    DeepSeek API Key
 *   BCC_SESSION_DIR     会话存储目录（优先级低于 --session-dir）
 */
import { ModelRouter } from '@bcc/model-core';
import { FileMemoryStore } from '@bcc/memory-fs';
import { CliChannel } from '../src/index.js';

// ─── 解析 CLI 参数 ────────────────────────────────────────────────────────────

interface CliArgs {
  model: 'claude' | 'deepseek' | 'both';
  sessionId: string;
  system: string | undefined;
  noMemory: boolean;
  sessionDir: string | undefined;
  maxMessages: number | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: 'claude',
    sessionId: 'default',
    system: undefined,
    noMemory: false,
    sessionDir: undefined,
    maxMessages: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--model':
        args.model = (argv[++i] ?? 'claude') as CliArgs['model'];
        break;
      case '--session':
        args.sessionId = argv[++i] ?? 'default';
        break;
      case '--system':
        args.system = argv[++i];
        break;
      case '--no-memory':
        args.noMemory = true;
        break;
      case '--session-dir':
        args.sessionDir = argv[++i];
        break;
      case '--max-messages': {
        const n = parseInt(argv[++i] ?? '', 10);
        if (!isNaN(n)) args.maxMessages = n;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
bcc-chat — backer-cloud-claw 命令行 Agent

用法：
  tsx bin/bcc-chat.ts [选项]

选项：
  --model <id>          模型：claude（默认）| deepseek | both（双模型路由）
  --session <id>        会话 ID，用于持久化（默认：default）
  --system <prompt>     系统提示词
  --no-memory           禁用持久化（历史仅保存在内存中）
  --session-dir <dir>   自定义会话存储目录（默认：~/.bcc/sessions）
  --max-messages <n>    保留的最大历史消息数
  --help, -h            显示此帮助

环境变量：
  ANTHROPIC_API_KEY     Claude API Key
  DEEPSEEK_API_KEY      DeepSeek API Key
  BCC_SESSION_DIR       会话存储目录
`);
}

// ─── 构建模型路由 ─────────────────────────────────────────────────────────────

async function buildModel(args: CliArgs): Promise<ModelRouter> {
  // 动态导入，避免在未安装 SDK 时报错
  const router = new ModelRouter({ enableFailover: true });
  let registered = 0;

  if ((args.model === 'claude' || args.model === 'both') && process.env['ANTHROPIC_API_KEY']) {
    const { ClaudeAdapter } = await import('@bcc/model-claude');
    router.register(new ClaudeAdapter(), { priority: 0 });
    registered++;
  }

  if ((args.model === 'deepseek' || args.model === 'both') && process.env['DEEPSEEK_API_KEY']) {
    const { DeepSeekAdapter } = await import('@bcc/model-deepseek');
    const isFallback = args.model === 'both';
    router.register(new DeepSeekAdapter(), { priority: 1, fallback: isFallback });
    registered++;
  }

  // 没有 API Key：提示并退出
  if (registered === 0) {
    console.error(`
错误：未找到 API Key。请设置以下环境变量之一：

  export ANTHROPIC_API_KEY=sk-ant-...   # 使用 Claude
  export DEEPSEEK_API_KEY=sk-...        # 使用 DeepSeek

然后重新运行：
  ANTHROPIC_API_KEY=sk-ant-... tsx bin/bcc-chat.ts
`);
    process.exit(1);
  }

  return router;
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const model = await buildModel(args);

  const sessionDir = args.sessionDir
    ?? process.env['BCC_SESSION_DIR']
    ?? undefined;

  const memory = args.noMemory
    ? undefined
    : new FileMemoryStore(sessionDir !== undefined ? { dir: sessionDir } : {});

  const cli = await CliChannel.create({
    model,
    ...(args.system !== undefined && { system: args.system }),
    ...(memory !== undefined && { memory }),
    sessionId: args.sessionId,
    ...(args.maxMessages !== undefined && { maxMessages: args.maxMessages }),
  });

  await cli.start();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
