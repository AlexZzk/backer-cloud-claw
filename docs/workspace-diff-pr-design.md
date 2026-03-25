# 工作空间文件对比 & PR 合并 — 设计文档

> 状态：规划中，待确认后实施

## 背景与目标

Worker 在自己的工作空间（`~/.bcc/workspaces/{workerId}/`）完成代码开发后，需要一套类似 GitHub PR 的机制，将改动合并到共享目录（`~/.bcc/shared/`），供其他 Worker 只读访问。

核心需求：
- 查看工作空间与共享目录之间的文件差异（新增 / 修改 / 删除）
- 逐文件查看 unified diff（哪些行被增加、删除）
- 通过 PR 流程将工作空间文件合并到共享目录

类比关系：
```
Worker 工作空间  ←→  feature branch
共享目录         ←→  main branch
PR 合并          ←→  merge PR
```

---

## 功能模块

### 1. 差异计算

比较 Worker 工作空间与共享目录之间的文件状态：

| 状态 | 条件 |
|------|------|
| `added` | 工作空间有，共享目录没有 |
| `modified` | 两边都有，内容不同 |
| `deleted` | 共享目录有，工作空间没有（Worker 删除了该文件） |
| `unchanged` | 内容完全相同（不展示） |

Diff 格式：**unified diff**，通过 shell `diff -u` 命令生成（无需引入额外依赖）。

### 2. PR 数据结构

```typescript
interface WorkspacePR {
  id: string;                              // UUID
  workerId: string;                        // 提交 PR 的 Worker ID
  title: string;                           // PR 标题
  description?: string;                    // PR 描述（可选）
  files: string[];                         // 要合并的文件列表（相对工作空间根）
  status: 'open' | 'merged' | 'closed';
  createdAt: number;                       // Unix 毫秒时间戳
  mergedAt?: number;
  closedAt?: number;
}
```

PR 持久化路径：`~/.bcc/workspace-prs.json`

### 3. Worker 可用工具（AI 侧）

供 Worker AI 主动调用，用于自查改动、创建 PR：

| 工具名 | 说明 |
|--------|------|
| `workspace_diff` | 列出工作空间与共享目录的差异文件摘要（含 +N/-N 行统计） |
| `workspace_diff_file` | 查看某个具体文件的 unified diff 内容 |
| `workspace_pr_create` | 创建 PR（指定 title、description、要合并的文件列表） |
| `workspace_pr_list` | 查看自己名下的 PR 列表及状态 |

这些工具只在 Worker 配置了工作空间工具（`workspace-*`）时注册。

### 4. 后端 API

```
GET  /api/workspace/:workerId/diff           列出所有差异文件（摘要列表）
GET  /api/workspace/:workerId/diff/*         获取某文件的 unified diff 文本

GET  /api/prs                                列出所有 PR（?workerId= 过滤）
GET  /api/prs/:id                            获取 PR 详情（含差异预览）
POST /api/prs                                创建 PR
POST /api/prs/:id/merge                      合并 PR（将文件复制到共享目录）
POST /api/prs/:id/close                      关闭 PR（不合并）
```

### 5. 前端 UI

**入口**：WorkersView Worker 详情页增加「查看差异」按钮 → 跳转到 PR 创建/查看页面。

**PR 列表页**（路由 `/prs`）：
- 显示所有 open PR，含 Worker 名称、标题、涉及文件数、创建时间
- 点击 PR → 进入 PR 详情页

**PR 详情页**：
- 左侧面板：文件列表，每项显示状态徽标（added / modified / deleted）和 +N/-N 行统计
- 右侧面板：选中文件的 unified diff，纯 CSS 高亮（新增行绿色 `+`，删除行红色 `-`，上下文行灰色）
- 底部操作栏：「合并到共享目录」「关闭 PR」按钮（合并后状态变为 merged，不可撤销）

---

## 实现顺序（供参考）

1. **`packages/channel-http/src/workspace.ts`**
   添加 `computeWorkspaceDiff(workerDir, sharedDir, filePath?)` 函数，调用 `diff -u` 生成 unified diff。

2. **`packages/channel-http/src/workspace-pr.ts`**
   PR 的 CRUD 操作：load/save JSON，创建 / 合并 / 关闭 PR，合并时使用 `fs.copyFile`。

3. **`packages/channel-http/src/server.ts`**
   - 注册 `/api/workspace/:workerId/diff` 路由
   - 注册 `/api/prs` CRUD 路由
   - 在 `_createWorker` 中为工作空间 Worker 注册 4 个 diff 工具

4. **`packages/web/src/api/client.ts`**
   添加 `WorkspaceDiff`、`WorkspacePR` 类型和 `prsApi`。

5. **`packages/web/src/views/PRsView.vue`**
   PR 列表 + 详情页，含 diff 高亮展示组件。

6. **Router + Nav**
   添加 `/prs` 路由，在侧边栏加入「代码审查」导航项。

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| Diff 算法 | shell `diff -u`，无需引入 npm 依赖 |
| 二进制文件 | 跳过内容 diff，只标注 added/modified/deleted 状态 |
| 大文件 diff | 超过 50 KB 截断，提示用户 |
| 删除文件的 PR | 合并时从共享目录删除对应文件 |
| 版本快照 | PR 不做文件快照，合并时取工作空间当前内容 |
| 并发冲突 | 暂不检测，后续可扩展冲突标记机制 |
| 工具注册条件 | 仅为配置了 `workspace-*` 工具的 Worker 注册 diff 工具 |

---

## 待确认事项

- [ ] PR 的「审核人」概念是否需要？（当前设计：任何人都可以直接合并）
- [ ] 是否需要支持「只合并部分文件」（当前设计：合并时可指定文件子集）
- [ ] diff 比较的基准是否一定是共享目录？还是可以指定某个 Worker 的工作空间作为基准？
- [ ] 文件的删除操作（工作空间没有、共享目录有）是否纳入 PR 流程？
- [ ] 是否需要在 PR 中记录 diff 快照（防止合并前工作空间内容被修改）？
