import * as readline from 'node:readline';
import type { AgentInterface } from '@bcc/foundation';
import { AllModelsFailedError } from '@bcc/foundation';
import type { AgentRegistry } from '@bcc/agents';
import { bold, cyan, green, yellow, red, gray, dim, clearLine, showCursor } from './ansi.js';
import { SkillRegistry, expandSkill, skillNeedsInput } from '@bcc/skills';

const PROMPT    = cyan('You') + gray(' › ') + ' ';
const AI_PREFIX = green('AI') + gray('  › ') + ' ';
const THINKING  = dim('  …thinking');

/** 内置斜杠命令列表 */
const HELP_TEXT = `
${bold('可用命令：')}
  ${yellow('/help')}                    显示此帮助
  ${yellow('/clear')}                   清空对话历史（不影响已保存的文件）
  ${yellow('/history')}                 查看当前对话历史
  ${yellow('/model <id>')}              切换模型（需配置 ModelRouter）
  ${yellow('/models')}                  列出所有可用模型
  ${yellow('/ping')}                    测试所有模型连通性
  ${yellow('/save')}                    手动保存当前历史到持久化存储
  ${yellow('/session')}                 显示当前 Session 信息
  ${yellow('/debug')}                   显示上一次错误的完整详情

${bold('多 Agent：')}
  ${yellow('/agents')}                  列出所有已配置的 Agent
  ${yellow('/agent <id>')}              切换主对话 Agent
  ${yellow('/agent <id> <消息>')}       向指定 Agent 发送一次消息（不切换）
  ${dim('  使用 pnpm bcc-agent 创建、编辑、删除 Agent 配置')}

${bold('技能（Skill）：')}
  ${yellow('/skills')}                  列出所有可用技能
  ${yellow('/skill <名称> [内容]')}     执行技能（如 /skill summarize 这段文字…）
  ${dim('  使用 pnpm bcc-skill 创建、编辑、删除自定义技能')}

  ${yellow('/exit')} 或 ${yellow('Ctrl+C')}          退出
`;

// ─── 错误展示 ─────────────────────────────────────────────────────────────────

/** 保存最近一次错误，供 /debug 命令查看 */
let lastError: unknown = null;

/** 将 HTTP 状态码转为中文提示 */
function httpStatusHint(status: number): string {
  switch (status) {
    case 401: return '认证失败（API Key 错误或已过期）';
    case 403: return '无权限（Key 可能没有该模型的访问权限）';
    case 404: return '模型不存在（请检查模型名称是否正确）';
    case 429: return '请求过于频繁（已达到速率限制）';
    case 500: return '服务端错误（提供商服务异常，稍后重试）';
    case 503: return '服务暂不可用（提供商服务维护中）';
    default:  return '';
  }
}

const isDebug = (): boolean => process.env['BCC_DEBUG'] === '1';

/**
 * 遍历 Error.cause 链，收集每一层的 message。
 * 用于把 "Connection error." → "fetch failed" → "connect ECONNREFUSED ..." 完整展示出来。
 */
function collectCauseChain(err: Error): string[] {
  const msgs: string[] = [];
  let cur: unknown = err.cause;
  const seen = new Set<unknown>([err]);
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    if (cur.message && cur.message !== err.message) {
      msgs.push(cur.message);
    }
    cur = cur.cause;
  }
  return msgs;
}

