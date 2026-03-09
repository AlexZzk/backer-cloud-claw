#!/usr/bin/env node
/**
 * bcc chat — 交互式命令行 AI 对话
 *
 * 配置优先级（高 → 低）：
 *   1. CLI 参数
 *   2. 环境变量（ANTHROPIC_API_KEY、DASHSCOPE_API_KEY 等）
 *   3. 配置文件（~/.bcc/config.json，由 bcc-init 生成）
 *   4. 内置默认值
 *
 * 运行模式（优先级从高到低）：
 *   1. Worker 模式：config.workers 有内容 → 使用 @bcc/org 的 Worker 架构
 *   2. 多 Agent 模式：config.agents 有内容 → 使用 BccAgent Orchestrator
 *   3. 普通模式：ModelRouter 单对话（默认）
 */
import { ModelRouter } from '@bcc/model-core';
import { FileMemoryStore } from '@bcc/memory-fs';
import { CliChannel } from '../src/index.js';
import {
  loadConfig,
  type ModelInstanceConfig,
  type ProviderType,
  type AgentConfig,
  type WorkerConfig,
} from '../src/config.js';
import { BccAgent, AgentRegistry } from '@bcc/agents';
import { Worker, Company } from '@bcc/org';
import { WorkerSession, WorkerRegistry } from '../src/worker-session.js';

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

interface CliArgs {
  model:       string | undefined;
  /** Worker 模式下指定对话的 Worker ID */
  worker:      string | undefined;
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
    model: undefined, worker: undefined, sessionId: undefined, system: undefined,
    noMemory: false, sessionDir: undefined, maxMessages: undefined,
    debug: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--model':        args.model      = argv[++i]; break;
      case '--worker':       args.worker     = argv[++i]; break;
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
  --worker <id>         指定 Worker ID（Worker 模式）
  --model <id>          指定主模型实例 ID（普通模式）
  --session <id>        会话 ID，用于持久化（默认：default）
  --system <prompt>     系统提示词（普通模式）
  --no-memory           禁用持久化
  --session-dir <dir>   自定义会话存储目录
  --max-messages <n>    最大历史消息数
  --debug               输出详细错误信息（等同于 BCC_DEBUG=1）
  --help, -h            显示此帮助

运行模式：
  Worker 模式    config.workers 有配置时自动启用，--worker 选择员工
  多 Agent 模式  config.agents  有配置时启用（旧版 Orchestrator）
  普通模式       默认 ModelRouter 单对话

配置：
  首次使用请运行 pnpm bcc-init 完成初始化。
  配置文件位置：~/.bcc/config.json

环境变量：
  ANTHROPIC_API_KEY     覆盖所有 claude 实例的 Key
  OPENAI_API_KEY        覆盖所有 openai 实例的 Key
  DASHSCOPE_API_KEY     覆盖所有 bailian 实例的 Key
  DEEPSEEK_API_KEY      覆盖所有 deepseek 实例的 Key
  BCC_SESSION_DIR       会话存储目录
  BCC_DEBUG=1           等同于 --debug
`);
}

// ─── 提供商预设 ───────────────────────────────────────────────────────────────

const PROVIDER_PROTOCOL: Record<ProviderType, 'anthropic' | 'openai'> = {
  claude:   'anthropic',
  openai:   'openai',
  deepseek: 'openai',
  bailian:  'openai',
  custom:   'openai',
};

const PROVIDER_DEFAULT_BASE_URL: Record<ProviderType, string> = {
  claude:   '',
  openai:   'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  bailian:  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  custom:   '',
};

const PROVIDER_DEFAULT_MODEL: Record<ProviderType, string> = {
  claude:   'claude-sonnet-4-5',
  openai:   'gpt-4o',
  deepseek: 'deepseek-chat',
  bailian:  'qwen-plus',
  custom:   '',
};

const PROVIDER_ENV_KEY: Partial<Record<ProviderType, string>> = {
  claude:   'ANTHROPIC_API_KEY',
  openai:   'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  bailian:  'DASHSCOPE_API_KEY',
};

const PROVIDER_SUPPORT_TOOLS: Record<ProviderType, boolean> = {
  claude:   true,
  openai:   true,
  deepseek: true,
  bailian:  true,
  custom:   false,
};

// ─── 适配器工厂 ───────────────────────────────────────────────────────────────

async function createAdapter(instance: ModelInstanceConfig) {
  const protocol = PROVIDER_PROTOCOL[instance.provider];
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

// ─── 构建 ModelRouter（普通模式）────────────────────────────────────────────

async function buildRouter(
  models: ModelInstanceConfig[],
  forceModelId: string | undefined,
): Promise<ModelRouter> {
  if (models.length === 0) {
    console.error(`\n错误：配置中没有任何模型实例。\n  请先运行初始化向导：\n    pnpm bcc-init\n`);
    process.exit(1);
  }

  const router = new ModelRouter({ enableFailover: true });
  let registered = 0;

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
    console.error(`\n错误：所有模型实例均加载失败。\n  请检查配置或重新运行：\n    pnpm bcc-init\n`);
    process.exit(1);
  }

  return router;
}

// ─── 构建 AgentRegistry（旧版多 Agent 模式）─────────────────────────────────

async function buildAgentRegistry(
  agentDefs: AgentConfig[],
  modelInstances: ModelInstanceConfig[],
  memory?: FileMemoryStore,
): Promise<AgentRegistry | null> {
  if (agentDefs.length === 0) return null;

  const registry = new AgentRegistry();

  for (const def of agentDefs) {
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

// ─── 构建 WorkerRegistry（新 Org 模式）──────────────────────────────────────

async function buildWorkerRegistry(
  workerDefs: WorkerConfig[],
  modelInstances: ModelInstanceConfig[],
): Promise<WorkerRegistry | null> {
  if (workerDefs.length === 0) return null;

  // Company 提供共享 tokenTracker + eventBus（为后续管理后台对接做准备）
  const company = new Company({ name: '我的团队' });
  const registry = new WorkerRegistry();

  for (const def of workerDefs) {
    const modelInstance = modelInstances.find(m => m.id === def.modelId)
      ?? modelInstances.find(m => m.primary)
      ?? modelInstances[0];

    if (!modelInstance) {
      console.warn(`  ⚠ Worker "${def.id}" 找不到模型实例 "${def.modelId}"，已跳过`);
      continue;
    }

    try {
      const adapter = await createAdapter(modelInstance);
      const worker = await Worker.create({
        profile: {
          id:          def.id,
          name:        def.name,
          role:        def.id,
          skills:      def.skills,
          description: def.description,
          modelId:     def.modelId,
        },
        engineOptions: {
          model:  adapter,
          system: def.role,  // role 字段作为 system prompt
        },
        tokenTracker: company.tokenTracker,
        eventBus:     company.eventBus,
      });

      company.addWorker(worker);
      registry.register(new WorkerSession(worker, company.tokenTracker));
    } catch (err) {
      console.warn(`  ⚠ Worker "${def.id}" 创建失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (registry.size === 0) return null;

