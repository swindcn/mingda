# 落砂清理执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将合型浇注合格箱数转换为待落砂毛坯件数，完成单一落砂清理工艺节点内的落砂、清理打磨、缺陷、撤销和毛坯产出追溯。

**Architecture:** 新增独立 `ShakeCleanService`。浇注报工事务生成 `ShakeBatch`，落砂报工按 FIFO 消费并生成 `CleaningBatch`，清理报工再生成 `BlankOutputBatch`。工单始终使用已锁定路线版本，冷却未到期只提醒不阻断，管理端和小程序共用同一后端事务边界。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React、Ant Design、微信原生小程序、Node test scripts。

---

### Task 1: 落砂清理纯计算与失败测试

**Files:**
- Create: `apps/api/src/production/shake-clean.calculations.ts`
- Create: `apps/api/scripts/test-shake-clean-calculations.mjs`
- Modify: `apps/api/package.json`

- [x] **Step 1: 写数量换算、冷却和 FIFO 失败测试**

测试直接调用将要导出的纯函数：

```js
assert.equal(calculateShakePieces(120, 2), 240)
assert.equal(calculateShakePieces(0, 2), 0)
assert.deepEqual(calculateCoolingState('2026-08-24T08:00:00Z', '2026-08-24T09:30:00Z', 120), {
  requiredMinutes: 120,
  actualMinutes: 90,
  remainingMinutes: 30,
  early: true,
})
assert.deepEqual(allocateQueueBatches(12, [
  { id: 'a', remainingQuantity: 5, availableAt: '2026-08-24T08:00:00Z' },
  { id: 'b', remainingQuantity: 10, availableAt: '2026-08-24T09:00:00Z' },
]), [{ batchId: 'a', quantity: 5 }, { batchId: 'b', quantity: 7 }])
assert.throws(() => allocateQueueBatches(16, candidates), /待处理数量不足/)
```

- [x] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```bash
npm --prefix apps/api run build
node apps/api/scripts/test-shake-clean-calculations.mjs
```

Expected: FAIL，提示 `shake-clean.calculations` 不存在。

- [x] **Step 3: 实现最小纯计算函数**

`shake-clean.calculations.ts` 导出：

```ts
export function calculateShakePieces(goodBoxes: number, cavityCount: number): number
export function calculateCoolingState(pouredAt: Date | string, checkedAt: Date | string, requiredMinutes: number): {
  requiredMinutes: number
  actualMinutes: number
  remainingMinutes: number
  early: boolean
}
export function allocateQueueBatches(quantity: number, candidates: Array<{
  id: string
  remainingQuantity: number
  availableAt: Date | string
}>): Array<{ batchId: string; quantity: number }>
```

箱数、穴数和报工数量必须为非负整数；有效报工的“合格 + 废品”必须大于零。FIFO 固定按 `availableAt -> id` 排序。

- [x] **Step 4: 注册脚本并确认通过**

`apps/api/package.json` 增加 `test:shake-clean-calculations`，运行后必须输出：

```json
{"ok":true,"suite":"shake-clean-calculations"}
```

