// Mock data for the interactive prototype

export interface MockWorker {
  id: string;
  name: string;
  description: string;
  modelId: string;
  role: string;
  skills: string[];
  tools: string[];
  status: 'online' | 'idle' | 'offline';
  totalTokens: number;
  totalSessions: number;
  lastActive: string;
  avatar: string; // emoji or url
}

export interface MockMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface MockConversation {
  id: string;
  workerId: string;
  workerName: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
  messages: MockMessage[];
}

export interface MockDepartment {
  id: string;
  name: string;
  description: string;
  members: MockEmployee[];
}

export interface MockEmployee {
  id: string;
  name: string;
  role: string;
  email: string;
  avatar: string;
  departmentId: string;
  workerId?: string;
}

export interface MockCompany {
  id: string;
  name: string;
  description: string;
  departments: MockDepartment[];
}

// ─── Workers ──────────────────────────────────────────────────────────────────

export const MOCK_WORKERS: MockWorker[] = [
  {
    id: 'w-research',
    name: '研究助手',
    description: '专注于信息检索、数据分析和研究报告撰写',
    modelId: 'claude-sonnet-4-6',
    role: '你是一名专业的研究助手，擅长快速检索信息、分析数据，并撰写清晰的研究报告。',
    skills: ['research', 'analysis', 'writing'],
    tools: ['web-fetch', 'file-read', 'file-write'],
    status: 'online',
    totalTokens: 284720,
    totalSessions: 47,
    lastActive: '2分钟前',
    avatar: '🔬',
  },
  {
    id: 'w-code',
    name: '代码助手',
    description: '帮助编写、审查和调试代码，支持多种编程语言',
    modelId: 'claude-sonnet-4-6',
    role: '你是一名经验丰富的软件工程师，擅长编写高质量代码、代码审查和调试。',
    skills: ['coding', 'debugging', 'review'],
    tools: ['file-read', 'file-write', 'shell-exec'],
    status: 'idle',
    totalTokens: 512340,
    totalSessions: 82,
    lastActive: '1小时前',
    avatar: '💻',
  },
  {
    id: 'w-writer',
    name: '写作助手',
    description: '协助内容创作、文案优化和多语言翻译',
    modelId: 'claude-opus-4-6',
    role: '你是一名专业的内容创作者，擅长各类文体写作、文案优化和创意表达。',
    skills: ['writing', 'translation', 'editing'],
    tools: ['file-read', 'file-write'],
    status: 'online',
    totalTokens: 163890,
    totalSessions: 31,
    lastActive: '30分钟前',
    avatar: '✍️',
  },
  {
    id: 'w-data',
    name: '数据分析师',
    description: '处理数据分析任务，生成统计报告和可视化建议',
    modelId: 'claude-sonnet-4-6',
    role: '你是一名数据分析专家，擅长数据处理、统计分析和数据可视化方案设计。',
    skills: ['data-analysis', 'statistics', 'visualization'],
    tools: ['file-read', 'file-write', 'datetime'],
    status: 'offline',
    totalTokens: 89430,
    totalSessions: 18,
    lastActive: '2天前',
    avatar: '📊',
  },
];

// ─── Conversations ─────────────────────────────────────────────────────────────

export const MOCK_CONVERSATIONS: MockConversation[] = [
  {
    id: 'conv-1',
    workerId: 'w-research',
    workerName: '研究助手',
    title: 'Vue 3 组合式 API 最佳实践',
    lastMessage: '好的，我已经整理了 Vue 3 组合式 API 的核心最佳实践...',
    updatedAt: Date.now() - 1000 * 60 * 5,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '帮我整理一下 Vue 3 组合式 API 的最佳实践',
        timestamp: Date.now() - 1000 * 60 * 10,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: `# Vue 3 组合式 API 最佳实践

## 1. 使用 \`<script setup>\`
推荐使用 \`<script setup>\` 语法糖，它更简洁且具有更好的 TypeScript 支持。

## 2. 合理拆分 Composables
将可复用的逻辑提取到独立的 composable 函数中：

\`\`\`typescript
// useCounter.ts
export function useCounter(initial = 0) {
  const count = ref(initial)
  const increment = () => count.value++
  const decrement = () => count.value--
  return { count, increment, decrement }
}
\`\`\`

## 3. 响应式状态管理
- 使用 \`ref()\` 处理原始值
- 使用 \`reactive()\` 处理对象（但注意解构会失去响应性）
- 使用 \`computed()\` 处理派生状态

## 4. 生命周期钩子
在 setup 中使用对应的生命周期函数，如 \`onMounted\`、\`onUnmounted\` 等。

好的，我已经整理了 Vue 3 组合式 API 的核心最佳实践，需要我深入介绍哪个部分吗？`,
        timestamp: Date.now() - 1000 * 60 * 5,
        tokenUsage: { inputTokens: 42, outputTokens: 287 },
      },
    ],
  },
  {
    id: 'conv-2',
    workerId: 'w-code',
    workerName: '代码助手',
    title: 'TypeScript 泛型使用指南',
    lastMessage: '泛型让代码更加灵活且类型安全，以下是主要用法...',
    updatedAt: Date.now() - 1000 * 60 * 60,
    messages: [
      {
        id: 'm3',
        role: 'user',
        content: '解释一下 TypeScript 泛型的使用场景',
        timestamp: Date.now() - 1000 * 60 * 65,
      },
      {
        id: 'm4',
        role: 'assistant',
        content: '泛型让代码更加灵活且类型安全，以下是主要用法...\n\n```typescript\nfunction identity<T>(arg: T): T {\n  return arg;\n}\n```',
        timestamp: Date.now() - 1000 * 60 * 60,
        tokenUsage: { inputTokens: 28, outputTokens: 156 },
      },
    ],
  },
  {
    id: 'conv-3',
    workerId: 'w-writer',
    workerName: '写作助手',
    title: '产品发布公告草稿',
    lastMessage: '以下是产品发布公告的初稿，你可以根据需要调整...',
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
    messages: [
      {
        id: 'm5',
        role: 'user',
        content: '帮我写一份 AI 产品发布的公告',
        timestamp: Date.now() - 1000 * 60 * 60 * 3.5,
      },
      {
        id: 'm6',
        role: 'assistant',
        content: '以下是产品发布公告的初稿，你可以根据需要调整...',
        timestamp: Date.now() - 1000 * 60 * 60 * 3,
        tokenUsage: { inputTokens: 35, outputTokens: 342 },
      },
    ],
  },
];

