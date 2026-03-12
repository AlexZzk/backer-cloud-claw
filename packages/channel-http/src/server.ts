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
 *
 * Worker 间异步聊天监控（依赖 @bcc/messaging）：
 *   GET    /api/chats                     列出所有 Worker 间聊天会话
 *   GET    /api/chats/:chatId             获取会话元信息
 *   GET    /api/chats/:chatId/messages    获取会话消息历史
 *   POST   /api/chats                     创建/打开直聊会话
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AgentEngine } from '@bcc/agent-engine';
import { getBuiltinTool, findBuiltin } from '@bcc/skills';
import type { AgentInterface } from '@bcc/foundation';
import { SessionStore } from './session-store.js';
import type { ApiWorker, ApiModel, TokenStats, SseEvent } from './types.js';
import type {
  BccConfig,
  ModelInstanceConfig,
  WorkerConfig,
} from './config-loader.js';
import { saveConfig, loadConfig } from './config-loader.js';
import { ChatStore } from '@bcc/messaging';
import { TaskStore, TaskManager } from '@bcc/task';

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
  });
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

export class HttpServer {
  private store = new SessionStore();
  private tokenAcc = new Map<string, WorkerTokenAcc>();
  /** 每个 Worker 共享同一 AgentEngine 实例，跨会话保持记忆 */
  private workerAgents = new Map<string, AgentInterface>();
  /** Worker 间异步聊天存储（与 CLI 模式共享同一 ~/.bcc/chats 目录） */
  private chatStore = new ChatStore();
  /** 任务存储（持久化到 ~/.bcc/tasks，所有 Worker 共享一个 TaskStore） */
  private taskStore = new TaskStore();
  /** 每个 Worker 的 TaskManager（有 todolist 技能的 Worker 才创建） */
  private workerTaskManagers = new Map<string, TaskManager>();

  constructor(
    private config: BccConfig,
    readonly port = 3000,
  ) {}

  // ── 对外入口 ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // 从磁盘恢复历史会话（元数据 + 消息，agent 按需重建）
    await this.store.loadFromDisk();

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