### Task 2: Prisma 真实关系和路线冷却参数

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/process-routing/process-routing.controller.ts`
- Modify: `apps/admin/src/utils/processRoutings.ts`
- Modify: `apps/admin/src/pages/modeling/ProcessRoutingWorkbenchPage.tsx`
- Modify: `apps/api/scripts/test-process-routings.mjs`
- Modify: `apps/admin/tests/process-routing-ui.test.mjs`

- [x] **Step 1: 在路线测试中增加冷却时长失败断言**

在创建的 `OP-SHAKE` 节点中提交 `coolingDurationMinutes: 120`，断言详情、编辑和版本克隆后都保留 `120`；提交小数或负数返回 `400`。管理端测试断言该字段只在落砂清理节点配置抽屉中显示。

- [x] **Step 2: 运行路线 API 和 UI 测试并确认失败**

Run:

```bash
npm --prefix apps/api run test:process-routings
node --test apps/admin/tests/process-routing-ui.test.mjs
```

Expected: FAIL，当前 DTO 和页面未保存/展示冷却时长。

- [x] **Step 3: 增加路线冷却字段**

`ProcessRoutingNode` 增加：

```prisma
coolingDurationMinutes Int @default(0)
```

后端创建、编辑、详情和克隆统一处理该字段。必须是非负整数，非落砂清理节点强制保存为 `0`。

- [x] **Step 4: 增加落砂、清理和毛坯产出模型**

在 Prisma 中增加：

- `ShakeBatchStatus`: `WAITING/PARTIAL/CONSUMED/CANCELED`。
- `ShakeReportStatus`: `ACTIVE/REVERSED`。
- `CleaningBatchStatus`: `WAITING/PARTIAL/CONSUMED/CANCELED`。
- `CleaningReportStatus`: `ACTIVE/REVERSED`。
- `BlankOutputBatchStatus`: `WAITING_NEXT_OPERATION/WAITING_WAREHOUSE/CANCELED`。
- `ShakeBatch`：唯一关联 `sourcePouringReportId`，关联 `MoldingTask/WorkOrder/ProcessRoutingVersion/ProcessRoutingNode`，保存快照、`originalQuantity/remainingQuantity/pouredAt/coolingDurationMinutesSnapshot/status/versionNo`。
- `ShakeReport`：关联任务、落砂节点、设备、操作人/撤销人，保存 `goodQty/scrapQty/requiredCoolingMinutesSnapshot/actualCoolingMinutesSnapshot/earlyShake/requestId/versionNo`。
- `ShakeBatchConsumption`：保存每笔落砂报工对具体待落砂批次的 `quantity/quantityBefore/quantityAfter`。
- `ShakeReportDefect`：真实关联 `DefectCode`。
- `CleaningBatch`：唯一关联 `sourceShakeReportId`，保存待清理数量、来源时间和快照。
- `CleaningReport`：关联任务、落砂清理节点、设备、操作人/撤销人，保存 `goodQty/scrapQty/riseringScrapWeightKg/requestId/versionNo`。
- `CleaningBatchConsumption`、`CleaningReportDefect`：分别保存 FIFO 消费和缺陷真实关系。
- `BlankOutputBatch`：唯一关联 `sourceCleaningReportId`，关联工单、路线版本、落砂节点和可空的 `nextRoutingNodeId`，保存合格数、状态和快照。

唯一约束至少包含：

```prisma
@@unique([moldingTaskId, requestId])
@@unique([shakeReportId, shakeBatchId])
@@unique([cleaningReportId, cleaningBatchId])
@@unique([shakeReportId, defectCodeId])
@@unique([cleaningReportId, defectCodeId])
```

同步给 `User`、`Furnace`、`DefectCode`、`WorkOrder`、`MoldingTask`、`ProcessRoutingVersion`、`ProcessRoutingNode`、`PouringReport` 增加反向关系。

- [x] **Step 5: 生成 Prisma Client 并同步本地 Docker 数据库**

Run:

```bash
npm --prefix apps/api run prisma:generate
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npx --prefix apps/api prisma db push
npm --prefix apps/api run build
```

Expected: 不删除已有数据，TypeScript 构建通过。

### Task 3: 浇注报工生成待落砂队列

**Files:**
- Create: `apps/api/src/production/shake-clean.queue.ts`
- Modify: `apps/api/src/production/pouring.service.ts`
- Modify: `apps/api/scripts/test-pouring-execution.mjs`

- [x] **Step 1: 写浇注到落砂队列失败测试**

新增断言：

- 浇注合格 `3` 箱、造型任务穴数 `2` 时生成 `6` 件待落砂数量。
- 浇注废品数不进入待落砂数量。
- 批次保存浇注报工时间和落砂节点冷却时长快照。
- 无可达 `OP-SHAKE`/清理工段节点时浇注仍成功，但不生成批次。
- 工单锁定路线后续停用仍能按原版本找到落砂节点。

- [x] **Step 2: 运行浇注接口测试并确认失败**

Run:

```bash
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3000/api' npm --prefix apps/api run test:pouring-execution
```

Expected: FAIL，浇注报工尚未生成 `ShakeBatch`。

- [x] **Step 3: 实现可达落砂节点解析和历史补建**

`shake-clean.queue.ts` 实现：

```ts
export async function findReachableShakeNode(
  client: Prisma.TransactionClient | PrismaService,
  routingVersionId: string,
  pouringNodeId: string,
): Promise<{ id: string; operationCode: string; operationName: string; coolingDurationMinutes: number } | null>

