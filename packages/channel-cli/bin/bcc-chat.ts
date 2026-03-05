#!/usr/bin/env node
/**
 * bcc chat — 交互式命令行 AI 对话
 *
 * 配置优先级（高 → 低）：
 *   1. CLI 参数
 *   2. 环境变量（ANTHROPIC_API_KEY、DASHSCOPE_API_KEY 等）
 *   3. 配置文件（~/.bcc/config.json，由 bcc-init 生成）
 *   4. 内置默认值
 */
import { ModelRouter } from '@bcc/model-core';
import { FileMemoryStore } from '@bcc/memory-fs';
import { CliChannel } from '../src/index.js';
import { loadConfig, type ModelInstanceConfig } from '../src/config.js';

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

interface CliArgs {
  /** 指定主模型实例 ID（覆盖配置文件中的 primary） */
  model:       string | undefined;
  sessionId:   string | undefined;
  system:      string | undefined;
  noMemory:    boolean;
  sessionDir:  string | undefined;
  maxMessages: number | undefined;
  debug:       boolean;
  help:        boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: undefined, sessionId: undefined, system: undefined,
    noMemory: false, sessionDir: undefined, maxMessages: undefined,
    debug: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--model':        args.model      = argv[++i]; break;
      case '--session':      args.sessionId  = argv[++i]; break;
      case '--system':       args.system     = argv[++i]; break;
      case '--no-memory':    args.noMemory   = true; break;
      case '--session-dir':  args.sessionDir = argv[++i]; break;
      case '--max-messages': { const n = parseInt(argv[++i] ?? '', 10); if (!isNaN(n)) args.maxMessages = n; break; }
      case '--debug':        args.debug = true; break;
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

选项：
  --model <id>          指定主模型实例 ID（在 /model 列表中选择）
  --session <id>        会话 ID，用于持久化（默认：default）
  --system <prompt>     系统提示词
  --no-memory           禁用持久化
  --session-dir <dir>   自定义会话存储目录
  --max-messages <n>    最大历史消息数
  --debug               输出详细错误信息（等同于 BCC_DEBUG=1）
  --help, -h            显示此帮助

配置：
  首次使用请运行 pnpm bcc-init 完成初始化。
  配置文件位置：~/.bcc/config.json

环境变量（可覆盖单个实例的 API Key）：
  ANTHROPIC_API_KEY     覆盖所有 claude 实例的 Key
  DASHSCOPE_API_KEY     覆盖所有 bailian 实例的 Key
  DEEPSEEK_API_KEY      覆盖所有 deepseek 实例的 Key
  BCC_SESSION_DIR       会话存储目录
  BCC_DEBUG=1           等同于 --debug
`);
}

// ─── 从 ModelInstanceConfig 创建适配器 ──────────────────────────────────────

async function createAdapter(instance: ModelInstanceConfig) {
  switch (instance.provider) {
    case 'claude': {
      const { ClaudeAdapter } = await import('@bcc/model-claude');
      const key = process.env['ANTHROPIC_API_KEY'] || instance.apiKey;
      return new ClaudeAdapter({
        apiKey: key,
        ...(instance.model   && { model:   instance.model }),
        ...(instance.baseUrl && { baseURL: instance.baseUrl }),
      });
    }
    case 'bailian': {
      const { BailianAdapter } = await import('@bcc/model-bailian');
      const key = process.env['DASHSCOPE_API_KEY'] || instance.apiKey;
      return new BailianAdapter({
        apiKey: key,
        ...(instance.model   && { model:   instance.model }),
        ...(instance.baseUrl && { baseUrl: instance.baseUrl }),
      });
    }
    case 'deepseek': {
      const { DeepSeekAdapter } = await import('@bcc/model-deepseek');
      const key = process.env['DEEPSEEK_API_KEY'] || instance.apiKey;
      return new DeepSeekAdapter({
        apiKey: key,
        ...(instance.model   && { model:   instance.model }),
        ...(instance.baseUrl && { baseURL: instance.baseUrl }),
      });
    }
    case 'custom': {
      const { OpenAICompatAdapter } = await import('@bcc/model-openai-compat');
      if (!instance.baseUrl) throw new Error(`自定义实例 "${instance.id}" 缺少 baseUrl`);
      if (!instance.model)   throw new Error(`自定义实例 "${instance.id}" 缺少 model 名称`);
      return new OpenAICompatAdapter({
        name:   instance.id,
        apiKey: instance.apiKey,
        baseUrl: instance.baseUrl,
        model:  instance.model,
      });
    }
    default:
      throw new Error(`未知提供商类型：${String((instance as { provider: unknown }).provider)}`);
  }
}

// ─── 构建 ModelRouter ─────────────────────────────────────────────────────────

async function buildRouter(
  models: ModelInstanceConfig[],
  forceModelId: string | undefined,
): Promise<ModelRouter> {
  if (models.length === 0) {
    console.error(`
错误：配置中没有任何模型实例。
  请先运行初始化向导：
    pnpm bcc-init
`);
    process.exit(1);
  }

  const router = new ModelRouter({ enableFailover: true });
  let registered = 0;

  // 如果 CLI 指定了 --model，把它提到最前面并设为 primary
  const ordered = forceModelId
    ? [
        ...models.filter(m => m.id === forceModelId),
        ...models.filter(m => m.id !== forceModelId),
      ]
    : [
        ...models.filter(m => m.primary),
        ...models.filter(m => !m.primary && !m.fallback),
        ...models.filter(m => !m.primary && m.fallback),
      ];

  for (let i = 0; i < ordered.length; i++) {
    const instance = ordered[i]!;
    try {
      const adapter = await createAdapter(instance);
      const isPrimary = forceModelId ? instance.id === forceModelId : (instance.primary ?? i === 0);
      router.register(adapter, {
        priority: i,
        ...(!isPrimary && instance.fallback && { fallback: true }),
      });
      registered++;
    } catch (err) {
      console.warn(`  ⚠ 加载 "${instance.id}" 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (registered === 0) {
    console.error(`
错误：所有模型实例均加载失败。
  请检查配置或重新运行：
    pnpm bcc-init
`);
    process.exit(1);
  }

  return router;
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  if (args.debug || process.env['BCC_DEBUG'] === '1') {
    process.env['BCC_DEBUG'] = '1';
  }

  const config = await loadConfig();

  if (!config) {
    console.error(`
错误：尚未找到配置文件。
  请先运行初始化向导：
    pnpm bcc-init
`);
    process.exit(1);
  }

  const modelRouter = await buildRouter(config.models, args.model);

  const sessionDir  = args.sessionDir ?? process.env['BCC_SESSION_DIR'] ?? config.defaults.sessionDir;
  const enableMem   = args.noMemory ? false : config.defaults.enableMemory;
  const sessionId   = args.sessionId ?? 'default';
  const maxMessages = args.maxMessages ?? config.defaults.maxMessages;
  const system      = args.system;

  const memory = enableMem
    ? new FileMemoryStore(sessionDir ? { dir: sessionDir } : {})
    : undefined;

  const cli = await CliChannel.create({
    model: modelRouter,
    ...(system      !== undefined && { system }),
    ...(memory      !== undefined && { memory }),
    sessionId,
    ...(maxMessages > 0           && { maxMessages }),
  });

  await cli.start();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
