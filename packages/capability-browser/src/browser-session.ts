/**
 * BrowserSession：管理单个 Playwright 浏览器会话的生命周期。
 *
 * 每个 Worker 拥有独立的 BrowserSession 实例，支持：
 * - 懒启动（首次 navigate 时才真正打开浏览器）
 * - 会话复用（多次操作共享同一个 Page 实例）
 * - 主动关闭（browser_close 工具调用或 Worker 销毁时）
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrowserCapabilityConfig } from '@bcc/foundation';
import type { Browser, BrowserContext, Page } from 'playwright';

export const DEFAULT_SCREENSHOT_DIR = join(homedir(), '.bcc', 'screenshots');
export const DEFAULT_TIMEOUT = 30_000;
export const DEFAULT_VIEWPORT_WIDTH = 1280;
export const DEFAULT_VIEWPORT_HEIGHT = 720;

export interface ResolvedBrowserConfig {
  headless: boolean;
  timeout: number;
  allowedUrls: string[];
  screenshotDir: string;
  viewportWidth: number;
  viewportHeight: number;
}

export function resolveBrowserConfig(
  raw: BrowserCapabilityConfig | boolean | undefined,
): ResolvedBrowserConfig {
  const cfg = typeof raw === 'object' ? raw : {};
  return {
    headless:        cfg.headless        ?? true,
    timeout:         cfg.timeout         ?? DEFAULT_TIMEOUT,
    allowedUrls:     cfg.allowedUrls     ?? [],
    screenshotDir:   cfg.screenshotDir   ?? DEFAULT_SCREENSHOT_DIR,
    viewportWidth:   cfg.viewportWidth   ?? DEFAULT_VIEWPORT_WIDTH,
    viewportHeight:  cfg.viewportHeight  ?? DEFAULT_VIEWPORT_HEIGHT,
  };
}

export class BrowserSession {
  private _browser: Browser | undefined;
  private _context: BrowserContext | undefined;
  private _page: Page | undefined;
  readonly config: ResolvedBrowserConfig;

  constructor(rawConfig: BrowserCapabilityConfig | boolean | undefined = true) {
    this.config = resolveBrowserConfig(rawConfig);
  }

  // ─── 懒初始化 ──────────────────────────────────────────────────────────────

  /**
   * 获取当前 Page（若浏览器未启动则先启动）。
   */
  async getPage(): Promise<Page> {
    if (this._page) return this._page;
    await this._launch();
    return this._page!;
  }

  /**
   * 判断浏览器会话是否已启动。
   */
  get isOpen(): boolean {
    return !!this._browser;
  }

  // ─── URL 安全校验 ──────────────────────────────────────────────────────────

  /**
   * 校验目标 URL 是否在白名单中。
   * 未配置白名单（空数组）时允许所有 URL。
   */
  checkUrl(url: string): void {
    const allowed = this.config.allowedUrls;
    if (allowed.length === 0) return;
    const ok = allowed.some(prefix => url.startsWith(prefix));
    if (!ok) {
      throw new Error(
        `URL "${url}" 不在允许的访问范围内。\n` +
        `已配置白名单：${allowed.join(', ')}`,
      );
    }
  }

  // ─── 核心操作 ──────────────────────────────────────────────────────────────

  /**
   * 导航到指定 URL，等待页面 load 事件。
   * @returns 页面标题
   */
  async navigate(url: string): Promise<string> {
    this.checkUrl(url);
    const page = await this.getPage();
    await page.goto(url, {
      timeout: this.config.timeout,
      waitUntil: 'load',
    });
    return page.title();
  }

  /**
   * 截取当前页面截图，保存到 screenshotDir，返回文件路径。
   */
  async screenshot(filename?: string): Promise<string> {
    const page = await this.getPage();
    await mkdir(this.config.screenshotDir, { recursive: true });
    const name = filename ?? `screenshot-${Date.now()}.png`;
    const filePath = join(this.config.screenshotDir, name);
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  }

  /**
   * 获取页面可见文本内容（全页或指定选择器区域）。
   */
  async getContent(selector?: string): Promise<{ url: string; title: string; text: string }> {
    const page = await this.getPage();
    const url = page.url();
    const title = await page.title();

    let text: string;
    if (selector) {
      const el = page.locator(selector).first();
      text = await el.innerText({ timeout: this.config.timeout });
    } else {
      // 提取 body 的可见文本，去除脚本/样式节点
      text = await page.evaluate(() => {
        const body = document.body;
        if (!body) return '';
        // 克隆并移除 script / style 节点
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
        return (clone.innerText ?? clone.textContent ?? '').trim();
      });
    }

    return { url, title, text };
  }

  /**
   * 点击页面上的元素。
   */
  async click(selector: string): Promise<void> {
    const page = await this.getPage();
    await page.locator(selector).first().click({ timeout: this.config.timeout });
  }

  /**
   * 在输入框中输入文字（默认先清空）。
   */
  async type(selector: string, text: string, clear = true): Promise<void> {
    const page = await this.getPage();
    const el = page.locator(selector).first();
    if (clear) await el.clear({ timeout: this.config.timeout });
    await el.fill(text, { timeout: this.config.timeout });
  }

  /**
   * 等待某个选择器出现在页面中。
   */
  async waitFor(selector: string, timeoutMs?: number): Promise<void> {
    const page = await this.getPage();
    await page.locator(selector).first().waitFor({
      state: 'visible',
      timeout: timeoutMs ?? this.config.timeout,
    });
  }

  /**
   * 滚动页面。
   * @param direction 'up' | 'down' | 'top' | 'bottom'
   * @param amount    像素数（direction 为 up/down 时有效，默认 300）
   */
  async scroll(
    direction: 'up' | 'down' | 'top' | 'bottom',
    amount = 300,
  ): Promise<void> {
    const page = await this.getPage();
    if (direction === 'top') {
      await page.evaluate(() => window.scrollTo(0, 0));
    } else if (direction === 'bottom') {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    } else {
      const delta = direction === 'down' ? amount : -amount;
      await page.evaluate((dy: number) => window.scrollBy(0, dy), delta);
    }
  }

  /**
   * 从下拉菜单（<select>）中选择指定值。
   */
  async selectOption(selector: string, value: string): Promise<void> {
    const page = await this.getPage();
    await page.locator(selector).first().selectOption(value, {
      timeout: this.config.timeout,
    });
  }

  /**
   * 获取元素的指定属性值。
   */
  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    const page = await this.getPage();
    return page.locator(selector).first().getAttribute(attribute, {
      timeout: this.config.timeout,
    });
  }

  /**
   * 浏览器历史后退。
   */
  async goBack(): Promise<void> {
    const page = await this.getPage();
    await page.goBack({ timeout: this.config.timeout, waitUntil: 'load' });
  }

  /**
   * 关闭浏览器并释放所有资源。
   * 调用后 isOpen 变为 false，下次操作会重新启动。
   */
  async close(): Promise<void> {
    if (this._browser) {
      await this._browser.close();
      this._browser = undefined;
      this._context = undefined;
      this._page = undefined;
    }
  }

  // ─── 私有：启动浏览器 ──────────────────────────────────────────────────────

  private async _launch(): Promise<void> {
    // 动态导入 playwright，避免在不使用浏览器能力的场景中加载额外模块
    const { chromium } = await import('playwright');
    this._browser = await chromium.launch({
      headless: this.config.headless,
    });
    this._context = await this._browser.newContext({
      viewport: {
        width:  this.config.viewportWidth,
        height: this.config.viewportHeight,
      },
    });
    this._page = await this._context.newPage();
  }
}