export async function createShakeBatchForPouringReport(
  tx: Prisma.TransactionClient,
  pouringReportId: string,
): Promise<string | null>

export async function backfillShakeBatches(tx: Prisma.TransactionClient): Promise<void>
```

图搜索检测循环，只接受首个可达的清理工段/`OP-SHAKE` 节点。补建仅处理 `ACTIVE` 且 `goodQty > 0` 的历史浇注报工，依靠唯一约束保证幂等。

- [x] **Step 4: 在浇注事务中生成批次并增加撤销保护**

浇注报工创建完成后、事务提交前调用 `createShakeBatchForPouringReport`。撤销浇注时：

- 待落砂批次无有效消费：将其置为 `CANCELED`。
- 已被落砂报工消费：返回“该浇注报工已进入落砂追溯，请先撤销落砂报工”。

- [x] **Step 5: 运行浇注回归**

Expected: `test:pouring-execution` PASS，测试数据清理后不留孤立落砂批次。

### Task 4: 落砂清理领域服务、接口与权限

**Files:**
- Create: `apps/api/src/production/shake-clean.types.ts`
- Create: `apps/api/src/production/shake-clean.service.ts`
- Create: `apps/api/src/production/shake-clean.controller.ts`
- Create: `apps/api/scripts/test-shake-clean-execution.mjs`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/shared/admin-default-permissions.ts`
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/api/scripts/test-defect-operations.mjs`
- Modify: `apps/api/package.json`

- [x] **Step 1: 写完整接口失败测试**

隔离 PostgreSQL schema 测试覆盖：

1. 队列按最早浇注时间排序并按任务聚合。
2. `3 箱 × 2 穴 = 6 件`。
3. 未到冷却时长的 check 接口返回 `EARLY_SHAKE`，未确认时提交返回 `409`，确认后可提交。
4. 落砂设备必须启用、类型等于“落砂”且绑定当前路线节点。
5. 清理设备必须启用、类型属于“清理/抛丸/打磨/切割”且绑定节点。
6. 落砂和清理均按 FIFO 跨两笔批次扣减。
7. 数量超余量返回 `400`，旧 `versionNo` 返回 `409`。
8. 落砂合格数生成待清理批次，清理合格数生成毛坯产出。
9. 废品大于零时缺陷必填，缺陷必须绑定 `OP-SHAKE`，数量合计必须等于废品数。
10. 落砂和清理相同 `requestId` 重试不重复扣减。
11. 清理撤销返还数量并撤销毛坯产出；落砂撤销必须先无有效清理消费。
12. 上游浇注未完成时队列清空显示 `WAITING_POURING`，全部完成时显示 `COMPLETED`。
13. 数据范围只返回可见的 `production:molding_tasks`/生产工单来源任务。

- [x] **Step 2: 运行新接口测试并确认因接口不存在而失败**

Run:

```bash
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:shake-clean-execution
```

Expected: FAIL with HTTP 404 or missing script/module.

- [x] **Step 3: 实现队列、选项、冷却检查和缺陷查询**

管理端路由：

```text
GET  /admin/production/shake-clean-tasks
GET  /admin/production/shake-clean-tasks/:id/options
GET  /admin/production/shake-clean-tasks/:id/reports
GET  /admin/production/shake-clean-tasks/:id/trace
GET  /admin/production/shake-clean-tasks/:id/defect-options
POST /admin/production/shake-clean/shake/check
POST /admin/production/shake-clean/shake/reports
POST /admin/production/shake-clean/cleaning/reports
POST /admin/production/shake-clean/shake-reports/:id/reverse
POST /admin/production/shake-clean/cleaning-reports/:id/reverse
```

小程序提供同等查询/check/报工路由，前缀为 `/mini/production`，不提供撤销。

落砂选项返回落砂设备、待落砂余量、冷却状态和批次版本；清理选项返回清理设备、待清理余量和批次版本。

- [x] **Step 4: 实现落砂和清理事务**

两类报工都使用 `Serializable` 事务，流程为：

1. 锁定聚合任务的当前 FIFO 批次。
2. 查找同一任务和 `requestId` 的已有记录，命中则返回旧记录。
3. 重新计算余量、冷却风险、设备关系和缺陷。
4. 校验页面提交的批次 `versionNo`。
5. 创建报工、缺陷和消费明细。
6. 更新 FIFO 批次余量和状态。
7. 落砂合格数创建 `CleaningBatch`；清理合格数创建 `BlankOutputBatch`。

清理节点有一条后续边时保存 `nextRoutingNodeId` 并置 `WAITING_NEXT_OPERATION`；无后续边时置 `WAITING_WAREHOUSE`；多于一条后续边时返回明确配置错误，不猜测分支。

- [x] **Step 5: 实现撤销和下游保护**

清理撤销锁定报工及其消费批次，返还数量、撤销毛坯产出并保存撤销快照。落砂撤销前查查 `CleaningBatch` 是否已有有效消费，无消费时返还待落砂数量并撤销待清理批次。

- [x] **Step 6: 注册权限和初始缺陷**

注册权限：

```text
production.shake_clean.view
production.shake_clean.shake_report
production.shake_clean.clean_report
production.shake_clean.reverse
mini.production.shake_clean.view
mini.production.shake_clean.shake_report
mini.production.shake_clean.clean_report
```

`test-defect-operations.mjs` 为 `OP-SHAKE` 补充并验证：

```text
SHAKE-CRACK    粗开裂
SHAKE-DAMAGE   严重损坏
CLEAN-STICKING 粘砂
CLEAN-POROSITY 气孔
CLEAN-OVERCUT  切割过深
CLEAN-SANDHOLE 砂眼
```

- [x] **Step 7: 运行后端回归**

Run:

```bash
npm --prefix apps/api run build
npm --prefix apps/api run test:shake-clean-calculations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:defect-operations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:pouring-execution
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:shake-clean-execution
```

Expected: 全部 PASS，临时 schema 和测试数据完整清理。

### Task 5: 管理端落砂清理页面

**Files:**
- Create: `apps/admin/src/utils/shakeClean.ts`
- Create: `apps/admin/src/pages/production/ShakeCleanTaskListPage.tsx`
- Create: `apps/admin/src/pages/production/ShakeCleanTaskDetailPage.tsx`
- Create: `apps/admin/tests/shake-clean-ui.test.mjs`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Modify: `apps/admin/src/utils/roles.ts`

- [x] **Step 1: 写管理端页面失败测试**

断言：

- 路由和菜单受 `production.shake_clean.view` 保护。
- 标题右侧存在查询，报工按钮分别受 `shake_report` 和 `clean_report` 保护。
- 标签页包含待落砂、落砂中、待清理、清理中、等待后续浇注、已完成。
- 列表使用 `ResizableTable`，操作列固定右侧。
- 冷却未到期显示倒计时和二次确认，但不隐藏落砂提交。
- 落砂/清理都有数量快捷操作、一键拉满、设备和缺陷。
- 清理报工包含切割浇冒口重量。
- 撤销受 `production.shake_clean.reverse` 保护并强制填写原因。
- 只调用真实 `/admin/production/shake-clean*` 接口。

- [x] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test apps/admin/tests/shake-clean-ui.test.mjs`

