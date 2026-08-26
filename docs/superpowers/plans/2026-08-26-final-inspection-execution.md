# 成品终检与毛坯入库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从清理合格毛坯批次生成待终检队列，完成合格入库、清理返修、报废回炉及工单终态更新的真实持久化闭环。

**Architecture:** 新增独立 `FinalInspectionService`，以 `BlankOutputBatch` 为唯一上游，通过 FIFO 消费 `InspectionBatch` 完成多次报检。终检报告、返修任务、库存入账、报废回炉和工单状态均在 PostgreSQL 事务中处理，并使用 `requestId` 与 `versionNo` 防重和防并发覆盖；管理端和小程序共享同一业务服务。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React、Ant Design、微信原生小程序、Node.js 接口测试。

---

### Task 1: 终检数量、回炉重量和完成判定纯函数

**Files:**
- Create: `apps/api/src/production/final-inspection.calculations.ts`
- Create: `apps/api/scripts/test-final-inspection-calculations.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 写失败测试**

覆盖单次报检数量、FIFO 分配、默认回炉重量和完成判定：

```js
assert.deepEqual(validateInspectionQuantities({ goodQty: 80, reworkQty: 10, scrapQty: 10 }, 100), { total: 100 })
assert.throws(() => validateInspectionQuantities({ goodQty: 80, reworkQty: 20, scrapQty: 1 }, 100), /超过待检数量/)
assert.throws(() => validateInspectionQuantities({ goodQty: 0, reworkQty: 0, scrapQty: 0 }, 100), /必须大于 0/)
assert.equal(calculateDefaultScrapWeightKg(3, 45), 135)
assert.deepEqual(allocateInspectionBatches(12, [
  { id: 'a', remainingQuantity: 5, availableAt: '2026-08-26T08:00:00Z' },
  { id: 'b', remainingQuantity: 10, availableAt: '2026-08-26T09:00:00Z' },
]), [{ batchId: 'a', quantity: 5 }, { batchId: 'b', quantity: 7 }])
assert.equal(canCompleteFinalInspection({ upstreamOpen: false, pendingInspectionQty: 0, openReworkQty: 0 }), true)
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```bash
node apps/api/scripts/test-final-inspection-calculations.mjs
```

Expected: FAIL，提示 `final-inspection.calculations` 不存在。

- [ ] **Step 3: 实现最小纯函数**

导出：

```ts
export function validateInspectionQuantities(input: InspectionQuantities, remaining: number): { total: number }
export function calculateDefaultScrapWeightKg(scrapQty: number, netWeightKg: number): number
export function allocateInspectionBatches(quantity: number, batches: InspectionQueueCandidate[]): InspectionAllocation[]
export function canCompleteFinalInspection(input: { upstreamOpen: boolean; pendingInspectionQty: number; openReworkQty: number }): boolean
```

所有件数必须为非负整数，重量必须为非负有限数；FIFO 固定按 `availableAt -> id` 排序。

- [ ] **Step 4: 注册并运行测试**

在 `apps/api/package.json` 增加 `test:final-inspection-calculations`，期望输出：

```json
{"ok":true,"suite":"final-inspection-calculations"}
```

### Task 2: Prisma 终检、返修和库存真实关系

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/scripts/seed-final-inspection-warehouses.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 在接口测试脚本中先写模型存在性失败断言**

创建 `apps/api/scripts/test-final-inspection-execution.mjs`，启动时检查 Prisma Client 包含：

```js
for (const delegate of [
  'systemWarehouse', 'inspectionBatch', 'inspectionReport', 'cleaningReworkTask',
  'blankInventoryBatch', 'blankWarehouseReceipt', 'scrapWriteOff', 'returnMeltInventoryLedger',
]) assert.ok(prisma[delegate], `${delegate} delegate is required`)
```

- [ ] **Step 2: 增加枚举和模型**

在 Prisma 中增加：

```prisma
enum InspectionBatchStatus { WAITING PARTIAL CONSUMED CANCELED }
enum InspectionReportStatus { ACTIVE REVERSED }
enum CleaningReworkTaskStatus { PENDING IN_PROGRESS COMPLETED CANCELED }
enum InventoryBatchStatus { AVAILABLE CONSUMED CANCELED }
enum InventoryLedgerAction { RECEIPT REVERSAL ISSUE ADJUSTMENT }
```

