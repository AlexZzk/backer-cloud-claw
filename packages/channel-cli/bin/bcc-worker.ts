#!/usr/bin/env node
/**
 * bcc worker — 员工（Worker）管理工具
 *
 * Worker 配置保存在 ~/.bcc/config.json 的 workers 字段中。
 * 每个 Worker = 一个模型实例 + 一个身份（名称/角色）+ 一组技能标签。
 *
 * 子命令：
 *   list                  列出所有员工
 *   show <id>             查看员工详情
 *   add                   交互式创建新员工
 *   edit <id>             编辑已有员工
 *   delete <id>           删除员工
 *   set-primary <id>      设置默认员工（对话时不指定 --worker 参数时使用）
 */

import {
  loadConfig,
  saveConfig,
  makeDefaultConfig,
  type WorkerConfig,
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
bcc worker — 员工（Worker）管理工具 v${VERSION}

用法：
  pnpm bcc-worker [子命令] [参数]

子命令：
  list                  列出所有已配置的员工
  show <id>             查看员工详情（含 System Prompt）
  add                   交互式创建新员工
  edit <id>             编辑已有员工配置
  delete <id>           删除员工
  set-primary <id>      设置为默认员工（不指定 --worker 时的对话对象）

用法示例：
  pnpm bcc-worker list
  pnpm bcc-worker add
  pnpm bcc-worker show coder
  pnpm bcc-worker edit writer
  pnpm bcc-worker delete researcher
  pnpm bcc-worker set-primary coder

配置文件位置：
  ${CONFIG_PATH}

在对话中使用：
  /workers              列出所有员工及 Token 消耗统计
  /worker <id>          切换到指定员工
  /worker <id> <消息>   向指定员工发送一次消息（不切换）

对话启动：
  pnpm bcc-chat                    使用默认员工
  pnpm bcc-chat --worker coder     直接与 coder 员工对话
`);
}

// ─── 辅助 ─────────────────────────────────────────────────────────────────────

async function requireConfig(): Promise<BccConfig> {
  const cfg = await loadConfig();
  if (!cfg) {
    fail('未找到配置文件，请先运行 pnpm bcc-init 初始化');
    process.exit(1);
  }
  return cfg;
}

function ensureWorkers(cfg: BccConfig): WorkerConfig[] {
  if (!cfg.workers) cfg.workers = [];
  return cfg.workers;
}

// ─── 子命令：list ─────────────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
  const cfg     = await requireConfig();
  const workers = cfg.workers ?? [];

  if (workers.length === 0) {
    console.log('\n  （尚未配置任何员工）');
    console.log('  运行 pnpm bcc-worker add 创建第一位员工\n');
    return;
  }

  console.log(`\n  员工列表（共 ${workers.length} 位）\n`);
  for (const w of workers) {
    const primary = w.primary ? ' [默认]' : '';
    console.log(`  ${w.primary ? '★' : ' '} ${w.id.padEnd(18)} ${w.name}${primary}  [${w.modelId}]`);
    console.log(`      ${w.description || '（无描述）'}`);
    if (w.skills.length > 0) {
      console.log(`      技能：${w.skills.join('、')}`);
    }
  }
  console.log(`\n  配置文件：${CONFIG_PATH}`);
  console.log(`  启动对话：pnpm bcc-chat  |  指定员工：pnpm bcc-chat --worker <id>\n`);
}

// ─── 子命令：show ─────────────────────────────────────────────────────────────

async function cmdShow(id: string): Promise<void> {
  const cfg    = await requireConfig();
  const worker = (cfg.workers ?? []).find(w => w.id === id);
  if (!worker) {
    fail(`找不到员工 "${id}"，运行 pnpm bcc-worker list 查看所有员工`);
    process.exit(1);
  }

  console.log(`\n  ── 员工：${worker.id} ──`);
  console.log(`  显示名称：  ${worker.name}`);
  console.log(`  是否默认：  ${worker.primary ? '是（★）' : '否'}`);
  console.log(`  使用模型：  ${worker.modelId}`);
  console.log(`  描述：      ${worker.description || '（未填写）'}`);
  console.log(`  技能标签：  ${worker.skills.length > 0 ? worker.skills.join('、') : '（未填写）'}`);
  console.log(`\n  System Prompt（角色设定）：`);
  console.log(worker.role.split('\n').map(l => '    ' + l).join('\n'));
  console.log();
}

// ─── 子命令：add ──────────────────────────────────────────────────────────────

async function cmdAdd(): Promise<void> {
  const cfg     = await loadConfig() ?? makeDefaultConfig();
  const workers = ensureWorkers(cfg);

  if (cfg.models.length === 0) {
    fail('尚未配置任何模型实例，请先运行 pnpm bcc-init 初始化');
    process.exit(1);
  }

  printHeader(VERSION);
  console.log('  创建新员工\n');

  // ── ID ──
  let id = '';
  while (!id) {
    id = await askText('员工 ID（小写字母/数字/连字符，如 coder、writer、pm）', '');
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      warn('ID 必须以小写字母开头，只含小写字母/数字/连字符'); id = ''; continue;
    }
    if (workers.some(w => w.id === id)) {
      warn(`ID "${id}" 已存在，请选择其他 ID`); id = ''; continue;
    }
  }

  // ── 显示名称 ──
  console.log();
  const name = (await askText('显示名称（如"代码工程师 Claude"、"文案策划 Qwen"）', id)) || id;

  // ── 绑定模型 ──
  console.log();
  let modelId = '';
  if (cfg.models.length === 1) {
    modelId = cfg.models[0]!.id;
    console.log(`  绑定模型：${modelId}（只有一个模型实例）`);
  } else {
    const choices = cfg.models.map(m => ({
      label: `${m.id}  (${m.provider}${m.model ? ' · ' + m.model : ''})`,
      value: m.id,
    }));
    modelId = (await selectOne('绑定模型实例（此员工使用哪个模型对话）', choices)) ?? cfg.models[0]!.id;
  }

  // ── System Prompt（角色设定）──
  console.log();
  console.log('  System Prompt — 角色设定（定义员工身份、职责、行为边界）');
  console.log('  例如："你是一位专注后端开发的工程师，擅长 TypeScript 和数据库设计，...'  );
  console.log('        回答时简洁直接，代码注重可读性和类型安全。"');
  console.log('  （支持多行，输入空行结束）\n');

  const roleLines: string[] = [];
  while (true) {
    const line = await askText('  > ', '');
    if (line === '' && roleLines.length > 0) break;
    if (line === '') continue;
    roleLines.push(line);
  }
  const role = roleLines.join('\n');

  // ── 技能标签 ──
  console.log();
  const skillsInput = await askText(
    '技能标签（逗号分隔，如"编写代码,代码审查,架构设计"，可留空）', '',
  );
  const skills = skillsInput
    ? skillsInput.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // ── 描述 ──
  console.log();
  const description = await askText(
    '能力描述（一句话说明此员工能做什么，供 /workers 展示，可留空）', '',
  );

  // ── 是否默认员工 ──
  console.log();
  const hasPrimary = workers.some(w => w.primary);
  const isPrimary  = await askConfirm(
    hasPrimary
      ? '是否设为默认员工？（当前已有默认员工，设置后会替换）'
      : '是否设为默认员工？（bcc-chat 时不指定 --worker 则默认与此员工对话）',
    !hasPrimary,
  );

  // ── 预览 ──
  console.log('\n  ── 预览 ──');
  console.log(`  ID：        ${id}`);
  console.log(`  名称：      ${name}`);
  console.log(`  模型：      ${modelId}`);
  console.log(`  默认：      ${isPrimary ? '是（★）' : '否'}`);
  if (description) console.log(`  描述：      ${description}`);
  if (skills.length > 0) console.log(`  技能：      ${skills.join('、')}`);
  console.log(`\n  System Prompt：`);
  console.log(role.split('\n').map(l => '    ' + l).join('\n'));
  console.log();

  const confirmed = await askConfirm('保存此员工配置？', true);
  if (!confirmed) { console.log('  已取消\n'); closeWizard(); return; }

  // 取消其他员工的 primary 标记
  if (isPrimary) {
    for (const w of workers) { w.primary = false; }
  }

  const newWorker: WorkerConfig = {
    id,
    name,
    role,
    skills,
    description: description || name,
    modelId,
    ...(isPrimary && { primary: true }),
  };

  workers.push(newWorker);
  await saveConfig(cfg);

  ok(`员工 "${name}"（${id}）已保存`);
  console.log(`\n  开始对话：pnpm bcc-chat --worker ${id}`);
  console.log(`  或对话中：/worker ${id}\n`);
  closeWizard();
}

// ─── 子命令：edit ─────────────────────────────────────────────────────────────

async function cmdEdit(id: string): Promise<void> {
  const cfg     = await requireConfig();
  const workers = ensureWorkers(cfg);
  const idx     = workers.findIndex(w => w.id === id);
  if (idx < 0) {
    fail(`找不到员工 "${id}"，运行 pnpm bcc-worker list 查看所有员工`);
    process.exit(1);
  }
  const worker = workers[idx]!;

  printHeader(VERSION);
  console.log(`  编辑员工：${id}（回车保持当前值）\n`);

  const name = (await askText(`显示名称（当前：${worker.name}）`, worker.name)) || worker.name;

  // 绑定模型
  console.log();
  let modelId = worker.modelId;
  if (cfg.models.length > 1) {
    const choices = cfg.models.map(m => ({
      label: `${m.id}  (${m.provider}${m.model ? ' · ' + m.model : ''})${m.id === worker.modelId ? '  ← 当前' : ''}`,
      value: m.id,
    }));
    modelId = (await selectOne('绑定模型实例', choices)) ?? worker.modelId;
  } else {
    console.log(`  绑定模型：${modelId}（只有一个模型实例）`);
  }

  // System Prompt
  console.log(`\n  当前 System Prompt：\n${worker.role.split('\n').map(l => '    ' + l).join('\n')}`);
  const changeRole = await askConfirm('\n  是否修改 System Prompt？', false);
  let role = worker.role;
  if (changeRole) {
    console.log('  输入新 System Prompt（输入空行结束）：');
    const lines: string[] = [];
    while (true) {
      const line = await askText('  > ', '');
      if (line === '' && lines.length > 0) break;
      if (line === '') continue;
      lines.push(line);
    }
    if (lines.length > 0) role = lines.join('\n');
  }

  // 技能标签
  console.log();
  const currentSkills = worker.skills.join(',');
  const skillsInput = await askText(
    `技能标签（当前：${currentSkills || '（空）'}，逗号分隔）`, currentSkills,
  );
  const skills = skillsInput
    ? skillsInput.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // 描述
  console.log();
  const description = (await askText(`描述（当前：${worker.description}）`, worker.description)) || worker.description;

  console.log();
  const save = await askConfirm('保存更改？', true);
  if (!save) { warn('已取消，员工配置未修改'); closeWizard(); return; }

  workers[idx] = { ...worker, name, modelId, role, skills, description };
  await saveConfig(cfg);
  ok(`员工 "${id}" 已更新`);
  closeWizard();
}

// ─── 子命令：delete ───────────────────────────────────────────────────────────

async function cmdDelete(id: string): Promise<void> {
  const cfg     = await requireConfig();
  const workers = ensureWorkers(cfg);
  const idx     = workers.findIndex(w => w.id === id);
  if (idx < 0) {
    fail(`找不到员工 "${id}"`);
    process.exit(1);
  }
  const worker = workers[idx]!;

  console.log(`\n  准备删除员工 "${worker.name}"（${id}）\n`);
  const confirmed = await askConfirm('确认删除？此操作不可撤销', false);
  if (!confirmed) { console.log('  已取消\n'); closeWizard(); return; }

  workers.splice(idx, 1);

  if (worker.primary && workers.length > 0) {
    workers[0]!.primary = true;
    warn(`已自动将 "${workers[0]!.name}"（${workers[0]!.id}）设为默认员工`);
  }

  await saveConfig(cfg);
  ok(`员工 "${id}" 已删除`);
  closeWizard();
}

// ─── 子命令：set-primary ──────────────────────────────────────────────────────

async function cmdSetPrimary(id: string): Promise<void> {
  const cfg     = await requireConfig();
  const workers = ensureWorkers(cfg);
  const target  = workers.find(w => w.id === id);
  if (!target) {
    fail(`找不到员工 "${id}"`);
    process.exit(1);
  }

  for (const w of workers) { w.primary = w.id === id; }
  await saveConfig(cfg);
  ok(`已将 "${target.name}"（${id}）设为默认员工`);
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
      if (!rest[0]) { fail('用法：pnpm bcc-worker show <id>'); process.exit(1); }
      await cmdShow(rest[0]);
      break;

    case 'add':
      await cmdAdd();
      break;

    case 'edit':
      if (!rest[0]) { fail('用法：pnpm bcc-worker edit <id>'); process.exit(1); }
      await cmdEdit(rest[0]);
      break;

    case 'delete':
    case 'rm':
    case 'remove':
      if (!rest[0]) { fail('用法：pnpm bcc-worker delete <id>'); process.exit(1); }
      await cmdDelete(rest[0]);
      break;

    case 'set-primary':
    case 'primary':
      if (!rest[0]) { fail('用法：pnpm bcc-worker set-primary <id>'); process.exit(1); }
      await cmdSetPrimary(rest[0]);
      break;

    default:
      fail(`未知子命令 "${subcmd}"，运行 pnpm bcc-worker help 查看帮助`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('\n  错误：' + (err instanceof Error ? err.message : String(err)));
  closeWizard();
  process.exit(1);
});