Expected: FAIL，页面和工具尚不存在。

- [x] **Step 3: 实现真实 API 类型和工具**

`shakeClean.ts` 定义队列、选项、落砂检查、落砂/清理报工、缺陷、批次追溯和撤销 DTO，全部使用现有 `apiRequest`。

- [x] **Step 4: 实现列表和详情页**

列表显示任务/工单/产品、浇注件数、待落砂、待清理、合格毛坯、冷却状态、进度和状态。详情页用标签页展示“任务信息、落砂记录、清理记录、批次追溯”，报工弹窗使用项目既有 Ant Design 表单和数量控件标准。

- [x] **Step 5: 运行管理端测试和构建**

Run:

```bash
node --test apps/admin/tests/shake-clean-ui.test.mjs
npm run build:admin
```

Expected: PASS；只允许现有 Vite 大包体积告警，不允许 TypeScript 错误。

### Task 6: 小程序落砂和清理报工

**Files:**
- Create: `apps/miniprogram/src/pages/shake-clean/list/index.ts`
- Create: `apps/miniprogram/src/pages/shake-clean/list/index.wxml`
- Create: `apps/miniprogram/src/pages/shake-clean/list/index.wxss`
- Create: `apps/miniprogram/src/pages/shake-clean/list/index.json`
- Create: `apps/miniprogram/src/pages/shake-clean/detail/index.ts`
- Create: `apps/miniprogram/src/pages/shake-clean/detail/index.wxml`
- Create: `apps/miniprogram/src/pages/shake-clean/detail/index.wxss`
- Create: `apps/miniprogram/src/pages/shake-clean/detail/index.json`
- Create: `apps/miniprogram/src/pages/shake-clean/shake-report/index.ts`
- Create: `apps/miniprogram/src/pages/shake-clean/shake-report/index.wxml`
- Create: `apps/miniprogram/src/pages/shake-clean/shake-report/index.wxss`
- Create: `apps/miniprogram/src/pages/shake-clean/shake-report/index.json`
- Create: `apps/miniprogram/src/pages/shake-clean/clean-report/index.ts`
- Create: `apps/miniprogram/src/pages/shake-clean/clean-report/index.wxml`
- Create: `apps/miniprogram/src/pages/shake-clean/clean-report/index.wxss`
- Create: `apps/miniprogram/src/pages/shake-clean/clean-report/index.json`
- Create: `apps/miniprogram/tests/shake-clean-pages.test.cjs`
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/home/index.ts`
- Modify: `apps/miniprogram/src/pages/home/index.wxml`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/types/business.ts`

