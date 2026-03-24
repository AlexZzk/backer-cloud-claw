/**
 * @bcc/channel-http — HTTP/SSE API 服务器
 *
 * 使用 Node.js 内置 http 模块，零额外依赖。
 * 为 Web 前端（packages/web）提供 REST + SSE 接口。
 *
 * 路由表：
 *   GET    /api/health
 *   GET    /api/workers                   获取 Worker 列表（每次热重载 config）
 *   POST   /api/workers                   创建 Worker
 *   PUT    /api/workers/:id               更新 Worker
 *   DELETE /api/workers/:id              删除 Worker
 *   GET    /api/models                    获取模型列表（每次热重载 config）
 *   POST   /api/models                    创建模型实例
 *   PUT    /api/models/:id               更新模型实例
 *   DELETE /api/models/:id              删除模型实例
 *   GET    /api/config                    获取脱敏配置
 *   POST   /api/workers/:id/sessions      创建会话
 *   GET    /api/workers/:id/sessions      列出会话
 *   GET    /api/sessions/:id             获取会话+消息
 *   DELETE /api/sessions/:id            删除会话
 *   POST   /api/sessions/:id/messages    发消息（SSE 流）
 *   GET    /api/analytics/tokens         token 统计
 *   GET    /api/skills                   列出本地技能（内置 + 用户 + 项目）
 *   POST   /api/skills                   创建用户技能
 *   DELETE /api/skills/:name             删除用户技能
 *   GET    /api/skills/hub?q=            在 SkillHub 搜索技能
 *
 * Worker 间异步聊天监控（依赖 @bcc/messaging）：
 *   GET    /api/chats                     列出所有 Worker 间聊天会话
 *   GET    /api/chats/:chatId             获取会话元信息
 *   GET    /api/chats/:chatId/messages    获取会话消息历史
 *   POST   /api/chats                     创建/打开直聊会话
 *
 * Worker 心跳机制（对标 OpenClaw heartbeat）：
 *   GET    /api/events                    SSE 全局事件流（心跳、消息、任务事件实时推送）
 *   POST   /api/workers/:id/heartbeat     手动触发某个 Worker 的一次心跳审视
 *
 * Worker 文件工作空间：
 *   GET    /api/workspace/:workerId        工作空间信息 + 文件列表
 *   GET    /api/workspace/:workerId/file/* 下载/读取工作空间文件（支持二进制）
 *   DELETE /api/workspace/:workerId/file/* 删除工作空间文件
 *   GET    /api/shared                     共享目录文件列表
 *   GET    /api/shared/file/*             下载/读取共享目录文件
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readdir, unlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AgentEngine } from '@bcc/agent-engine';
import { getBuiltinTool, findBuiltin, SkillRegistry, saveUserSkill, deleteUserSkill, SkillHub } from '@bcc/skills';
import type { AgentInterface, AgentChunk, OrgMessage, Tool, Message } from '@bcc/foundation';
import { SessionStore } from './session-store.js';
import type { ApiWorker, ApiModel, TokenStats, TokenRecord, SseEvent } from './types.js';
import type {
  BccConfig,
  ModelInstanceConfig,
  WorkerConfig,
} from './config-loader.js';
import { saveConfig, loadConfig } from './config-loader.js';
import {
  resolveWorkspaceDir, resolveSharedDir, safePath,
  listWorkspaceFiles, listSharedFiles, getMimeType,
  createWorkspaceTools, buildWorkspaceSystemSection,
  WORKSPACE_TOOL_LIST,
} from './workspace.js';
import { ChatStore, MessagingService } from '@bcc/messaging';
import { TaskStore, TaskManager } from '@bcc/task';
import { Company, Worker } from '@bcc/org';
import { FileMemoryStore } from '@bcc/memory-fs';

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** 标准 API 响应信封 */
interface ApiEnvelope<T = unknown> {
  code: string;
  msg: string;
  data: T;
}

function ok<T>(res: ServerResponse, data: T, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  const envelope: ApiEnvelope<T> = { code: '', msg: '', data };
  res.end(JSON.stringify(envelope));
}

function notFound(res: ServerResponse) {
  cors(res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'NOT_FOUND', msg: '资源不存在', data: null }));
}

function badRequest(res: ServerResponse, message: string) {
  cors(res);
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'BAD_REQUEST', msg: message, data: null }));
}

function serverError(res: ServerResponse, message: string) {
  cors(res);
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'SERVER_ERROR', msg: message, data: null }));
}

function conflict(res: ServerResponse, message: string) {
  cors(res);
  res.writeHead(409, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'CONFLICT', msg: message, data: null }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function writeSse(res: ServerResponse, event: SseEvent) {
  res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

// ─── 路由解析 ──────────────────────────────────────────────────────────────────

interface RouteMatch {
  params: Record<string, string>;
}

function matchRoute(pattern: string, path: string): RouteMatch | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;
    const v = pathParts[i]!;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(v);
    } else if (p !== v) {
      return null;
    }
  }
  return { params };
}

// ─── 适配器工厂（与 bcc-chat.ts 共享逻辑，独立副本避免循环依赖）─────────────

const PROVIDER_PROTOCOL: Record<string, 'anthropic' | 'openai'> = {
  claude:   'anthropic',
  openai:   'openai',
  deepseek: 'openai',
  bailian:  'openai',
  custom:   'openai',
};

const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  openai:   'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  bailian:  'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  claude:   'claude-sonnet-4-5',
  openai:   'gpt-4o',
  deepseek: 'deepseek-chat',
  bailian:  'qwen-plus',
};

const PROVIDER_ENV_KEY: Record<string, string> = {
  claude:   'ANTHROPIC_API_KEY',
  openai:   'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  bailian:  'DASHSCOPE_API_KEY',
};

async function createAdapter(instance: ModelInstanceConfig) {
  const protocol = PROVIDER_PROTOCOL[instance.provider] ?? 'openai';
  const envKey = PROVIDER_ENV_KEY[instance.provider];
  const apiKey = (envKey ? process.env[envKey] : undefined) || instance.apiKey;

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
  const baseUrl = instance.baseUrl || PROVIDER_DEFAULT_BASE_URL[instance.provider] || '';
  const model   = instance.model   || PROVIDER_DEFAULT_MODEL[instance.provider]   || '';
  return new OpenAIAdapter({
    name:    instance.id,
    apiKey,
    baseUrl,
    model,
    provider: instance.provider,
    supportTools: true,
    ...(instance.insecure && { insecure: true }),
    ...(instance.noProxy  && { noProxy:  instance.noProxy }),
  });
}

// ─── WorkerChatAdapter ────────────────────────────────────────────────────────

/**
 * WorkerChatAdapter：将 Company Worker 实例包装为 AgentInterface。
 *
 * CLI 模式通过 WorkerSession 包装 Worker（位于 @bcc/channel-cli）。
 * HTTP 模式通过此 Adapter 包装，两者逻辑一致，确保"改一端，两端生效"。
 *
 * 核心行为：
 * - stream()：调用 Worker.receiveStream()，透传 tool_call/tool_result 事件
 * - 注入 getStateContext()（pending 消息 + 任务），让 Worker 感知工作现场
 * - getHistory()/clearHistory()/dumpHistory() 代理到 Worker 的 AgentEngine
 */
class WorkerChatAdapter implements AgentInterface {
  private readonly threadId: string;
  /** 本会话独立的对话历史，与其他会话隔离 */
  private sessionHistory: Message[] = [];
  /** 历史会话的摘要，在本会话首条消息时注入跨会话上下文 */
  private priorContextSummary = '';

  constructor(private readonly worker: Worker, threadId?: string) {
    this.threadId = threadId ?? randomUUID();
  }

  get currentModel(): string {
    return this.worker.profile.modelId;
  }

  listModels(): string[] {
    return [this.worker.profile.modelId];
  }

  getHistory() {
    return this.sessionHistory;
  }

  clearHistory(): void {
    this.sessionHistory = [];
  }

  /** 从外部（如磁盘恢复）加载初始对话历史 */
  loadSessionHistory(messages: Message[]): void {
    this.sessionHistory = [...messages];
  }

  /** 设置历史会话摘要，将在首条消息时自动注入上下文 */
  setPriorContextSummary(summary: string): void {
    this.priorContextSummary = summary;
  }

  dumpHistory(): string {
    return this.worker.getHistory()
      .map(m => {
        const role = m.role === 'user' ? '用户' : this.worker.profile.name;
        const text = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter((c): c is { type: 'text'; text: string } => typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
                .map((c) => (c as { type: 'text'; text: string }).text)
                .join('')
            : '';
        return `[${role}]\n${text}`;
      })
      .filter(s => s.split('\n')[1]?.trim())
      .join('\n\n');
  }

  async *stream(userInput: string): AsyncIterable<AgentChunk> {
    // 将本会话的历史切换到 Worker 引擎，实现多会话隔离
    this.worker.loadHistory(this.sessionHistory);

    // 首条消息：将历史会话摘要注入上下文，帮助 Worker 了解之前的工作背景
    let effectiveInput = userInput;
    if (this.sessionHistory.length === 0 && this.priorContextSummary) {
      effectiveInput = `【历史会话摘要 - 此前与用户沟通的要点】\n${this.priorContextSummary}\n\n---\n\n${userInput}`;
    }

    // 注入当前工作现场上下文（未读消息 + 待处理任务），与 CLI WorkerSession 保持一致
    const stateContext = await this.worker.getStateContext();
    const enrichedInput = stateContext
      ? `【当前状态提醒 - 你的工作现场】\n${stateContext}\n\n【本条消息】\n${effectiveInput}`
      : effectiveInput;

    const message: OrgMessage = {
      id: randomUUID(),
      threadId: this.threadId,
      from: 'user',
      to: this.worker.id,
      content: enrichedInput,
      timestamp: Date.now(),
    };

    for await (const event of this.worker.receiveStream(message)) {
      if (event.type === 'chunk') {
        yield { type: 'text', text: event.text };
      } else if (event.type === 'tool_call') {
        yield event;
      } else if (event.type === 'tool_result') {
        yield event;
      } else {
        // done
        const tu = event.reply.tokenUsage;
        yield tu ? { type: 'done', tokenUsage: tu } : { type: 'done' };
      }
    }

    // 将本轮更新后的引擎历史保存回本会话，下次调用时可正确恢复
    this.sessionHistory = this.worker.getHistory();
  }
}

// ─── token 统计累计 ───────────────────────────────────────────────────────────

interface WorkerTokenAcc {
  workerId: string;
  workerName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
}

// ─── HttpServer ────────────────────────────────────────────────────────────────

const TOKEN_RECORDS_PATH = join(homedir(), '.bcc', 'token-records.json');

export class HttpServer {
  private store = new SessionStore();
  private tokenAcc = new Map<string, WorkerTokenAcc>();
  /** 带时间戳的明细记录，用于按天/按周统计，持久化到 ~/.bcc/token-records.json */
  private tokenRecords: TokenRecord[] = [];
  /** 每个 Worker 共享同一 AgentEngine 实例，跨会话保持记忆 */
  private workerAgents = new Map<string, AgentInterface>();
  /** Worker 间异步聊天存储（与 CLI 模式共享同一 ~/.bcc/chats 目录） */
  private chatStore = new ChatStore();
  /** 任务存储（持久化到 ~/.bcc/tasks，所有 Worker 共享一个 TaskStore） */
  private taskStore = new TaskStore();
  /** 每个 Worker 的 TaskManager（有 todolist 技能的 Worker 才创建） */
  private workerTaskManagers = new Map<string, TaskManager>();
  /**
   * Company：核心业务逻辑层（与 CLI 模式共享同一实现）。
   * 管理 Worker 实例、心跳调度（WorkerScheduler）和 Token 统计。
   */
  private company: Company | null = null;
  /** 共享消息服务（与 company.eventBus 绑定） */
  private messagingService: MessagingService | null = null;
  /**
   * SSE 全局事件流的客户端连接集合。
   * GET /api/events 的每个订阅者对应一个 ServerResponse 对象。
   */
  private sseClients = new Set<ServerResponse>();

