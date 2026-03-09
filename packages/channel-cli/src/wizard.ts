/**
 * bcc 向导交互工具 —— 零外部依赖，全平台兼容
 *
 * 支持平台：macOS / Linux / Windows（CMD、PowerShell、Windows Terminal、Git Bash、WSL）
 *
 * 设计决策：
 * - 使用编号菜单（1/2/3）而非方向键，确保在所有终端均可使用，包括非 TTY 管道
 * - API Key 在 TTY 环境下使用原始模式（raw mode）显示 * 遮蔽
 * - 非 TTY 环境（CI/管道）自动降级为明文读取
 */

import * as readline from 'node:readline';

// ─── 单例 readline 接口 ───────────────────────────────────────────────────────
// 整个向导生命周期内共用一个 rl 实例，避免 stdin 状态冲突

let _rl:     readline.Interface | null = null;
let _closed  = false;   // stdin 是否已关闭（管道/EOF）

function getRL(): readline.Interface | null {
  if (_closed) return null;
  if (!_rl) {
    _rl = readline.createInterface({
      input:    process.stdin,
      output:   process.stdout,
      terminal: process.stdin.isTTY,
    });
    _rl.on('close', () => { _closed = true; });
    _rl.on('SIGINT', () => {
      process.stdout.write('\n');
      process.exit(0);
    });
  }
  return _rl;
}

/** 在向导结束后关闭 readline 接口，释放 stdin */
export function closeWizard(): void {
  _rl?.close();
  _rl     = null;
  _closed = false;
}

// ─── 基础问答 ─────────────────────────────────────────────────────────────────

/**
 * 向用户提问，等待一行回答。
 * 在非 TTY / 管道模式下，如果 stdin 已关闭则立即返回空字符串（使用默认值）。
 */
function ask(prompt: string): Promise<string> {
  return new Promise(resolve => {
    const rl = getRL();

    // stdin 已关闭（管道 EOF）：使用空字符串，调用方会取默认值
    if (!rl) { resolve(''); return; }

    let done = false;
    const finish = (answer: string): void => {
      if (!done) { done = true; resolve(answer.trim()); }
    };

    // 如果等待期间 stdin 关闭，同样使用空字符串
    rl.once('close', () => finish(''));
    rl.question(prompt, finish);
  });
}

// ─── 编号选择菜单 ─────────────────────────────────────────────────────────────

export interface Choice<T> {
  label:       string;
  value:       T;
  description?: string;
  /** 标记为"跳过"选项（会显示为灰色提示） */
  skip?:       boolean;
}

/**
 * 显示编号菜单，用户输入数字选择。
 *
 * @param question    提示标题（一行）
 * @param choices     选项列表
 * @param defaultIdx  默认选项索引（0-based）
 */
export async function selectOne<T>(
  question: string,
  choices: Array<Choice<T>>,
  defaultIdx = 0,
): Promise<T> {
  console.log(`  ${question}`);
  for (let i = 0; i < choices.length; i++) {
    const c   = choices[i]!;
    const cur = i === defaultIdx;
    const marker = cur ? '▶' : ' ';
    const desc = c.description ? `\n      ${c.description}` : '';
    const skipNote = c.skip ? ' （可跳过）' : '';
    console.log(`  ${marker} ${i + 1}) ${c.label}${skipNote}${desc}`);
  }
  const answer = await ask(`\n  请输入编号 [${defaultIdx + 1}]: `);
  const n = parseInt(answer || String(defaultIdx + 1), 10);
  if (isNaN(n) || n < 1 || n > choices.length) return choices[defaultIdx]!.value;
  return choices[n - 1]!.value;
}

// ─── 多选菜单 ─────────────────────────────────────────────────────────────────

/**
 * 显示带编号的多选菜单，用户输入逗号分隔的编号（如 "1,3,4"）。
 *
 * @param question      提示标题
 * @param choices       选项列表
 * @param currentValues 当前已选中的值（用于显示 ✓ 标记）
 * @returns             用户选中的 value 数组
 */
export async function selectMultiple<T>(
  question: string,
  choices: Array<Choice<T>>,
  currentValues: T[] = [],
): Promise<T[]> {
  console.log(`  ${question}`);
  console.log('  （输入编号，多选用逗号分隔，如 "1,3"；直接回车跳过）');
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i]!;
    const checked = currentValues.includes(c.value) ? '✓' : ' ';
    console.log(`  [${checked}] ${i + 1}) ${c.label}${c.description ? `  — ${c.description}` : ''}`);
  }
  const answer = await ask('\n  请输入编号（如 1,3）或直接回车: ');
  if (!answer.trim()) return currentValues;

  const selected: T[] = [];
  for (const part of answer.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (!isNaN(n) && n >= 1 && n <= choices.length) {
      const val = choices[n - 1]!.value;
      if (!selected.includes(val)) selected.push(val);
    }
  }
  return selected;
}

// ─── 文本输入 ─────────────────────────────────────────────────────────────────

/**
 * 带默认值的文本输入。
 * 直接回车使用默认值。
 */