- [x] **Step 1: 写小程序失败测试**

断言：

- 注册四个页面，首页入口只受 `mini.production.shake_clean.view` 控制。
- 列表有状态标签、扫码、查询和下拉刷新。
- 详情按后端 `allowedActions` 显示落砂/清理入口，不使用前端身份硬编码。
- 落砂报工支持设备下拉/扫码、快捷数量、一键拉满、缺陷和冷却未到期确认。
- 清理报工支持设备下拉/扫码、快捷数量、缺陷和浇冒口重量。
- 页面使用真实 `/mini/production/shake-clean*` 接口，`requestId` 在当前页面实例内稳定。

- [x] **Step 2: 运行小程序测试并确认失败**

Run: `npm --prefix apps/miniprogram test`

Expected: FAIL，落砂清理页面和路由尚不存在。

- [x] **Step 3: 实现真实 API、类型、首页入口和列表**

复用现有请求层的 token 过期、超时、`409` 和 latest-request gate。列表按最早上游时间排序，冷却状态使用红/绿状态文字，不增加装饰性卡片。

- [x] **Step 4: 实现落砂、清理报工与并发刷新**

两个报工页面都先调用服务端 check/options，再提交最新 `versionNo`。收到冷却提醒时显示一个二次确认；收到并发冲突时就地刷新任务，不返回首页。

- [x] **Step 5: 运行小程序全量测试和构建**

Run: `npm --prefix apps/miniprogram test`

