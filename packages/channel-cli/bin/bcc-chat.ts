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
import { randomUUID } from 'node:crypto';
import { ModelRouter } from '@bcc/model-core';
import { FileMemoryStore } from '@bcc/memory-fs';
import { FileEpisodicStore, EpisodeGenerator } from '@bcc/memory-episodic';
import { getBuiltinTool } from '@bcc/skills';
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
import type { Tool } from '@bcc/foundation';
import { WorkerSession, WorkerRegistry } from '../src/worker-session.js';
import { ChatStore, MessagingService } from '@bcc/messaging';
import { TaskStore, TaskManager } from '@bcc/task';

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

// ─── 情节摘要辅助 ────────────────────────────────────────────────────────────

/**
 * 为情节摘要生成找一个可用的模型适配器。
 * 优先使用当前活跃 WorkerSession 绑定的模型实例。
 */
async function getAdapterForSession(
  session: WorkerSession,
  modelInstances: ModelInstanceConfig[],
) {
  const modelId = session.currentModel;
  const instance = modelInstances.find(m => m.id === modelId)
    ?? modelInstances.find(m => m.primary)
    ?? modelInstances[0];
  if (!instance) return null;
  try {
    return await createAdapter(instance);
  } catch {
    return null;
  }
}

// ─── 情节记忆注入 ─────────────────────────────────────────────────────────────

/**
 * 从 EpisodicStore 加载 Worker 最近 N 条情节摘要，格式化为 system prompt 片段。
 * 若 store 为 undefined 或无记忆，返回空字符串。
 */
async function buildMemorySection(
  store: FileEpisodicStore | undefined,
  workerId: string,
  limit = 5,
): Promise<string> {
  if (!store) return '';

  const episodes = await store.recent(workerId, limit);
  if (episodes.length === 0) return '';

  const lines: string[] = ['## 过往记忆（按时间倒序）'];
  for (const ep of episodes) {
    const date = new Date(ep.createdAt).toLocaleDateString('zh-CN');
    lines.push(`- [${date}] ${ep.summary}`);
    if (ep.keyPoints.length > 0) {
      for (const kp of ep.keyPoints) {
        lines.push(`  • ${kp}`);
      }
    }
  }
  return lines.join('\n');
}

// ─── 跨 Worker 委托工具 ──────────────────────────────────────────────────────

/**
 * 为 Worker 创建「委托给同事」工具。
 * Worker A 可在 LLM 工具调用时将子任务路由给 Worker B，
 * 结果以字符串形式返回给 A 的模型上下文。
 */
function createDelegateTool(fromWorker: Worker, targets: Worker[], company: Company): Tool {
  const targetDesc = targets
    .map(w => `  - ${w.profile.id}（${w.profile.name}）：${w.profile.description}`)
    .join('\n');

  return {
    definition: {
      name: 'call_worker',
      description: `将子任务委托给团队中的其他成员，获取他们的专业回复后继续处理。\n可委托的成员：\n${targetDesc}`,
      inputSchema: {
        type: 'object',
        properties: {
          worker_id: {
            type: 'string',
            description: '目标员工的 ID',
            enum: targets.map(w => w.profile.id),
          },
          message: {
            type: 'string',
            description: '发给目标员工的任务描述或问题',
          },
        },
        required: ['worker_id', 'message'],
      },
    },
    handler: async (input) => {
      const { worker_id, message } = input as { worker_id: string; message: string };
      const thread = company.openThread(`${fromWorker.profile.id} → ${worker_id}`, [fromWorker.profile.id, worker_id]);
      try {
        const replies = await company.send(worker_id, message, thread.id, fromWorker.profile.id);
        company.closeThread(thread.id);
        if (replies.length === 0) return `（${worker_id} 未返回任何内容）`;
        return replies.map(r => r.content).join('\n');
      } catch (err) {
        company.closeThread(thread.id);
        throw err;
      }
    },
  };
}

// ─── Worker 身份 & 异步沟通系统 Prompt 构建 ──────────────────────────────────

/**
 * 为某个 Worker 生成"同事名录"片段，注入到 system prompt。
 * Worker 需要知道团队中有哪些人，才能主动发消息给他们。
 */
function buildColleagueSection(allDefs: WorkerConfig[], currentWorkerId: string): string {
  const others = allDefs.filter(d => d.id !== currentWorkerId);
  if (others.length === 0) return '';

  const lines = ['## 你的同事'];
  for (const d of others) {
    lines.push(`- **${d.name}**（ID: \`${d.id}\`）：${d.description ?? d.role}`);
  }
  return lines.join('\n');
}

/**
 * 生成异步协作工作方式说明，告诉 Worker 如何使用消息系统和任务系统。
 * 这是让 Worker 真正拟人化的关键 prompt 片段。
 */
function buildAsyncCommsGuide(): string {
  return `## 工作方式
你是一人公司中的 AI 员工。公司内的沟通方式类似飞书/微信：
- **查收消息**：同事或老板会给你留言，消息不会打断你，你需要主动使用 \`check_inbox\` 工具查收。每次对话开始时系统会告知你是否有未读消息。
- **发送消息**：使用 \`send_message\` 工具给同事发异步消息（填写会话 ID 和内容）。对方会在他们的工作时间查收，无需等待即时回复。
- **管理任务**：使用 \`list_tasks\` 查看待办，\`create_task\` 创建新任务，\`update_task_status\` 更新进度。
- **主动汇报**：完成重要任务后，主动给相关同事或老板发消息告知进展。`;
}

// ─── 构建 WorkerRegistry（新 Org 模式）──────────────────────────────────────

interface WorkerBuildResult {
  registry: WorkerRegistry;
  company: Company;
}

