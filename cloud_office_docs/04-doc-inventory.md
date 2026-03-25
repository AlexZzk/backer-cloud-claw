# 原仓库文档盘点与迁移建议

源仓库：`backer-cloud-claw`

## A. 全量文档盘点

1. `docs/PROJECT_STATUS.md`
   - 内容：项目状态、包结构、已完成能力
   - 建议：迁移“架构背景”片段到新仓库，保留源链接

2. `docs/worker-architecture-v2.md`
   - 内容：Worker/Company 架构设计
   - 建议：作为 Cloud Office 的上游依赖说明保留引用，不整篇迁移

3. `docs/requirements.md`
   - 内容：功能需求汇总
   - 建议：抽取与 scene/presence 相关条目

4. `docs/openclaw-comparison.md`
   - 内容：对比分析
   - 建议：仅保留对“心跳/可视化能力”有用段落

5. `docs/install.md`
   - 内容：安装说明
   - 建议：不迁移（新仓库应自建安装文档）

6. `docs/update.md`
   - 内容：更新说明
   - 建议：不迁移（新仓库将独立维护 changelog）

7. `docs/channel-contribution-guide.md`
   - 内容：渠道贡献规范
   - 建议：不迁移（与 cloud office 关联弱）

8. `docs/virtual-office-planning.md`
   - 内容：空间化场景+资产兼容规划（最新）
   - 建议：核心迁移文档

## B. 新仓库建议首批文档

- `README.md`
- `docs/project-charter.md`
- `docs/architecture/scene-runtime.md`
- `docs/roadmap.md`
- `docs/glossary.md`（scene/zone/entity/presence/asset）

## C. 迁移策略

- 不做“全量复制”，做“按主题抽取 + 源文档索引”。
- 每个迁移文档头部标注来源文件与日期。
- 原仓库保留历史归档作用，新仓库承接后续迭代。

