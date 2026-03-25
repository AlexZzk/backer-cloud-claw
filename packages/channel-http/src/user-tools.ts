/**
 * @bcc/channel-http — Tools 工具目录 & 用户自定义工具执行
 *
 * 提供三类工具的元数据和运行时支持：
 *   1. builtin  — 内置系统工具（工作空间文件操作等）
 *   2. browser  — 浏览器能力工具（需 capabilities.browser）
 *   3. user     — 用户自定义 Webhook 工具（持久化于 config.json）
 */

import type { ApiToolEntry, UserToolConfig } from './types.js';

// ─── 内置工具目录 ─────────────────────────────────────────────────────────────

export const BUILTIN_TOOL_CATALOG: ApiToolEntry[] = [
  {
    id: 'workspace-list',
    name: '列出工作空间文件',
    description: '列出当前 Worker 工作空间及共享目录中的所有文件和子目录，包含文件大小和修改时间。',
    category: 'builtin',
    inputParams: {
      path: {
        type: 'string',
        description: '子目录路径（相对工作空间根目录，可选，默认列出根目录）',
      },
    },
  },
  {
    id: 'workspace-read',
    name: '读取工作空间文件',
    description: '读取工作空间或共享目录中的文本文件内容。读取共享目录文件时路径须以 "shared/" 前缀开头。',
    category: 'builtin',
    inputParams: {
      path: {
        type: 'string',
        description: '文件路径（相对工作空间根目录，或 shared/xxx 读取共享文件）',
      },
    },
    requiredParams: ['path'],
  },
  {
    id: 'workspace-write',
    name: '写入工作空间文件',
    description: '将文本内容写入工作空间中的文件，如果文件不存在则自动创建，如果存在则覆盖。',
    category: 'builtin',
    inputParams: {
      path: {
        type: 'string',
        description: '目标文件路径（相对工作空间根目录）',
      },
      content: {
        type: 'string',
        description: '要写入的文本内容',
      },
    },
    requiredParams: ['path', 'content'],
  },
  {
    id: 'workspace-delete',
    name: '删除工作空间文件',
    description: '删除工作空间中的指定文件。',
    category: 'builtin',
    inputParams: {
      path: {
        type: 'string',
        description: '要删除的文件路径（相对工作空间根目录）',
      },
    },
    requiredParams: ['path'],
  },
  {
    id: 'workspace-share',
    name: '分享文件到共享目录',
    description: '将工作空间文件复制到共享目录，让其他所有 Worker 均可只读访问。',
    category: 'builtin',
    inputParams: {
      path: {
        type: 'string',
        description: '工作空间中的源文件路径（相对工作空间根目录）',
      },
      destName: {
        type: 'string',
        description: '共享目录中的目标文件名（可选，默认使用源文件名）',
      },
    },
    requiredParams: ['path'],
  },
  {
    id: 'datetime',
    name: '获取当前时间',
    description: '返回当前的日期和时间（ISO 格式），支持指定时区。',
    category: 'builtin',
    inputParams: {
      timezone: {
        type: 'string',
        description: 'IANA 时区名称，例如 "Asia/Shanghai"、"UTC"（可选，默认系统时区）',
      },
    },
  },
  {
    id: 'web-fetch',
    name: '请求网页内容',
    description: '发送 HTTP GET 请求获取指定 URL 的文本内容（HTML / JSON / 纯文本）。',
    category: 'builtin',
    inputParams: {
      url: {
        type: 'string',
        description: '要请求的 URL，例如 "https://api.example.com/data"',
      },
      headers: {
        type: 'object',
        description: '自定义请求头（可选），例如 {"Authorization": "Bearer token"}',
      },
    },
    requiredParams: ['url'],
  },
  {
    id: 'shell-exec',
    name: '执行 Shell 命令',
    description: '在 Worker 工作空间目录下执行 Shell 命令，返回标准输出和错误输出。',
    category: 'builtin',
    inputParams: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令，例如 "ls -la" 或 "npm run build"',
      },
      timeout: {
        type: 'number',
        description: '命令超时时间（毫秒，可选，默认 30000）',
      },
    },
    requiredParams: ['command'],
  },
];

// ─── 浏览器工具目录 ───────────────────────────────────────────────────────────

