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
  isSecretary?: boolean; // default/pinned assistant
}

export interface MockMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface MockSession {
  id: string;
  workerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: MockMessage[];
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

export interface MockGoal {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'completed' | 'paused';
}

export interface MockDepartment {
  id: string;
  name: string;
  description: string;
  members: MockEmployee[];
  goals: MockGoal[];
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
  goals: MockGoal[];
}

// ─── Workers ──────────────────────────────────────────────────────────────────

export const MOCK_WORKERS: MockWorker[] = [
  {
    id: 'w-secretary',
    name: '个人助理',
    description: '您的专属助理，可以帮您处理任何日常事务、回答问题、安排计划',
    modelId: 'claude-opus-4-6',
    role: '你是用户的专属个人助理，具备广泛的知识储备，能够处理各类问题。你性格亲切、专业高效。',
    skills: ['assistant', 'planning', 'research'],
    tools: ['datetime', 'web-fetch', 'file-read'],
    status: 'online',
    totalTokens: 98430,
    totalSessions: 124,
    lastActive: '刚刚',
    avatar: '🤵',
    isSecretary: true,
  },
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

// ─── Sessions (worker-centric) ────────────────────────────────────────────────

const now = Date.now();

export const MOCK_SESSIONS: MockSession[] = [
  // Secretary sessions (multiple — like WeChat threads)
  {
    id: 'sess-secretary-1',
    workerId: 'w-secretary',
    title: '今日工作安排',
    createdAt: now - 1000 * 60 * 30,
    updatedAt: now - 1000 * 60 * 5,
    messages: [
      {
        id: 'sm1', role: 'user',
        content: '帮我整理一下今天需要完成的工作',
        timestamp: now - 1000 * 60 * 30,
      },
      {
        id: 'sm2', role: 'assistant',
        content: '好的！根据您的日历和任务列表，今天需要完成以下工作：\n\n**上午**\n- 09:00 技术评审会议（1小时）\n- 10:30 完成 API 接口文档\n\n**下午**\n- 14:00 与产品团队对齐需求\n- 16:00 代码 Review\n\n**今日截止**\n- ✅ 提交月度报告\n- 📝 更新项目进度看板\n\n需要我帮您发送会议提醒或准备任何材料吗？',
        timestamp: now - 1000 * 60 * 25,
        tokenUsage: { inputTokens: 28, outputTokens: 186 },
      },
      {
        id: 'sm3', role: 'user',
        content: '帮我起草一封邮件给研发团队，说明下午14点的需求对齐会议',
        timestamp: now - 1000 * 60 * 8,
      },
      {
        id: 'sm4', role: 'assistant',
        content: '邮件草稿如下：\n\n---\n**收件人：** 研发团队\n**主题：** 【今日 14:00】需求对齐会议通知\n\n各位好，\n\n今天下午 14:00 我们将在会议室 A 召开需求对齐会议，主要议题如下：\n\n1. Q2 核心功能规划确认\n2. 技术可行性评估\n3. 排期与里程碑讨论\n\n请提前准备好各自负责模块的最新进展，会议预计 1 小时。\n\n如有冲突请提前告知，谢谢！\n\n---\n\n需要我调整邮件内容或添加其他信息吗？',
        timestamp: now - 1000 * 60 * 5,
        tokenUsage: { inputTokens: 42, outputTokens: 220 },
      },
    ],
  },
  {
    id: 'sess-secretary-2',
    workerId: 'w-secretary',
    title: '周末旅行计划',
    createdAt: now - 1000 * 60 * 60 * 24,
    updatedAt: now - 1000 * 60 * 60 * 23,
    messages: [
      {
        id: 'sm5', role: 'user',
        content: '帮我规划一下这个周末去杭州的行程',
        timestamp: now - 1000 * 60 * 60 * 24,
      },
      {
        id: 'sm6', role: 'assistant',
        content: '杭州周末两日游推荐行程：\n\n**周六**\n- 上午：西湖游览（苏堤、断桥、雷峰塔）\n- 下午：河坊街、清河坊历史街区\n- 晚上：外婆家或知味观品尝杭帮菜\n\n**周日**\n- 上午：灵隐寺、飞来峰\n- 下午：龙井村采茶体验\n- 返程\n\n需要我帮您查询高铁票价或酒店推荐吗？',
        timestamp: now - 1000 * 60 * 60 * 23,
        tokenUsage: { inputTokens: 35, outputTokens: 198 },
      },
    ],
  },

  // Research assistant sessions
  {
    id: 'sess-research-1',
    workerId: 'w-research',
    title: 'Vue 3 组合式 API 最佳实践',
    createdAt: now - 1000 * 60 * 60 * 2,
    updatedAt: now - 1000 * 60 * 60 * 1,
    messages: [
      {
        id: 'rm1', role: 'user',
        content: '帮我整理一下 Vue 3 组合式 API 的最佳实践',
        timestamp: now - 1000 * 60 * 60 * 2,
      },
      {
        id: 'rm2', role: 'assistant',
        content: `# Vue 3 组合式 API 最佳实践\n\n## 1. 使用 \`<script setup>\`\n推荐使用 \`<script setup>\` 语法糖，它更简洁且具有更好的 TypeScript 支持。\n\n## 2. 合理拆分 Composables\n将可复用的逻辑提取到独立的 composable 函数中：\n\n\`\`\`typescript\nexport function useCounter(initial = 0) {\n  const count = ref(initial)\n  const increment = () => count.value++\n  return { count, increment }\n}\n\`\`\`\n\n## 3. 响应式状态管理\n- 使用 \`ref()\` 处理原始值\n- 使用 \`reactive()\` 处理对象\n- 使用 \`computed()\` 处理派生状态`,
        timestamp: now - 1000 * 60 * 60 * 1,
        tokenUsage: { inputTokens: 42, outputTokens: 287 },
      },
    ],
  },

  // Code assistant sessions
  {
    id: 'sess-code-1',
    workerId: 'w-code',
    title: 'TypeScript 泛型使用指南',
    createdAt: now - 1000 * 60 * 60 * 5,
    updatedAt: now - 1000 * 60 * 60 * 4,
    messages: [
      {
        id: 'cm1', role: 'user',
        content: '解释一下 TypeScript 泛型的使用场景',
        timestamp: now - 1000 * 60 * 60 * 5,
      },
      {
        id: 'cm2', role: 'assistant',
        content: '泛型让代码更加灵活且类型安全，以下是主要用法...\n\n```typescript\nfunction identity<T>(arg: T): T {\n  return arg;\n}\n```',
        timestamp: now - 1000 * 60 * 60 * 4,
        tokenUsage: { inputTokens: 28, outputTokens: 156 },
      },
    ],
  },

  // Writer sessions
  {
    id: 'sess-writer-1',
    workerId: 'w-writer',
    title: '产品发布公告草稿',
    createdAt: now - 1000 * 60 * 60 * 8,
    updatedAt: now - 1000 * 60 * 60 * 7,
    messages: [
      {
        id: 'wm1', role: 'user',
        content: '帮我写一份 AI 产品发布的公告',
        timestamp: now - 1000 * 60 * 60 * 8,
      },
      {
        id: 'wm2', role: 'assistant',
        content: '以下是产品发布公告的初稿：\n\n---\n**BCC v1.0 正式发布**\n\n我们很高兴地宣布，backer-cloud-claw v1.0 今日正式发布！\n\n本次发布包含以下核心功能：\n- 🤖 智能 Worker 系统\n- 💬 多会话对话管理\n- 📊 完整的数据统计\n- 🏢 企业组织架构管理\n\n---\n\n需要调整内容或风格吗？',
        timestamp: now - 1000 * 60 * 60 * 7,
        tokenUsage: { inputTokens: 35, outputTokens: 342 },
      },
    ],
  },
];

// Legacy format for backward compat
export const MOCK_CONVERSATIONS: MockConversation[] = MOCK_SESSIONS.map(s => ({
  id: s.id,
  workerId: s.workerId,
  workerName: MOCK_WORKERS.find(w => w.id === s.workerId)?.name ?? '',
  title: s.title,
  lastMessage: s.messages[s.messages.length - 1]?.content.slice(0, 60) ?? '',
  updatedAt: s.updatedAt,
  messages: s.messages,
}));

// ─── Organization ─────────────────────────────────────────────────────────────

export const MOCK_COMPANY: MockCompany = {
  id: 'company-1',
  name: '未来科技有限公司',
  description: '专注于 AI 应用开发的科技公司',
  goals: [
    { id: 'cg-1', title: '成为行业领先的 AI 平台', description: '在 2025 年底前，成为国内 AI 应用开发领域市场占有率前三的平台', priority: 'high', status: 'active' },
    { id: 'cg-2', title: '扩展企业客户', description: '全年新增 100 家企业客户，覆盖金融、医疗、教育三大领域', priority: 'high', status: 'active' },
    { id: 'cg-3', title: '打造高效 AI 团队文化', description: '建立 AI 辅助工作流程，提升整体研发效率 30%', priority: 'medium', status: 'active' },
  ],
  departments: [
    {
      id: 'dept-tech',
      name: '技术部',
      description: '负责产品研发和技术架构',
      goals: [
        { id: 'tg-1', title: '完成 v2.0 核心功能开发', description: '在 Q2 前完成多模态支持、长上下文优化和 API 网关重构', priority: 'high', status: 'active' },
        { id: 'tg-2', title: '系统稳定性提升', description: '将服务可用性提升至 99.9%，减少 P0 故障发生频率', priority: 'high', status: 'active' },
        { id: 'tg-3', title: '技术债清理', description: '清理历史技术债，提升代码覆盖率至 80% 以上', priority: 'medium', status: 'active' },
      ],
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
      goals: [
        { id: 'pg-1', title: '完成用户体验全面升级', description: '重新设计核心交互流程，NPS 提升至 60+', priority: 'high', status: 'active' },
        { id: 'pg-2', title: '新功能快速验证', description: '建立 MVP 快速验证机制，缩短功能验证周期至 2 周', priority: 'medium', status: 'active' },
      ],
      members: [
        { id: 'emp-4', name: '赵六', role: '产品经理', email: 'zhao@example.com', avatar: '📋', departmentId: 'dept-product' },
        { id: 'emp-5', name: '钱七', role: 'UI 设计师', email: 'qian@example.com', avatar: '🎨', departmentId: 'dept-product' },
      ],
    },
    {
      id: 'dept-research',
      name: '研究部',
      description: '负责 AI 技术研究和探索',
      goals: [
        { id: 'rg-1', title: '发布 Agent 技术白皮书', description: '整理内部 Agent 架构经验，发布技术白皮书，提升品牌技术影响力', priority: 'medium', status: 'active' },
        { id: 'rg-2', title: '探索多智能体协作框架', description: '研究并原型验证多 Agent 协作机制，输出可行性报告', priority: 'high', status: 'active' },
      ],
      members: [
        { id: 'emp-6', name: '孙八', role: 'AI 研究员', email: 'sun@example.com', avatar: '🔭', departmentId: 'dept-research', workerId: 'w-research' },
        { id: 'emp-7', name: '周九', role: '数据科学家', email: 'zhou@example.com', avatar: '📈', departmentId: 'dept-research', workerId: 'w-data' },
      ],
    },
    {
      id: 'dept-content',
      name: '内容部',
      description: '负责内容创作和市场传播',
      goals: [
        { id: 'contg-1', title: '内容矩阵建设', description: '建立技术博客、视频教程、社区运营三位一体的内容矩阵', priority: 'high', status: 'active' },
        { id: 'contg-2', title: '品牌曝光提升', description: '全年实现 500 万+ 内容曝光量，社媒粉丝增长 200%', priority: 'medium', status: 'paused' },
      ],
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
  { name: '代码助手', workerId: 'w-code', deptId: 'dept-tech', input: 148580, output: 363760, value: 512340 },
  { name: '研究助手', workerId: 'w-research', deptId: 'dept-research', input: 82770, output: 201950, value: 284720 },
  { name: '写作助手', workerId: 'w-writer', deptId: 'dept-content', input: 47530, output: 116360, value: 163890 },
  { name: '数据分析师', workerId: 'w-data', deptId: 'dept-research', input: 25950, output: 63480, value: 89430 },
  { name: '个人助理', workerId: 'w-secretary', deptId: null, input: 28560, output: 69870, value: 98430 },
];

// Dept-level aggregation (workers mapped to depts via members[].workerId)
export const MOCK_TOKEN_BY_DEPT = [
  { deptId: 'dept-tech', name: '技术部', input: 148580, output: 363760, value: 512340 },
  { deptId: 'dept-research', name: '研究部', input: 108720, output: 265430, value: 374150 },
  { deptId: 'dept-content', name: '内容部', input: 47530, output: 116360, value: 163890 },
  { deptId: 'dept-product', name: '产品部', input: 0, output: 0, value: 0 },
];

export const MOCK_TOKEN_BY_MODEL = [
  { name: 'claude-sonnet-4-6', value: 886490 },
  { name: 'claude-opus-4-6', value: 262320 },
];