新增 `SystemWarehouse`、`InspectionBatch`、`InspectionReport`、`InspectionBatchConsumption`、`InspectionReportDefect`、`InspectionReportImage`、`CleaningReworkTask`、`CleaningReworkReport`、`BlankWarehouseReceipt`、`BlankInventoryBatch`、`BlankInventoryLedger`、`ScrapWriteOff` 和 `ReturnMeltInventoryLedger`。

必须设置：

```prisma
@@unique([workOrderId, requestId])
@@unique([inspectionReportId, inspectionBatchId])
@@unique([inspectionReportId, defectCodeId])
```

`InspectionBatch` 只能二选一关联 `sourceBlankOutputBatchId` 或 `sourceReworkReportId`，服务层强制校验；所有生产、产品、路线和操作数据同时保存真实外键及快照。

- [ ] **Step 3: 增加系统仓库种子**

脚本使用 upsert 创建：

```js
[
  { code: 'BLANK_WAREHOUSE', name: '铸件毛坯库', type: 'BLANK', system: true },
  { code: 'RETURN_MELT_WAREHOUSE', name: '回炉料仓', type: 'RETURN_MELT', system: true },
]
```

- [ ] **Step 4: 生成客户端并同步本地数据库**

Run:

```bash
npm --prefix apps/api run prisma:generate
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npx --prefix apps/api prisma db push
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run seed:final-inspection-warehouses
npm --prefix apps/api run build
```

Expected: Prisma 生成、db push、仓库种子和 API 构建全部通过。

### Task 3: 清理报告生成待终检队列及历史回填

**Files:**
- Create: `apps/api/src/production/final-inspection.queue.ts`
- Modify: `apps/api/src/production/shake-clean.service.ts`
- Create: `apps/api/scripts/backfill-inspection-batches.mjs`
- Modify: `apps/api/scripts/test-shake-clean-execution.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 写清理到终检队列失败测试**

新增断言：

- 清理合格 `10` 件且后继为 `OP-INSP` 时，生成一条数量为 `10` 的 `InspectionBatch`。
- 同一 `BlankOutputBatch` 重试不重复生成。
- 后继不是 `OP-INSP` 或毛坯批次已取消时不生成。
- 工单锁定路线版本停用后仍按该版本节点生成。

- [ ] **Step 2: 实现幂等队列函数**

```ts
export async function ensureInspectionBatchForBlankOutput(
  tx: Prisma.TransactionClient,
  blankOutputBatchId: string,
): Promise<{ id: string; created: boolean } | null>
```

函数锁定毛坯批次，校验 `nextRoutingNode.operationCode === 'OP-INSP'`，并以 `sourceBlankOutputBatchId` 唯一约束 upsert。

- [ ] **Step 3: 接入清理报工事务**

`reportCleaning()` 创建 `BlankOutputBatch` 后，在同一事务调用 `ensureInspectionBatchForBlankOutput()`。任何终检队列创建失败都回滚本次清理报工。

- [ ] **Step 4: 增加幂等回填脚本并验证**

回填所有有效且后继为 `OP-INSP` 的历史 `BlankOutputBatch`。连续执行两次，第二次必须输出 `created: 0`。

### Task 4: 终检报工、库存、报废和撤销 API

**Files:**
- Create: `apps/api/src/production/final-inspection.types.ts`
- Create: `apps/api/src/production/final-inspection.service.ts`
- Create: `apps/api/src/production/final-inspection.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/shared/admin-default-permissions.ts`
- Modify: `apps/api/scripts/test-final-inspection-execution.mjs`

- [ ] **Step 1: 写终检接口失败测试**

测试以下事务行为：

- FIFO 多次报检，剩余数量正确。
- 相同 `requestId` 返回原报告，不重复入库。
- 版本过期返回 `409`。
- 合格数量生成入库单、库存批次和 `RECEIPT` 流水。
- 报废重量默认按 BOM 毛坯净重计算，显式重量可以覆盖默认值。
- 报废生成 `ScrapWriteOff` 和回炉料仓正向重量流水。
- 缺陷未绑定 `OP-INSP` 返回 `400`。
- 撤销在无下游消费时恢复待检数量并写负向冲销流水；已发生下游消费返回 `409`。

- [ ] **Step 2: 定义请求类型**

```ts
export type ReportFinalInspectionBody = {
  workOrderId: string
  requestId: string
  goodQty: number
  reworkQty: number
  scrapQty: number
  scrapWeightKg?: number
  batchVersions: Array<{ id: string; versionNo: number }>
  defects?: Array<{ defectCode: string; quantity: number; remark?: string }>
  imageUrl?: string
  remark?: string
}
```

- [ ] **Step 3: 实现查询和报工服务**

提供：

```ts
listQueue(request, query, mobile?)
getTask(request, workOrderId, mobile?)
options(request, workOrderId, mobile?)
defectOptions(request, workOrderId, mobile?)
report(request, body, mobile?)
reverse(request, reportId, { versionNo, reason })
trace(request, workOrderId, mobile?)
```

报工事务按顺序锁定工单、待检批次和系统仓库，写报告、消费明细、入库、返修、报废和流水。

- [ ] **Step 4: 增加管理端与小程序控制器**

路由：

```text
GET  /admin/production/inspection-tasks
GET  /admin/production/inspection-tasks/:workOrderId
GET  /admin/production/inspection-tasks/:workOrderId/options
GET  /admin/production/inspection-tasks/:workOrderId/defect-options
GET  /admin/production/inspection-tasks/:workOrderId/trace
POST /admin/production/inspection/reports
POST /admin/production/inspection-reports/:id/reverse