export const BROWSER_TOOL_CATALOG: ApiToolEntry[] = [
  {
    id: 'browser_navigate',
    name: '导航到 URL',
    description: '打开浏览器并导航到指定 URL。首次调用时会自动启动浏览器。成功后返回页面标题。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      url: {
        type: 'string',
        description: '要导航到的完整 URL，例如 "http://localhost:5173"',
      },
    },
    requiredParams: ['url'],
  },
  {
    id: 'browser_screenshot',
    name: '截取页面截图',
    description: '截取当前浏览器页面的截图，保存到本地文件并返回文件路径。可用于视觉验证页面状态。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      filename: {
        type: 'string',
        description: '截图文件名（可选，默认自动生成，须以 .png 结尾）',
      },
    },
  },
  {
    id: 'browser_get_content',
    name: '获取页面内容',
    description: '获取当前页面的可见文本内容。可传入 CSS 选择器只获取特定区域。返回当前 URL、页面标题和文本内容。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      selector: {
        type: 'string',
        description: 'CSS 选择器（可选）。不传则获取整页 body 文本',
      },
    },
  },
  {
    id: 'browser_click',
    name: '点击元素',
    description: '点击页面上符合 CSS 选择器的第一个可见元素。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      selector: {
        type: 'string',
        description: 'CSS 选择器，例如 "button[type=submit]"、".login-btn"',
      },
    },
    requiredParams: ['selector'],
  },
  {
    id: 'browser_type',
    name: '在输入框输入文字',
    description: '在指定输入框中输入文字。默认先清空原有内容再输入。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
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
    requiredParams: ['selector', 'text'],
  },
  {
    id: 'browser_wait_for',
    name: '等待元素出现',
    description: '等待指定 CSS 选择器的元素出现在页面中。适用于等待异步加载完成后再执行操作。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      selector: {
        type: 'string',
        description: '要等待的 CSS 选择器',
      },
      timeout: {
        type: 'number',
        description: '最大等待时间（毫秒，可选）',
      },
    },
    requiredParams: ['selector'],
  },
  {
    id: 'browser_scroll',
    name: '滚动页面',
    description: '滚动当前浏览器页面。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      direction: {
        type: 'string',
        enum: ['up', 'down', 'top', 'bottom'],
        description: '滚动方向：up 向上、down 向下、top 滚到顶部、bottom 滚到底部',
      },
      amount: {
        type: 'number',
        description: '滚动距离（像素，仅 up/down 时有效，默认 300）',
      },
    },
    requiredParams: ['direction'],
  },
  {
    id: 'browser_select',
    name: '下拉菜单选择',
    description: '从 <select> 下拉菜单中选择指定的 value 值。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      selector: {
        type: 'string',
        description: 'CSS 选择器，指向目标 <select> 元素',
      },
      value: {
        type: 'string',
        description: '要选中的选项 value 属性值',
      },
    },
    requiredParams: ['selector', 'value'],
  },
  {
    id: 'browser_get_attr',
    name: '获取元素属性',
    description: '获取指定元素的某个 HTML 属性值。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {
      selector: {
        type: 'string',
        description: 'CSS 选择器',
      },
      attribute: {
        type: 'string',
        description: '属性名，例如 "href"、"src"、"class"、"data-id"',
      },
    },
    requiredParams: ['selector', 'attribute'],
  },
  {
    id: 'browser_go_back',
    name: '浏览器后退',
    description: '浏览器历史后退，返回上一个访问的页面。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {},
  },
  {
    id: 'browser_close',
    name: '关闭浏览器',
    description: '关闭浏览器并释放所有资源。下次调用 browser_navigate 时会重新启动一个新的浏览器实例。',
    category: 'browser',
    requiresCapability: 'browser',
    inputParams: {},
  },
];

// ─── 用户工具 ID 验证 ─────────────────────────────────────────────────────────

const USER_TOOL_ID_RE = /^[a-z][a-z0-9_]{1,49}$/;

export function validateUserToolId(id: string): string | null {
  if (!id) return 'id 不能为空';
  if (!USER_TOOL_ID_RE.test(id)) {
    return 'id 只能包含小写字母、数字和下划线，且必须以字母开头，长度 2-50';
  }
  const reserved = new Set([
    ...BUILTIN_TOOL_CATALOG.map(t => t.id),
    ...BROWSER_TOOL_CATALOG.map(t => t.id),
  ]);
  if (reserved.has(id)) return `"${id}" 与内置工具 ID 冲突`;
  return null;
}

// ─── 用户工具执行 ─────────────────────────────────────────────────────────────

/**
 * 执行用户自定义 Webhook 工具。
 * 将 input 参数以 JSON body 发送给 webhookUrl，返回响应文本。
 */
export async function executeUserTool(
  tool: UserToolConfig,
  input: Record<string, unknown>,
): Promise<string> {
  const method = tool.method ?? 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(tool.headers ?? {}),
  };

  let url = tool.webhookUrl;
  let bodyStr: string | undefined;

  if (method === 'GET') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(input)) {
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
  } else {
    bodyStr = JSON.stringify(input);
  }

  const resp = await fetch(url, {
    method,
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });

  const text = await resp.text();
  if (!resp.ok) {
    return `Webhook 返回错误 ${resp.status}：${text.slice(0, 500)}`;
  }
  return text.length > 4000 ? text.slice(0, 4000) + '\n\n[响应过长，已截断]' : text;
}