function printError(err: unknown): void {
  lastError = err;

  if (err instanceof AllModelsFailedError && err.errors.length > 0) {
    console.error(red('✗ 模型调用失败：'));
    for (let i = 0; i < err.errors.length; i++) {
      const sub = err.errors[i]!;
      const status = (sub as { status?: number }).status;
      const statusStr = status ? red(` [HTTP ${status}]`) : '';
      const hint = status ? gray(`  → ${httpStatusHint(status)}`) : '';
      console.error(`  ${gray(String(i + 1) + '.')} ${sub.message}${statusStr}`);
      if (hint) console.error(hint);

      // 始终展示 cause 链（连接错误的根因在这里）
      const causes = collectCauseChain(sub);
      for (const c of causes) {
        console.error(gray(`     ↳ ${c}`));
      }

      if (isDebug()) {
        const body = (sub as { error?: unknown }).error;
        if (body) console.error(gray(`  响应：${JSON.stringify(body)}`));
        if (sub.stack) {
          const frames = sub.stack.split('\n').slice(1, 4);
          for (const f of frames) console.error(dim('  ' + f.trim()));
        }
      }
    }
    if (!isDebug()) console.error(dim('  输入 /debug 查看完整错误详情'));
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red('✗ 错误：') + msg);
    if (err instanceof Error) {
      const causes = collectCauseChain(err);
      for (const c of causes) console.error(gray(`  ↳ ${c}`));
    }
    if (isDebug() && err instanceof Error && err.stack) {
      const frames = err.stack.split('\n').slice(1, 5);
      for (const f of frames) console.error(dim('  ' + f.trim()));
    } else {
      console.error(dim('  输入 /debug 查看完整错误详情'));
    }
  }
}

export interface ReplOptions {
  session: AgentInterface;
  banner?: string | undefined;
  hint?: string | undefined;
  /** 多 Agent 注册表，用于 /agents、/agent 命令 */
  agentRegistry?: AgentRegistry | undefined;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  // 用可变引用支持 /agent <id> 切换焦点
  let activeSession: AgentInterface = options.session;
  const { agentRegistry } = options;

