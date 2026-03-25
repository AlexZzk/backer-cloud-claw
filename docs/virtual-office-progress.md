# 虚拟办公室开发进度检查（2026-03-25）

## 已完成

- Scene Runtime 基础模型：Scene/Zone/Entity/PresenceSnapshot
- 后端 API：
  - `GET /api/scenes`
  - `GET /api/scenes/:sceneId`
  - `GET /api/scenes/:sceneId/presence`
  - `GET /api/scenes/:sceneId/events`（SSE）
- 多模板验证：`default-office` + `game-studio`
- 入驻管理：
  - `GET /api/scenes/:sceneId/residents`
  - `PUT /api/scenes/:sceneId/residents/:workerId`
  - `~/.bcc/scene-residency.json` 持久化
- 前端 Scene 页面：
  - 实时订阅（SSE + 轮询回退）
  - Zone 可视化
  - 入驻开关与默认区域设置

## 未完成（下一阶段重点）

1. **工位级坐标与动画（进行中）**
   - 已接入 `anchors` + `seatId/position` 的静态落点分配。
   - 待完善：路径移动与平滑动画。

2. **任务驱动的更精确状态机（进行中）**
   - 已接入 task store：有待办/进行中任务会提升为 `working`，高优任务可提升 `focus`。
   - 待完善：把任务截止时间、阻塞状态、父子任务链纳入状态机规则。

3. **模型不可用判定增强**
   - 当前 `offline` 主要来自 Worker 生命周期状态。
   - 还需接入最近模型调用失败窗口、恢复重试状态。

4. **场景编辑器/模板管理**
   - 目前模板是代码内置。
   - 还未支持从 UI 新建/编辑场景模板。

5. **资产化协议扩展**
   - 已有 `assetBinding` 占位。
   - 还未实现资产提供者（AssetProvider）与所有权校验/授权流程。

6. **自动化测试**
   - 目前尚无 scene-runtime 专项单元测试与 API 集成测试。

## 建议的下一开发切片

- 切片 A：补全 `SceneStateEngine`（已接入任务数量/优先级信号，待接入截止时间与阻塞语义）。
- 切片 B：补全 `SeatAllocator`（已完成 seat 静态分配，待接入移动轨迹动画）。
- 切片 C：前端加入 Avatar 轨迹与房间人数热力图。
