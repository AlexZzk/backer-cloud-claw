/**
 * basic-chat：验证 Phase 0 完整链路
 *
 * 演示：
 *   1. 最简用法（单模型）
 *   2. 多模型路由（故障转移 A + 手动切换 B）
 *   3. 流式输出
 *   4. 历史保留验证
 */
import { logger } from '@bcc/foundation';
import { ModelRouter } from '@bcc/model-core';
import { ClaudeAdapter } from '@bcc/model-claude';
import { DeepSeekAdapter } from '@bcc/model-deepseek';
import { ChatSession } from '@bcc/conversation';

const log = logger.child('example');

// ─── 示例 1：最简用法（单模型） ──────────────────────────────────────────────

async function demo1() {
  log.info('=== Demo 1: 单模型对话 ===');

  const session = new ChatSession({
    model: new ClaudeAdapter(),
    system: '你是一个简洁的 AI 助手，回复不超过 2 句话。',
  });

  const r1 = await session.chat('你好，我叫 Alex');
  log.info(`Claude: ${r1.text}`);

  const r2 = await session.chat('我刚才说我叫什么？');
  log.info(`Claude（记住了吗）: ${r2.text}`);

  log.info(`对话历史条数: ${session.getHistory().length}`);
}

// ─── 示例 2：故障转移（场景 A）──────────────────────────────────────────────

async function demo2() {
  log.info('\n=== Demo 2: 故障转移（Claude 主 → DeepSeek 备） ===');

  const router = new ModelRouter({ enableFailover: true })
    .register(new ClaudeAdapter(), { priority: 0 })               // 主模型
    .register(new DeepSeekAdapter(), { priority: 1, fallback: true }); // 备用

  const session = new ChatSession({ model: router });
  log.info(`当前模型: ${session.currentModel}`);
  log.info(`可用模型: ${session.listModels().join(', ')}`);

  const result = await session.chat('用一句话解释什么是故障转移');
  log.info(`回复: ${result.text}`);
}

// ─── 示例 3：手动切换（场景 B）──────────────────────────────────────────────

async function demo3() {
  log.info('\n=== Demo 3: 手动切换模型，历史保留 ===');

  const router = new ModelRouter()
    .register(new ClaudeAdapter())
    .register(new DeepSeekAdapter());

  const session = new ChatSession({ model: router });

  log.info(`初始模型: ${session.currentModel}`);
  const r1 = await session.chat('记住这个数字：42');
  log.info(`Claude: ${r1.text}`);

  session.switchModel('deepseek:deepseek-chat');
  log.info(`切换后模型: ${session.currentModel}`);

  const r2 = await session.chat('我刚才让你记住的数字是多少？');
  log.info(`DeepSeek（历史是否保留）: ${r2.text}`);
}

// ─── 示例 4：流式输出 ────────────────────────────────────────────────────────

async function demo4() {
  log.info('\n=== Demo 4: 流式输出 ===');

  const session = new ChatSession({
    model: new ClaudeAdapter(),
  });

  process.stdout.write('流式回复: ');
  for await (const chunk of session.stream('用三个词描述编程的乐趣')) {
    if (chunk.type === 'text' && chunk.text) {
      process.stdout.write(chunk.text);
    }
  }
  process.stdout.write('\n');
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

async function main() {
  // 没有 API Key 时跳过真实调用，只做结构验证
  const hasApiKey = Boolean(
    process.env['ANTHROPIC_API_KEY'] || process.env['DEEPSEEK_API_KEY'],
  );

  if (!hasApiKey) {
    log.info('未检测到 API Key，运行结构验证模式（不发起真实请求）');
    await structureCheck();
    return;
  }

  await demo1();
  await demo2();
  await demo3();
  await demo4();
}

/** 无 API Key 时验证模块结构是否正确 */
async function structureCheck() {
  log.info('验证模块导入与类型结构...');

  // 验证 ModelRouter
  const router = new ModelRouter({ enableFailover: true, maxRetries: 3 })
    .register(new ClaudeAdapter({ apiKey: 'mock' }), { priority: 0 })
    .register(new DeepSeekAdapter({ apiKey: 'mock' }), { priority: 1, fallback: true });

  log.info(`ModelRouter 当前模型: ${router.currentModelId}`);
  log.info(`可用模型列表: ${router.listModels().map(m => m.id).join(', ')}`);

  // 验证 ChatSession
  const session = new ChatSession({
    model: router,
    system: '你是一个助手',
    history: { maxMessages: 50 },
  });

  log.info(`ChatSession 当前模型: ${session.currentModel}`);
  log.info(`可用模型: ${session.listModels().join(', ')}`);

  // 验证手动切换
  session.switchModel('deepseek:deepseek-chat');
  log.info(`切换后模型: ${session.currentModel}`);

  // 验证历史注入
  session.injectMessage({ role: 'user', content: '你好' });
  session.injectMessage({ role: 'assistant', content: '你好！有什么可以帮你？' });
  log.info(`历史条数: ${session.getHistory().length}`);
  log.info(`历史内容:\n${session.dumpHistory()}`);

  log.info('\n✓ 所有结构验证通过！设置 ANTHROPIC_API_KEY 后可运行真实对话。');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
