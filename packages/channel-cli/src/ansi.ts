/**
 * 零依赖 ANSI 终端样式工具。
 * 自动检测 NO_COLOR 环境变量和非 TTY 环境，降级为纯文本输出。
 */

const enabled = process.stdout.isTTY && !process.env['NO_COLOR'];

const c = (code: string) => (text: string) =>
  enabled ? `\x1b[${code}m${text}\x1b[0m` : text;

export const bold   = c('1');
export const dim    = c('2');
export const green  = c('32');
export const cyan   = c('36');
export const yellow = c('33');
export const red    = c('31');
export const gray   = c('90');
export const blue   = c('34');

/** 移动光标到行首并清除当前行 */
export const clearLine = () => {
  if (enabled) process.stdout.write('\r\x1b[K');
};

/** 隐藏光标 */
export const hideCursor = () => {
  if (enabled) process.stdout.write('\x1b[?25l');
};

/** 显示光标 */
export const showCursor = () => {
  if (enabled) process.stdout.write('\x1b[?25h');
};
