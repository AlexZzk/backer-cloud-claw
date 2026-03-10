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
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AgentEngine } from '@bcc/agent-engine';
import { getBuiltinTool } from '@bcc/skills';
import { SessionStore } from './session-store.js';
import type { ApiWorker, ApiModel, TokenStats, SseEvent } from './types.js';
import type {
  BccConfig,
  ModelInstanceConfig,
  WorkerConfig,
} from './config-loader.js';
import { saveConfig, loadConfig } from './config-loader.js';

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse) {
  json(res, 404, { error: 'Not found' });
}

function badRequest(res: ServerResponse, message: string) {
  json(res, 400, { error: message });
}

function serverError(res: ServerResponse, message: string) {
  json(res, 500, { error: message });
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

  constructor(
    private config: BccConfig,
    readonly port = 3000,
  ) {}

  // ── 对外入口 ────────────────────────────────────────────────────────────────

  start(): Promise<void> {
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

    // CORS 预检
    if (method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // ── GET /api/health
    if (method === 'GET' && path === '/api/health') {
      json(res, 200, { status: 'ok', timestamp: Date.now() });
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
      json(res, 200, {
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

    // ── POST /api/dm-sessions  (创建 Worker↔Worker DM 会话)
    if (method === 'POST' && path === '/api/dm-sessions') {
      await this.handleCreateDmSession(req, res);
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
    json(res, 200, workers);
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
    json(res, 200, models);
  }

  private handleGetAnalytics(res: ServerResponse) {
    const byWorker = [...this.tokenAcc.values()];
    const stats: TokenStats = {
      totalInputTokens:  byWorker.reduce((s, w) => s + w.inputTokens,  0),
      totalOutputTokens: byWorker.reduce((s, w) => s + w.outputTokens, 0),
      totalTokens:       byWorker.reduce((s, w) => s + w.totalTokens,  0),
      byWorker,
    };
    json(res, 200, stats);
  }

  private async handleCreateSession(req: IncomingMessage, res: ServerResponse, workerId: string) {
    const workerCfg = (this.config.workers ?? []).find(w => w.id === workerId);
    if (!workerCfg) {
      notFound(res);
      return;
    }

    try {
      const agent = await this.buildAgentForWorker(workerCfg);
      const entry = this.store.create(workerId, agent);
      json(res, 201, this.store.toApiSession(entry));
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  }

  private handleListSessions(res: ServerResponse, workerId: string) {
    const sessions = this.store.listByWorker(workerId).map(e => this.store.toApiSession(e));
    json(res, 200, sessions);
  }

  private handleGetSession(res: ServerResponse, sessionId: string) {
    const entry = this.store.get(sessionId);
    if (!entry) { notFound(res); return; }
    json(res, 200, { ...this.store.toApiSession(entry), messages: entry.messages });
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
      json(res, 200, this.store.toApiSession(existing));
      return;
    }

    try {
      const fromAgent = await this.buildAgentForWorker(fromCfg);
      const toAgent   = await this.buildAgentForWorker(toCfg);
      const entry = this.store.createDm(fromWorkerId, toWorkerId, fromAgent, toAgent);
      json(res, 201, this.store.toApiSession(entry));
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
      json(res, 409, { error: `Model with id "${id}" already exists` }); return;
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
    json(res, 201, apiModel);
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
    json(res, 200, apiModel);
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
      json(res, 409, { error: `Worker with id "${id}" already exists` }); return;
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
    json(res, 201, apiWorker);
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
    json(res, 200, apiWorker);
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

    cors(res);
    res.writeHead(204);
    res.end();
  }

  // ── 构建 Worker 专属的 AgentEngine（每个 HTTP 会话独立实例）────────────────

  private async buildAgentForWorker(workerCfg: WorkerConfig) {
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

    const system = [identityHeader, workerCfg.role || ''].filter(Boolean).join('\n\n');

    const engine = await AgentEngine.create({
      model:  adapter,
      system,
      // 每个 HTTP 会话不共享持久化（会话间隔离）
    });

    for (const toolId of workerCfg.tools ?? []) {
      const tool = getBuiltinTool(toolId);
      if (tool) engine.registerTool(tool);
    }

    return engine;
  }
}