GET  /mini/production/inspection-tasks
GET  /mini/production/inspection-tasks/:workOrderId
GET  /mini/production/inspection-tasks/:workOrderId/options
GET  /mini/production/inspection-tasks/:workOrderId/defect-options
POST /mini/production/inspection/reports
```

- [ ] **Step 5: 接入权限守卫并运行接口测试**

管理端使用 `production.inspection.view/report/reverse`，小程序使用 `mini.production.inspection.view/report`。接口测试必须全部通过。

### Task 5: 清理返修闭环和工单终态

**Files:**
- Modify: `apps/api/src/production/final-inspection.service.ts`
- Modify: `apps/api/src/production/final-inspection.controller.ts`
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/api/scripts/test-final-inspection-execution.mjs`

- [ ] **Step 1: 写返修闭环失败测试**

测试：终检返修生成任务；返修分次报工；返修合格重新待检；返修报废进入回炉料仓；返修全部处理后任务完成；存在未处理返修时工单不完成。

- [ ] **Step 2: 实现返修 API**

```text
GET  /admin/production/cleaning-rework-tasks
GET  /admin/production/cleaning-rework-tasks/:id
POST /admin/production/cleaning-rework/reports
GET  /mini/production/cleaning-rework-tasks
GET  /mini/production/cleaning-rework-tasks/:id
POST /mini/production/cleaning-rework/reports
```

返修报告参数包含 `requestId/taskId/goodQty/scrapQty/scrapWeightKg?/equipmentCode/versionNo/remark`；合格数生成新待检批次，报废数写回炉台账。

- [ ] **Step 3: 实现工单终态刷新器**

```ts
async function refreshFinalInspectionWorkOrderStatus(tx: Prisma.TransactionClient, workOrderId: string): Promise<void>
```

只有同时满足以下条件才完成末节点工单：所有造型任务完成；无待浇注、待落砂、待清理数量；无待检数量；无开放返修任务。`completedQuantity` 取未撤销毛坯入库单合格数量合计，并写操作时间与最后操作人快照。

- [ ] **Step 4: 验证短产量工单可以完结**

创建计划 `100`、最终合格 `95`、报废 `5` 的数据；所有队列处理完后工单应为 `COMPLETED` 且 `completedQuantity = 95`。

### Task 6: 管理端终检和返修页面

