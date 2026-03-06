#!/usr/bin/env node
/**
 * bcc agent — Agent 管理工具
 *
 * Agent 配置保存在 ~/.bcc/config.json 的 agents 字段中。
 *
 * 子命令：
 *   list                  列出所有 Agent
 *   show <id>             查看 Agent 详情
 *   add                   交互式创建新 Agent
 *   edit <id>             编辑已有 Agent
 *   delete <id>           删除 Agent
 *   set-primary <id>      设置主 Agent（对话默认入口）
 */

import {
  loadConfig,
  saveConfig,
  makeDefaultConfig,
  type AgentConfig,
  type BccConfig,
  CONFIG_PATH,
} from '../src/config.js';
import {
  selectOne,
  askText,
  askConfirm,
  closeWizard,
  printHeader,
  ok,
  warn,
  fail,
} from '../src/wizard.js';

const VERSION = '0.1.0';

// ─── 帮助 ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
bcc agent — Agent 管理工具 v${VERSION}

用法：
  pnpm bcc-agent [子命令] [参数]

子命令：
  list                  列出所有已配置的 Agent
  show <id>             查看 Agent 详情
  add                   交互式创建新 Agent
  edit <id>             编辑已有 Agent 配置
  delete <id>           删除 Agent
  set-primary <id>      设置为主 Agent（对话默认入口）

用法示例：
  pnpm bcc-agent list
  pnpm bcc-agent add
  pnpm bcc-agent show orchestrator
  pnpm bcc-agent edit coder
  pnpm bcc-agent delete researcher
  pnpm bcc-agent set-primary orchestrator

配置文件位置：
  ${CONFIG_PATH}

在对话中使用：
  /agents               列出所有 Agent
  /agent <id>           切换到指定 Agent
  /agent <id> <消息>    向指定 Agent 发送一次消息