  console.log(`  👥 Worker 模式（${registry.size} 名员工）：`);
  for (const session of registry.list()) {
    const cfg = workerDefs.find(d => d.id === session.workerId);
    const marker = cfg?.primary ? '★' : '○';
    console.log(`     ${marker} ${session.workerName}（${session.workerId}）[${session.currentModel}]`);
    if (session.workerSkills.length > 0) {
      console.log(`       技能：${session.workerSkills.join('、')}`);
    }
  }
  console.log();

  return registry;
}

function resolveInitialWorkerSession(
  registry: WorkerRegistry,
  workerDefs: WorkerConfig[],
  forceWorkerId: string | undefined,
): WorkerSession {
  if (forceWorkerId) {
    const target = registry.find(forceWorkerId);
    if (!target) {
      const ids = registry.list().map(s => s.workerId).join('、');
      console.error(`错误：找不到 Worker "${forceWorkerId}"，可用 ID：${ids}`);
      process.exit(1);
    }
    return target;
  }

  const primaryDef = workerDefs.find(d => d.primary);
  if (primaryDef) {
    const primary = registry.find(primaryDef.id);
    if (primary) return primary;
  }

  const first = registry.getPrimary();
  if (!first) { console.error('错误：Worker 注册表为空。'); process.exit(1); }
  return first;
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
    console.error(`\n错误：尚未找到配置文件。\n  请先运行初始化向导：\n    pnpm bcc-init\n`);
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

  // ── 模式 1：Worker 模式（优先）──────────────────────────────────────────
  const workerDefs = config.workers ?? [];
  if (workerDefs.length > 0) {
    const workerRegistry = await buildWorkerRegistry(workerDefs, config.models);
    if (workerRegistry) {
      const initialSession = resolveInitialWorkerSession(workerRegistry, workerDefs, args.worker);
      const cli = await CliChannel.create({ agent: initialSession, workerRegistry });
      await cli.start();
      return;
    }
  }

  // ── 模式 2：多 Agent 模式（旧版 Orchestrator）──────────────────────────
  const agentDefs = config.agents ?? [];
  const agentRegistry = await buildAgentRegistry(agentDefs, config.models, memory);

  if (agentRegistry) {
    if (system !== undefined) {
      console.warn('  ⚠ --system 在多 Agent 模式下不生效');
    }
    const primary = agentRegistry.getPrimary()!;
    const cli = await CliChannel.create({ agent: primary, agentRegistry });
    await cli.start();
    return;
  }

  // ── 模式 3：普通模式（ModelRouter）────────────────────────────────────
  const modelRouter = await buildRouter(config.models, args.model);
  const cli = await CliChannel.create({
    model:          modelRouter,
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