async function buildWorkerRegistry(
  workerDefs: WorkerConfig[],
  modelInstances: ModelInstanceConfig[],
  memory: FileMemoryStore | undefined,
  episodicStore: FileEpisodicStore | undefined,
): Promise<WorkerBuildResult | null> {
  if (workerDefs.length === 0) return null;

  // Company 提供共享 tokenTracker + eventBus（为后续管理后台对接做准备）
  const company = new Company({ name: '我的团队' });
  const registry = new WorkerRegistry();
  const allWorkers: Worker[] = [];

  // 共享的异步消息服务（所有 Worker 共用一个 ChatStore）
  const chatStore = new ChatStore();
  const messagingService = new MessagingService({ store: chatStore, eventBus: company.eventBus });

  // 共享的任务存储（每个 Worker 独立管理各自的任务）
  const taskStore = new TaskStore();

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

      // ── 构建 system prompt（四个层次）──────────────────────────────────────
      // 1. 身份头部：告诉 Worker 自己是谁
      const identityHeader = def.description
        ? `你的名字是「${def.name}」。${def.description}`
        : `你的名字是「${def.name}」。`;

      // 2. 情节记忆：跨会话长期记忆（过去的工作摘要）
      const memorySection = await buildMemorySection(episodicStore, def.id);

      // 3. 同事名录：让 Worker 知道团队成员，可以主动沟通
      const colleagueSection = buildColleagueSection(workerDefs, def.id);

      // 4. 工作方式：异步沟通协议（消息 / 任务 / 汇报）
      const asyncCommsGuide = workerDefs.length > 1 ? buildAsyncCommsGuide() : '';

      const fullSystem = [
        identityHeader,
        def.role || '',
        memorySection,
        colleagueSection,
        asyncCommsGuide,
      ].filter(Boolean).join('\n\n').trim();

      // 每个 Worker 拥有独立的 TaskManager（任务存储隔离）
      const taskManager = new TaskManager({ store: taskStore, workerId: def.id, eventBus: company.eventBus });

      // 可选：审视引擎（心跳用，使用更便宜的模型降低后台成本）
      let reviewEngineOptions;
      if (def.reviewModelId) {
        const reviewModelInstance = modelInstances.find(m => m.id === def.reviewModelId);
        if (reviewModelInstance) {
          const reviewAdapter = await createAdapter(reviewModelInstance);
          reviewEngineOptions = { model: reviewAdapter, system: fullSystem };
        }
      }

      const worker = await Worker.create({
        profile: {
          id:          def.id,
          name:        def.name,
          role:        def.description || def.name,  // 职位描述（非 system prompt）
          skills:      def.skills,
          description: def.description ?? '',
          modelId:     def.modelId,
          ...(def.reviewModelId && { reviewModelId: def.reviewModelId }),
        },
        engineOptions: {
          model:  adapter,
          system: fullSystem,
          // 每个 Worker 使用独立 sessionId，历史文件互相隔离
          ...(memory !== undefined && { memory, sessionId: `worker-${def.id}` }),
        },
        ...(reviewEngineOptions && { reviewEngineOptions }),
        tokenTracker:  company.tokenTracker,
        eventBus:      company.eventBus,
        inboxService:  messagingService,
        taskService:   taskManager,
      });

      // 注册配置的工具
      for (const toolId of def.tools ?? []) {
        const tool = getBuiltinTool(toolId);
        if (tool) {
          worker.registerTool(tool);
        } else {
          console.warn(`  ⚠ Worker "${def.id}" 的工具 "${toolId}" 未找到，已跳过`);
        }
      }

      company.addWorker(worker);
      allWorkers.push(worker);
      registry.register(new WorkerSession(worker, company.tokenTracker));
    } catch (err) {
      console.warn(`  ⚠ Worker "${def.id}" 创建失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (registry.size === 0) return null;

  // ── 注入跨 Worker 委托工具（多于 1 名 Worker 时） ──────────────────────────
  if (allWorkers.length > 1) {
    for (const worker of allWorkers) {
      const others = allWorkers.filter(w => w.profile.id !== worker.profile.id);
      worker.registerTool(createDelegateTool(worker, others, company));
    }
    console.log(`  🔗 已为所有员工注入「call_worker」委托工具（Worker 间可直接传递任务）`);
  }

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

  return { registry, company };
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

  // 情节记忆存储（与 WorkingMemory 存储目录并列，可独立配置）
  const episodicStore = enableMem
    ? new FileEpisodicStore({
        ...(sessionDir ? { dir: sessionDir.replace(/sessions$/, 'episodes') } : {}),
      })
    : undefined;

  // ── 模式 1：Worker 模式（优先）──────────────────────────────────────────
  const workerDefs = config.workers ?? [];
  if (workerDefs.length > 0) {
    const buildResult = await buildWorkerRegistry(workerDefs, config.models, memory, episodicStore);
    if (buildResult) {
      const { registry: workerRegistry } = buildResult;
      const initialSession = resolveInitialWorkerSession(workerRegistry, workerDefs, args.worker);
      const cli = await CliChannel.create({ agent: initialSession, workerRegistry });
      await cli.start();

      // 会话结束后，生成情节摘要（最多等 5 秒，超时静默忽略）
      if (episodicStore) {
        const modelAdapter = await getAdapterForSession(initialSession, config.models);
        if (modelAdapter) {
          const generator = new EpisodeGenerator(modelAdapter);
          const summaryTasks = workerRegistry.list().map(s =>
            s.summarize(episodicStore, generator, `worker-${s.workerId}`)
          );
          await Promise.race([
            Promise.allSettled(summaryTasks),
            new Promise(r => setTimeout(r, 5000)),
          ]);
        }
      }
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