`);
}

// ─── 辅助：加载配置，若不存在则报错 ─────────────────────────────────────────

async function requireConfig(): Promise<BccConfig> {
  const cfg = await loadConfig();
  if (!cfg) {
    fail('未找到配置文件，请先运行 pnpm bcc-init 初始化');
    process.exit(1);
  }
  return cfg;
}

/** 确保 agents 字段存在 */
function ensureAgents(cfg: BccConfig): AgentConfig[] {
  if (!cfg.agents) cfg.agents = [];
  return cfg.agents;
}

// ─── 子命令：list ─────────────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
  const cfg = await requireConfig();
  const agents = cfg.agents ?? [];

  if (agents.length === 0) {
    console.log('\n  （尚未配置任何 Agent）');
    console.log('  运行 pnpm bcc-agent add 创建第一个 Agent\n');
    return;
  }

  console.log(`\n  Agent 列表（共 ${agents.length} 个）\n`);
  for (const a of agents) {
    const primary = a.primary ? ' [主]' : '';
    const model   = a.model   ? ` (${a.model})` : '';
    console.log(`  ${a.primary ? '★' : ' '} ${a.id.padEnd(18)} ${a.name}${primary}${model}`);
    console.log(`      ${a.description}`);
    if (a.skills && a.skills.length > 0) {
      console.log(`      技能：${a.skills.join(', ')}`);
    }
  }
  console.log(`\n  配置文件：${CONFIG_PATH}\n`);
}

// ─── 子命令：show ─────────────────────────────────────────────────────────────

async function cmdShow(id: string): Promise<void> {
  const cfg    = await requireConfig();
  const agent  = (cfg.agents ?? []).find(a => a.id === id);
  if (!agent) {
    fail(`找不到 Agent "${id}"，运行 pnpm bcc-agent list 查看所有 Agent`);
    process.exit(1);
  }

  console.log(`\n  ── Agent：${agent.id} ──`);
  console.log(`  显示名称：  ${agent.name}`);
  console.log(`  是否主要：  ${agent.primary ? '是（★）' : '否'}`);
  console.log(`  首选模型：  ${agent.model ?? '（使用全局主模型）'}`);
  console.log(`  描述：      ${agent.description}`);
  if (agent.skills && agent.skills.length > 0) {
    console.log(`  技能标签：  ${agent.skills.join(', ')}`);
  }
  console.log(`\n  System Prompt：`);
  console.log(agent.system.split('\n').map(l => '    ' + l).join('\n'));
  console.log();
}

// ─── 子命令：add ──────────────────────────────────────────────────────────────

async function cmdAdd(): Promise<void> {
  const cfg    = await loadConfig() ?? makeDefaultConfig();
  const agents = ensureAgents(cfg);

  printHeader(VERSION);
  console.log('  创建新 Agent\n');

  // ID
  let id = '';
  while (!id) {
    id = await askText('Agent ID（小写字母、数字、连字符，如 orchestrator、coder）', '');
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      warn('ID 必须以小写字母开头，只含小写字母/数字/连字符'); id = ''; continue;
    }
    if (agents.some(a => a.id === id)) {
      warn(`ID "${id}" 已存在，请选择其他 ID`); id = ''; continue;
    }
  }

  // 显示名称
  console.log();
  const name = (await askText('显示名称（如"协调员"、"研究员"）', id)) || id;

  // 描述
  console.log();
  const description = await askText(
    '能力描述（简洁说明此 Agent 擅长做什么，供其他 Agent 委托时参考）', '',
  );

  // System Prompt
  console.log();
  console.log('  System Prompt（定义角色与行为边界，支持多行，输入空行结束）：');
  const sysLines: string[] = [];
  while (true) {
    const line = await askText('  > ', '');
    if (line === '' && sysLines.length > 0) break;
    if (line === '') continue; // 至少一行
    sysLines.push(line);
  }
  const system = sysLines.join('\n');

  // 首选模型
  console.log();
  const modelIds = cfg.models.map(m => m.id);
  let model: string | undefined;
  if (modelIds.length > 1) {
    const choices = [
      { label: '（使用全局主模型）', value: '' },
      ...modelIds.map(id => ({ label: id, value: id })),
    ];
    const picked  = await selectOne('首选模型（此 Agent 默认使用的模型）', choices);
    if (picked) model = picked;
  } else {
    console.log('  首选模型：（只有一个模型，使用全局主模型）');
  }

  // 是否为主 Agent
  console.log();
  const hasPrimary = agents.some(a => a.primary);
  const isPrimary  = await askConfirm(
    hasPrimary
      ? '是否将此 Agent 设为主 Agent？（当前已有主 Agent，设为主后会取消其他 Agent 的主角色）'
      : '是否将此 Agent 设为主 Agent？（多 Agent 时用户的默认对话对象）',
    !hasPrimary,
  );

  // 技能标签
  console.log();
  const skillsInput = await askText(
    '技能标签（可选，逗号分隔，如 "research,analysis"）', '',
  );
  const skills = skillsInput
    ? skillsInput.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  // 预览
  console.log('\n  ── 预览 ──');
  console.log(`  ID：        ${id}`);
  console.log(`  名称：      ${name}`);
  console.log(`  是否主要：  ${isPrimary ? '是（★）' : '否'}`);
  if (model) console.log(`  首选模型：  ${model}`);
  console.log(`  描述：      ${description || '（未填写）'}`);
  if (skills && skills.length > 0) console.log(`  技能标签：  ${skills.join(', ')}`);
  console.log(`\n  System Prompt：`);
  console.log(system.split('\n').map(l => '    ' + l).join('\n'));
  console.log();

  const confirmed = await askConfirm('保存此 Agent？', true);
  if (!confirmed) { console.log('  已取消\n'); closeWizard(); return; }

  // 如果设为主 Agent，取消其他的 primary 标记
  if (isPrimary) {
    for (const a of agents) { a.primary = false; }
  }

  const newAgent: AgentConfig = { id, name, description: description || name, system };
  if (model) newAgent.model = model;
  if (isPrimary) newAgent.primary = true;
  if (skills && skills.length > 0) newAgent.skills = skills;

  agents.push(newAgent);
  await saveConfig(cfg);

  ok(`Agent "${name}"（${id}）已保存到配置文件`);
  console.log(`\n  在对话中使用：/agent ${id} [消息]\n`);
  closeWizard();
}

// ─── 子命令：edit ─────────────────────────────────────────────────────────────

async function cmdEdit(id: string): Promise<void> {
  const cfg   = await requireConfig();
  const agents = ensureAgents(cfg);
  const idx   = agents.findIndex(a => a.id === id);
  if (idx < 0) {
    fail(`找不到 Agent "${id}"，运行 pnpm bcc-agent list 查看所有 Agent`);
    process.exit(1);
  }
  const agent = agents[idx]!;

  printHeader(VERSION);
  console.log(`  编辑 Agent：${id}（回车保持当前值）\n`);

  const name        = (await askText('显示名称', agent.name)) || agent.name;
  console.log();
  const description = (await askText('能力描述', agent.description)) || agent.description;

  console.log(`\n  当前 System Prompt：\n${agent.system.split('\n').map(l => '    ' + l).join('\n')}`);
  const changeSystem = await askConfirm('\n  是否修改 System Prompt？', false);
  let system = agent.system;
  if (changeSystem) {
    console.log('  输入新 System Prompt（输入空行结束）：');
    const lines: string[] = [];
    while (true) {
      const line = await askText('  > ', '');
      if (line === '' && lines.length > 0) break;
      if (line === '') continue;
      lines.push(line);
    }
    if (lines.length > 0) system = lines.join('\n');
  }

  const modelIds = cfg.models.map(m => m.id);
  let model = agent.model;
  if (modelIds.length > 1) {
    console.log();
    const choices = [
      { label: '（使用全局主模型）', value: '' },
      ...modelIds.map(id => ({ label: id, value: id })),
    ];
    const picked = await selectOne(`首选模型（当前：${agent.model ?? '全局主模型'}）`, choices);
    model = picked || undefined;
  }

  console.log();
  const save = await askConfirm('保存更改？', true);
  if (!save) { warn('已取消，Agent 未修改'); closeWizard(); return; }

  agents[idx] = { ...agent, name, description, system, ...(model ? { model } : {}) };
  if (!model && 'model' in agents[idx]!) delete agents[idx]!.model;
  await saveConfig(cfg);
  ok(`Agent "${id}" 已更新`);
  closeWizard();
}

// ─── 子命令：delete ───────────────────────────────────────────────────────────

async function cmdDelete(id: string): Promise<void> {
  const cfg    = await requireConfig();
  const agents = ensureAgents(cfg);
  const idx    = agents.findIndex(a => a.id === id);
  if (idx < 0) {
    fail(`找不到 Agent "${id}"`);
    process.exit(1);
  }
  const agent = agents[idx]!;

  console.log(`\n  准备删除 Agent "${agent.name}"（${id}）：${agent.description}\n`);
  const confirmed = await askConfirm('确认删除？', false);
  if (!confirmed) { console.log('  已取消\n'); closeWizard(); return; }

  agents.splice(idx, 1);

  // 若删除的是主 Agent 且还有其他 Agent，自动将第一个设为主
  if (agent.primary && agents.length > 0) {
    agents[0]!.primary = true;
    warn(`已将 "${agents[0]!.name}"（${agents[0]!.id}）自动设为主 Agent`);
  }

  await saveConfig(cfg);
  ok(`Agent "${id}" 已删除`);
  closeWizard();
}

// ─── 子命令：set-primary ──────────────────────────────────────────────────────

async function cmdSetPrimary(id: string): Promise<void> {
  const cfg    = await requireConfig();
  const agents = ensureAgents(cfg);
  const target = agents.find(a => a.id === id);
  if (!target) {
    fail(`找不到 Agent "${id}"`);
    process.exit(1);
  }

  for (const a of agents) { a.primary = a.id === id; }
  await saveConfig(cfg);
  ok(`已将 "${target.name}"（${id}）设为主 Agent`);
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [subcmd, ...rest] = process.argv.slice(2);

  switch (subcmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    case 'list':
      await cmdList();
      break;

    case 'show':
      if (!rest[0]) { fail('用法：pnpm bcc-agent show <id>'); process.exit(1); }
      await cmdShow(rest[0]);
      break;

    case 'add':
      await cmdAdd();
      break;

    case 'edit':
      if (!rest[0]) { fail('用法：pnpm bcc-agent edit <id>'); process.exit(1); }
      await cmdEdit(rest[0]);
      break;

    case 'delete':
    case 'rm':
    case 'remove':
      if (!rest[0]) { fail('用法：pnpm bcc-agent delete <id>'); process.exit(1); }
      await cmdDelete(rest[0]);
      break;

    case 'set-primary':
    case 'primary':
      if (!rest[0]) { fail('用法：pnpm bcc-agent set-primary <id>'); process.exit(1); }
      await cmdSetPrimary(rest[0]);
      break;

    default:
      fail(`未知子命令 "${subcmd}"，运行 pnpm bcc-agent help 查看帮助`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('\n  错误：' + (err instanceof Error ? err.message : String(err)));
  closeWizard();
  process.exit(1);
});
