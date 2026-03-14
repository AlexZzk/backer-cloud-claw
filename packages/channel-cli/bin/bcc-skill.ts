#!/usr/bin/env node
/**
 * bcc skill — 技能管理工具
 *
 * 子命令：
 *   list                  列出所有技能（内置 + 用户 + 项目）
 *   show <name>           查看技能详情
 *   add                   交互式创建新技能
 *   edit <name>           编辑已有用户技能
 *   delete <name>         删除用户技能
 *   test <name> [input]   在终端快速测试技能提示词展开效果
 */

import {
  SkillRegistry,
  expandSkill,
  skillNeedsInput,
  saveUserSkill,
  deleteUserSkill,
  loadUserSkill,
  validateSkillName,
  USER_SKILLS_DIR,
  SkillHub,
  type Skill,
} from '@bcc/skills';
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
bcc skill — 技能管理工具 v${VERSION}

用法：
  pnpm bcc-skill [子命令] [参数]

子命令：
  list                  列出所有技能（内置 + 用户 + 项目）
  show <名称>           查看技能详情和提示词
  add                   交互式创建新用户技能
  edit <名称>           编辑已有用户技能
  delete <名称>         删除用户技能
  test <名称> [内容]    预览技能提示词展开效果（不发送给模型）
  search <关键词>       在 SkillHub 搜索技能
  install <名称>        从 SkillHub 安装技能到本地
  publish <名称>        发布本地技能到 SkillHub（需要 BCC_HUB_TOKEN）

用法示例：
  pnpm bcc-skill list
  pnpm bcc-skill add
  pnpm bcc-skill show summarize
  pnpm bcc-skill edit my-skill
  pnpm bcc-skill delete my-skill
  pnpm bcc-skill test summarize "这是一段测试文本"
  pnpm bcc-skill search 翻译
  pnpm bcc-skill install translate-en
  pnpm bcc-skill publish my-skill

技能存储位置：
  用户技能：~/.bcc/skills/<name>.json
  项目技能：./.bcc/skills/<name>.json（优先级最高）

在对话中使用：
  /skills            列出所有技能
  /skill <名称> [内容]  执行技能