  constructor(
    private config: BccConfig,
    readonly port = 3000,
  ) {}

  // ── 对外入口 ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // 从磁盘恢复历史会话（元数据 + 消息，agent 按需重建）
    await this.store.loadFromDisk();
    // 恢复 token 明细记录
    await this._loadTokenRecords();

    // ── 初始化 Company（核心业务逻辑层：Worker 实例 + 调度器 + 心跳）──────────
    await this._initCompany();

    return new Promise(resolve => {
      const server = createServer((req, res) => {
        void this.dispatch(req, res);
      });
      server.listen(this.port, () => {
        console.log(`  🌐 BCC HTTP Server running at http://localhost:${this.port}`);
        console.log(`  📡 API base: http://localhost:${this.port}/api`);
        resolve();
      });
    });
  }

  /**
   * 初始化 Company（核心业务逻辑层）：
   * - 创建 Company 实例（含 EventBus、TokenTracker、WorkerScheduler）
   * - 为所有已配置的 Worker 创建 Worker 实例并加入 Company
   * - 订阅 org:event 事件，通过 SSE /api/events 推送给前端
   * - 启动 WorkerScheduler（定期驱动 Worker.processInbox()）
   *
   * CLI 与 HTTP 共享同一套核心逻辑，只是展示层不同。
   */
  private async _initCompany(): Promise<void> {
    const workerCount = this.config.workers?.length ?? 0;
    if (workerCount === 0) return;

    this.company = new Company({ name: 'BCC HTTP Server' });
    this.messagingService = new MessagingService({
      store: this.chatStore,
      eventBus: this.company.eventBus,
    });

    // 订阅 org:event 事件，广播给所有 SSE 客户端
    this.company.onEvent((event) => {
      this._broadcastSseEvent('org', event);
      if (event.type === 'worker:inbox:checked' && event.pendingCount === -1) {
        console.error(`  ⚠️  [heartbeat] Worker "${event.workerId}" 心跳出错`);
      }
    });

    // 为所有 Worker 创建实例并加入 Company
    const memory = this.config.defaults.enableMemory
      ? new FileMemoryStore({ dir: this.config.defaults.sessionDir })
      : undefined;
    for (const workerCfg of this.config.workers ?? []) {
      try {
        const worker = await this._createWorker(workerCfg, memory);
        this.company.addWorker(worker);
      } catch (err) {
        console.error(`  ⚠️  初始化 Worker "${workerCfg.id}" 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 注入 call_worker 委托工具（多于 1 名 Worker 时，与 CLI 模式行为一致）
    // Worker 可通过同步委托立即获得另一个 Worker 的回复（适合短时间子任务）
    const allCompanyWorkers = this.company.getWorkers() as Worker[];
    if (allCompanyWorkers.length > 1) {
      for (const fromWorker of allCompanyWorkers) {
        const targets = allCompanyWorkers.filter(w => w.profile.id !== fromWorker.profile.id);
        const targetDesc = targets
          .map(w => `  - ${w.profile.id}（${w.profile.name}）：${w.profile.description}`)
          .join('\n');
        const callWorkerTool: Tool = {
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
                message: { type: 'string', description: '发给目标员工的任务描述或问题' },
              },
              required: ['worker_id', 'message'],
            },
          },
          handler: async (input) => {
            const { worker_id, message } = input as { worker_id: string; message: string };
            const thread = this.company!.openThread(
              `${fromWorker.profile.id} → ${worker_id}`,
              [fromWorker.profile.id, worker_id],
            );
            try {
              const replies = await this.company!.send(worker_id, message, thread.id, fromWorker.profile.id);
              this.company!.closeThread(thread.id);
              if (replies.length === 0) return `（${worker_id} 未返回任何内容）`;
              return replies.map(r => r.content).join('\n');
            } catch (err) {
              this.company!.closeThread(thread.id);
              throw err;
            }
          },
        };
        fromWorker.registerTool(callWorkerTool);
      }
      console.log(`  🔗 已为所有员工注入「call_worker」委托工具`);
    }

    // 按各 Worker 独立配置启动心跳（heartbeatIntervalMs === 0 为被动模式，不启动定时器）
    const activeWorkers: string[] = [];
    const passiveWorkers: string[] = [];
    for (const workerCfg of this.config.workers ?? []) {
      if (workerCfg.heartbeatIntervalMs === 0) {
        passiveWorkers.push(workerCfg.id);
      } else {
        const interval = workerCfg.heartbeatIntervalMs ?? 30_000;
        this.company.scheduler.start(workerCfg.id, interval);
        activeWorkers.push(`${workerCfg.id}(${interval / 1000}s)`);
      }
    }
    if (activeWorkers.length > 0) {
      console.log(`  💓 Worker 心跳已启动：${activeWorkers.join('、')}`);
    }
    if (passiveWorkers.length > 0) {
      console.log(`  💤 被动 Worker（仅事件触发）：${passiveWorkers.join('、')}`);
    }
  }

  /**
   * 为指定 WorkerConfig 创建 @bcc/org Worker 实例（用于 Company / 心跳调度）。
   */
  private async _createWorker(
    workerCfg: WorkerConfig,
    memory?: FileMemoryStore,
  ): Promise<Worker> {
    const modelInstance = this.config.models.find(m => m.id === workerCfg.modelId)
      ?? this.config.models.find(m => m.primary)
      ?? this.config.models[0];

    if (!modelInstance) {
      throw new Error(`Worker "${workerCfg.id}" 找不到可用的模型配置`);
    }

    const adapter = await createAdapter(modelInstance);

    const identityHeader = workerCfg.description
      ? `你的名字是「${workerCfg.name}」。${workerCfg.description}`
      : `你的名字是「${workerCfg.name}」。`;

    // 同事名录：与 CLI 的 buildColleagueSection() 保持一致
    // 让 Worker 知道团队成员的 ID 和职责，才能正确使用 send_direct_message 等工具
    const allWorkers = this.config.workers ?? [];
    const colleagues = allWorkers.filter(w => w.id !== workerCfg.id);
    const colleagueSection = colleagues.length > 0
      ? [
          '## 你的同事',
          ...colleagues.map(c => `- **${c.name}**（ID: \`${c.id}\`）：${c.description ?? c.role}`),
        ].join('\n')
      : '';

    const skillPrompts: string[] = [];
    for (const skillId of workerCfg.skills ?? []) {
      const skill = findBuiltin(skillId);
      if (skill?.system) skillPrompts.push(skill.system);
    }
    if (!workerCfg.skills?.includes('communicate')) {
      const communicateSkill = findBuiltin('communicate');
      if (communicateSkill?.system) skillPrompts.push(communicateSkill.system);
    }

    // 若 Worker 配置了工作空间工具，注入工作空间相关系统提示
    const workspaceDir = resolveWorkspaceDir(workerCfg, this.config);
    const sharedDir    = resolveSharedDir(this.config);
    const workspaceSection = buildWorkspaceSystemSection(
      workspaceDir, sharedDir, workerCfg.tools ?? [],
    );

    const system = [identityHeader, workerCfg.role || '', colleagueSection, ...skillPrompts, workspaceSection]
      .filter(Boolean)
      .join('\n\n');

    // 可选：审视引擎（心跳用，更便宜的模型）
    let reviewEngineOptions;
    if (workerCfg.reviewModelId) {
      const reviewModelInstance = this.config.models.find(m => m.id === workerCfg.reviewModelId);
      if (reviewModelInstance) {
        const reviewAdapter = await createAdapter(reviewModelInstance);
        reviewEngineOptions = { model: reviewAdapter, system };
      }
    }

    const taskService = workerCfg.skills?.includes('todolist')
      ? this.getTaskManagerForWorker(workerCfg.id)
      : undefined;

    const sessionId = `worker-${workerCfg.id}`;

    const worker = await Worker.create({
      profile: {
        id:          workerCfg.id,
        name:        workerCfg.name,
        role:        workerCfg.role,
        skills:      workerCfg.skills,
        description: workerCfg.description,
        modelId:     workerCfg.modelId,
        ...(workerCfg.reviewModelId && { reviewModelId: workerCfg.reviewModelId }),
      },
      engineOptions: {
        model: adapter,
        system,
        // 持久化对话记忆（与 CLI 行为对齐，跨会话保持历史上下文）
        ...(memory && { memory, sessionId }),
      },
      ...(reviewEngineOptions && { reviewEngineOptions }),
      tokenTracker:  this.company!.tokenTracker,
      eventBus:      this.company!.eventBus,
      inboxService:  this.messagingService!,
      // 提供同事 ID 列表，用于工具调用时校验目标 Worker 是否存在（排除自身）
      peersProvider: () => (this.config.workers ?? [])
        .map(w => w.id)
        .filter(id => id !== workerCfg.id),
      ...(taskService && { taskService }),
      sessionId,
    });

    // 注册 Worker 配置中指定的工具（工作空间工具 + 内置工具）
    const wsDir   = resolveWorkspaceDir(workerCfg, this.config);
    const shdDir  = resolveSharedDir(this.config);
    const wsTools = createWorkspaceTools(wsDir, shdDir);
    for (const toolId of workerCfg.tools ?? []) {
      const tool = wsTools[toolId] ?? getBuiltinTool(toolId);
      if (tool) worker.registerTool(tool);
    }

    // 确保工作空间目录存在
    if ((workerCfg.tools ?? []).some(t => t.startsWith('workspace-'))) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(wsDir,  { recursive: true }).catch(() => {});
      await mkdir(shdDir, { recursive: true }).catch(() => {});
    }

    return worker;
  }

