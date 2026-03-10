#!/usr/bin/env node
/**
 * bcc-server — HTTP/SSE API 服务器
 *
 * 为 Web 前端（packages/web）提供后端 API。
 *
 * 用法：
 *   pnpm bcc-server [--port 3000]
 *
 * 配置读取：~/.bcc/config.json（由 bcc-init 生成）
 */

import { HttpServer } from '../src/server.js';
import { loadConfig } from '../src/config-loader.js';

// ─── 参数解析 ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let port = 3000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    const p = parseInt(args[i + 1]!, 10);
    if (!isNaN(p)) port = p;
    i++;
  }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
bcc-server — backer-cloud-claw HTTP API 服务器

用法：
  pnpm bcc-server [选项]

选项：
  --port <n>    监听端口（默认 3000）
  --help, -h    显示此帮助

说明：
  启动后，Web 前端（pnpm --filter @bcc/web dev）可通过
  http://localhost:<port>/api 访问所有 AI 对话接口。

  配置文件：~/.bcc/config.json（请先运行 pnpm bcc-init）
`);
    process.exit(0);
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

const config = await loadConfig();

if (!config) {
  console.error(`
错误：未找到配置文件 (~/.bcc/config.json)。
请先运行初始化向导：

  pnpm bcc-init
`);
  process.exit(1);
}

if (config.models.length === 0) {
  console.error(`
错误：配置中没有可用的模型。
请运行 pnpm bcc-init 添加至少一个模型。
`);
  process.exit(1);
}

const server = new HttpServer(config, port);
await server.start();

// 输出配置摘要
const workerCount = config.workers?.length ?? 0;
console.log(`  📋 已加载配置：`);
console.log(`     模型：${config.models.map(m => m.id).join('、')}`);
console.log(`     Worker：${workerCount > 0 ? config.workers!.map(w => `${w.name}（${w.id}）`).join('、') : '（未配置，将以普通对话模式运行）'}`);
console.log(`\n  CORS 已开启，Web 前端可直接跨域请求。`);
console.log(`  按 Ctrl+C 停止服务。\n`);
