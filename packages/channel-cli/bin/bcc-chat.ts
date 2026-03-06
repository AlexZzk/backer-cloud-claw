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
import { loadConfig, type ModelInstanceConfig, type ProviderType, type AgentConfig } from '../src/config.js';
import { BccAgent, AgentRegistry } from '@bcc/agents';

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
  OPENAI_API_KEY        覆盖所有 openai 实例的 Key
  DASHSCOPE_API_KEY     覆盖所有 bailian 实例的 Key
  DEEPSEEK_API_KEY      覆盖所有 deepseek 实例的 Key
  BCC_SESSION_DIR       会话存储目录
  BCC_DEBUG=1           等同于 --debug
`);
}

// ─── 提供商预设（协议层派发依据）────────────────────────────────────────────

/**
 * 每个提供商对应的底层协议。
 *   anthropic → @bcc/protocol-anthropic (AnthropicAdapter)
 *   openai    → @bcc/protocol-openai    (OpenAIAdapter)
 */
const PROVIDER_PROTOCOL: Record<ProviderType, 'anthropic' | 'openai'> = {
  claude:   'anthropic',
  openai:   'openai',
  deepseek: 'openai',
  bailian:  'openai',
  custom:   'openai',
};

/** 提供商默认 baseUrl（未填写 baseUrl 时使用）。空字符串表示使用 SDK 内置地址。 */
const PROVIDER_DEFAULT_BASE_URL: Record<ProviderType, string> = {
  claude:   '',  // Anthropic SDK 内置
  openai:   'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  bailian:  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  custom:   '',
};

/** 提供商默认模型名 */
const PROVIDER_DEFAULT_MODEL: Record<ProviderType, string> = {
  claude:   'claude-sonnet-4-5',
  openai:   'gpt-4o',
  deepseek: 'deepseek-chat',
  bailian:  'qwen-plus',
  custom:   '',
};

/** 覆盖 API Key 的环境变量名 */
const PROVIDER_ENV_KEY: Partial<Record<ProviderType, string>> = {
  claude:   'ANTHROPIC_API_KEY',
  openai:   'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  bailian:  'DASHSCOPE_API_KEY',
};

/** 已知支持工具调用的提供商（custom 由用户自行保证） */
const PROVIDER_SUPPORT_TOOLS: Record<ProviderType, boolean> = {
  claude:   true,
  openai:   true,
  deepseek: true,
  bailian:  true,
  custom:   false,  // 私有部署工具调用能力不确定，保守设为 false
};

// ─── 从 ModelInstanceConfig 创建适配器 ──────────────────────────────────────

async function createAdapter(instance: ModelInstanceConfig) {
  const protocol = PROVIDER_PROTOCOL[instance.provider];

  // 环境变量可覆盖 API Key
  const envKey = PROVIDER_ENV_KEY[instance.provider];
  const apiKey = (envKey && process.env[envKey]) || instance.apiKey;

  if (protocol === 'anthropic') {
    const { AnthropicAdapter } = await import('@bcc/protocol-anthropic');
    return new AnthropicAdapter({
      name:   instance.id,
      apiKey,
      ...(instance.model   && { model:   instance.model }),
      ...(instance.baseUrl && { baseURL: instance.baseUrl }),
    });
  }

  // protocol === 'openai' — 通用 OpenAI 兼容协议
  const { OpenAIAdapter } = await import('@bcc/protocol-openai');

  const baseUrl = instance.baseUrl || PROVIDER_DEFAULT_BASE_URL[instance.provider];
  if (!baseUrl) {
    throw new Error(`实例 "${instance.id}"（${instance.provider}）缺少 baseUrl，请在配置中填写 API 地址。`);
  }

  const model = instance.model || PROVIDER_DEFAULT_MODEL[instance.provider];
  if (!model) {
    throw new Error(`实例 "${instance.id}"（${instance.provider}）缺少模型名称，请在配置中填写 model。`);
  }

  return new OpenAIAdapter({
    name:         instance.id,
    apiKey,
    baseUrl,
    model,
    provider:     instance.provider,
    supportTools: PROVIDER_SUPPORT_TOOLS[instance.provider],
  });
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

// ─── 构建 AgentRegistry ───────────────────────────────────────────────────────

/**
 * 根据 config.agents 构建 AgentRegistry。
 *
 * 构建顺序：
 *   1. 为每个 Agent 创建对应的模型适配器（引用 config.models）
 *   2. 实例化 BccAgent（使用 AgentEngine，含 tool-use loop）
 *   3. 将所有 Agent 注册到 AgentRegistry
 *   4. 为 primary Agent 注入其他所有 Agent 作为委托工具（Orchestrator 模式）
 *
 * @returns 若 agentDefs 为空，返回 null（使用普通 ModelRouter 模式）
 */
async function buildAgentRegistry(
  agentDefs: AgentConfig[],
  modelInstances: ModelInstanceConfig[],
  memory?: FileMemoryStore,
): Promise<AgentRegistry | null> {
  if (agentDefs.length === 0) return null;

  const registry = new AgentRegistry();

  for (const def of agentDefs) {
    // 找到 Agent 指定的模型实例（或 primary 模型）
    const modelId = def.model;
    const modelInstance = modelId
      ? modelInstances.find(m => m.id === modelId)
      : modelInstances.find(m => m.primary) ?? modelInstances[0];

    if (!modelInstance) {
      console.warn(`  ⚠ Agent "${def.id}" 找不到模型实例 "${modelId ?? 'primary'}"，已跳过`);
      continue;
    }

    try {
      const adapter = await createAdapter(modelInstance);
      const agent = await BccAgent.create({
        def,
        model: adapter,
        tools: [],
        ...(memory && { memory }),
      });
      registry.register(agent);
    } catch (err) {
      console.warn(`  ⚠ Agent "${def.id}" 创建失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (registry.size === 0) return null;

  // Orchestrator 模式：primary Agent 自动获得其他所有 Agent 作为委托工具
  const primary = registry.getPrimary();
  if (primary && registry.size > 1) {
    const subTools = registry.asTools(primary.def.id);
    for (const tool of subTools) {
      primary.registerTool(tool);
    }
    console.log(`  ⚡ Orchestrator 模式：${primary.def.name}（${primary.def.id}）可委托给 ${subTools.length} 个子 Agent`);
  }

  return registry;
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

  const sessionDir  = args.sessionDir ?? process.env['BCC_SESSION_DIR'] ?? config.defaults.sessionDir;
  const enableMem   = args.noMemory ? false : config.defaults.enableMemory;
  const sessionId   = args.sessionId ?? 'default';
  const maxMessages = args.maxMessages ?? config.defaults.maxMessages;
  const system      = args.system;

  const memory = enableMem
    ? new FileMemoryStore({
        ...(sessionDir ? { dir: sessionDir } : {}),
        ...(maxMessages > 0 ? { maxMessages } : {}),
      })
    : undefined;

  // ── 多 Agent 模式 vs 普通模式 ────────────────────────────────────────────
  const agentDefs = config.agents ?? [];
  const agentRegistry = await buildAgentRegistry(agentDefs, config.models, memory);

  let cli: CliChannel;

  if (agentRegistry) {
    // 多 Agent 模式：primary Agent 作为主对话对象（已内置子 Agent 委托工具）
    if (system !== undefined) {
      console.warn('  ⚠ --system 在多 Agent 模式下不生效（各 Agent 使用配置中各自的 system 提示词）');
    }
    const primary = agentRegistry.getPrimary()!;
    cli = await CliChannel.create({
      agent:          primary,
      agentRegistry,
    });
  } else {
    // 普通模式：ModelRouter（故障转移）
    const modelRouter = await buildRouter(config.models, args.model);
    cli = await CliChannel.create({
      model:          modelRouter,
      ...(system      !== undefined && { system }),
      ...(memory      !== undefined && { memory }),
      sessionId,
      ...(maxMessages > 0           && { maxMessages }),
    });
  }

  await cli.start();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