Expected: PASS，`apps/miniprogram/dist/pages/shake-clean/` 包含四个已构建页面。

### Task 7: 文档、完整回归和 Docker 验收

**Files:**
- Modify: `docs/product/context-summary.md`
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/production-execution-context.md`
- Modify: `docs/product/production-execution-test-cases.md`
- Modify: `docs/superpowers/plans/2026-08-24-shake-cleaning-execution.md`

- [x] **Step 1: 固化长期业务规则**

记录单工序双阶段、箱数乘穴数、冷却只提醒、FIFO、设备类型字典、缺陷绑定、下游先撤销、毛坯产出边界、幂等和并发版本规则，并链接设计文档。

- [x] **Step 2: 执行完整回归**

Run:

```bash
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run build
npm --prefix apps/api run test:shake-clean-calculations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:defect-operations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:pouring-execution
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:shake-clean-execution
node --test apps/admin/tests/process-routing-ui.test.mjs apps/admin/tests/shake-clean-ui.test.mjs
npm run build:admin
npm --prefix apps/miniprogram test
git diff --check
```

Expected: 全部测试和构建通过。

- [x] **Step 3: 重建 Docker 并运行真实接口验收**

Run:

```bash
docker buildx build --load -f docker/api.Dockerfile -t mingda-casting-api .
docker buildx build --load -f docker/admin.Dockerfile --build-arg VITE_API_BASE_URL=/api -t mingda-casting-admin .
docker compose up -d --no-build postgres api admin
curl -fsS http://127.0.0.1:3000/api/health
docker compose ps
```

用管理员登录 `http://127.0.0.1:8080/dashboard/production/shake-clean-tasks`，验证列表、详情和两阶段报工页面非空白；用 Playwright 保存列表和详情截图到 `output/playwright/`。

Expected: PostgreSQL healthy，API 和管理端容器运行，健康接口返回 `status: ok`。

#### 2026-08-24 Task 7 验收摘要

- `npm --prefix apps/api run prisma:generate`：退出码 `0`。
- `npm --prefix apps/api run build`：退出码 `0`。
- `npm --prefix apps/api run test:shake-clean-calculations`：退出码 `0`。
- `test:defect-operations`：退出码 `0`，`OP-SHAKE` 缺陷 `6` 项。
- `test:pouring-execution`：退出码 `0`；显式使用共享本地库开关，脚本 `finally` 已恢复路线边、穴数、冷却、版本和测试记录。
- `test:shake-clean-execution`：退出码 `0`；使用临时隔离 schema 并在结束后删除。
- 管理端 `process-routing-ui + shake-clean-ui`：退出码 `0`，`15/15` 通过。
- 管理端构建：退出码 `0`；保留既有单包超过 `500 kB` 的构建警告。
- 小程序全量测试和构建：退出码 `0`，`46/46` 通过，`src` 已同步到 `dist`。
- `git diff --check`：退出码 `0`。
- Docker Prisma `db push`：首次从仓库根传入错误相对路径退出 `1`，未连接数据库；改在 `apps/api` 执行后退出 `0`，数据库已与 schema 同步且未删除数据。
- API 和管理端 Docker buildx：退出码均为 `0`。API 镜像依赖扫描报告 `9` 个漏洞（`1 low / 8 high`），需单独评估升级，未在本次范围内强制升级依赖。
- `docker compose up` 后首次 health 请求撞到启动窗口，curl 退出 `56`；重试退出 `0`，API 返回 `status: ok`。最终 PostgreSQL `healthy`，API 和管理端均运行。
- Playwright：管理员登录成功，`GET /api/admin/production/shake-clean-tasks?page=1&pageSize=20` 返回 `200`，控制台 `0 errors / 0 warnings`，页面与主内容区无横向溢出。
- 本地 Docker 数据库暂无落砂清理任务，因此只保存真实空列表截图，详情能力由隔离 schema 接口测试和管理端 UI 测试覆盖；未创建伪造验收数据。
- 截图：`output/playwright/shake-clean-task-list.png`。
