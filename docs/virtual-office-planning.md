# 空间化 Worker 可视化规划（可扩展场景 / 资产化兼容）v0.2

> 日期：2026-03-25  
> 适用仓库：`backer-cloud-claw`  
> 核心修正：**“办公室”只是默认场景，不是唯一形态**；架构需从第一天支持可扩展场景与后续 Web3 资产化拆分。

---

## 1. 本次修正（针对你的两点反馈）

### 1.1 “办公室”降级为抽象概念，不做硬编码

- 旧思路里的 `OfficeMap` 改为更通用的 `SpaceScene`。
- “总裁办公室/会议室/工位/茶水间”属于一个 **Scene Template（办公室模板）**。
- 一人公司、游戏团队、内容工作室，都可以加载不同模板：
  - `office-template`（办公室）
  - `game-studio-template`（游戏场景）
  - `factory-template`（流水线）
  - `custom-template`（用户自定义）

> 结论：我们做的是 **Worker Spatial Runtime（空间运行时）**，而不只是“办公室页面”。

### 1.2 提前考虑虚拟资产化（Web3 走向）

- 场景（Scene）和员工 Avatar 都需要具备“资产标识层”，但与运行时解耦。
- 当前阶段不强绑定链上实现；只预留可插拔 `AssetProvider` 接口。
- 后续可以支持：
  - 场景 NFT（可交易 / 授权 / 租赁）
  - Avatar NFT（员工皮肤、身份卡、稀有属性）
  - 资产权限（owner、operator、viewer）映射到系统 RBAC

> 结论：先把“可拆分性”放在协议层，而不是后补。

---

## 2. 新的目标定义（从 Office 升级到 Scene Runtime）

我们要交付的是一个独立模块：

1. **空间容器（Scene）**：可装载不同业务语义的地图与区域。
2. **实体系统（Entity）**：Worker Avatar、装饰物、会议桌、任务看板等。
3. **状态映射（Presence Rules）**：把 Worker 运行状态映射到空间位置。
4. **资产兼容（Asset-ready）**：Scene/Avatar 可关联可交易资产元数据。

这样既满足你现在“虚拟办公室”的诉求，也兼容未来“可出售的场景与员工”。

---

## 3. 外部案例（继续借鉴，但不限制形态）

1. **Gather**：空间内协作语义强，适合借鉴房间聚合与出勤感。
2. **WorkAdventure**：开源地图与 zone 机制，适合借鉴模板化场景配置。
3. **Decentraland / The Sandbox（方向参考）**：场景/角色资产化与所有权流转思路可参考。

参考链接：
- <https://www.gather.town/>
- <https://workadventu.re/>
- <https://decentraland.org/>
- <https://www.sandbox.game/>

---

## 4. 核心抽象模型（替代旧 Office-only 模型）

### 4.1 场景模型

- `SpaceScene`
  - `id`, `name`, `templateId`, `version`
  - `zones: SceneZone[]`
  - `navigationGraph`（可选，给路径移动/动画）
  - `renderConfig`（2D/等距/3D）

- `SceneZone`
  - `id`, `type`, `capacity`, `tags`
  - `anchors`（可站位点）

`type` 不再写死为办公室专有值，采用开放枚举：
- `work`, `meeting`, `social`, `private`, `system`, `custom:*`

### 4.2 Worker 实体模型

- `WorkerEntity`
  - `workerId`, `displayName`, `avatarId`
  - `presenceState`: `working | idle | meeting | offline | focus`
  - `currentZoneId`, `position`, `activityLabel`, `lastSeenAt`

### 4.3 资产元数据模型（新增）

- `AssetBinding`
  - `assetType`: `scene | avatar | prop`
  - `assetId`（内部 ID）
  - `ownerId`
  - `tokenRef?`（链上引用：`chainId`, `contract`, `tokenId`）
  - `license`（可售、可租、可转授权）

> 运行态只依赖 `AssetBinding`，不直接依赖具体区块链 SDK。

---

## 5. 架构拆分（保证可插拔与可拆分）

### 5.1 后端（`channel-http`）

建议新增 `space-runtime` 子域，而不是 `office` 写死：

