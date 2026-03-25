# Cloud Office 文档包（迁移版）

> 目标仓库：`https://github.com/AlexZzk/cloud_office.git`
> 生成日期：2026-03-25

该目录用于把 `backer-cloud-claw` 中与“空间化 Worker（Cloud Office / Scene Runtime）”相关的规划与背景文档进行整理，并作为新仓库初始化文档集。

## 文档结构

- `01-project-charter.md`：新仓库项目章程（愿景、范围、非目标）
- `02-architecture-plan.md`：架构规划（Scene Runtime、API、模块拆分）
- `03-roadmap.md`：里程碑计划（M0-M4）
- `04-doc-inventory.md`：原仓库 docs 全量盘点与迁移建议
- `05-repo-migration.md`：迁移执行说明（含推送失败记录与后续操作）

## 迁移原则

1. **能力切分**：`backer-cloud-claw` 保持通用 Agent SDK；`cloud_office` 专注空间化可视化与资产化扩展。
2. **接口优先**：通过 HTTP/SSE 协议对接，避免反向耦合。
3. **模板化场景**：办公室只是默认模板，支持游戏、工厂、创作工作室等模板。
4. **资产兼容**：预留 `AssetBinding` / `AssetProvider`，不在首期绑定链上 SDK。

