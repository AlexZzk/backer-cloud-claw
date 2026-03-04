import * as readline from 'node:readline';
import type { AgentInterface } from '@bcc/foundation';
import { bold, cyan, green, yellow, red, gray, dim, clearLine, showCursor } from './ansi.js';

const PROMPT    = cyan('You') + gray(' › ') + ' ';
const AI_PREFIX = green('AI') + gray('  › ') + ' ';
const THINKING  = dim('  …thinking');

/** 内置斜杠命令列表 */
const HELP_TEXT = `
${bold('可用命令：')}
  ${yellow('/help')}              显示此帮助
  ${yellow('/clear')}             清空对话历史（不影响已保存的文件）
  ${yellow('/history')}           查看当前对话历史
  ${yellow('/model <id>')}        切换模型（需配置 ModelRouter）
  ${yellow('/models')}            列出所有可用模型
  ${yellow('/save')}              手动保存当前历史到持久化存储
  ${yellow('/session')}           显示当前 Session 信息
  ${yellow('/exit')} 或 ${yellow('Ctrl+C')}  退出
`;

export interface ReplOptions {
  session: AgentInterface;
  banner?: string | undefined;
  hint?: string | undefined;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const { session } = options;

  if (options.banner) console.log(options.banner);
  if (options.hint)   console.log(dim(options.hint));
  console.log(dim('  输入 /help 查看命令，Ctrl+C 或 /exit 退出\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // ─── 斜杠命令 ──────────────────────────────────────────────────────────
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.slice(1).split(/\s+/);
      await handleCommand(cmd ?? '', args, session, rl);
      return;
    }

    // ─── 普通对话 ──────────────────────────────────────────────────────────
    rl.pause();
    process.stdout.write(THINKING);

    let firstTextChunk = true;
    try {
      for await (const chunk of session.stream(input)) {
        switch (chunk.type) {
          case 'text':
            if (chunk.text) {
              if (firstTextChunk) {
                clearLine();
                process.stdout.write(AI_PREFIX);
                firstTextChunk = false;
              }
              process.stdout.write(chunk.text);
            }
            break;

          case 'tool_call':
            // 工具调用：换行后显示正在执行哪个工具
            if (!firstTextChunk) process.stdout.write('\n');
            firstTextChunk = true; // 重置，工具结果后可能还有文本
            clearLine();
            process.stdout.write(
              dim('  ⚙ ') + cyan(chunk.tool) + dim(' › ') +
              gray(JSON.stringify(chunk.input).slice(0, 80)) + '\n',
            );
            break;

          case 'tool_result':
            // 工具结果
            process.stdout.write(
              (chunk.isError ? red('  ✗ ') : dim('  ✓ ')) +
              dim(chunk.tool + ': ') +
              gray(chunk.result.slice(0, 120)) + '\n',
            );
            break;

          case 'done':
            // 完成，不需要额外输出
            break;
        }
      }
    } catch (err) {
      if (!firstTextChunk) process.stdout.write('\n');
      clearLine();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red('错误：') + msg);
    }

    if (firstTextChunk) {
      clearLine(); // 没有任何文本输出时清掉"…thinking"
    } else {
      process.stdout.write('\n');
    }

    console.log(); // 空行分隔
    rl.resume();
    rl.prompt();
  });

  // Ctrl+D
  rl.on('close', () => {
    showCursor();
    console.log('\n' + dim('再见！'));
    process.exit(0);
  });

  // Ctrl+C：第一次中断输入，第二次退出
  let sigintCount = 0;
  rl.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount === 1) {
      process.stdout.write('\n' + dim('  再按一次 Ctrl+C 退出\n'));
      rl.prompt();
      setTimeout(() => { sigintCount = 0; }, 2000);
    } else {
      showCursor();
      console.log(dim('\n再见！'));
      process.exit(0);
    }
  });
}

// ─── 命令处理器 ────────────────────────────────────────────────────────────────

async function handleCommand(
  cmd: string,
  args: string[],
  session: AgentInterface,
  rl: readline.Interface,
): Promise<void> {
  switch (cmd.toLowerCase()) {

    case 'help':
      console.log(HELP_TEXT);
      break;

    case 'clear':
      session.clearHistory();
      console.log(green('✓') + ' 对话历史已清空\n');
      break;

    case 'history': {
      const history = session.getHistory();
      if (history.length === 0) { console.log(dim('  （暂无历史）\n')); break; }
      console.log(bold('\n  对话历史：'));
      console.log(session.dumpHistory().split('\n').map(l => '  ' + l).join('\n'));
      console.log();
      break;
    }

    case 'model': {
      const modelId = args[0];
      if (!modelId) { console.log(yellow('  用法：/model <model-id>\n')); break; }
      try {
        session.switchModel?.(modelId);
        console.log(green('✓') + ` 已切换到 ${bold(session.currentModel)}\n`);
      } catch (err) {
        console.log(red('✗') + ' ' + (err instanceof Error ? err.message : String(err)) + '\n');
      }
      break;
    }

    case 'models': {
      const models = session.listModels();
      console.log(bold('\n  可用模型：'));
      for (const m of models) {
        const cur = m === session.currentModel;
        console.log(`  ${cur ? green('▶') : ' '} ${m}${cur ? dim(' (当前)') : ''}`);
      }
      console.log();
      break;
    }

    case 'save':
      try {
        await session.persist?.();
        console.log(green('✓') + ' 历史已保存\n');
      } catch (err) {
        console.log(red('✗') + ' 保存失败：' + (err instanceof Error ? err.message : String(err)) + '\n');
      }
      break;

    case 'session':
      console.log(`  ${dim('模型：')} ${session.currentModel}`);
      console.log(`  ${dim('历史：')} ${session.getHistory().length} 条消息\n`);
      break;

    case 'exit':
    case 'quit':
      showCursor();
      console.log(dim('\n再见！'));
      process.exit(0);
      break;

    default:
      console.log(yellow(`  未知命令 /${cmd}，输入 /help 查看帮助\n`));
  }

  rl.prompt();
}