**Files:**
- Create: `apps/admin/src/utils/finalInspection.ts`
- Create: `apps/admin/src/pages/production/FinalInspectionTaskListPage.tsx`
- Create: `apps/admin/src/pages/production/FinalInspectionTaskDetailPage.tsx`
- Create: `apps/admin/src/pages/production/FinalInspectionReportModal.tsx`
- Create: `apps/admin/src/pages/production/CleaningReworkReportModal.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Modify: `apps/admin/src/utils/roles.ts`
- Create: `apps/admin/tests/final-inspection-ui.test.mjs`

- [ ] **Step 1: 写 UI 失败测试**

断言菜单、受保护路由、待检/检验中/返修中/已完成页签、查询按钮、权限控制的报工/撤销按钮、数量联动、缺陷单图上传和返修记录均存在。

- [ ] **Step 2: 实现 API 类型与请求函数**

`finalInspection.ts` 统一定义列表、详情、报告、返修和追溯 DTO，不在页面内拼装未知对象。

- [ ] **Step 3: 实现标准列表和详情**

沿用 BOM、落砂清理页面标准：右上角蓝色查询按钮，`ResizableTable`，固定操作列，最多三个实际授权操作。

- [ ] **Step 4: 实现终检和返修弹窗**

数量变化实时校验并显示剩余待检数；报废重量随报废数自动计算但允许修改；缺陷图片复用统一图片上传组件且最多一张。

- [ ] **Step 5: 接入菜单、路由、权限并运行测试和构建**

Run:

```bash
node --test apps/admin/tests/final-inspection-ui.test.mjs
npm run build:admin
```

### Task 7: 小程序终检和返修执行

**Files:**
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/home/index.ts`
- Modify: `apps/miniprogram/src/pages/home/index.wxml`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/types/business.ts`
- Create: `apps/miniprogram/src/pages/inspection/list/*`
- Create: `apps/miniprogram/src/pages/inspection/detail/*`
- Create: `apps/miniprogram/src/pages/inspection/report/*`
- Create: `apps/miniprogram/src/pages/cleaning-rework/list/*`
- Create: `apps/miniprogram/src/pages/cleaning-rework/detail/*`
- Create: `apps/miniprogram/src/pages/cleaning-rework/report/*`
- Create: `apps/miniprogram/tests/final-inspection-pages.test.cjs`

- [ ] **Step 1: 写小程序页面失败测试**

断言九宫格权限、下拉刷新、批次选择/扫码入口、数量快捷按钮、一键全部合格、缺陷选择、拍照/选图和无撤销入口。

- [ ] **Step 2: 实现终检页面**

报工人显示当前登录姓名；重复点击提交期间禁用按钮；提交携带稳定 `requestId` 和页面加载时获取的批次版本。

- [ ] **Step 3: 实现返修页面**

列表只展示当前用户有权查看的开放返修任务；返修合格重新待检，返修报废重量支持默认值和修改。

- [ ] **Step 4: 接入权限和正式 API 并构建**

Run:

```bash
npm --prefix apps/miniprogram test
npm --prefix apps/miniprogram run build
```

确认 `dist` 包含全部新增页面，不允许引用 mock 数据。

### Task 8: 回归、文档和端到端验证

**Files:**
- Modify: `docs/product/context-summary.md`
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/production-execution-context.md`
- Modify: `docs/product/production-execution-test-cases.md`
- Modify: `docs/deployment/tencent-cloud-test.md`

- [ ] **Step 1: 补充上下游数据关系和防呆规则**

记录 `BlankOutputBatch -> InspectionBatch -> 入库/返修/报废`、系统仓库、并发锁、撤销限制、工单完成条件和新增权限。

- [ ] **Step 2: 运行全部相关验证**

```bash
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run build
npm --prefix apps/api run test:final-inspection-calculations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3000/api' npm --prefix apps/api run test:final-inspection-execution
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3000/api' ALLOW_SHARED_DB_MUTATION=1 npm --prefix apps/api run test:shake-clean-execution
node --test apps/admin/tests/final-inspection-ui.test.mjs
npm run build:admin
npm --prefix apps/miniprogram test
npm --prefix apps/miniprogram run build
git diff --check
```

- [ ] **Step 3: 浏览器与小程序人工验证**

管理端验证列表、报工、返修、撤销、入库和追溯；小程序验证权限菜单、待检选择、拍照和提交。验证刷新后数据仍存在，并用两个终端模拟旧页面提交，确认第二次返回 `409`。

- [ ] **Step 4: 最终代码审核**

按业务一致性、安全权限、事务完整性、并发和测试覆盖顺序审核；存在高优先级问题时修复后重新运行完整验证。