- `packages/channel-http/src/space-runtime/`
  - `types.ts`：Scene / Entity / AssetBinding 协议
  - `rules.ts`：状态到区域映射规则
  - `allocator.ts`：座位/区域分配器
  - `service.ts`：聚合 workers/tasks/chats/events
  - `asset-provider.ts`：资产提供者接口（默认本地实现）

API 草案：

- `GET /api/scenes`：场景列表
- `GET /api/scenes/:id`：场景定义
- `GET /api/scenes/:id/presence`：实体快照
- `GET /api/scenes/:id/events`：SSE 增量事件
- `GET /api/assets/:type/:id`：资产绑定信息（可选）

### 5.2 前端（`web`）

建议新增 `scene` 模块，而不是仅 `office` 模块：

- `packages/web/src/modules/scene/`
  - `views/SceneView.vue`
  - `scene/SceneCanvas.vue`
  - `stores/scene.ts`
  - `api/scene.ts`
  - `components/EntityAvatar.vue`

路由建议：

- `/scenes/:id`（默认可跳转到 `office-template` 的场景实例）
- “虚拟办公室”可作为快捷入口，本质是默认模板。

---

## 6. 规则层（保持你定义的业务语义）

你的规则完全保留，但映射到“可泛化 Zone”上：

- 有工作 → `work` 区域
- 没工作 → `social` 区域
- 模型不通 → `system:outside`（不在场）
- 多人开会 → `meeting` 区域

这样同一套规则可在不同模板复用：

- 办公室模板：`work=工位`，`social=茶水间`
- 游戏模板：`work=战术台`，`social=休息营地`

---

## 7. Web3 / 资产化兼容路线（分层推进）

### Phase A（现在）

- 只做 `AssetBinding` 协议与本地存储。
- UI 上展示“资产徽章/所有者”，不做交易。

### Phase B（后续）

- 接入可插拔 `AssetProvider`（例如链上索引服务）。
- 支持 Scene/Avatar 的“可验证所有权”。

### Phase C（长期）

- 支持市场流通（出售/租赁/授权）。
- 支持跨组织导入资产模板。

> 关键点：交易系统是上层能力，**不要**侵入 Worker 核心执行链。

---

## 8. 分阶段实施计划（修订版）

### P0：抽象重构（1~2 天）

- 将命名从 `office` 统一调整为 `scene/space-runtime` 语义。
- 先产出 `SpaceScene`、`SceneZone`、`WorkerEntity`、`AssetBinding` 类型定义草案。

### P1：默认模板 MVP（3~5 天）

- 实现 `office-template`（满足你当前办公室需求）。
- 提供 `/api/scenes/:id/presence` 与前端渲染。

### P2：模板扩展（3~5 天）

- 新增第二模板（如 `game-studio-template`）验证开放性。
- 规则层不改动，仅替换 zone 映射。

### P3：资产化试点（后续）

- 加入 `AssetBinding` 展示与 mock ownership。
- 验证“场景可售 / Avatar 可售”的数据闭环。

---

## 9. 风险与提前约束

1. **概念锁死风险**：开发中又回到 office-only 命名。
   - 约束：代码包名与 API 均使用 `scene` / `space-runtime`。

2. **链上耦合过早风险**：为了 Web3 把当前复杂度拉高。
   - 约束：先协议化，不上链 SDK。

3. **资产与权限冲突风险**：所有权与操作权未分离。
   - 约束：`owner/operator/viewer` 三层权限模型。

---

## 10. 下一步最小落地任务（可直接开工）

1. 新建 `docs/scene-runtime-schema-v0.md`（定义通用协议）。
2. 后端先实现 `GET /api/scenes` + `GET /api/scenes/:id/presence`（默认办公室模板）。
3. 前端新增 `SceneView`，先渲染 `office-template`。
4. 在实体信息中加入 `assetBinding?: AssetBinding` 字段（先本地 mock）。
5. 做一轮演示：切换 `office-template` 与 `game-studio-template`，验证规则可复用。

---

## 11. 一句话结论

你这个方向应该定义为：**可扩展的“空间化 Worker 运行时” + 资产化兼容协议**。  
“办公室”只是其中一个默认模板，这样现在能跑，未来也能走向可交易的 Web3 资产生态。