`);
}

// ─── 子命令：list ─────────────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
  const reg = await SkillRegistry.load();
  const list = reg.list();
  const stats = reg.stats();

  console.log(`\n  技能列表（内置 ${stats.builtin} / 用户 ${stats.user} / 项目 ${stats.project}）\n`);

  let lastSource = '';
  for (const s of list) {
    const src = s.source ?? 'builtin';
    if (src !== lastSource) {
      const label = src === 'builtin' ? '内置（只读）' : src === 'user' ? '用户自定义' : '项目';
      console.log(`  ── ${label} ──`);
      lastSource = src;
    }
    const sysTag = s.system ? ' [覆盖 system]' : '';
    const tag    = src === 'builtin' ? '' : ` [${src}]`;
    console.log(`    ${s.name.padEnd(20)} ${s.description}${sysTag}${tag}`);
  }

  console.log(`\n  技能存储目录：${USER_SKILLS_DIR}\n`);
}

// ─── 子命令：show ─────────────────────────────────────────────────────────────

async function cmdShow(name: string): Promise<void> {
  const reg = await SkillRegistry.load();
  const skill = reg.find(name);
  if (!skill) {
    fail(`找不到技能 "${name}"，运行 pnpm bcc-skill list 查看所有技能`);
    process.exit(1);
  }

  console.log(`\n  ── 技能：${skill.name} ──`);
  console.log(`  来源：      ${skill.source ?? 'builtin'}`);
  console.log(`  描述：      ${skill.description}`);
  console.log(`  需要输入：  ${skillNeedsInput(skill) ? '是（含 {input} 占位符）' : '否'}`);
  if (skill.system) {
    console.log(`\n  System Prompt 覆盖：`);
    console.log(skill.system.split('\n').map(l => '    ' + l).join('\n'));
  }
  console.log(`\n  Prompt 模板：`);
  console.log(skill.prompt.split('\n').map(l => '    ' + l).join('\n'));
  console.log();
}

// ─── 子命令：add ──────────────────────────────────────────────────────────────

async function cmdAdd(): Promise<void> {
  printHeader(VERSION);
  console.log('  创建新用户技能\n');

  // 名称
  let name = '';
  while (!name) {
    name = await askText('技能名称（小写字母、数字、连字符）', '');
    const err = validateSkillName(name);
    if (err) { warn(err); name = ''; continue; }

    // 检查是否已存在
    const reg = await SkillRegistry.load();
    const existing = reg.find(name);
    if (existing) {
      if (existing.source === 'builtin') {
        warn(`"${name}" 是内置技能，用户技能可以覆盖它（同名覆盖）。继续？`);
        const ok2 = await askConfirm('  继续使用此名称？', true);
        if (!ok2) { name = ''; continue; }
      } else {
        warn(`"${name}" 已存在，继续将覆盖现有技能。`);
        const ok2 = await askConfirm('  覆盖？', false);
        if (!ok2) { name = ''; continue; }
      }
    }
  }

  // 描述
  console.log();
  const description = await askText('一句话描述（显示在 /skills 列表中）', '');

  // 提示词模板
  console.log();
  console.log('  提示词模板（用 {input} 表示用户输入的位置，支持多行，输入空行结束）：');
  const lines: string[] = [];
  while (true) {
    const line = await askText('  > ', '');
    if (line === '' && lines.length > 0) break;
    lines.push(line);
  }
  const prompt = lines.join('\n');

  if (!prompt.trim()) { warn('提示词不能为空，已取消。'); closeWizard(); return; }

  // System Prompt（可选）
  console.log();
  const wantSystem = await askConfirm('是否设置 system prompt 覆盖？（可选，用于临时切换角色）', false);
  let system = '';
  if (wantSystem) {
    console.log('  输入 system prompt（输入空行结束）：');
    const sysLines: string[] = [];
    while (true) {
      const line = await askText('  > ', '');
      if (line === '' && sysLines.length > 0) break;
      sysLines.push(line);
    }
    system = sysLines.join('\n');
  }

  // 预览
  console.log('\n  ── 预览 ──');
  console.log(`  名称：      ${name}`);
  console.log(`  描述：      ${description || '（未填写）'}`);
  if (skillNeedsInput({ name, description, prompt })) {
    const preview = expandSkill({ name, description, prompt }, '← 这里是用户输入 →');
    console.log(`  展开效果：\n${preview.split('\n').map(l => '    ' + l).join('\n')}`);
  } else {
    console.log(`  提示词：\n${prompt.split('\n').map(l => '    ' + l).join('\n')}`);
  }
  console.log();

  const confirmed = await askConfirm('保存此技能？', true);
  if (!confirmed) { console.log('  已取消。\n'); closeWizard(); return; }

  const skill: Omit<Skill, 'source'> = { name, description, prompt };
  if (system) skill.system = system;
  await saveUserSkill(skill);
  ok(`技能 "${name}" 已保存至 ${USER_SKILLS_DIR}/${name}.json`);
  console.log(`\n  在对话中使用：${skillNeedsInput(skill) ? `/skill ${name} <内容>` : `/skill ${name}`}\n`);
  closeWizard();
}

// ─── 子命令：edit ─────────────────────────────────────────────────────────────

async function cmdEdit(name: string): Promise<void> {
  const existing = await loadUserSkill(name);
  if (!existing) {
    fail(`找不到用户技能 "${name}"（内置技能不可编辑）`);
    console.log('  提示：运行 pnpm bcc-skill add 创建同名技能以覆盖内置技能\n');
    process.exit(1);
  }

  printHeader(VERSION);
  console.log(`  编辑技能：${name}（回车保持当前值）\n`);

  const description = await askText('描述', existing.description);

  console.log(`\n  当前提示词：\n${existing.prompt.split('\n').map(l => '    ' + l).join('\n')}`);
  const changePrompt = await askConfirm('\n  是否修改提示词？', false);
  let prompt = existing.prompt;
  if (changePrompt) {
    console.log('  输入新提示词（支持多行，输入空行结束）：');
    const lines: string[] = [];
    while (true) {
      const line = await askText('  > ', '');
      if (line === '' && lines.length > 0) break;
      lines.push(line);
    }
    if (lines.length > 0) prompt = lines.join('\n');
  }

  const changeSystem = await askConfirm('\n  是否修改 system prompt？', false);
  let system = existing.system ?? '';
  if (changeSystem) {
    if (system) console.log(`  当前：${system}`);
    console.log('  输入新 system prompt（留空=删除，输入空行结束）：');
    const sysLines: string[] = [];
    while (true) {
      const line = await askText('  > ', '');
      if (line === '' && sysLines.length === 0) break;
      if (line === '') break;
      sysLines.push(line);
    }
    system = sysLines.join('\n');
  }

  console.log();
  const save = await askConfirm('保存更改？', true);
  if (!save) { warn('已取消，技能未修改'); closeWizard(); return; }

  const updated: Omit<Skill, 'source'> = { name, description: description || existing.description, prompt };
  if (system) updated.system = system;
  await saveUserSkill(updated);
  ok(`技能 "${name}" 已更新`);
  closeWizard();
}

// ─── 子命令：delete ───────────────────────────────────────────────────────────

async function cmdDelete(name: string): Promise<void> {
  const existing = await loadUserSkill(name);
  if (!existing) {
    fail(`找不到用户技能 "${name}"（内置技能不可删除）`);
    process.exit(1);
  }

  console.log(`\n  准备删除技能 "${name}"：${existing.description}\n`);
  const confirmed = await askConfirm('确认删除？', false);
  if (!confirmed) { console.log('  已取消\n'); closeWizard(); return; }

  await deleteUserSkill(name);
  ok(`技能 "${name}" 已删除`);
  closeWizard();
}

// ─── 子命令：test ─────────────────────────────────────────────────────────────

async function cmdTest(name: string, inlineInput: string): Promise<void> {
  const reg = await SkillRegistry.load();
  const skill = reg.find(name);
  if (!skill) {
    fail(`找不到技能 "${name}"`);
    process.exit(1);
  }

  let input = inlineInput;
  if (skillNeedsInput(skill) && !input) {
    input = await askText('输入内容（用于替换 {input}）', '');
  }

  const expanded = expandSkill(skill, input);
  console.log(`\n  ── 技能：${skill.name} ──`);
  console.log(`  来源：${skill.source ?? 'builtin'}`);
  if (skill.system) {
    console.log(`\n  System Prompt：\n${skill.system.split('\n').map(l => '    ' + l).join('\n')}`);
  }
  console.log(`\n  展开后的提示词：\n`);
  console.log(expanded.split('\n').map(l => '  ' + l).join('\n'));
  console.log();
  closeWizard();
}

// ─── 子命令：search ───────────────────────────────────────────────────────────

async function cmdSearch(query: string): Promise<void> {
  console.log(`\n  正在搜索 SkillHub：${query}…\n`);
  let skills;
  try {
    const hub = new SkillHub();
    skills = await hub.search(query);
  } catch (err) {
    fail(`搜索失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (skills.length === 0) {
    console.log('  没有找到匹配的技能。\n');
    return;
  }

  console.log(`  找到 ${skills.length} 个技能：\n`);
  for (const s of skills) {
    const meta: string[] = [];
    if (s.author)    meta.push(`作者：${s.author}`);
    if (s.downloads !== undefined) meta.push(`下载：${s.downloads}`);
    if (s.tags?.length) meta.push(`标签：${s.tags.join(', ')}`);
    console.log(`    ${s.name.padEnd(22)} ${s.description}`);
    if (meta.length > 0) console.log(`    ${''.padEnd(22)} ${meta.join('  ')}`);
  }
  console.log(`\n  安装：pnpm bcc-skill install <名称>\n`);
}