  /**
   * 向所有 SSE 客户端广播一个事件。
   */
  private _broadcastSseEvent(eventName: string, data: unknown): void {
    if (this.sseClients.size === 0) return;
    const line = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(line);
      } catch {
        // 客户端已断开，从集合中移除
        this.sseClients.delete(client);
      }
    }
  }

  // ── 路由分发 ────────────────────────────────────────────────────────────────

  private async dispatch(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const path = url.pathname;

    // 请求日志
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      console.log(`  ${method} ${path} → ${res.statusCode} (${ms}ms)`);
    });

    // CORS 预检
    if (method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // ── GET /api/health
    if (method === 'GET' && path === '/api/health') {
      ok(res, { status: 'ok', timestamp: Date.now() });
      return;
    }

    // ── GET /api/events  (SSE 全局事件流：心跳、消息、任务事件实时推送)
    if (method === 'GET' && path === '/api/events') {
      this.handleSseEvents(req, res);
      return;
    }

    // ── GET /api/workers
    if (method === 'GET' && path === '/api/workers') {
      await this.handleGetWorkers(res);
      return;
    }

    // ── GET /api/models
    if (method === 'GET' && path === '/api/models') {
      await this.handleGetModels(res);
      return;
    }

    // ── POST /api/models
    if (method === 'POST' && path === '/api/models') {
      await this.handleCreateModel(req, res);
      return;
    }

    // ── PUT /api/models/:modelId
    {
      const m = matchRoute('/api/models/:modelId', path);
      if (m && method === 'PUT') {
        await this.handleUpdateModel(req, res, m.params['modelId']!);
        return;
      }
    }

    // ── DELETE /api/models/:modelId
    {
      const m = matchRoute('/api/models/:modelId', path);
      if (m && method === 'DELETE') {
        await this.handleDeleteModel(res, m.params['modelId']!);
        return;
      }
    }

    // ── GET /api/config
    if (method === 'GET' && path === '/api/config') {
      ok(res, {
        models: this.config.models.map(m => ({ ...m, apiKey: m.apiKey ? '***' : '' })),
        workers: this.config.workers ?? [],
        defaults: this.config.defaults,
      });
      return;
    }

    // ── PUT /api/config/defaults  — 更新 defaults 可配置字段（工作空间目录等）
    if (method === 'PUT' && path === '/api/config/defaults') {
      const body = JSON.parse(await readBody(req)) as Partial<{
        workspaceBaseDir: string;
        sharedDir: string;
      }>;
      if (body.workspaceBaseDir !== undefined) {
        this.config.defaults.workspaceBaseDir = body.workspaceBaseDir.trim() || this.config.defaults.workspaceBaseDir;
      }
      if (body.sharedDir !== undefined) {
        this.config.defaults.sharedDir = body.sharedDir.trim() || this.config.defaults.sharedDir;
      }
      await saveConfig(this.config);
      ok(res, { defaults: this.config.defaults });
      return;
    }

    // ── GET /api/analytics/tokens
    if (method === 'GET' && path === '/api/analytics/tokens') {
      this.handleGetAnalytics(res);
      return;
    }

    // ── GET /api/skills/hub  (SkillHub 搜索，需先于 /api/skills 匹配)
    if (method === 'GET' && path === '/api/skills/hub') {
      await this.handleSkillHubSearch(url, res);
      return;
    }

    // ── GET /api/skills
    if (method === 'GET' && path === '/api/skills') {
      await this.handleGetSkills(res);
      return;
    }

    // ── POST /api/skills
    if (method === 'POST' && path === '/api/skills') {
      await this.handleCreateSkill(req, res);
      return;
    }

    // ── DELETE /api/skills/:name
    {
      const m = matchRoute('/api/skills/:name', path);
      if (m && method === 'DELETE') {
        await this.handleDeleteSkill(res, m.params['name']!);
        return;
      }
    }

    // ── POST /api/workers/:workerId/heartbeat  (手动触发一次心跳审视)
    {
      const m = matchRoute('/api/workers/:workerId/heartbeat', path);
      if (m && method === 'POST') {
        await this.handleTriggerHeartbeat(res, m.params['workerId']!);
        return;
      }
    }

    // ── POST /api/workers/:workerId/sessions
    {
      const m = matchRoute('/api/workers/:workerId/sessions', path);
      if (m && method === 'POST') {
        await this.handleCreateSession(req, res, m.params['workerId']!);
        return;
      }
    }

    // ── GET /api/workers/:workerId/sessions
    {
      const m = matchRoute('/api/workers/:workerId/sessions', path);
      if (m && method === 'GET') {
        this.handleListSessions(res, m.params['workerId']!);
        return;
      }
    }

    // ── GET /api/sessions/:sessionId
    {
      const m = matchRoute('/api/sessions/:sessionId', path);
      if (m && method === 'GET') {
        this.handleGetSession(res, m.params['sessionId']!);
        return;
      }
    }

    // ── PATCH /api/sessions/:sessionId  (更新会话标题)
    {
      const m = matchRoute('/api/sessions/:sessionId', path);
      if (m && method === 'PATCH') {
        await this.handlePatchSession(req, res, m.params['sessionId']!);
        return;
      }
    }

    // ── DELETE /api/sessions/:sessionId
    {
      const m = matchRoute('/api/sessions/:sessionId', path);
      if (m && method === 'DELETE') {
        this.handleDeleteSession(res, m.params['sessionId']!);
        return;
      }
    }

    // ── POST /api/sessions/:sessionId/messages
    {
      const m = matchRoute('/api/sessions/:sessionId/messages', path);
      if (m && method === 'POST') {
        await this.handleSendMessage(req, res, m.params['sessionId']!);
        return;
      }
    }

    // ── Worker 间异步聊天监控 ────────────────────────────────────────────────────

    // ── GET /api/chats  (列出所有 Worker 间聊天会话)
    if (method === 'GET' && path === '/api/chats') {
      await this.handleListChats(req, res);
      return;
    }

    // ── POST /api/chats  (创建/打开直聊会话)
    if (method === 'POST' && path === '/api/chats') {
      await this.handleCreateChat(req, res);
      return;
    }

    // ── DELETE /api/chats  (批量删除所有聊天)
    if (method === 'DELETE' && path === '/api/chats') {
      await this.handleDeleteAllChats(res);
      return;
    }

    // ── GET /api/chats/:chatId/messages
    {
      const m = matchRoute('/api/chats/:chatId/messages', path);
      if (m && method === 'GET') {
        await this.handleGetChatMessages(res, m.params['chatId']!);
        return;
      }
    }

    // ── PUT /api/chats/:chatId/participants  (追加群聊成员)
    {
      const m = matchRoute('/api/chats/:chatId/participants', path);
      if (m && method === 'PUT') {
        await this.handleAddChatParticipants(req, res, m.params['chatId']!);
        return;
      }
    }

    // ── DELETE /api/chats/:chatId
    {
      const m = matchRoute('/api/chats/:chatId', path);
      if (m && method === 'DELETE') {
        await this.handleDeleteChat(res, m.params['chatId']!);
        return;
      }
    }

    // ── GET /api/chats/:chatId
    {
      const m = matchRoute('/api/chats/:chatId', path);
      if (m && method === 'GET') {
        await this.handleGetChat(res, m.params['chatId']!);
        return;
      }
    }

    // ── DELETE /api/sessions  (批量删除所有会话)
    if (method === 'DELETE' && path === '/api/sessions') {
      await this.handleDeleteAllSessions(res);
      return;
    }

    // ── POST /api/dm-sessions  (创建 Worker↔Worker DM 会话)
    if (method === 'POST' && path === '/api/dm-sessions') {
      await this.handleCreateDmSession(req, res);
      return;
    }

    // ── POST /api/group-sessions  (创建用户↔多 Worker 群聊会话)
    if (method === 'POST' && path === '/api/group-sessions') {
      await this.handleCreateGroupSession(req, res);
      return;
    }

    // ── POST /api/workers  (创建 Worker)
    if (method === 'POST' && path === '/api/workers') {
      await this.handleCreateWorker(req, res);
      return;
    }

    // ── PUT /api/workers/:workerId  (更新 Worker)
    {
      const m = matchRoute('/api/workers/:workerId', path);
      if (m && method === 'PUT') {
        await this.handleUpdateWorker(req, res, m.params['workerId']!);
        return;
      }
    }

    // ── DELETE /api/workers/:workerId
    {
      const m = matchRoute('/api/workers/:workerId', path);
      if (m && method === 'DELETE') {
        await this.handleDeleteWorker(res, m.params['workerId']!);
        return;
      }
    }

    // ── GET /api/workspace/:workerId        工作空间信息 + 文件列表
    {
      const m = matchRoute('/api/workspace/:workerId', path);
      if (m && method === 'GET') {
        await this.handleGetWorkspace(res, m.params['workerId']!);
        return;
      }
    }

    // ── GET /api/shared                    共享目录文件列表
    if (method === 'GET' && path === '/api/shared') {
      await this.handleGetShared(res);
      return;
    }

    // ── GET /api/shared/file/*             下载共享文件（支持子路径）
    if (method === 'GET' && path.startsWith('/api/shared/file/')) {
      const filePath = decodeURIComponent(path.slice('/api/shared/file/'.length));
      await this.handleGetSharedFile(res, filePath);
      return;
    }

    // ── GET  /api/workspace/:workerId/file/*  下载文件（支持子路径）
    // ── DELETE /api/workspace/:workerId/file/* 删除文件
    {
      const wsFilePrefix = '/api/workspace/';
      const wsFileSuffix = '/file/';
      if (path.startsWith(wsFilePrefix)) {
        const rest = path.slice(wsFilePrefix.length);
        const slashIdx = rest.indexOf(wsFileSuffix);
        if (slashIdx !== -1) {
          const wid = rest.slice(0, slashIdx);
          const filePath = decodeURIComponent(rest.slice(slashIdx + wsFileSuffix.length));
          if (method === 'GET') {
            await this.handleGetWorkspaceFile(res, wid, filePath);
            return;
          }
          if (method === 'DELETE') {
            await this.handleDeleteWorkspaceFile(res, wid, filePath);
            return;
          }
        }
      }
    }

    notFound(res);
  }

  // ── 具体处理函数 ─────────────────────────────────────────────────────────────

  /** 从磁盘热重载 config，使 CLI 改动无需重启即可在 Web 端生效 */
  private async reloadConfig(): Promise<void> {
    try {
      const fresh = await loadConfig();
      if (fresh) this.config = fresh;
    } catch {
      // reload 失败则沿用内存中的 config
    }
  }

  private async handleGetWorkers(res: ServerResponse) {
    await this.reloadConfig();
    const workers: ApiWorker[] = (this.config.workers ?? []).map(w => ({
      id:          w.id,
      name:        w.name,
      description: w.description,
      skills:      w.skills,
      modelId:     w.modelId,
      ...(w.reviewModelId && { reviewModelId: w.reviewModelId }),
      ...(w.heartbeatIntervalMs !== undefined && { heartbeatIntervalMs: w.heartbeatIntervalMs }),
      role:        w.role,
      tools:       w.tools ?? [],
      isPrimary:   w.primary ?? false,
      status:      this._resolveWorkerStatus(w.id),
      workspace:   resolveWorkspaceDir(w, this.config),
    }));
    ok(res, workers);
  }

  /**
   * 将 Worker 内部 lifecycle state 映射到 API status。
   * - 未加入 Company（初始化失败 / 尚未启动）→ 'offline'
   * - processing → 'busy'
   * - idle / sleeping / blocked → 'online'
   */
  private _resolveWorkerStatus(workerId: string): ApiWorker['status'] {
    if (!this.company) return 'offline';
    const w = this.company.getWorker(workerId) as Worker | undefined;
    if (!w) return 'offline';
    return w.state === 'processing' ? 'busy' : 'online';
  }

  private async handleGetModels(res: ServerResponse) {
    await this.reloadConfig();
    const models: ApiModel[] = this.config.models.map(m => {
      const item: ApiModel = {
        id:         m.id,
        provider:   m.provider,
        isPrimary:  m.primary  ?? false,
        isFallback: m.fallback ?? false,
      };
      if (m.model)    item.model    = m.model;
      if (m.baseUrl)  item.baseUrl  = m.baseUrl;
      if (m.insecure) item.insecure = m.insecure;
      if (m.noProxy)  item.noProxy  = m.noProxy;
      return item;
    });
    ok(res, models);
  }

  private handleGetAnalytics(res: ServerResponse) {
    const byWorker = [...this.tokenAcc.values()];

    // 将明细记录按日期聚合（最近 30 天）
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dayMap = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>();
    for (const r of this.tokenRecords) {
      if (r.timestamp < cutoff) continue;
      const d = new Date(r.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const acc = dayMap.get(key) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      acc.inputTokens  += r.inputTokens;
      acc.outputTokens += r.outputTokens;
      acc.totalTokens  += r.totalTokens;
      dayMap.set(key, acc);
    }
    const byDay = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    const stats: TokenStats = {
      totalInputTokens:  byWorker.reduce((s, w) => s + w.inputTokens,  0),
      totalOutputTokens: byWorker.reduce((s, w) => s + w.outputTokens, 0),
      totalTokens:       byWorker.reduce((s, w) => s + w.totalTokens,  0),
      byWorker,
      byDay,
    };
    ok(res, stats);
  }

  private async handleCreateSession(req: IncomingMessage, res: ServerResponse, workerId: string) {
    const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
    if (!workerCfg) {
      notFound(res);
      return;
    }

    // ?force=true 时跳过幂等检查，强制新建会话
    const url = new URL(req.url ?? '/', 'http://localhost');
    const force = url.searchParams.get('force') === 'true';

    if (!force) {
      // 幂等：用户与同一 Worker 只有一个 1对1 会话，存在则直接返回
      const existing = this.store.findChat(workerId);
      if (existing) {
        ok(res, this.store.toApiSession(existing));
        return;
      }
    }

    try {
      // 每个 chat 会话创建独立的 WorkerChatAdapter，避免多会话间对话历史互相污染
      const adapter = this._newChatAdapter(workerCfg) ?? await this.getAgentForWorker(workerCfg);

      // force=true 时，汇总此前所有 chat 会话的摘要，注入新会话的跨会话上下文
      if (force && adapter instanceof WorkerChatAdapter) {
        const existingSessions = this.store.listByWorker(workerId)
          .filter(s => s.type === 'chat');

        // 对尚未生成摘要且有消息的会话，调用 LLM 生成摘要并持久化
        for (const session of existingSessions) {
          if (!session.summary && session.messages.length > 0) {
            try {
              const summary = await this._summarizeSession(session, workerCfg);
              if (summary) this.store.setSummary(session.id, summary);
            } catch (err) {
              console.warn(`  ⚠️  会话 ${session.id} 摘要生成失败: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        // 收集所有有摘要的历史会话，按时间顺序拼接成综合上下文
        const summaries = existingSessions
          .filter(s => s.summary)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((s, i) => `【第 ${i + 1} 段会话摘要】\n${s.summary!}`)
          .join('\n\n');

        if (summaries) {
          adapter.setPriorContextSummary(summaries);
        }
      }

      const entry = this.store.create(workerId, adapter);
      ok(res, this.store.toApiSession(entry), 201);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 用 LLM 为指定会话生成摘要（100~200 字中文）。
   * 优先使用 Worker 的 reviewModelId（更便宜的模型），其次主模型。
   */
  private async _summarizeSession(
    entry: import('./session-store.js').SessionEntry,
    workerCfg: WorkerConfig,
  ): Promise<string> {
    const transcript = entry.messages
      .map(m => `[${m.role === 'user' ? '用户' : workerCfg.name}]\n${m.content}`)
      .join('\n\n');

    if (!transcript.trim()) return '';

    const modelId = workerCfg.reviewModelId ?? workerCfg.modelId;
    const modelInstance =
      this.config.models.find(m => m.id === modelId)
      ?? this.config.models.find(m => m.primary)
      ?? this.config.models[0];

    if (!modelInstance) return '';

    const modelAdapter = await createAdapter(modelInstance);
    const engine = await AgentEngine.create({ model: modelAdapter });

    const prompt = `以下是一段对话记录，请用简洁的中文总结这段对话的主要内容、关键决策和待办事项（100~200字），供后续对话参考：\n\n${transcript}`;

    let summary = '';
    for await (const chunk of engine.stream(prompt)) {
      if (chunk.type === 'text') summary += chunk.text;
    }

    return summary.trim();
  }

  /** 为 chat 类会话创建独立的 WorkerChatAdapter（有 Company Worker 时优先使用）。 */
  private _newChatAdapter(workerCfg: WorkerConfig): WorkerChatAdapter | null {
    if (!this.company) return null;
    const companyWorker = this.company.getWorker(workerCfg.id);
    if (!companyWorker) return null;
    return new WorkerChatAdapter(companyWorker);
  }

  private handleListSessions(res: ServerResponse, workerId: string) {
    const sessions = this.store.listByWorker(workerId).map(e => this.store.toApiSession(e));
    ok(res, sessions);
  }

  private handleGetSession(res: ServerResponse, sessionId: string) {
    const entry = this.store.get(sessionId);
    if (!entry) { notFound(res); return; }
    ok(res, { ...this.store.toApiSession(entry), messages: entry.messages });
  }

  private async handlePatchSession(req: IncomingMessage, res: ServerResponse, sessionId: string) {
    const entry = this.store.get(sessionId);
    if (!entry) { notFound(res); return; }
    let body: { title?: string };
    try { body = JSON.parse(await readBody(req)) as typeof body; } catch { badRequest(res, 'Invalid JSON'); return; }
    if (typeof body.title === 'string' && body.title.trim()) {
      this.store.updateTitle(sessionId, body.title.trim());
    }
    ok(res, this.store.toApiSession(entry));
  }

  private handleDeleteSession(res: ServerResponse, sessionId: string) {
    if (!this.store.delete(sessionId)) { notFound(res); return; }
    cors(res);
    res.writeHead(204);
    res.end();
  }

  private async handleSendMessage(req: IncomingMessage, res: ServerResponse, sessionId: string) {
    const entry = this.store.get(sessionId);
    if (!entry) { notFound(res); return; }

    let body: { content?: string };
    try {
      body = JSON.parse(await readBody(req)) as { content?: string };
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }
    const content = body.content?.trim();
    if (!content) { badRequest(res, '"content" is required'); return; }

    // SSE headers
    cors(res);
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });

    if (entry.type === 'dm') {
      await this.handleDmMessage(res, entry, content);
    } else if (entry.type === 'group') {
      await this.handleGroupMessage(res, entry, content);
    } else {
      await this.handleChatMessage(res, entry, content);
    }
  }

  /** 普通 chat 会话：用户 → Worker */
  private async handleChatMessage(
    res: ServerResponse,
    entry: import('./session-store.js').SessionEntry,
    content: string,
  ) {
    // 懒加载：会话从磁盘恢复时 agent 为 undefined，按需重建（每个会话独立 adapter）
    if (!entry.agent) {
      const workerCfg = (this.config.workers ?? []).find(w => w.id === entry.workerId);
      if (!workerCfg) {
        writeSse(res, { event: 'error', data: { message: `Worker "${entry.workerId}" 配置不存在` } });
        res.end(); return;
      }
      const adapter = this._newChatAdapter(workerCfg);
      if (adapter) {
        // 从持久化消息恢复会话历史，让 LLM 拥有正确的对话上下文
        const history: Message[] = entry.messages.map(m => ({ role: m.role, content: m.content }));
        adapter.loadSessionHistory(history);
        entry.agent = adapter;
      } else {
        entry.agent = await this.getAgentForWorker(workerCfg);
      }
    }

    // 记录用户消息
    entry.messages.push({ id: randomUUID(), role: 'user', content, timestamp: Date.now() });
    if (entry.messages.length === 1) entry.title = content.slice(0, 30);
    entry.updatedAt = Date.now();

    let assistantText = '';
    let tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of entry.agent.stream(content)) {
        switch (chunk.type) {
          case 'text':
            if (chunk.text) { assistantText += chunk.text; writeSse(res, { event: 'chunk', data: { text: chunk.text } }); }
            break;
          case 'tool_call':
            writeSse(res, { event: 'tool_call', data: { tool: chunk.tool, input: chunk.input } });
            break;
          case 'tool_result':
            writeSse(res, { event: 'tool_result', data: { tool: chunk.tool, result: chunk.result, isError: chunk.isError } });
            break;
          case 'done':
            if (chunk.tokenUsage) tokenUsage = chunk.tokenUsage;
            break;
        }
      }
    } catch (err) {
      writeSse(res, { event: 'error', data: { message: err instanceof Error ? err.message : String(err) } });
      res.end(); return;
    }

    if (assistantText) {
      entry.messages.push({
        id: randomUUID(), role: 'assistant', content: assistantText, timestamp: Date.now(),
        ...(tokenUsage && { tokenUsage: { inputTokens: tokenUsage.inputTokens, outputTokens: tokenUsage.outputTokens } }),
      });
      entry.updatedAt = Date.now();
    }

    this.accumulateTokens(entry.workerId, tokenUsage);
    writeSse(res, { event: 'done', data: tokenUsage ? { tokenUsage } : {} });
    res.end();
    void this.store.persistEntry(entry.id);
  }

  /** DM 会话：fromWorker → toWorker（两轮 LLM 调用） */
  private async handleDmMessage(
    res: ServerResponse,
    entry: import('./session-store.js').SessionEntry,
    content: string,
  ) {
    const fromWorkerCfg = (this.config.workers ?? []).find(w => w.id === entry.workerId);
    const toWorkerCfg   = (this.config.workers ?? []).find(w => w.id === entry.toWorkerId);
    const fromName = fromWorkerCfg?.name ?? entry.workerId;
    const toName   = toWorkerCfg?.name   ?? (entry.toWorkerId ?? 'Worker B');

    // 懒加载：会话从磁盘恢复时 agent/toAgent 为 undefined，按需重建
    if (!entry.agent && fromWorkerCfg) {
      entry.agent = await this.getAgentForWorker(fromWorkerCfg);
    }
    if (!entry.toAgent && toWorkerCfg) {
      entry.toAgent = await this.getAgentForWorker(toWorkerCfg);
    }
    if (!entry.agent) {
      writeSse(res, { event: 'error', data: { message: `Worker "${entry.workerId}" 配置不存在` } });
      res.end(); return;
    }

    // 记录用户指令（可选：仅在首条消息时更新标题）
    if (entry.messages.length === 0) {
      entry.title = `${fromName} → ${toName}`;
    }
    entry.messages.push({ id: randomUUID(), role: 'user', content, timestamp: Date.now() });
    entry.updatedAt = Date.now();

    // ── 第一轮：fromWorker 生成消息 ────────────────────────────────────────
    writeSse(res, { event: 'speaker', data: { workerId: entry.workerId, workerName: fromName } });

    let fromText = '';
    try {
      for await (const chunk of entry.agent.stream(content)) {
        if (chunk.type === 'text' && chunk.text) {
          fromText += chunk.text;
          writeSse(res, { event: 'chunk', data: { text: chunk.text } });
        }
        if (chunk.type === 'tool_call') writeSse(res, { event: 'tool_call', data: { tool: chunk.tool, input: chunk.input } });
        if (chunk.type === 'tool_result') writeSse(res, { event: 'tool_result', data: { tool: chunk.tool, result: chunk.result, isError: chunk.isError } });
      }
    } catch (err) {
      writeSse(res, { event: 'error', data: { message: err instanceof Error ? err.message : String(err) } });
      res.end(); return;
    }

    if (fromText) {
      entry.messages.push({ id: randomUUID(), role: 'assistant', speakerId: entry.workerId, content: fromText, timestamp: Date.now() });
      entry.updatedAt = Date.now();
    }

    // ── 第二轮：toWorker 回复 ──────────────────────────────────────────────
    if (!entry.toAgent || !fromText) {
      writeSse(res, { event: 'done', data: {} });
      res.end(); return;
    }

    writeSse(res, { event: 'speaker', data: { workerId: entry.toWorkerId!, workerName: toName } });

    // 构建发给 toWorker 的提示（带发送方身份 + 人称转换提醒）
    const promptForTo = [
      `【来自同事「${entry.workerId}」（${fromName}）的消息】`,
      `（注意：消息中的"我"指「${entry.workerId}」，若你需要委托其他人，请将代词替换为具体的 Worker ID）`,
      '',
      fromText,
    ].join('\n');
    let toText = '';
    try {
      for await (const chunk of entry.toAgent.stream(promptForTo)) {
        if (chunk.type === 'text' && chunk.text) {
          toText += chunk.text;
          writeSse(res, { event: 'chunk', data: { text: chunk.text } });
        }
        if (chunk.type === 'tool_call') writeSse(res, { event: 'tool_call', data: { tool: chunk.tool, input: chunk.input } });
        if (chunk.type === 'tool_result') writeSse(res, { event: 'tool_result', data: { tool: chunk.tool, result: chunk.result, isError: chunk.isError } });
      }
    } catch (err) {
      writeSse(res, { event: 'error', data: { message: err instanceof Error ? err.message : String(err) } });
      res.end(); return;
    }

    if (toText) {
      entry.messages.push({ id: randomUUID(), role: 'assistant', speakerId: entry.toWorkerId!, content: toText, timestamp: Date.now() });
      entry.updatedAt = Date.now();
    }

    writeSse(res, { event: 'done', data: {} });
    res.end();
    void this.store.persistEntry(entry.id);
  }

  /**
   * 解析消息中 @提及的 Worker ID 列表。
   * - 包含 @all 或 @所有人 → 返回 null（表示全部响应）
   * - 包含 @workerID 或 @workerName → 返回对应 ID 列表
   * - 无任何 @mention → 返回空数组（无人响应）
   */
  private parseMentions(
    content: string,
    workerIds: string[],
  ): string[] | null {
    if (content.includes('@all') || content.includes('@所有人')) return null;

    const mentioned: string[] = [];
    for (const workerId of workerIds) {
      const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
      const workerName = workerCfg?.name ?? '';
      if (
        content.includes(`@${workerId}`) ||
        (workerName && content.includes(`@${workerName}`))
      ) {
        mentioned.push(workerId);
      }
    }
    return mentioned;
  }

  /** group 会话：用户 → 多 Worker，仅被 @提及的 Worker 回复 */
  private async handleGroupMessage(
    res: ServerResponse,
    entry: import('./session-store.js').SessionEntry,
    content: string,
  ) {
    const workerIds = entry.workerIds ?? [entry.workerId];

    // 懒加载：会话从磁盘恢复时 groupAgents 为 undefined，按需重建整个 Map
    if (!entry.groupAgents) {
      const agentMap = new Map<string, AgentInterface>();
      for (const wid of workerIds) {
        const cfg = (this.config.workers ?? []).find(w => w.id === wid);
        if (cfg) agentMap.set(wid, await this.getAgentForWorker(cfg));
      }
      entry.groupAgents = agentMap;
      if (!entry.agent) {
        const primaryAgent = agentMap.get(entry.workerId);
        if (primaryAgent) entry.agent = primaryAgent;
      }
    }

    if (entry.messages.length === 0) {
      entry.title = `群聊：${content.slice(0, 20)}`;
    }
    entry.messages.push({ id: randomUUID(), role: 'user', content, timestamp: Date.now() });
    entry.updatedAt = Date.now();

    // 根据 @mention 决定哪些 Worker 需要回复
    // null = 全部（@all/@所有人），[] = 无人响应，[...ids] = 指定 Worker
    const mentionedIds = this.parseMentions(content, workerIds);

    if (mentionedIds !== null && mentionedIds.length === 0) {
      // 没有 @mention，消息存档但无 Worker 回复
      writeSse(res, { event: 'done', data: {} });
      res.end();
      void this.store.persistEntry(entry.id);
      return;
    }

    for (const workerId of workerIds) {
      // 跳过未被 @提及的 Worker（null 表示全部参与）
      if (mentionedIds !== null && !mentionedIds.includes(workerId)) continue;

      const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
      const workerName = workerCfg?.name ?? workerId;
      const agent = entry.groupAgents?.get(workerId) ?? entry.agent;
      if (!agent) continue; // agent 未找到时跳过该 worker

      writeSse(res, { event: 'speaker', data: { workerId, workerName } });

      let workerText = '';
      try {
        for await (const chunk of agent.stream(content)) {
          if (chunk.type === 'text' && chunk.text) {
            workerText += chunk.text;
            writeSse(res, { event: 'chunk', data: { text: chunk.text } });
          }
          if (chunk.type === 'tool_call') writeSse(res, { event: 'tool_call', data: { tool: chunk.tool, input: chunk.input } });
          if (chunk.type === 'tool_result') writeSse(res, { event: 'tool_result', data: { tool: chunk.tool, result: chunk.result, isError: chunk.isError } });
          if (chunk.type === 'done' && chunk.tokenUsage) this.accumulateTokens(workerId, chunk.tokenUsage);
        }
      } catch (err) {
        writeSse(res, { event: 'error', data: { message: err instanceof Error ? err.message : String(err) } });
        res.end(); return;
      }

      if (workerText) {
        entry.messages.push({ id: randomUUID(), role: 'assistant', speakerId: workerId, content: workerText, timestamp: Date.now() });
        entry.updatedAt = Date.now();
      }
    }

    writeSse(res, { event: 'done', data: {} });
    res.end();
    void this.store.persistEntry(entry.id);
  }

  /** POST /api/group-sessions — 创建用户↔多 Worker 群聊 */
  private async handleCreateGroupSession(req: IncomingMessage, res: ServerResponse) {
    let body: { workerIds?: string[] };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const { workerIds } = body;
    if (!workerIds || !Array.isArray(workerIds) || workerIds.length < 2) {
      badRequest(res, '"workerIds" must be an array with at least 2 Worker IDs'); return;
    }
    if (new Set(workerIds).size !== workerIds.length) {
      badRequest(res, '"workerIds" must not contain duplicates'); return;
    }

    const workers = this.config.workers ?? [];
    const workerCfgs = workerIds.map(id => workers.find(w => w.id === id));
    if (workerCfgs.some(w => !w)) {
      notFound(res); return;
    }

    try {
      const agentMap = new Map<string, AgentInterface>();
      for (const cfg of workerCfgs) {
        const agent = await this.getAgentForWorker(cfg!);
        agentMap.set(cfg!.id, agent);
      }
      const title = workerCfgs.map(w => w!.name).join('、') + ' 群聊';
      const entry = this.store.createGroup(workerIds, agentMap, title);
      ok(res, this.store.toApiSession(entry), 201);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  private accumulateTokens(
    workerId: string,
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined,
  ) {
    if (!tokenUsage) return;
    const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
    const workerName = workerCfg?.name ?? workerId;

    // 累计汇总（内存，用于 byWorker 统计）
    const acc = this.tokenAcc.get(workerId) ?? {
      workerId, workerName, inputTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0,
    };
    acc.inputTokens  += tokenUsage.inputTokens;
    acc.outputTokens += tokenUsage.outputTokens;
    acc.totalTokens  += tokenUsage.totalTokens;
    acc.callCount    += 1;
    this.tokenAcc.set(workerId, acc);

    // 明细记录（带时间戳，用于 byDay 统计）
    const record: TokenRecord = {
      workerId,
      workerName,
      inputTokens:  tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens:  tokenUsage.totalTokens,
      timestamp: Date.now(),
    };
    this.tokenRecords.push(record);
    void this._persistTokenRecords();
  }

  /** 从磁盘恢复 token 明细记录，同时重建内存汇总 */
  private async _loadTokenRecords(): Promise<void> {
    try {
      const raw = await readFile(TOKEN_RECORDS_PATH, 'utf-8');
      const records: TokenRecord[] = JSON.parse(raw);
      this.tokenRecords = records;
      // 重建 tokenAcc 汇总
      for (const r of records) {
        const acc = this.tokenAcc.get(r.workerId) ?? {
          workerId: r.workerId, workerName: r.workerName,
          inputTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0,
        };
        acc.inputTokens  += r.inputTokens;
        acc.outputTokens += r.outputTokens;
        acc.totalTokens  += r.totalTokens;
        acc.callCount    += 1;
        this.tokenAcc.set(r.workerId, acc);
      }
    } catch {
      // 文件不存在或解析失败，忽略
    }
  }

  /** 异步持久化 token 明细记录到磁盘 */
  private async _persistTokenRecords(): Promise<void> {
    try {
      await mkdir(join(homedir(), '.bcc'), { recursive: true });
      await writeFile(TOKEN_RECORDS_PATH, JSON.stringify(this.tokenRecords), 'utf-8');
    } catch {
      // 写入失败不影响主流程
    }
  }

  // ── DM 会话 ──────────────────────────────────────────────────────────────────

  // ── Worker 间异步聊天监控 ──────────────────────────────────────────────────────

  /**
   * GET /api/chats
   * 列出所有 Worker 间聊天会话，可选 ?participant=workerId 过滤。
   * 这是监控面板的核心接口：看到所有人在聊什么。
   */
  private async handleListChats(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const participant = url.searchParams.get('participant') ?? undefined;
    try {
      const chats = await this.chatStore.listChats(participant);
      ok(res, chats);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to list chats');
    }
  }

  /**
   * GET /api/chats/:chatId
   * 获取单个聊天会话的元信息（参与者、状态、最后消息预览）。
   */
  private async handleGetChat(res: ServerResponse, chatId: string) {
    try {
      const chat = await this.chatStore.getChat(chatId);
      if (!chat) { notFound(res); return; }
      ok(res, chat);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to get chat');
    }
  }

  /**
   * GET /api/chats/:chatId/messages
   * 获取聊天会话的消息历史，可选 ?limit=N 限制条数。
   * 监控面板用此接口展示完整对话记录，溯源每条消息的发件人。
   */
  private async handleGetChatMessages(res: ServerResponse, chatId: string) {
    try {
      const messages = await this.chatStore.getMessages(chatId);
      if (messages.length === 0) {
        const chat = await this.chatStore.getChat(chatId);
        if (!chat) { notFound(res); return; }
      }
      ok(res, messages);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to get chat messages');
    }
  }

  /**
   * POST /api/chats
   * 创建或打开两个参与者之间的直聊会话（幂等）。
   * Body: { participant1: string, participant2: string }
   */
  private async handleCreateChat(req: IncomingMessage, res: ServerResponse) {
    let body: { participant1?: string; participant2?: string };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const { participant1, participant2 } = body;
    if (!participant1) { badRequest(res, '"participant1" is required'); return; }
    if (!participant2) { badRequest(res, '"participant2" is required'); return; }
    if (participant1 === participant2) { badRequest(res, 'participant1 and participant2 must be different'); return; }

    try {
      const chat = await this.chatStore.createChat([participant1, participant2], 'direct');
      ok(res, chat);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to create chat');
    }
  }

  /**
   * PUT /api/chats/:chatId/participants
   * 向已有群聊追加新成员（幂等：已在群内的成员自动跳过）。
   * Body: { newParticipants: string[] }
   */
  private async handleAddChatParticipants(req: IncomingMessage, res: ServerResponse, chatId: string) {
    let body: { newParticipants?: string[] };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }
    const { newParticipants } = body;
    if (!newParticipants || !Array.isArray(newParticipants) || newParticipants.length === 0) {
      badRequest(res, '"newParticipants" must be a non-empty array'); return;
    }
    try {
      const chat = this.messagingService
        ? await this.messagingService.addMembersToGroup(chatId, newParticipants)
        : await this.chatStore.addParticipants(chatId, newParticipants);
      if (!chat) { notFound(res); return; }
      ok(res, chat);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to add participants');
    }
  }

  /** DELETE /api/chats/:chatId — 删除指定聊天会话 */
  private async handleDeleteChat(res: ServerResponse, chatId: string) {
    try {
      const deleted = await this.chatStore.deleteChat(chatId);
      if (!deleted) { notFound(res); return; }
      cors(res);
      res.writeHead(204);
      res.end();
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to delete chat');
    }
  }

  /** DELETE /api/chats — 批量删除所有聊天会话 */
  private async handleDeleteAllChats(res: ServerResponse) {
    try {
      const count = await this.chatStore.deleteAllChats();
      ok(res, { deleted: count });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : 'Failed to delete chats');
    }
  }

  /** DELETE /api/sessions — 批量删除所有会话（含 Worker 记忆文件） */
  private async handleDeleteAllSessions(res: ServerResponse) {
    // 1. 删除 HTTP 会话（SessionStore 管理的文件）
    const all = this.store.listAll();
    let count = 0;
    for (const session of all) {
      if (this.store.delete(session.id)) count++;
    }

    // 2. 删除 Worker 的持久化记忆文件（worker-*.json in sessionDir）
    if (this.config.defaults.enableMemory) {
      const sessionDir = this.config.defaults.sessionDir;
      try {
        const files = await readdir(sessionDir);
        for (const f of files) {
          if (f.startsWith('worker-') && f.endsWith('.json')) {
            await unlink(join(sessionDir, f)).catch(() => {});
            count++;
          }
        }
      } catch {
        // 目录不存在时忽略
      }
    }

    ok(res, { deleted: count });
  }

  private async handleCreateDmSession(req: IncomingMessage, res: ServerResponse) {
    let body: { fromWorkerId?: string; toWorkerId?: string };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const { fromWorkerId, toWorkerId } = body;
    if (!fromWorkerId) { badRequest(res, '"fromWorkerId" is required'); return; }
    if (!toWorkerId)   { badRequest(res, '"toWorkerId" is required'); return; }
    if (fromWorkerId === toWorkerId) { badRequest(res, 'fromWorkerId and toWorkerId must be different'); return; }

    const workers = this.config.workers ?? [];
    const fromCfg = workers.find(w => w.id === fromWorkerId);
    const toCfg   = workers.find(w => w.id === toWorkerId);
    if (!fromCfg || !toCfg) { notFound(res); return; }

    // 如果会话已存在则直接返回（幂等）
    const existing = this.store.findDm(fromWorkerId, toWorkerId);
    if (existing) {
      ok(res, this.store.toApiSession(existing));
      return;
    }

    try {
      const fromAgent = await this.getAgentForWorker(fromCfg);
      const toAgent   = await this.getAgentForWorker(toCfg);
      const entry = this.store.createDm(fromWorkerId, toWorkerId, fromAgent, toAgent);
      ok(res, this.store.toApiSession(entry), 201);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  // ── Model CRUD ───────────────────────────────────────────────────────────────

  private async handleCreateModel(req: IncomingMessage, res: ServerResponse) {
    let body: Partial<ModelInstanceConfig & { isPrimary?: boolean; isFallback?: boolean }>;
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const { id, provider, apiKey, model, baseUrl, isPrimary, isFallback, insecure, noProxy } = body;
    if (!id?.trim())       { badRequest(res, '"id" is required'); return; }
    if (!provider?.trim()) { badRequest(res, '"provider" is required'); return; }
    if (!apiKey?.trim())   { badRequest(res, '"apiKey" is required'); return; }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      badRequest(res, '"id" must contain only letters, numbers, hyphens, or underscores'); return;
    }

    if (this.config.models.some(m => m.id === id)) {
      conflict(res, `Model with id "${id}" already exists`); return;
    }

    const newModel: ModelInstanceConfig = {
      id: id.trim(),
      provider: provider.trim() as ModelInstanceConfig['provider'],
      apiKey: apiKey.trim(),
      ...(model    && { model:    model.trim() }),
      ...(baseUrl  && { baseUrl:  baseUrl.trim() }),
      ...(insecure && { insecure: true }),
      ...(noProxy  && { noProxy:  noProxy.trim() }),
      primary:  isPrimary  ?? false,
      fallback: isFallback ?? false,
    };

    if (newModel.primary) {
      this.config.models.forEach(m => { m.primary = false; });
    }
    this.config.models.push(newModel);

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    const apiModel: ApiModel = {
      id:         newModel.id,
      provider:   newModel.provider,
      isPrimary:  newModel.primary  ?? false,
      isFallback: newModel.fallback ?? false,
    };
    if (newModel.model)    apiModel.model    = newModel.model;
    if (newModel.baseUrl)  apiModel.baseUrl  = newModel.baseUrl;
    if (newModel.insecure) apiModel.insecure = newModel.insecure;
    if (newModel.noProxy)  apiModel.noProxy  = newModel.noProxy;
    ok(res, apiModel, 201);
  }

  private async handleUpdateModel(req: IncomingMessage, res: ServerResponse, modelId: string) {
    const idx = this.config.models.findIndex(m => m.id === modelId);
    if (idx < 0) { notFound(res); return; }

    let body: Partial<ModelInstanceConfig & { isPrimary?: boolean; isFallback?: boolean }>;
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const existing = this.config.models[idx]!;
    const updated: ModelInstanceConfig = {
      id:       modelId,
      provider: (body.provider?.trim() as ModelInstanceConfig['provider']) ?? existing.provider,
      // 空字符串表示"不修改"，保留原 key
      apiKey:   body.apiKey?.trim() || existing.apiKey,
      primary:  body.isPrimary  ?? existing.primary  ?? false,
      fallback: body.isFallback ?? existing.fallback ?? false,
    };
    if (body.model !== undefined) {
      const m = body.model?.trim();
      if (m) updated.model = m;
    } else if (existing.model) {
      updated.model = existing.model;
    }
    if (body.baseUrl !== undefined) {
      const u = body.baseUrl?.trim();
      if (u) updated.baseUrl = u;
    } else if (existing.baseUrl) {
      updated.baseUrl = existing.baseUrl;
    }
    if (body.insecure !== undefined) {
      if (body.insecure) updated.insecure = true;
      // insecure: false → 不写入字段，相当于删除该配置
    } else if (existing.insecure) {
      updated.insecure = existing.insecure;
    }
    if (body.noProxy !== undefined) {
      const np = body.noProxy?.trim();
      if (np) updated.noProxy = np;
      // noProxy: '' 或 undefined → 不写入字段，相当于删除
    } else {
      // 字段未传递（undefined）时保留旧值
      if (existing.noProxy) updated.noProxy = existing.noProxy;
    }

    if (updated.primary) {
      this.config.models.forEach(m => { m.primary = false; });
    }
    this.config.models[idx] = updated;

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    // 重新初始化所有使用该模型的 Worker，使新配置（insecure / noProxy 等）立即生效
    if (this.company && this.messagingService) {
      const affectedWorkers = (this.config.workers ?? []).filter(
        w => w.modelId === modelId || w.reviewModelId === modelId,
      );
      for (const workerCfg of affectedWorkers) {
        try {
          this.evictAgent(workerCfg.id);
          this.company.removeWorker(workerCfg.id);
          const worker = await this._createWorker(workerCfg);
          this.company.addWorker(worker);
          if (workerCfg.heartbeatIntervalMs !== 0) {
            this.company.scheduler.start(workerCfg.id, workerCfg.heartbeatIntervalMs ?? 30_000);
          }
        } catch (err) {
          console.error(`  ⚠️  模型更新后重启 Worker "${workerCfg.id}" 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const apiModel: ApiModel = {
      id:         updated.id,
      provider:   updated.provider,
      isPrimary:  updated.primary  ?? false,
      isFallback: updated.fallback ?? false,
    };
    if (updated.model)    apiModel.model    = updated.model;
    if (updated.baseUrl)  apiModel.baseUrl  = updated.baseUrl;
    if (updated.insecure) apiModel.insecure = updated.insecure;
    if (updated.noProxy)  apiModel.noProxy  = updated.noProxy;
    ok(res, apiModel);
  }

  private async handleDeleteModel(res: ServerResponse, modelId: string) {
    const idx = this.config.models.findIndex(m => m.id === modelId);
    if (idx < 0) { notFound(res); return; }

    const wasPrimary = this.config.models[idx]!.primary ?? false;
    this.config.models.splice(idx, 1);

    if (wasPrimary && this.config.models.length > 0) {
      this.config.models[0]!.primary = true;
    }

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    cors(res);
    res.writeHead(204);
    res.end();
  }

  // ── Worker CRUD ──────────────────────────────────────────────────────────────

  private async handleCreateWorker(req: IncomingMessage, res: ServerResponse) {
    let body: Partial<WorkerConfig>;
    try {
      body = JSON.parse(await readBody(req)) as Partial<WorkerConfig>;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const { id: rawId, name, modelId, reviewModelId, heartbeatIntervalMs, role, description, skills, tools, primary, workspace } = body;
    if (!name?.trim())    { badRequest(res, '"name" is required'); return; }
    if (!modelId?.trim()) { badRequest(res, '"modelId" is required'); return; }

    // ID：由客户端提供（可选），若不提供则系统自动生成
    let id: string;
    if (rawId?.trim()) {
      // 如果提供了 ID，做格式校验
      if (!/^[a-zA-Z0-9_-]+$/.test(rawId.trim())) {
        badRequest(res, '"id" must contain only letters, numbers, hyphens, or underscores'); return;
      }
      id = rawId.trim();
    } else {
      // 自动生成：w + 3位递增序号（w001, w002, ...），对 LLM 更易识别
      const existingWorkers = this.config.workers ?? [];
      const maxNum = existingWorkers.reduce((max, w) => {
        const m = /^w(\d+)$/.exec(w.id);
        return m ? Math.max(max, parseInt(m[1]!, 10)) : max;
      }, 0);
      id = 'w' + String(maxNum + 1).padStart(3, '0');
      // 极罕见冲突兜底（如用户手动指定了 w001 等 ID）
      while (existingWorkers.some(w => w.id === id)) {
        id = 'w' + String(parseInt(id.slice(1), 10) + 1).padStart(3, '0');
      }
    }

    const workers = this.config.workers ?? [];
    if (workers.some(w => w.id === id)) {
      conflict(res, `Worker with id "${id}" already exists`); return;
    }

    const newWorker: WorkerConfig = {
      id,
      name: name.trim(),
      modelId: modelId.trim(),
      ...(reviewModelId?.trim() && { reviewModelId: reviewModelId.trim() }),
      ...(heartbeatIntervalMs !== undefined && { heartbeatIntervalMs }),
      role: role?.trim() ?? '',
      description: description?.trim() ?? '',
      skills: skills ?? [],
      tools: tools ?? [],
      primary: primary ?? false,
      ...(workspace?.trim() && { workspace: workspace.trim() }),
    };

    // 若设为主 Worker，取消其他 primary 标记
    if (newWorker.primary) {
      workers.forEach(w => { w.primary = false; });
    }

    workers.push(newWorker);
    this.config.workers = workers;

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    // 若 Company 已初始化，动态加入新 Worker 并启动心跳
    if (this.company && this.messagingService) {
      try {
        const worker = await this._createWorker(newWorker);
        this.company.addWorker(worker);
        if (newWorker.heartbeatIntervalMs !== 0) {
          this.company.scheduler.start(newWorker.id, newWorker.heartbeatIntervalMs ?? 30_000);
        }
      } catch (err) {
        console.error(`  ⚠️  注册 Worker "${newWorker.id}" 到 Company 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const apiWorker: ApiWorker = {
      id:          newWorker.id,
      name:        newWorker.name,
      description: newWorker.description,
      skills:      newWorker.skills,
      modelId:     newWorker.modelId,
      ...(newWorker.reviewModelId && { reviewModelId: newWorker.reviewModelId }),
      ...(newWorker.heartbeatIntervalMs !== undefined && { heartbeatIntervalMs: newWorker.heartbeatIntervalMs }),
      role:        newWorker.role,
      tools:       newWorker.tools ?? [],
      isPrimary:   newWorker.primary ?? false,
      status:      this._resolveWorkerStatus(newWorker.id),
      workspace:   resolveWorkspaceDir(newWorker, this.config),
    };
    ok(res, apiWorker, 201);
  }

  private async handleUpdateWorker(req: IncomingMessage, res: ServerResponse, workerId: string) {
    const workers = this.config.workers ?? [];
    const idx = workers.findIndex(w => w.id === workerId);
    if (idx < 0) { notFound(res); return; }

    let body: Partial<WorkerConfig>;
    try {
      body = JSON.parse(await readBody(req)) as Partial<WorkerConfig>;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const existing = workers[idx]!;
    // reviewModelId: 传空字符串表示清除，undefined 表示不修改
    const newReviewModelId = body.reviewModelId !== undefined
      ? (body.reviewModelId.trim() || undefined)
      : existing.reviewModelId;
    // heartbeatIntervalMs: undefined 表示不修改，0 表示被动模式，>0 为主动轮询间隔
    const newHeartbeatIntervalMs = body.heartbeatIntervalMs !== undefined
      ? body.heartbeatIntervalMs
      : existing.heartbeatIntervalMs;
    // workspace: 传空字符串表示清除（使用默认路径），undefined 表示不修改
    const newWorkspace = body.workspace !== undefined
      ? (body.workspace.trim() || undefined)
      : existing.workspace;
    const updated: WorkerConfig = {
      id:          workerId,
      name:        body.name?.trim()        ?? existing.name,
      modelId:     body.modelId?.trim()     ?? existing.modelId,
      ...(newReviewModelId && { reviewModelId: newReviewModelId }),
      ...(newHeartbeatIntervalMs !== undefined && { heartbeatIntervalMs: newHeartbeatIntervalMs }),
      role:        body.role?.trim()        ?? existing.role,
      description: body.description?.trim() ?? existing.description,
      skills:      body.skills              ?? existing.skills,
      tools:       body.tools               ?? existing.tools ?? [],
      primary:     body.primary             ?? existing.primary ?? false,
      ...(newWorkspace && { workspace: newWorkspace }),
    };

    if (updated.primary) {
      workers.forEach(w => { w.primary = false; });
    }
    workers[idx] = updated;
    this.config.workers = workers;

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    // Worker 配置已变更，清除缓存的会话 Agent（下次请求以新配置重建）
    this.evictAgent(workerId);

    // 若 Company 已初始化，重新注册 Worker（配置可能已更改 model/reviewModelId/heartbeatIntervalMs 等）
    if (this.company && this.messagingService) {
      try {
        this.company.removeWorker(workerId);
        const worker = await this._createWorker(updated);
        this.company.addWorker(worker);
        if (updated.heartbeatIntervalMs !== 0) {
          this.company.scheduler.start(workerId, updated.heartbeatIntervalMs ?? 30_000);
        }
      } catch (err) {
        console.error(`  ⚠️  重新注册 Worker "${workerId}" 到 Company 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const apiWorker: ApiWorker = {
      id:          updated.id,
      name:        updated.name,
      description: updated.description,
      skills:      updated.skills,
      modelId:     updated.modelId,
      ...(updated.reviewModelId && { reviewModelId: updated.reviewModelId }),
      ...(updated.heartbeatIntervalMs !== undefined && { heartbeatIntervalMs: updated.heartbeatIntervalMs }),
      role:        updated.role,
      tools:       updated.tools ?? [],
      isPrimary:   updated.primary ?? false,
      status:      this._resolveWorkerStatus(updated.id),
      workspace:   resolveWorkspaceDir(updated, this.config),
    };
    ok(res, apiWorker);
  }

  private async handleDeleteWorker(res: ServerResponse, workerId: string) {
    const workers = this.config.workers ?? [];
    const idx = workers.findIndex(w => w.id === workerId);
    if (idx < 0) { notFound(res); return; }

    const wasPrimary = workers[idx]!.primary ?? false;
    workers.splice(idx, 1);

    // 若删除的是主 Worker，把第一个升为主
    if (wasPrimary && workers.length > 0) {
      workers[0]!.primary = true;
    }
    this.config.workers = workers;

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    // 清除已缓存的会话 Agent，从 Company 移除（同时停止心跳调度）
    this.evictAgent(workerId);
    this.company?.removeWorker(workerId);

    // 删除 Worker 的持久化记忆文件（FileMemoryStore）
    await this._deleteWorkerMemoryFile(workerId);

    cors(res);
    res.writeHead(204);
    res.end();
  }

  /** 删除 Worker 的 FileMemoryStore 文件（{sessionDir}/worker-{id}.json） */
  private async _deleteWorkerMemoryFile(workerId: string): Promise<void> {
    if (!this.config.defaults.enableMemory) return;
    const sessionDir = this.config.defaults.sessionDir;
    const filePath = join(sessionDir, `worker-${workerId}.json`);
    await unlink(filePath).catch(() => {/* 文件不存在时静默忽略 */});
  }

  // ── 工作空间 API ──────────────────────────────────────────────────────────

  /** GET /api/workspace/:workerId — 工作空间信息 + 文件列表 */
  private async handleGetWorkspace(res: ServerResponse, workerId: string) {
    const workerCfg = this.config.workers?.find(w => w.id === workerId);
    if (!workerCfg) { notFound(res); return; }
    const workspaceDir = resolveWorkspaceDir(workerCfg, this.config);
    const sharedDir    = resolveSharedDir(this.config);
    const [files, sharedFiles] = await Promise.all([
      listWorkspaceFiles(workspaceDir),
      listSharedFiles(sharedDir),
    ]);
    ok(res, { workspaceDir, sharedDir, files, sharedFiles });
  }

  /** GET /api/workspace/:workerId/file/:filePath — 下载工作空间文件 */
  private async handleGetWorkspaceFile(res: ServerResponse, workerId: string, filePath: string) {
    const workerCfg = this.config.workers?.find(w => w.id === workerId);
    if (!workerCfg) { notFound(res); return; }
    const workspaceDir = resolveWorkspaceDir(workerCfg, this.config);
    const absPath = safePath(workspaceDir, filePath);
    if (!absPath) { badRequest(res, '非法路径'); return; }
    try {
      const { readFile: rf } = await import('node:fs/promises');
      const data = await rf(absPath);
      const mime = getMimeType(filePath);
      const fname = encodeURIComponent(filePath.split('/').pop() ?? filePath);
      cors(res);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Content-Disposition': `attachment; filename*=UTF-8''${fname}`,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    } catch {
      notFound(res);
    }
  }

  /** DELETE /api/workspace/:workerId/file/:filePath — 删除工作空间文件 */
  private async handleDeleteWorkspaceFile(res: ServerResponse, workerId: string, filePath: string) {
    const workerCfg = this.config.workers?.find(w => w.id === workerId);
    if (!workerCfg) { notFound(res); return; }
    const workspaceDir = resolveWorkspaceDir(workerCfg, this.config);
    const absPath = safePath(workspaceDir, filePath);
    if (!absPath) { badRequest(res, '非法路径'); return; }
    try {
      await unlink(absPath);
      cors(res);
      res.writeHead(204);
      res.end();
    } catch {
      notFound(res);
    }
  }

  /** GET /api/shared — 共享目录文件列表 */
  private async handleGetShared(res: ServerResponse) {
    const sharedDir = resolveSharedDir(this.config);
    const files = await listSharedFiles(sharedDir);
    ok(res, { sharedDir, files });
  }

  /** GET /api/shared/file/:filePath — 下载共享目录文件 */
  private async handleGetSharedFile(res: ServerResponse, filePath: string) {
    const sharedDir = resolveSharedDir(this.config);
    const absPath = safePath(sharedDir, filePath);
    if (!absPath) { badRequest(res, '非法路径'); return; }
    try {
      const { readFile: rf } = await import('node:fs/promises');
      const data = await rf(absPath);
      const mime = getMimeType(filePath);
      const fname = encodeURIComponent(filePath.split('/').pop() ?? filePath);
      cors(res);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Content-Disposition': `attachment; filename*=UTF-8''${fname}`,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    } catch {
      notFound(res);
    }
  }

  // ── 构建（或复用）Worker 专属的 AgentEngine ───────────────────────────────
  //
  // 每个 Worker 在服务运行期间共享同一 AgentEngine 实例，实现跨会话记忆：
  //   - 普通对话（用户↔Worker）与 DM 对话（Worker↔Worker）使用同一 Agent
  //   - Worker 能感知并记住在不同会话中发生的交互（包括 DM 收到的消息）
  //   - 当 Worker 配置更新时调用 evictAgent() 清除缓存，下次请求重建

  private async getAgentForWorker(workerCfg: WorkerConfig): Promise<AgentInterface> {
    const cached = this.workerAgents.get(workerCfg.id);
    if (cached) return cached;

    // 优先使用 Company Worker（与 CLI 模式共享同一实例，工具注册、[SKIP] 规则完全一致）
    // 这确保了"改 Worker 代码，CLI 和 UI 同时生效"，消除重复实现
    if (this.company) {
      const companyWorker = this.company.getWorker(workerCfg.id);
      if (companyWorker) {
        const adapter = new WorkerChatAdapter(companyWorker);
        this.workerAgents.set(workerCfg.id, adapter);
        return adapter;
      }
    }

    const modelInstance = this.config.models.find(m => m.id === workerCfg.modelId)
      ?? this.config.models.find(m => m.primary)
      ?? this.config.models[0];

    if (!modelInstance) {
      throw new Error(`Worker "${workerCfg.id}" 找不到可用的模型配置`);
    }

    const adapter = await createAdapter(modelInstance);

    const identityHeader = workerCfg.description
      ? `你的名字是「${workerCfg.name}」。${workerCfg.description}`
      : `你的名字是「${workerCfg.name}」。`;

    // 注入技能系统提示（skills 数组中列出的每个技能若有 system 字段则追加）
    const skillPrompts: string[] = [];
    for (const skillId of workerCfg.skills ?? []) {
      const skill = findBuiltin(skillId);
      if (skill?.system) skillPrompts.push(skill.system);
    }
    // communicate 技能是核心通信能力，所有 Worker 默认具备
    if (!workerCfg.skills?.includes('communicate')) {
      const communicateSkill = findBuiltin('communicate');
      if (communicateSkill?.system) skillPrompts.push(communicateSkill.system);
    }

    const system = [identityHeader, workerCfg.role || '', ...skillPrompts].filter(Boolean).join('\n\n');

    const engine = await AgentEngine.create({
      model:  adapter,
      system,
    });

    // 注册内置工具（含工作空间工具）
    const wsDir   = resolveWorkspaceDir(workerCfg, this.config);
    const shdDir  = resolveSharedDir(this.config);
    const wsTools = createWorkspaceTools(wsDir, shdDir);
    for (const toolId of workerCfg.tools ?? []) {
      const tool = wsTools[toolId] ?? getBuiltinTool(toolId);
      if (tool) engine.registerTool(tool);
    }

    // ── 注册群组沟通工具（与 CLI 模式共享同一 ChatStore，持久化到 ~/.bcc/chats）──
    const selfWorkerId = workerCfg.id;
    const selfWorkerName = workerCfg.name;
    const chatStore = this.chatStore;
    // 捕获 server 引用，用于工具 handler 中触发对方心跳（按需审视）
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const server = this;

    engine.registerTool({
      definition: {
        name: 'create_group_chat',
        description:
          '创建一个群聊，用于与 2 个或以上同事协作。' +
          '主管（用户）会自动加入群聊，无需手动添加。' +
          '返回 chatId，后续用 send_to_group 在群内发消息。',
        inputSchema: {
          type: 'object',
          properties: {
            participants: {
              type: 'array',
              items: { type: 'string' },
              description: '参与者的 Worker ID 数组（不需要包含自己和主管，系统自动添加）',
            },
            title: { type: 'string', description: '群聊名称（可选）' },
          },
          required: ['participants'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { participants, title } = input as { participants: string[]; title?: string };
        // 自动加入自己和 "user"（人类主管），去重
        const allParticipants = [...new Set([selfWorkerId, ...(participants as string[]), 'user'])];
        const chat = await chatStore.createChat(allParticipants, 'group', title);
        return [
          `✅ 群聊已创建`,
          `   群聊 ID：${chat.id}`,
          `   群聊名称：${chat.title ?? '（无标题）'}`,
          `   参与成员：${allParticipants.join('、')}`,
          `   （主管已自动加入，确保透明可查）`,
          `   提示：使用 send_to_group 发送消息，用 @workerID 指派任务`,
        ].join('\n');
      },
    });

    engine.registerTool({
      definition: {
        name: 'send_to_group',
        description:
          '在群聊中发送消息，可用 @workerID 格式指派任务给特定成员。' +
          '例如：@worker2，请完成需求文档；@worker3，请评估技术方案。',
        inputSchema: {
          type: 'object',
          properties: {
            chatId:  { type: 'string', description: '群聊 ID（由 create_group_chat 返回）' },
            content: { type: 'string', description: '消息内容，可包含 @workerID 指派任务' },
          },
          required: ['chatId', 'content'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { chatId, content } = input as { chatId: string; content: string };
        // 优先通过 messagingService 发送（会触发 chat:message:sent 事件），降级到 chatStore
        const msg = server.messagingService
          ? await server.messagingService.post(chatId, selfWorkerId, content)
          : await chatStore.sendMessage(chatId, selfWorkerId, content);
        // 发送后立即触发群成员（非自己、非 user）的心跳，让对方尽快处理消息
        if (server.company) {
          const chat = await chatStore.getChat(chatId);
          const recipients = (chat?.participants ?? []).filter(p => p !== selfWorkerId && p !== 'user');
          for (const recipientId of recipients) {
            if (server.company.scheduler.isRunning(recipientId)) {
              void server.company.scheduler.triggerReview(recipientId).catch(() => {});
            }
          }
        }
        return [
          `✅ 消息已发送`,
          `   发件人：${selfWorkerId}（${selfWorkerName}）`,
          `   会话 ID：${(chatId as string).slice(0, 8)}…`,
          `   消息 ID：${msg.id}`,
          `   发送时间：${new Date(msg.timestamp).toLocaleString('zh-CN')}`,
        ].join('\n');
      },
    });

    engine.registerTool({
      definition: {
        name: 'check_my_mentions',
        description:
          '扫描所有群聊，查找 @提及了我的消息。' +
          '看到任务指派后，应使用任务工具记录到自己的待办列表。',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const chats = await chatStore.listChats(selfWorkerId);
        const mentions: string[] = [];

        for (const chat of chats) {
          if (chat.status === 'archived') continue;
          const messages = await chatStore.getMessages(chat.id);
          for (const m of messages) {
            if (m.from === selfWorkerId) continue;  // 自己发的不算
            if (m.content.includes(`@${selfWorkerId}`) || m.content.includes(`@${selfWorkerName}`)) {
              const time = new Date(m.timestamp).toLocaleString('zh-CN');
              const groupLabel = chat.title ?? `${chat.id.slice(0, 8)}…`;
              mentions.push(`[${time}] 群聊「${groupLabel}」来自 ${m.from}：${m.content}`);
            }
          }
        }

        if (mentions.length === 0) return '📭 没有找到 @提及了我的消息。';
        return `📬 找到 ${mentions.length} 条 @提及消息：\n\n` + mentions.join('\n\n');
      },
    });

    // 工具：向另一个 Worker 或用户发送私信（直接消息）
    engine.registerTool({
      definition: {
        name: 'send_direct_message',
        description:
          '向另一个 Worker 或用户发送一条私信（直接消息）。' +
          '收件方为 Worker 时，对方会在下一个心跳周期自动处理。' +
          '收件方填 "user" 可直接给用户（主管）发通知。' +
          '适合：请求协作、传递信息、任务完成后通知用户。',
        inputSchema: {
          type: 'object',
          properties: {
            toWorkerId: {
              type: 'string',
              description: '收件方的 Worker ID，或 "user"（表示发消息给用户/主管）',
            },
            content: { type: 'string', description: '消息正文' },
          },
          required: ['toWorkerId', 'content'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { toWorkerId, content } = input as { toWorkerId: string; content: string };
        // 创建或打开两人之间的直聊会话（幂等）
        const chat = await chatStore.createChat([selfWorkerId, toWorkerId as string], 'direct');
        const msg = server.messagingService
          ? await server.messagingService.post(chat.id, selfWorkerId, content)
          : await chatStore.sendMessage(chat.id, selfWorkerId, content);
        // 触发收件方心跳（'user' 没有心跳，跳过）
        if (toWorkerId !== 'user' && server.company?.scheduler.isRunning(toWorkerId as string)) {
          void server.company.scheduler.triggerReview(toWorkerId as string).catch(() => {});
        }
        return [
          `✅ 私信已发送`,
          `   收件方：${toWorkerId}`,
          `   会话 ID：${chat.id.slice(0, 8)}…`,
          `   消息 ID：${msg.id}`,
          `   发送时间：${new Date(msg.timestamp).toLocaleString('zh-CN')}`,
          toWorkerId !== 'user' ? `   （已触发对方即时处理）` : `   （已存入用户收件箱）`,
        ].join('\n');
      },
    });

    // 工具：查看自己的未读消息收件箱
    engine.registerTool({
      definition: {
        name: 'read_inbox',
        description:
          '查看我的未读消息收件箱，获取其他 Worker 或用户发给我但尚未处理的消息。' +
          '可用于：了解有哪些新任务、跟进协作进展、回应别人的提问。',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const allUnread = await chatStore.getAllUnread(selfWorkerId);
        if (allUnread.length === 0) return '📭 收件箱没有未读消息。';
        const lines = allUnread.map(({ chat, message }) => {
          const time = new Date(message.timestamp).toLocaleString('zh-CN');
          const chatLabel = chat.title ?? `${chat.id.slice(0, 8)}…`;
          return `[${time}] 来自「${message.from}」，会话「${chatLabel}」：${message.content}`;
        });
        return `📬 你有 ${allUnread.length} 条未读消息：\n\n` + lines.join('\n\n');
      },
    });

    // ── 注册任务管理工具（仅限具备 'todolist' 技能的 Worker）──────────────────
    if (workerCfg.skills?.includes('todolist')) {
      const taskMgr = this.getTaskManagerForWorker(workerCfg.id);

      engine.registerTool({
        definition: {
          name: 'create_task',
          description: '在我的待办列表中创建一个新任务。收到 @指派 后调用此工具记录任务。',
          inputSchema: {
            type: 'object',
            properties: {
              title:       { type: 'string', description: '任务标题（简短）' },
              description: { type: 'string', description: '任务详细描述与要求' },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'urgent'],
                description: '优先级，默认 medium',
              },
              chatId:    { type: 'string', description: '（可选）关联的群聊 ID，用于溯源' },
              messageId: { type: 'string', description: '（可选）触发此任务的消息 ID' },
            },
            required: ['title', 'description'],
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const { title, description, priority, chatId, messageId } = input as {
            title: string; description: string; priority?: string; chatId?: string; messageId?: string;
          };
          const task = await taskMgr.create({
            title, description,
            priority: (priority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
            createdBy: selfWorkerId,
            ...(chatId    && { chatId }),
            ...(messageId && { messageId }),
          });
          return [
            `✅ 任务已创建`,
            `   ID：${task.id}`,
            `   标题：${task.title}`,
            `   优先级：${task.priority}`,
            `   状态：${task.status}`,
          ].join('\n');
        },
      });

      engine.registerTool({
        definition: {
          name: 'update_task_status',
          description: '更新我的待办任务状态。',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: '任务 ID' },
              status: {
                type: 'string',
                enum: ['todo', 'in_progress', 'done', 'blocked', 'cancelled'],
                description: '新状态',
              },
            },
            required: ['taskId', 'status'],
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const { taskId, status } = input as { taskId: string; status: string };
          const task = await taskMgr.updateStatus(taskId, status as 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled');
          if (!task) return `⚠ 未找到任务 ${taskId}`;
          return `✅ 任务「${task.title}」状态已更新为 ${task.status}`;
        },
      });

      engine.registerTool({
        definition: {
          name: 'list_tasks',
          description: '查看我的待办任务列表，可按状态过滤。',
          inputSchema: {
            type: 'object',
            properties: {
              statusFilter: {
                type: 'array',
                items: { type: 'string', enum: ['todo', 'in_progress', 'done', 'blocked', 'cancelled'] },
                description: '按状态过滤（不填则返回全部）',
              },
            },
            required: [],
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const { statusFilter } = input as { statusFilter?: string[] };
          const tasks = await taskMgr.list(statusFilter as Array<'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'> | undefined);
          if (tasks.length === 0) return '📋 当前没有符合条件的任务。';
          return tasks.map((t: { priority: string; status: string; title: string; description: string }) =>
            `[${t.priority.toUpperCase()}] [${t.status}] ${t.title}\n  ${t.description}`
          ).join('\n\n');
        },
      });
    }

    this.workerAgents.set(workerCfg.id, engine);
    return engine;
  }

  /** 获取或创建某 Worker 的 TaskManager（有 todolist 技能才会调用） */
  private getTaskManagerForWorker(workerId: string): TaskManager {
    let tm = this.workerTaskManagers.get(workerId);
    if (!tm) {
      tm = new TaskManager({ store: this.taskStore, workerId });
      this.workerTaskManagers.set(workerId, tm);
    }
    return tm;
  }

  /**
   * Worker 配置变更时调用，使其下次请求重新初始化 Agent。
   * 同时重启该 Worker 的心跳（确保新配置生效）。
   */
  private evictAgent(workerId: string) {
    this.workerAgents.delete(workerId);
  }

  // ─── 心跳 & SSE 事件流 ────────────────────────────────────────────────────────

  /**
   * GET /api/events
   *
   * SSE 全局事件流，供前端实时订阅 Worker 的主动行为事件。
   *
   * 事件类型：
   *   heartbeat  - Worker 心跳事件（tick / processed / idle / error）
   *
   * 使用示例（前端）：
   *   const es = new EventSource('/api/events');
   *   es.addEventListener('heartbeat', e => console.log(JSON.parse(e.data)));
   */
  private handleSseEvents(req: IncomingMessage, res: ServerResponse): void {
    cors(res);
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });

    // 发送初始连接确认（让客户端知道连接成功）
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    // 注册客户端
    this.sseClients.add(res);

    // 客户端断开时清理
    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  /**
   * POST /api/workers/:workerId/heartbeat
   *
   * 手动触发某个 Worker 的一次心跳审视。
   * 可用于：测试心跳机制、在新消息到达时立即触发（无需等待下一个定时间隔）。
   */
  private async handleTriggerHeartbeat(res: ServerResponse, workerId: string): Promise<void> {
    const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
    if (!workerCfg) {
      notFound(res);
      return;
    }

    if (!this.company) {
      ok(res, { workerId, message: '心跳调度器未启动（无 Worker 配置）', triggered: false });
      return;
    }

    try {
      await this.company.scheduler.triggerReview(workerId);
      ok(res, { workerId, message: '心跳审视已触发', triggered: true });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  // ── Skills CRUD ──────────────────────────────────────────────────────────────

  private async handleGetSkills(res: ServerResponse) {
    try {
      const reg = await SkillRegistry.load();
      const list = reg.list();
      const stats = reg.stats();
      ok(res, { skills: list, stats });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  private async handleCreateSkill(req: IncomingMessage, res: ServerResponse) {
    let body: { name?: string; description?: string; prompt?: string; system?: string };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      badRequest(res, 'Invalid JSON body'); return;
    }

    const { name, description, prompt, system } = body;
    if (!name?.trim())        { badRequest(res, '"name" is required'); return; }
    if (!description?.trim()) { badRequest(res, '"description" is required'); return; }
    if (!prompt?.trim())      { badRequest(res, '"prompt" is required'); return; }

    const { validateSkillName } = await import('@bcc/skills');
    const err = validateSkillName(name);
    if (err) { badRequest(res, err); return; }

    try {
      await saveUserSkill({
        name,
        description,
        prompt,
        ...(system !== undefined && system.trim() !== '' && { system }),
      });
      ok(res, { name, description, prompt, ...(system ? { system } : {}), source: 'user' }, 201);
    } catch (e) {
      serverError(res, e instanceof Error ? e.message : String(e));
    }
  }

  private async handleDeleteSkill(res: ServerResponse, name: string) {
    try {
      const { loadUserSkill } = await import('@bcc/skills');
      const existing = await loadUserSkill(name);
      if (!existing) {
        notFound(res); return;
      }
      await deleteUserSkill(name);
      ok(res, { deleted: true, name });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  private async handleSkillHubSearch(url: URL, res: ServerResponse) {
    const query = url.searchParams.get('q') ?? '';
    if (!query.trim()) {
      badRequest(res, '"q" query parameter is required'); return;
    }
    try {
      const hub = new SkillHub();
      const skills = await hub.search(query);
      ok(res, { skills, total: skills.length });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }
}