  // 懒加载技能注册表（含内置 + 用户 + 项目技能）
  let skills: SkillRegistry | undefined;
  const getSkills = async (): Promise<SkillRegistry> => {
    if (!skills) skills = await SkillRegistry.load();
    return skills;
  };

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
      const switched = await handleCommand(
        cmd ?? '', args, activeSession, rl, getSkills, agentRegistry,
      );
      if (switched) activeSession = switched;
      return;
    }

    // ─── 普通对话 ──────────────────────────────────────────────────────────
    rl.pause();
    process.stdout.write(THINKING);

    let firstTextChunk = true;
    try {
      for await (const chunk of activeSession.stream(input)) {
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
      printError(err);
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

/**
 * 返回值：如果切换了 Agent，返回新的 AgentInterface；否则返回 null。
 */
async function handleCommand(
  cmd: string,
  args: string[],
  session: AgentInterface,
  rl: readline.Interface,
  getSkills: () => Promise<SkillRegistry>,
  agentRegistry?: AgentRegistry,
): Promise<AgentInterface | null> {
  let switchedSession: AgentInterface | null = null;
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

    case 'ping': {
      const models = session.listModels();
      if (models.length === 0) { console.log(dim('  （无可用模型）\n')); break; }
      console.log(bold('\n  测试模型连通性：'));
      for (const modelId of models) {
        process.stdout.write(`  ${dim('…')} ${modelId.padEnd(32)}`);
        const t0 = Date.now();
        try {
          // 临时切换到目标模型测试（测完恢复）
          const prev = session.currentModel;
          session.switchModel?.(modelId);
          // 用极短请求探测（复用 stream，遇到第一个 chunk 就算通）
          const gen = session.stream('\u200b'); // 零宽空格，尽量短
          let ok = false;
          for await (const chunk of gen) {
            if (chunk.type === 'text' || chunk.type === 'done') { ok = true; break; }
          }
          session.switchModel?.(prev);
          // 回滚刚才的探测消息（不污染历史）
          session.clearHistory();
          const ms = Date.now() - t0;
          process.stdout.write(`\r  ${green('✓')} ${modelId.padEnd(32)} ${dim(ms + 'ms')}\n`);
        } catch (err) {
          const causes = err instanceof Error ? collectCauseChain(err) : [];
          const rootCause = causes.at(-1) ?? (err instanceof Error ? err.message : String(err));
          process.stdout.write(`\r  ${red('✗')} ${modelId.padEnd(32)} ${red(rootCause)}\n`);
        }
      }
      console.log(yellow('\n  提示：/ping 会清空当前对话历史，仅用于测试。\n'));
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

    case 'debug': {
      if (!lastError) {
        console.log(dim('  （暂无错误记录）\n'));
        break;
      }
      console.log(bold('\n  最近一次错误详情：'));
      if (lastError instanceof AllModelsFailedError && lastError.errors.length > 0) {
        for (let i = 0; i < lastError.errors.length; i++) {
          const sub = lastError.errors[i]!;
          console.log(`\n  ${bold(`[${i + 1}] ${sub.name ?? 'Error'}`)}`);
          console.log(`  消息：${sub.message}`);
          const status = (sub as { status?: number }).status;
          if (status) console.log(`  HTTP：${status} ${httpStatusHint(status)}`);
          // 打印 OpenAI/Anthropic SDK 附带的响应体（如果有）
          const body = (sub as { error?: unknown }).error;
          if (body) console.log(`  响应：${JSON.stringify(body, null, 2).split('\n').join('\n  ')}`);
          if (sub.stack) {
            console.log(dim('  Stack:'));
            const lines = sub.stack.split('\n').slice(1, 6); // 只显示前5帧
            for (const l of lines) console.log(dim('  ' + l.trim()));
          }
        }
      } else if (lastError instanceof Error) {
        console.log(`  ${lastError.name}: ${lastError.message}`);
        if (lastError.stack) {
          console.log(dim('  Stack:'));
          const lines = lastError.stack.split('\n').slice(1, 8);
          for (const l of lines) console.log(dim('  ' + l.trim()));
        }
      } else {
        console.log(`  ${String(lastError)}`);
      }
      console.log();
      break;
    }

    // ── 技能命令 ─────────────────────────────────────────────────────────────

    case 'skills': {
      const reg = await getSkills();
      const list = reg.list();
      if (list.length === 0) {
        console.log(dim('  （暂无技能）\n'));
        break;
      }
      const stats = reg.stats();
      console.log(bold(`\n  技能列表（内置 ${stats.builtin} / 用户 ${stats.user} / 项目 ${stats.project}）：`));
      console.log();

      let lastSource = '';
      for (const s of list) {
        const src = s.source ?? 'builtin';
        if (src !== lastSource) {
          const label = src === 'builtin' ? '内置' : src === 'user' ? '用户自定义' : '项目';
          console.log(`  ${dim('── ' + label + ' ──')}`);
          lastSource = src;
        }
        const hasSystem = s.system ? dim(' [覆盖 system]') : '';
        console.log(`    ${yellow(s.name.padEnd(18))} ${s.description}${hasSystem}`);
      }
      console.log();
      console.log(dim('  用法：/skill <名称> [内容]'));
      console.log(dim('  管理：pnpm bcc-skill'));
      console.log();
      break;
    }

    case 'skill': {
      const skillName = args[0];
      if (!skillName) {
        console.log(yellow('  用法：/skill <名称> [内容]\n'));
        console.log(dim('  输入 /skills 查看所有可用技能\n'));
        break;
      }

      const reg = await getSkills();
      const skill = reg.find(skillName);
      if (!skill) {
        console.log(red(`  ✗ 找不到技能 "${skillName}"`) + dim('，输入 /skills 查看可用技能\n'));
        break;
      }

      // 行内输入 or 交互式询问
      let input = args.slice(1).join(' ');
      if (skillNeedsInput(skill) && !input) {
        rl.pause();
        input = await new Promise<string>(resolve => {
          rl.question(cyan('  输入内容') + gray(' › ') + ' ', resolve);
        });
        rl.resume();
      }

      const expandedPrompt = expandSkill(skill, input);

      // 如有 system 覆盖，提示用户（当前版本作为 context 注入到 prompt 前）
      const fullPrompt = skill.system
        ? `[角色设定：${skill.system}]\n\n${expandedPrompt}`
        : expandedPrompt;

      console.log(dim(`  ⚡ 技能：${skill.name}`));
      if (skill.source !== 'builtin') {
        console.log(dim(`  提示词（前80字）：${expandedPrompt.slice(0, 80)}…`));
      }
      console.log();

      // 执行技能（与普通对话流程相同）
      rl.pause();
      process.stdout.write(THINKING);
      let firstChunk = true;
      try {
        for await (const chunk of session.stream(fullPrompt)) {
          if (chunk.type === 'text' && chunk.text) {
            if (firstChunk) { clearLine(); process.stdout.write(AI_PREFIX); firstChunk = false; }
            process.stdout.write(chunk.text);
          }
        }
      } catch (err) {
        clearLine();
        printError(err);
      }
      if (firstChunk) clearLine(); else process.stdout.write('\n');
      console.log();
      rl.resume();
      break;
    }

    // ── 多 Agent 命令 ────────────────────────────────────────────────────────

    case 'agents': {
      if (!agentRegistry || agentRegistry.size === 0) {
        console.log(dim('  （未配置 Agent，在 bcc.json 中添加 agents 字段）\n'));
        break;
      }
      console.log(bold(`\n  Agent 列表（共 ${agentRegistry.size} 个）：\n`));
      for (const agent of agentRegistry.list()) {
        const isPrimary = agent.def.primary === true;
        const isCurrent = agent === session;
        const marker = isCurrent ? green('▶') : isPrimary ? yellow('★') : ' ';
        const tag = isPrimary ? dim(' [主]') : '';
        const model = agent.def.model ? dim(` (${agent.def.model})`) : '';
        console.log(`  ${marker} ${bold(agent.def.id.padEnd(16))} ${agent.def.name}${tag}${model}`);
        console.log(`      ${dim(agent.def.description)}`);
        if (agent.def.skills && agent.def.skills.length > 0) {
          console.log(`      ${dim('技能：' + agent.def.skills.join(', '))}`);
        }
      }
      console.log();
      console.log(dim('  ▶=当前  ★=主 Agent'));
      console.log(dim('  切换：/agent <id>  |  一次性委托：/agent <id> <消息>'));
      console.log();
      break;
    }

    case 'agent': {
      if (!agentRegistry || agentRegistry.size === 0) {
        console.log(yellow('  当前未启用多 Agent 模式（bcc.json 中需配置 agents 字段）\n'));
        break;
      }
      const agentId = args[0];
      if (!agentId) {
        console.log(yellow('  用法：/agent <id> [消息]\n'));
        break;
      }
      const targetAgent = agentRegistry.find(agentId);
      if (!targetAgent) {
        console.log(red(`  ✗ 找不到 Agent "${agentId}"`) + dim('，输入 /agents 查看可用列表\n'));
        break;
      }

      const delegateMsg = args.slice(1).join(' ');

      if (delegateMsg) {
        // 一次性委托：发消息给指定 Agent，不切换焦点
        console.log(dim(`  → 委托给 ${targetAgent.def.name}（${agentId}）`));
        rl.pause();
        process.stdout.write(THINKING);
        let firstChunk = true;
        try {
          for await (const chunk of targetAgent.stream(delegateMsg)) {
            if (chunk.type === 'text' && chunk.text) {
              if (firstChunk) {
                clearLine();
                process.stdout.write(green(targetAgent.def.name) + gray(' › ') + ' ');
                firstChunk = false;
              }
              process.stdout.write(chunk.text);
            }
          }
        } catch (err) {
          clearLine();
          printError(err);
        }
        if (firstChunk) clearLine(); else process.stdout.write('\n');
        console.log();
        rl.resume();
      } else {
        // 切换焦点
        switchedSession = targetAgent;
        console.log(green('✓') + ` 已切换到 Agent ${bold(targetAgent.def.name)}（${agentId}）\n`);
      }
      break;
    }

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
  return switchedSession;
}
