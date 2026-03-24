/**
 * createBrowserTools：根据 BrowserSession 创建一组可供 Worker 使用的浏览器工具。
 *
 * 工具列表：
 *   browser_navigate    — 导航到指定 URL
 *   browser_screenshot  — 截取当前页面截图
 *   browser_get_content — 获取页面或元素的可见文本内容
 *   browser_click       — 点击页面元素
 *   browser_type        — 在输入框中输入文字
 *   browser_wait_for    — 等待元素出现
 *   browser_scroll      — 滚动页面
 *   browser_select      — 从下拉菜单选择选项
 *   browser_get_attr    — 获取元素属性值
 *   browser_go_back     — 浏览器历史后退
 *   browser_close       — 关闭浏览器
 *
 * 所有工具的 handler 返回 string，失败时返回描述性错误信息（不抛出）。
 */

import type { Tool } from '@bcc/foundation';
import type { BrowserSession } from './browser-session.js';

export function createBrowserTools(session: BrowserSession): Tool[] {
  return [
    // ── browser_navigate ────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_navigate',
        description:
          '打开浏览器并导航到指定 URL。首次调用时会自动启动浏览器。' +
          '成功后返回页面标题。',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '要导航到的完整 URL，例如 "http://localhost:5173"',
            },
          },
          required: ['url'],
        },
      },
      handler: async (input) => {
        const url = input['url'] as string;
        try {
          const title = await session.navigate(url);
          return `已导航到 ${url}\n页面标题：${title}`;
        } catch (err) {
          return `导航失败：${String(err)}`;
        }
      },
    },

    // ── browser_screenshot ──────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_screenshot',
        description:
          '截取当前浏览器页面的截图，保存到本地文件并返回文件路径。' +
          '可用于视觉验证页面状态。',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: '截图文件名（可选，默认自动生成，须以 .png 结尾）',
            },
          },
        },
      },
      handler: async (input) => {
        const filename = input['filename'] as string | undefined;
        try {
          const filePath = await session.screenshot(filename);
          return `截图已保存：${filePath}`;
        } catch (err) {
          return `截图失败：${String(err)}`;
        }
      },
    },

    // ── browser_get_content ─────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_get_content',
        description:
          '获取当前页面的可见文本内容。可传入 CSS 选择器只获取特定区域。' +
          '返回当前 URL、页面标题和文本内容。',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description:
                'CSS 选择器（可选）。不传则获取整页 body 文本；' +
                '传入后只返回该元素内的文本，例如 "#app"、".nav-bar"',
            },
          },
        },
      },
      handler: async (input) => {
        const selector = input['selector'] as string | undefined;
        try {
          const { url, title, text } = await session.getContent(selector);
          const truncated = text.length > 4000
            ? text.slice(0, 4000) + '\n\n[内容过长，已截断]'
            : text;
          return `URL：${url}\n标题：${title}\n\n内容：\n${truncated}`;
        } catch (err) {
          return `获取内容失败：${String(err)}`;
        }
      },
    },

    // ── browser_click ───────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_click',
        description: '点击页面上符合 CSS 选择器的第一个可见元素。',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description:
                'CSS 选择器，例如 "button[type=submit]"、".login-btn"、"#confirm"',
            },
          },
          required: ['selector'],
        },
      },
      handler: async (input) => {
        const selector = input['selector'] as string;
        try {
          await session.click(selector);
          return `已点击元素：${selector}`;
        } catch (err) {
          return `点击失败（选择器：${selector}）：${String(err)}`;
        }
      },
    },

    // ── browser_type ────────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_type',
        description:
          '在指定输入框中输入文字。默认先清空原有内容再输入。',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS 选择器，指向目标 input / textarea 元素',
            },
            text: {
              type: 'string',
              description: '要输入的文字内容',
            },
            clear: {
              type: 'boolean',
              description: '输入前是否先清空原内容（默认 true）',
            },
          },
          required: ['selector', 'text'],
        },
      },
      handler: async (input) => {
        const selector = input['selector'] as string;
        const text     = input['text']     as string;
        const clear    = input['clear'] !== false;
        try {
          await session.type(selector, text, clear);
          return `已在 "${selector}" 中输入：${text}`;
        } catch (err) {
          return `输入失败（选择器：${selector}）：${String(err)}`;
        }
      },
    },

    // ── browser_wait_for ────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_wait_for',
        description:
          '等待指定 CSS 选择器的元素出现在页面中（变为可见状态）。' +
          '适用于等待异步加载完成后再执行操作。',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: '要等待的 CSS 选择器',
            },
            timeout: {
              type: 'number',
              description: '最大等待时间（毫秒，可选，默认使用全局配置的超时时间）',
            },
          },
          required: ['selector'],
        },
      },
      handler: async (input) => {
        const selector  = input['selector']  as string;
        const timeout   = input['timeout']   as number | undefined;
        try {
          await session.waitFor(selector, timeout);
          return `元素 "${selector}" 已出现`;
        } catch (err) {
          return `等待超时（选择器：${selector}）：${String(err)}`;
        }
      },
    },

    // ── browser_scroll ──────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_scroll',
        description: '滚动当前页面。',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['up', 'down', 'top', 'bottom'],
              description:
                '滚动方向：up 向上、down 向下、top 滚到顶部、bottom 滚到底部',
            },
            amount: {
              type: 'number',
              description: '滚动距离（像素，仅 up/down 时有效，默认 300）',
            },
          },
          required: ['direction'],
        },
      },
      handler: async (input) => {
        const direction = input['direction'] as 'up' | 'down' | 'top' | 'bottom';
        const amount    = input['amount']    as number | undefined;
        try {
          await session.scroll(direction, amount);
          return `已向 ${direction} 滚动${amount !== undefined ? ` ${amount}px` : ''}`;
        } catch (err) {
          return `滚动失败：${String(err)}`;
        }
      },
    },

    // ── browser_select ──────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_select',
        description: '从 <select> 下拉菜单中选择指定的 value 值。',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS 选择器，指向目标 <select> 元素',
            },
            value: {
              type: 'string',
              description: '要选中的选项 value 属性值',
            },
          },
          required: ['selector', 'value'],
        },
      },
      handler: async (input) => {
        const selector = input['selector'] as string;
        const value    = input['value']    as string;
        try {
          await session.selectOption(selector, value);
          return `已在 "${selector}" 中选择值：${value}`;
        } catch (err) {
          return `选择失败（选择器：${selector}，值：${value}）：${String(err)}`;
        }
      },
    },

    // ── browser_get_attr ────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_get_attr',
        description: '获取指定元素的某个 HTML 属性值。',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS 选择器',
            },
            attribute: {
              type: 'string',
              description: '属性名，例如 "href"、"src"、"class"、"data-id"',
            },
          },
          required: ['selector', 'attribute'],
        },
      },
      handler: async (input) => {
        const selector  = input['selector']  as string;
        const attribute = input['attribute'] as string;
        try {
          const value = await session.getAttribute(selector, attribute);
          if (value === null) {
            return `元素 "${selector}" 没有属性 "${attribute}"`;
          }
          return `${selector}[${attribute}] = ${value}`;
        } catch (err) {
          return `获取属性失败：${String(err)}`;
        }
      },
    },

    // ── browser_go_back ─────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_go_back',
        description: '浏览器历史后退，返回上一个访问的页面。',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        try {
          await session.goBack();
          return '已后退到上一页';
        } catch (err) {
          return `后退失败：${String(err)}`;
        }
      },
    },

    // ── browser_close ───────────────────────────────────────────────────────
    {
      definition: {
        name: 'browser_close',
        description:
          '关闭浏览器并释放所有资源。' +
          '下次调用 browser_navigate 时会重新启动一个新的浏览器实例。',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        try {
          await session.close();
          return '浏览器已关闭';
        } catch (err) {
          return `关闭失败：${String(err)}`;
        }
      },
    },
  ];
}

/**
 * BROWSER_TOOL_NAMES：所有浏览器工具的名称列表。
 * 可在配置中引用，例如 workerConfig.tools = BROWSER_TOOL_NAMES。
 */
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_screenshot',
  'browser_get_content',
  'browser_click',
  'browser_type',
  'browser_wait_for',
  'browser_scroll',
  'browser_select',
  'browser_get_attr',
  'browser_go_back',
  'browser_close',
] as const;

export type BrowserToolName = typeof BROWSER_TOOL_NAMES[number];