// ─── 子命令：install ──────────────────────────────────────────────────────────

async function cmdInstall(name: string): Promise<void> {
  console.log(`\n  正在从 SkillHub 安装技能 "${name}"…\n`);
  let hubSkill;
  try {
    const hub = new SkillHub();
    hubSkill = await hub.install(name);
  } catch (err) {
    fail(`安装失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  ok(`技能 "${hubSkill.name}" 已安装至 ${USER_SKILLS_DIR}/${hubSkill.name}.json`);
  console.log(`  描述：${hubSkill.description}`);
  console.log(`\n  使用：${skillNeedsInput(hubSkill) ? `/skill ${hubSkill.name} <内容>` : `/skill ${hubSkill.name}`}\n`);
}

// ─── 子命令：publish ──────────────────────────────────────────────────────────

async function cmdPublish(name: string): Promise<void> {
  const existing = await loadUserSkill(name);
  if (!existing) {
    fail(`找不到用户技能 "${name}"（只能发布用户自定义技能，内置技能不可发布）`);
    process.exit(1);
  }

  const token = process.env['BCC_HUB_TOKEN'];
  if (!token) {
    fail('未设置 BCC_HUB_TOKEN 环境变量。请访问 https://hub.bcc.dev 注册并获取 Token。');
    console.log('  用法：BCC_HUB_TOKEN=<token> pnpm bcc-skill publish <名称>\n');
    process.exit(1);
  }

  console.log(`\n  准备发布技能 "${name}" 到 SkillHub…`);
  console.log(`  描述：${existing.description}\n`);

  const confirmed = await askConfirm('确认发布？', true);
  if (!confirmed) { console.log('  已取消。\n'); closeWizard(); return; }

  try {
    const hub = new SkillHub();
    await hub.publish(existing, token);
    ok(`技能 "${name}" 已成功发布到 SkillHub！`);
    console.log(`\n  其他用户可通过以下命令安装：pnpm bcc-skill install ${name}\n`);
  } catch (err) {
    fail(`发布失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  closeWizard();
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
      if (!rest[0]) { fail('用法：pnpm bcc-skill show <名称>'); process.exit(1); }
      await cmdShow(rest[0]);
      break;

    case 'add':
      await cmdAdd();
      break;

    case 'edit':
      if (!rest[0]) { fail('用法：pnpm bcc-skill edit <名称>'); process.exit(1); }
      await cmdEdit(rest[0]);
      break;

    case 'delete':
    case 'rm':
    case 'remove':
      if (!rest[0]) { fail('用法：pnpm bcc-skill delete <名称>'); process.exit(1); }
      await cmdDelete(rest[0]);
      break;

    case 'test':
      if (!rest[0]) { fail('用法：pnpm bcc-skill test <名称> [内容]'); process.exit(1); }
      await cmdTest(rest[0], rest.slice(1).join(' '));
      break;

    case 'search':
      if (!rest[0]) { fail('用法：pnpm bcc-skill search <关键词>'); process.exit(1); }
      await cmdSearch(rest.join(' '));
      break;

    case 'install':
      if (!rest[0]) { fail('用法：pnpm bcc-skill install <名称>'); process.exit(1); }
      await cmdInstall(rest[0]);
      break;

    case 'publish':
      if (!rest[0]) { fail('用法：pnpm bcc-skill publish <名称>'); process.exit(1); }
      await cmdPublish(rest[0]);
      break;

    default:
      fail(`未知子命令 "${subcmd}"，运行 pnpm bcc-skill help 查看帮助`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('\n  错误：' + (err instanceof Error ? err.message : String(err)));
  closeWizard();
  process.exit(1);
});