    // ── GET /api/analytics/tokens
    if (method === 'GET' && path === '/api/analytics/tokens') {
      this.handleGetAnalytics(res);
      return;
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

    // ── GET /api/chats/:chatId/messages
    {
      const m = matchRoute('/api/chats/:chatId/messages', path);
      if (m && method === 'GET') {
        await this.handleGetChatMessages(res, m.params['chatId']!);
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
      role:        w.role,
      tools:       w.tools ?? [],
      isPrimary:   w.primary ?? false,
      status:      'online' as const,
    }));
    ok(res, workers);
  }

  private async handleGetModels(res: ServerResponse) {
    await this.reloadConfig();
    const models: ApiModel[] = this.config.models.map(m => ({
      id:         m.id,
      provider:   m.provider,
      ...(m.model   && { model:   m.model }),
      ...(m.baseUrl && { baseUrl: m.baseUrl }),
      isPrimary:  m.primary  ?? false,
      isFallback: m.fallback ?? false,
    }));
    ok(res, models);
  }

  private handleGetAnalytics(res: ServerResponse) {
    const byWorker = [...this.tokenAcc.values()];
    const stats: TokenStats = {
      totalInputTokens:  byWorker.reduce((s, w) => s + w.inputTokens,  0),
      totalOutputTokens: byWorker.reduce((s, w) => s + w.outputTokens, 0),
      totalTokens:       byWorker.reduce((s, w) => s + w.totalTokens,  0),
      byWorker,
    };
    ok(res, stats);
  }

  private async handleCreateSession(req: IncomingMessage, res: ServerResponse, workerId: string) {
    const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
    if (!workerCfg) {
      notFound(res);
      return;
    }

    // 幂等：用户与同一 Worker 只有一个 1对1 会话，存在则直接返回
    const existing = this.store.findChat(workerId);
    if (existing) {
      ok(res, this.store.toApiSession(existing));
      return;
    }

    try {
      const agent = await this.getAgentForWorker(workerCfg);
      const entry = this.store.create(workerId, agent);
      ok(res, this.store.toApiSession(entry), 201);
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
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
    // 懒加载：会话从磁盘恢复时 agent 为 undefined，按需重建
    if (!entry.agent) {
      const workerCfg = (this.config.workers ?? []).find(w => w.id === entry.workerId);
      if (!workerCfg) {
        writeSse(res, { event: 'error', data: { message: `Worker "${entry.workerId}" 配置不存在` } });
        res.end(); return;
      }
      entry.agent = await this.getAgentForWorker(workerCfg);
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

    // 构建发给 toWorker 的提示（带发送方身份）
    const promptForTo = `[来自 ${fromName} 的消息]\n${fromText}`;
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
      if (!entry.agent) entry.agent = agentMap.get(entry.workerId);
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
    const acc = this.tokenAcc.get(workerId) ?? {
      workerId, workerName, inputTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0,
    };
    acc.inputTokens  += tokenUsage.inputTokens;
    acc.outputTokens += tokenUsage.outputTokens;
    acc.totalTokens  += tokenUsage.totalTokens;
    acc.callCount    += 1;
    this.tokenAcc.set(workerId, acc);
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

    const { id, provider, apiKey, model, baseUrl, isPrimary, isFallback } = body;
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
      ...(model   && { model:   model.trim() }),
      ...(baseUrl && { baseUrl: baseUrl.trim() }),
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
      ...(newModel.model   && { model:   newModel.model }),
      ...(newModel.baseUrl && { baseUrl: newModel.baseUrl }),
      isPrimary:  newModel.primary  ?? false,
      isFallback: newModel.fallback ?? false,
    };
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

    if (updated.primary) {
      this.config.models.forEach(m => { m.primary = false; });
    }
    this.config.models[idx] = updated;

    try {
      await saveConfig(this.config);
    } catch (err) {
      serverError(res, `Failed to save config: ${err instanceof Error ? err.message : String(err)}`); return;
    }

    const apiModel: ApiModel = {
      id:         updated.id,
      provider:   updated.provider,
      ...(updated.model   && { model:   updated.model }),
      ...(updated.baseUrl && { baseUrl: updated.baseUrl }),
      isPrimary:  updated.primary  ?? false,
      isFallback: updated.fallback ?? false,
    };
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

    const { id, name, modelId, role, description, skills, tools, primary } = body;
    if (!id?.trim())      { badRequest(res, '"id" is required'); return; }
    if (!name?.trim())    { badRequest(res, '"name" is required'); return; }
    if (!modelId?.trim()) { badRequest(res, '"modelId" is required'); return; }

    // ID 格式校验（只允许字母、数字、连字符、下划线）
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      badRequest(res, '"id" must contain only letters, numbers, hyphens, or underscores'); return;
    }

    const workers = this.config.workers ?? [];
    if (workers.some(w => w.id === id)) {
      conflict(res, `Worker with id "${id}" already exists`); return;
    }

    const newWorker: WorkerConfig = {
      id: id.trim(),
      name: name.trim(),
      modelId: modelId.trim(),
      role: role?.trim() ?? '',
      description: description?.trim() ?? '',
      skills: skills ?? [],
      tools: tools ?? [],
      primary: primary ?? false,
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

    const apiWorker: ApiWorker = {
      id:          newWorker.id,
      name:        newWorker.name,
      description: newWorker.description,
      skills:      newWorker.skills,
      modelId:     newWorker.modelId,
      role:        newWorker.role,
      tools:       newWorker.tools ?? [],
      isPrimary:   newWorker.primary ?? false,
      status:      'online',
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
    const updated: WorkerConfig = {
      id:          workerId,
      name:        body.name?.trim()        ?? existing.name,
      modelId:     body.modelId?.trim()     ?? existing.modelId,
      role:        body.role?.trim()        ?? existing.role,
      description: body.description?.trim() ?? existing.description,
      skills:      body.skills              ?? existing.skills,
      tools:       body.tools               ?? existing.tools ?? [],
      primary:     body.primary             ?? existing.primary ?? false,
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

    // Worker 配置已变更，清除缓存的 Agent（下次请求会以新配置重建）
    this.evictAgent(workerId);

    const apiWorker: ApiWorker = {
      id:          updated.id,
      name:        updated.name,
      description: updated.description,
      skills:      updated.skills,
      modelId:     updated.modelId,
      role:        updated.role,
      tools:       updated.tools ?? [],
      isPrimary:   updated.primary ?? false,
      status:      'online',
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

    // 清除已缓存的 Agent
    this.evictAgent(workerId);

    cors(res);
    res.writeHead(204);
    res.end();
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

    for (const toolId of workerCfg.tools ?? []) {
      const tool = getBuiltinTool(toolId);
      if (tool) engine.registerTool(tool);
    }

    // ── 注册群组沟通工具（与 CLI 模式共享同一 ChatStore，持久化到 ~/.bcc/chats）──
    const selfWorkerId = workerCfg.id;
    const selfWorkerName = workerCfg.name;
    const chatStore = this.chatStore;

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
        const msg = await chatStore.sendMessage(chatId, selfWorkerId, content);
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

  /** Worker 配置变更时调用，使其下次请求重新初始化 Agent */
  private evictAgent(workerId: string) {
    this.workerAgents.delete(workerId);
  }
}
