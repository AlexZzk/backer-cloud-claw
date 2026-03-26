# Cloud Office 路线图

## M0 - 初始化（1 周）

- 新仓库初始化
- 文档落地（章程、架构、接口）
- 规范：lint/test/commit 约定

## M1 - Scene Runtime MVP（1~2 周）

- `office-template`
- `/api/scenes/:id/presence`
- 前端地图+Avatar渲染
- 轮询刷新

## M2 - 实时化（1 周）

- `/api/scenes/:id/events` SSE
- 增量更新与去抖
- 房间聚合展示

## M3 - 模板扩展（1 周）

- 新增 `game-studio-template`
- 验证规则可复用

## M4 - 资产化试点（1 周+）

- `AssetBinding` UI 展示
- ownership mock 数据
- 资产查询接口