export async function askText(prompt: string, defaultValue = ''): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await ask(`  ${prompt}${suffix}: `);
  return answer || defaultValue;
}

// ─── 是/否确认 ────────────────────────────────────────────────────────────────

export async function askConfirm(prompt: string, defaultValue = true): Promise<boolean> {
  const hint   = defaultValue ? 'Y/n' : 'y/N';
  const answer = await ask(`  ${prompt} (${hint}): `);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

// ─── 密钥输入（遮蔽显示）────────────────────────────────────────────────────

/**
 * 读取密钥/密码输入。
 *
 * - TTY 环境：启用原始模式，按键显示 * 而非明文，支持退格
 * - 非 TTY（CI / 管道）：降级为普通文本读取（不显示 *）
 *
 * 全平台兼容：
 *   macOS / Linux  ─ process.stdin.setRawMode()
 *   Windows        ─ 同上（ConPTY / Windows Terminal / Git Bash 均支持）
 *   老版 Windows CMD ─ isTTY 可能为 false，自动降级
 */
export async function askSecret(prompt: string): Promise<string> {
  const canRaw =
    process.stdin.isTTY &&
    typeof (process.stdin as NodeJS.ReadStream & { setRawMode?: unknown }).setRawMode === 'function';

  if (canRaw) {
    return readRawSecret(`  ${prompt}: `);
  }

  // 非 TTY / 不支持 raw mode：普通读取
  return ask(`  ${prompt} (输入不会被遮蔽): `);
}

/** 原始模式密钥读取：逐字符读取，显示 *；支持粘贴 */
function readRawSecret(prefix: string): Promise<string> {
  return new Promise(resolve => {
    // 关闭当前的 readline（以免与 raw mode 冲突）
    _rl?.close();
    _rl     = null;
    _closed = false;  // 重置关闭标志，让后续步骤可以继续创建 readline

    process.stdout.write(prefix);

    const chars: string[] = [];
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (key: string): void => {
      // 处理多字符输入（粘贴场景）：逐个字符处理
      if (key.length > 1) {
        // 检查是否包含回车（粘贴内容末尾可能带换行）
        const enterIdx = key.search(/[\r\n]/);
        const chunk = enterIdx >= 0 ? key.slice(0, enterIdx) : key;

        for (const ch of chunk) {
          const c = ch.charCodeAt(0);
          if (c >= 0x20 && c <= 0x7e) {
            chars.push(ch);
            process.stdout.write('*');
          }
        }

        if (enterIdx >= 0) {
          process.stdout.write('\n');
          finish();
          resolve(chars.join(''));
        }
        return;
      }

      const code = key.charCodeAt(0);

      // Ctrl+C → 退出
      if (code === 0x03) {
        process.stdout.write('\n');
        finish();
        process.exit(0);
      }

      // Enter（\r 或 \n）→ 完成
      if (code === 0x0d || code === 0x0a) {
        process.stdout.write('\n');
        finish();
        resolve(chars.join(''));
        return;
      }

      // Backspace（0x7f DEL 或 0x08）→ 删一个字符
      if (code === 0x7f || code === 0x08) {
        if (chars.length > 0) {
          chars.pop();
          process.stdout.write('\b \b');
        }
        return;
      }

      // 可打印 ASCII 字符
      if (code >= 0x20 && code <= 0x7e) {
        chars.push(key);
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// ─── 格式化工具（向导专用）───────────────────────────────────────────────────

/** 打印步骤标题（带横线分隔符） */
export function printStep(n: number, total: number, title: string): void {
  console.log();
  console.log(`  ── 步骤 ${n}/${total}：${title} ${'─'.repeat(Math.max(0, 44 - title.length))}`);
  console.log();
}

/** 打印向导页眉 */
export function printHeader(version: string): void {
  console.log();
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log(`  ║    bcc · backer-cloud-claw  v${version.padEnd(16)}║`);
  console.log('  ║    初始化向导                                ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log();
  console.log('  欢迎！这个向导将引导你完成初次配置。');
  console.log('  配置保存至 ~/.bcc/config.json，可随时重新运行修改。');
  console.log('  按 Ctrl+C 随时退出。');
}

/** 打印配置摘要表格 */
export function printSummary(rows: Array<[string, string]>): void {
  const labelWidth = Math.max(...rows.map(([l]) => l.length)) + 2;
  console.log();
  console.log('  ┌' + '─'.repeat(labelWidth + 34) + '┐');
  for (const [label, value] of rows) {
    const lPad = label.padEnd(labelWidth);
    const vPad = value.slice(0, 32).padEnd(32);
    console.log(`  │  ${lPad}${vPad}  │`);
  }
  console.log('  └' + '─'.repeat(labelWidth + 34) + '┘');
  console.log();
}

/** 打印成功消息 */
export function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

/** 打印警告消息 */
export function warn(msg: string): void {
  console.log(`  ⚠ ${msg}`);
}

/** 打印错误消息 */
export function fail(msg: string): void {
  console.log(`  ✗ ${msg}`);
}
