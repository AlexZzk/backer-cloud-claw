#!/usr/bin/env node
/**
 * bcc init — 初始化向导（多模型版）
 *
 * 支持配置任意数量的模型实例，每个实例可独立指定：
 *   - 提供商（Claude / 阿里百炼 / DeepSeek / 自定义 OpenAI 兼容接口）
 *   - API Key
 *   - 模型名称
 *   - API 地址（baseUrl）
 *   - 角色（主模型 / 故障转移备用 / 手动切换）
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  saveConfig,
  makeDefaultConfig,
  displayPath,
  CONFIG_PATH,
  DEFAULT_SESSION_DIR,
  type BccConfig,
  type ModelInstanceConfig,
  type ProviderType,
} from '../src/config.js';
import {
  selectOne,
  askText,
  askSecret,
  askConfirm,
  closeWizard,
  printHeader,
  printStep,
  printSummary,
  ok,
  warn,
  fail,
} from '../src/wizard.js';

const VERSION = '0.1.0';

// ─── 提供商元数据 ─────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<ProviderType, string> = {
  claude:   'Claude（Anthropic）',
  bailian:  '阿里百炼（通义千问）',
  deepseek: 'DeepSeek',
  custom:   '自定义（OpenAI 兼容接口）',
};

const PROVIDER_KEY_HINT: Record<ProviderType, string> = {
  claude:   'https://console.anthropic.com/settings/keys  格式：sk-ant-...',
  bailian:  'https://bailian.console.aliyun.com/ → API Key 管理  格式：sk-...',
  deepseek: 'https://platform.deepseek.com/api_keys  格式：sk-...',
  custom:   '取决于你的部署配置，部分私有部署可填任意值',
};

const PROVIDER_MODELS: Record<ProviderType, Array<{ label: string; value: string; description?: string }>> = {
  claude: [
    { label: 'claude-haiku-4-5',   value: 'claude-haiku-4-5',   description: '轻量快速，低成本' },
    { label: 'claude-sonnet-4-5',  value: 'claude-sonnet-4-5',  description: '均衡性能（推荐）' },
    { label: 'claude-opus-4-5',    value: 'claude-opus-4-5',    description: '最强性能，高成本' },
    { label: '自定义',             value: '__custom__',          description: '手动输入模型名称' },
  ],
  bailian: [
    { label: 'qwen-turbo',  value: 'qwen-turbo',  description: '快速响应，成本最低' },
    { label: 'qwen-plus',   value: 'qwen-plus',   description: '均衡性能（推荐）' },
    { label: 'qwen-max',    value: 'qwen-max',    description: '最强性能，高成本' },
    { label: 'qwen-long',   value: 'qwen-long',   description: '超长上下文（128k）' },
    { label: '自定义',      value: '__custom__',  description: '手动输入模型名称' },
  ],
  deepseek: [
    { label: 'deepseek-chat',     value: 'deepseek-chat',     description: '通用对话（推荐）' },
    { label: 'deepseek-reasoner', value: 'deepseek-reasoner', description: '深度推理，较慢' },
    { label: '自定义',            value: '__custom__',         description: '手动输入模型名称' },
  ],
  custom: [],
};

const PROVIDER_DEFAULT_BASE_URL: Record<ProviderType, string> = {
  claude:   '',
  bailian:  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom:   '',
};

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printHeader(VERSION);

  const existing = await loadConfig();
  if (existing) {
    console.log();
    warn(`检测到已有配置文件：${displayPath(CONFIG_PATH)}`);
    const overwrite = await askConfirm('  是否重新配置？（选 n 直接退出）', false);
    if (!overwrite) {
      console.log('\n  保持现有配置不变。运行 bcc-chat 开始对话。\n');
      closeWizard();
      process.exit(0);
    }
  }

  const config: BccConfig = existing ?? makeDefaultConfig();

  // ── 步骤 1：管理模型实例 ─────────────────────────────────────────────────
  printStep(1, 3, '模型配置');
  console.log('  每个模型实例可以有独立的 API Key、模型名和 API 地址。');
  console.log('  切换模型时，对话历史完整保留。');
  console.log();

  await manageModels(config);

  // ── 步骤 2：会话存储 ─────────────────────────────────────────────────────
  printStep(2, 3, '会话存储');
  console.log('  会话持久化：对话历史自动保存到磁盘，重启后可继续。');
  console.log();

  const enableMemory = await selectOne<'yes' | 'no'>(
    '是否启用会话持久化？',
    [
      { label: '启用（推荐）', value: 'yes', description: '历史自动保存到 ~/.bcc/sessions/' },
      { label: '禁用',        value: 'no',  description: '历史仅存内存，退出后清除' },
    ],
    config.defaults.enableMemory ? 0 : 1,
  );
  config.defaults.enableMemory = (enableMemory === 'yes');

  if (config.defaults.enableMemory) {
    console.log();
    const rawDir = await askText('会话文件存储位置',
      displayPath(config.defaults.sessionDir) || displayPath(DEFAULT_SESSION_DIR));
    config.defaults.sessionDir = rawDir.startsWith('~')
      ? join(homedir(), rawDir.slice(1))
      : rawDir || DEFAULT_SESSION_DIR;

    console.log();
    const maxChoice = await selectOne<string>(
      '历史消息上限（超出后截断最早消息）',
      [
        { label: '50 条（推荐）', value: '50'  },
        { label: '100 条',       value: '100' },
        { label: '200 条',       value: '200' },
        { label: '无限制',       value: '0'   },
      ],
      config.defaults.maxMessages === 50  ? 0
      : config.defaults.maxMessages === 100 ? 1
      : config.defaults.maxMessages === 200 ? 2
      : config.defaults.maxMessages === 0   ? 3 : 0,
    );
    config.defaults.maxMessages = parseInt(maxChoice, 10);
  }

  // ── 步骤 3：确认 ─────────────────────────────────────────────────────────
  printStep(3, 3, '确认');
  printSummary(buildSummaryRows(config));

  const confirmed = await askConfirm('是否保存以上配置？', true);
  if (!confirmed) {
    console.log('\n  已取消，配置未保存。\n');
    closeWizard();
    process.exit(0);
  }

  try {
    await saveConfig(config);
    console.log();
    ok(`配置已保存至 ${displayPath(CONFIG_PATH)}`);
  } catch (err) {
    console.log();
    fail(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    closeWizard();
    process.exit(1);
  }

  printNextSteps(config);
  closeWizard();
}

// ─── 多模型管理循环 ───────────────────────────────────────────────────────────

async function manageModels(config: BccConfig): Promise<void> {
  while (true) {
    printModelList(config.models);

    type Action = 'add' | 'edit' | 'delete' | 'done';
    const choices: Array<{ label: string; value: Action; description?: string; skip?: boolean }> = [
      { label: '添加模型', value: 'add', description: '配置一个新的模型实例' },
    ];

    if (config.models.length > 0) {
      choices.push({ label: '编辑模型',   value: 'edit',   description: '修改已有实例的配置' });
      choices.push({ label: '删除模型',   value: 'delete', description: '移除一个模型实例' });
      choices.push({ label: '继续下一步', value: 'done' });
    } else {
      choices.push({ label: '跳过（稍后配置）', value: 'done', skip: true,
        description: '运行 bcc-chat 前会提示重新运行 bcc-init' });
    }

    const action = await selectOne<Action>('操作', choices,
      config.models.length === 0 ? 0 : choices.length - 1);

    if (action === 'done') break;
    if (action === 'add')    { const m = await addModelWizard(config.models); if (m) { if (!config.models.some(x => x.primary)) m.primary = true; config.models.push(m); ok(`"${m.id}" 已添加`); console.log(); } }
    if (action === 'edit')   { await editModelWizard(config.models); }
    if (action === 'delete') { await deleteModelWizard(config.models); }
  }
}

function printModelList(models: ModelInstanceConfig[]): void {
  if (models.length === 0) {
    console.log('  当前已配置的模型：（无）\n');
    return;
  }
  console.log('  当前已配置的模型：');
  for (let i = 0; i < models.length; i++) {
    const m = models[i]!;
    const role = m.primary ? '主' : m.fallback ? '备用' : '手动';
    const modelName = m.model ?? `${m.provider} 默认`;
    const urlNote = m.baseUrl ? `  ${m.baseUrl.slice(0, 28)}` : '';
    console.log(`    ${i + 1}. [${role}] ${m.id.padEnd(18)} ${PROVIDER_LABELS[m.provider].padEnd(16)} / ${modelName}${urlNote}`);
  }
  console.log();
}

// ─── 添加模型向导 ─────────────────────────────────────────────────────────────

async function addModelWizard(existing: ModelInstanceConfig[]): Promise<ModelInstanceConfig | null> {
  console.log();

  // 提供商
  const provider = await selectOne<ProviderType>('提供商', [
    { label: 'Claude（Anthropic）',       value: 'claude',   description: '强大安全，适合通用任务' },
    { label: '阿里百炼（通义千问）',       value: 'bailian',  description: '国内友好，千问系列模型' },
    { label: 'DeepSeek',                  value: 'deepseek', description: '高性价比，擅长推理' },
    { label: '自定义（OpenAI 兼容接口）', value: 'custom',   description: '私有部署 / 本地模型 / 第三方代理' },
  ], 0);

  // 实例 ID
  console.log();
  const suggestedId = generateId(provider, existing);
  const id = await askText('实例名称（用于 /model 切换）', suggestedId);
  if (!id) { warn('未输入名称，已取消。'); return null; }
  if (existing.some(m => m.id === id)) { warn(`"${id}" 已存在，已取消。`); return null; }

  // API Key
  console.log();
  console.log(`  ${PROVIDER_KEY_HINT[provider]}`);
  console.log('  提示：支持粘贴（Ctrl+V / Cmd+V），输入显示为 *');
  const apiKey = await askSecret('  输入 API Key');
  if (!apiKey && provider !== 'custom') { warn('未输入 Key，已取消。'); return null; }
  if (provider === 'claude' && apiKey && !apiKey.startsWith('sk-ant')) {
    warn('Key 格式看起来不对（通常以 sk-ant 开头），已保存但请核实。');
  }

  // 模型名
  console.log();
  const model = await selectModelName(provider, existing.find(m => m.provider === provider)?.model);
  if (provider === 'custom' && !model) { warn('自定义提供商必须填写模型名称，已取消。'); return null; }

  // API 地址
  console.log();
  const baseUrl = await selectBaseUrl(provider);
  if (provider === 'custom' && !baseUrl) { warn('自定义提供商必须填写 API 地址，已取消。'); return null; }

  // 角色
  console.log();
  type Role = 'primary' | 'fallback' | 'manual';
  const hasPrimary = existing.some(m => m.primary);
  const role = await selectOne<Role>('此模型的角色', [
    { label: '主模型',       value: 'primary',  description: '对话时默认使用' },
    { label: '故障转移备用', value: 'fallback', description: '主模型失败时自动切换' },
    { label: '仅手动切换',   value: 'manual',   description: '通过 /model 命令手动切换' },
  ], hasPrimary ? 2 : 0);

  if (role === 'primary') {
    for (const m of existing) m.primary = false;
  }

  console.log();
  return {
    id, provider,
    apiKey: apiKey || 'none',
    ...(model   && { model }),
    ...(baseUrl && { baseUrl }),
    primary:  role === 'primary',
    fallback: role === 'fallback',
  };
}

function generateId(provider: ProviderType, existing: ModelInstanceConfig[]): string {
  if (!existing.some(m => m.id === provider)) return provider;
  for (let i = 2; i < 100; i++) {
    const c = `${provider}-${i}`;
    if (!existing.some(m => m.id === c)) return c;
  }
  return provider;
}

async function selectModelName(provider: ProviderType, prevModel?: string): Promise<string | undefined> {
  if (provider === 'custom') {
    const name = await askText('模型名称（如 llama3、qwen2.5-72b-instruct）', prevModel ?? '');
    return name || undefined;
  }
  const list = PROVIDER_MODELS[provider];
  const defaultIdx = list.findIndex(m => m.description?.includes('推荐'));
  const choice = await selectOne<string>('选择模型', list, defaultIdx >= 0 ? defaultIdx : 0);
  if (choice === '__custom__') {
    console.log();
    const custom = await askText('输入模型名称', prevModel ?? '');
    return custom || undefined;
  }
  return choice;
}

async function selectBaseUrl(provider: ProviderType): Promise<string | undefined> {
  if (provider === 'custom') {
    const url = await askText('API 地址（如 http://localhost:11434/v1）', '');
    return url || undefined;
  }
  const defaultUrl = PROVIDER_DEFAULT_BASE_URL[provider];
  if (defaultUrl) {
    console.log(`  默认 API 地址：${defaultUrl}`);
  } else {
    console.log('  默认 API 地址：SDK 内置（官方地址）');
  }
  const change = await askConfirm('  是否使用自定义地址（代理/私有部署时使用）？', false);
  if (!change) return undefined;
  console.log();
  const url = await askText('输入自定义 API 地址', defaultUrl);
  return url || undefined;
}

// ─── 编辑模型向导 ─────────────────────────────────────────────────────────────

async function editModelWizard(models: ModelInstanceConfig[]): Promise<void> {
  if (models.length === 0) return;
  console.log();
  const idx = await selectOne<number>('选择要编辑的模型',
    [
      ...models.map((m, i) => ({
        label: `${i + 1}. ${m.id}`,
        value: i,
        description: `${PROVIDER_LABELS[m.provider]} / ${m.model ?? '默认'} [${m.primary ? '主' : m.fallback ? '备用' : '手动'}]`,
      })),
      { label: '← 返回', value: -1, description: '不编辑，返回上级菜单' },
    ], 0);

  if (idx === -1) { console.log(); return; }

  const t = models[idx]!;
  // 保存快照，以便用户取消时恢复
  const snapshot: ModelInstanceConfig = { ...t };

  console.log(`\n  编辑 "${t.id}"（回车保持当前值）\n`);

  // Key
  console.log(`  当前 Key：${'*'.repeat(8)}...${t.apiKey.slice(-4)}`);
  if (await askConfirm('  是否更换 API Key？', false)) {
    console.log('  提示：支持粘贴，输入显示为 *');
    const k = await askSecret('  输入新 API Key');
    if (k) t.apiKey = k;
  }

  // 模型名
  console.log();
  const newModel = await askText('模型名称', t.model ?? '');
  if (newModel) t.model = newModel; else delete t.model;

  // baseUrl
  console.log();
  const defaultUrl = PROVIDER_DEFAULT_BASE_URL[t.provider];
  const newUrl = await askText('API 地址（留空=使用默认）', t.baseUrl ?? defaultUrl);
  if (!newUrl || newUrl === defaultUrl) delete t.baseUrl; else t.baseUrl = newUrl;

  // 角色
  console.log();
  type Role = 'primary' | 'fallback' | 'manual';
  const cur: Role = t.primary ? 'primary' : t.fallback ? 'fallback' : 'manual';
  const newRole = await selectOne<Role>('角色', [
    { label: '主模型',       value: 'primary'  },
    { label: '故障转移备用', value: 'fallback' },
    { label: '仅手动切换',   value: 'manual'   },
  ], cur === 'primary' ? 0 : cur === 'fallback' ? 1 : 2);

  // 确认或取消
  console.log();
  const save = await askConfirm('  保存以上更改？（选 n 放弃修改）', true);
  if (!save) {
    // 还原快照：先删掉编辑中新增的字段，再复制回原值
    for (const key of Object.keys(t)) {
      if (!(key in snapshot)) delete (t as unknown as Record<string, unknown>)[key];
    }
    Object.assign(t, snapshot);
    warn(`已取消，"${t.id}" 保持原配置`);
    console.log();
    return;
  }

  if (newRole === 'primary') { for (const m of models) m.primary = false; }
  t.primary  = newRole === 'primary';
  t.fallback = newRole === 'fallback';

  ok(`"${t.id}" 已更新`);
  console.log();
}

// ─── 删除模型向导 ─────────────────────────────────────────────────────────────

async function deleteModelWizard(models: ModelInstanceConfig[]): Promise<void> {
  if (models.length === 0) return;
  console.log();
  const idx = await selectOne<number>('选择要删除的模型',
    models.map((m, i) => ({ label: `${i + 1}. ${m.id}`, value: i,
      description: `${PROVIDER_LABELS[m.provider]} / ${m.model ?? '默认'}` })), 0);

  const t = models[idx]!;
  if (!await askConfirm(`  确认删除 "${t.id}"？`, false)) { console.log(); return; }
  models.splice(idx, 1);
  if (t.primary && models.length > 0) { models[0]!.primary = true; warn(`"${models[0]!.id}" 已自动设为主模型`); }
  ok(`已删除 "${t.id}"`);
  console.log();
}

// ─── 摘要 & 下一步 ────────────────────────────────────────────────────────────

function buildSummaryRows(config: BccConfig): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (config.models.length === 0) {
    rows.push(['模型配置', '未配置（跳过）']);
  } else {
    for (const m of config.models) {
      const role = m.primary ? '主' : m.fallback ? '备用' : '手动';
      const model = m.model ?? `${m.provider} 默认`;
      rows.push([`[${role}] ${m.id}`, `${model}  ${m.apiKey.slice(0, 6)}...**`]);
    }
  }
  rows.push(['会话存储', config.defaults.enableMemory ? displayPath(config.defaults.sessionDir) : '禁用']);
  if (config.defaults.enableMemory) {
    rows.push(['历史上限', config.defaults.maxMessages === 0 ? '无限制' : `${config.defaults.maxMessages} 条`]);
  }
  return rows;
}

function printNextSteps(config: BccConfig): void {
  console.log('\n  ── 下一步 ──────────────────────────────────────────────\n');
  if (config.models.length === 0) {
    console.log('  ⚠ 未配置模型，运行前请先设置：pnpm bcc-init\n');
  } else {
    const primary = config.models.find(m => m.primary) ?? config.models[0]!;
    console.log(`  主模型：${primary.id}（${PROVIDER_LABELS[primary.provider]}）`);
    const others = config.models.filter(m => !m.primary);
    if (others.length > 0) {
      console.log(`  其他：${others.map(m => m.id).join('、')}（对话中 /model <id> 切换，历史保留）`);
    }
    console.log('\n  开始对话：\n    pnpm bcc-chat\n');
  }
  console.log('  重新配置：\n    pnpm bcc-init\n');
  console.log(`  配置文件：${displayPath(CONFIG_PATH)}\n`);
}

// ─── 运行 ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n  错误：' + (err instanceof Error ? err.message : String(err)));
  closeWizard();
  process.exit(1);
});
