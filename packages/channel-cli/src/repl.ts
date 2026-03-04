import * as readline from 'node:readline';
import { ChatSession } from '@bcc/conversation';
import { bold, cyan, green, yellow, red, gray, dim, clearLine, showCursor } from './ansi.js';

const PROMPT = cyan('You') + gray(' › ') + ' ';
const AI_PREFIX = green('AI') + gray('  › ') + ' ';
const THINKING = dim('  …thinking');

/** 内置斜杠命令列表 */
const HELP_TEXT = `
${bold('可用命令：')}
  ${yellow('/help')}              显示此帮助
  ${yellow('/clear')}             清空对话历史（不影响已保存的文件）
  ${yellow('/history')}           查看当前对话历史
  ${yellow('/model <id>')}        切换模型（需配置 ModelRouter）
  ${yellow('/models')}            列出所有可用模型
  ${yellow('/save')}              手动保存当前历史到持久化存储
  ${yellow('/session')}           显示当前 Session ID
  ${yellow('/exit')} 或 ${yellow('Ctrl+C')}  退出
`;

export interface ReplOptions {
  session: ChatSession;
  banner?: string;
  hint?: string;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const { session } = options;

  // 打印欢迎横幅
  if (options.banner) {
    console.log(options.banner);
  }
  if (options.hint) {
    console.log(dim(options.hint));
  }
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
    if (!input) {
      rl.prompt();
      return;
    }

    // ─── 斜杠命令 ──────────────────────────────────────────────────────────
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.slice(1).split(/\s+/);
      await handleCommand(cmd ?? '', args, session, rl);
      return;
    }

    // ─── 普通对话 ──────────────────────────────────────────────────────────
    rl.pause();
    process.stdout.write(THINKING);

    let firstChunk = true;
    try {
      for await (const chunk of session.stream(input)) {
        if (chunk.type === 'text' && chunk.text) {
          if (firstChunk) {
            clearLine();
            process.stdout.write(AI_PREFIX);
            firstChunk = false;
          }
          process.stdout.write(chunk.text);
        }
      }
    } catch (err) {
      clearLine();
      const msg = err instanceof Error ? err.message : String(err);
      console.error('\n' + red('错误：') + msg);
    }

    if (firstChunk) {
      // 没有任何输出（空回复或出错）
      clearLine();
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

  // Ctrl+C：第一次中断当前输入，第二次退出
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
  session: ChatSession,
  rl: readline.Interface,
): Promise<void> {
  switch (cmd.toLowerCase()) {

    case 'help':
      console.log(HELP_TEXT);
      break;

    case 'clear':
      session.clearHistory();
      console.log(green('✓') + ' 对话历史已清空（持久化文件保留）\n');
      break;

    case 'history': {
      const history = session.getHistory();
      if (history.length === 0) {
        console.log(dim('  （暂无历史）\n'));
        break;
      }
      console.log(bold('\n  对话历史：'));
      console.log(session.dumpHistory()
        .split('\n')
        .map(l => '  ' + l)
        .join('\n'));
      console.log();
      break;
    }

    case 'model': {
      const modelId = args[0];
      if (!modelId) {
        console.log(yellow('  用法：/model <model-id>\n'));
        break;
      }
      try {
        session.switchModel(modelId);
        console.log(green('✓') + ` 已切换到 ${bold(session.currentModel)}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(red('✗') + ' ' + msg + '\n');
      }
      break;
    }

    case 'models': {
      const models = session.listModels();
      console.log(bold('\n  可用模型：'));
      for (const m of models) {
        const current = m === session.currentModel;
        console.log(`  ${current ? green('▶') : ' '} ${m}${current ? dim(' (当前)') : ''}`);
      }
      console.log();
      break;
    }

    case 'save':
      try {
        await session.persist();
        console.log(green('✓') + ' 历史已保存\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(red('✗') + ' 保存失败：' + msg + '\n');
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
