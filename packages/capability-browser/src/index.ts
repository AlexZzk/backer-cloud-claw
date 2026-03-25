/**
 * @bcc/capability-browser
 *
 * 浏览器访问能力：基于 Playwright 的浏览器自动化工具集。
 *
 * 使用方式：
 *   import { BrowserSession, createBrowserTools } from '@bcc/capability-browser';
 *
 *   const session = new BrowserSession({ headless: true, timeout: 30000 });
 *   const tools   = createBrowserTools(session);
 *   tools.forEach(tool => worker.registerTool(tool));
 */

export { BrowserSession, resolveBrowserConfig } from './browser-session.js';
export type { ResolvedBrowserConfig } from './browser-session.js';
export { createBrowserTools, BROWSER_TOOL_NAMES } from './tools.js';
export type { BrowserToolName } from './tools.js';