// ─── Organization ─────────────────────────────────────────────────────────────

export const MOCK_COMPANY: MockCompany = {
  id: 'company-1',
  name: '未来科技有限公司',
  description: '专注于 AI 应用开发的科技公司',
  departments: [
    {
      id: 'dept-tech',
      name: '技术部',
      description: '负责产品研发和技术架构',
      members: [
        { id: 'emp-1', name: '张三', role: '技术总监', email: 'zhang@example.com', avatar: '👨‍💻', departmentId: 'dept-tech', workerId: 'w-code' },
        { id: 'emp-2', name: '李四', role: '前端工程师', email: 'li@example.com', avatar: '👩‍💻', departmentId: 'dept-tech' },
        { id: 'emp-3', name: '王五', role: '后端工程师', email: 'wang@example.com', avatar: '🧑‍💻', departmentId: 'dept-tech' },
      ],
    },
    {
      id: 'dept-product',
      name: '产品部',
      description: '负责产品规划和用户体验',
      members: [
        { id: 'emp-4', name: '赵六', role: '产品经理', email: 'zhao@example.com', avatar: '📋', departmentId: 'dept-product' },
        { id: 'emp-5', name: '钱七', role: 'UI 设计师', email: 'qian@example.com', avatar: '🎨', departmentId: 'dept-product' },
      ],
    },
    {
      id: 'dept-research',
      name: '研究部',
      description: '负责 AI 技术研究和探索',
      members: [
        { id: 'emp-6', name: '孙八', role: 'AI 研究员', email: 'sun@example.com', avatar: '🔭', departmentId: 'dept-research', workerId: 'w-research' },
        { id: 'emp-7', name: '周九', role: '数据科学家', email: 'zhou@example.com', avatar: '📈', departmentId: 'dept-research', workerId: 'w-data' },
      ],
    },
    {
      id: 'dept-content',
      name: '内容部',
      description: '负责内容创作和市场传播',
      members: [
        { id: 'emp-8', name: '吴十', role: '内容总监', email: 'wu@example.com', avatar: '📝', departmentId: 'dept-content', workerId: 'w-writer' },
        { id: 'emp-9', name: '郑十一', role: '文案策划', email: 'zheng@example.com', avatar: '✍️', departmentId: 'dept-content' },
      ],
    },
  ],
};

// ─── Analytics ────────────────────────────────────────────────────────────────

export const MOCK_TOKEN_DAILY = [
  { date: '03-01', input: 12400, output: 34200 },
  { date: '03-02', input: 15600, output: 41800 },
  { date: '03-03', input: 9800, output: 28400 },
  { date: '03-04', input: 18200, output: 52600 },
  { date: '03-05', input: 21000, output: 61400 },
  { date: '03-06', input: 16800, output: 47200 },
  { date: '03-07', input: 24600, output: 72800 },
  { date: '03-08', input: 19400, output: 56200 },
  { date: '03-09', input: 22800, output: 68400 },
  { date: '03-10', input: 11200, output: 31600 },
];

export const MOCK_TOKEN_BY_WORKER = [
  { name: '代码助手', value: 512340 },
  { name: '研究助手', value: 284720 },
  { name: '写作助手', value: 163890 },
  { name: '数据分析师', value: 89430 },
];

export const MOCK_TOKEN_BY_MODEL = [
  { name: 'claude-sonnet-4-6', value: 886490 },
  { name: 'claude-opus-4-6', value: 163890 },
];
