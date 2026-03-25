# Cloud Office 架构规划

## 1. 核心模型

- `SpaceScene`: 场景容器（zones、模板、渲染配置）
- `SceneZone`: 可容纳实体的区域（work/meeting/social/custom）
- `WorkerEntity`: Worker 空间实体（状态、位置、活动）
- `AssetBinding`: 资产绑定（owner、tokenRef、license）

## 2. 后端模块（建议）

```txt
packages/channel-http/src/space-runtime/
  types.ts
  rules.ts
  allocator.ts
  service.ts
  asset-provider.ts
```

### API 草案

- `GET /api/scenes`
- `GET /api/scenes/:id`
- `GET /api/scenes/:id/presence`
- `GET /api/scenes/:id/events` (SSE)
- `GET /api/assets/:type/:id` (可选)

## 3. 前端模块（建议）

```txt
packages/web/src/modules/scene/
  views/SceneView.vue
  scene/SceneCanvas.vue
  stores/scene.ts
  api/scene.ts
  components/EntityAvatar.vue
```

路由：`/scenes/:id`（可用 `/office` 作为快捷重定向）

## 4. 规则映射（首版）

- `working -> work zone`
- `idle -> social zone`
- `meeting -> meeting zone`
- `offline -> outside/system zone`

## 5. 资产化兼容（协议优先）

- 运行时仅依赖 `AssetBinding`
- 交易系统在上层模块实现
- `AssetProvider` 可替换（本地/中心化服务/链上索引）

