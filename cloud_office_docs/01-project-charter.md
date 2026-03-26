# Cloud Office 项目章程

## 1. 愿景

构建一个可扩展的 `Scene Runtime`，将 Worker 的协作状态映射为可视化空间行为。

## 2. 范围（In Scope）

- 多场景模板：`office-template`、`game-studio-template`、`custom-template`
- Worker 实体可视化：位置、状态、活动标签、在场性
- Presence 规则引擎：`working/idle/meeting/offline/focus`
- 场景 API：场景定义、实时快照、事件流
- 资产兼容：场景与 Avatar 的资产绑定协议（非交易）

## 3. 非范围（Out of Scope, 首期不做）

- 链上铸造/交易逻辑
- 对 Worker 执行链的强控制（首期只读镜像）
- 复杂 3D 引擎和跨端渲染

## 4. 成功标准

- 30+ Worker 在单场景稳定可视化
- 状态切换延迟 < 2s（SSE）
- 模板可替换且无需改 Presence 规则核心
- 资产绑定字段可在 UI 展示并可通过接口查询

