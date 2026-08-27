# 合型浇注执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将造型报工形成的待浇砂型批次与熔炼转运包次绑定，实现合型浇注队列、预警、报工扣减、缺陷、撤销和完整追溯。

**Architecture:** 新增独立 `PouringService` 和显式 `PouringMoldBatch` 队列模型。造型报工事务生成待浇批次；浇注报工在可串行化事务内锁定具体转运记录和 FIFO 待浇批次，保存砂型消费、理论/实际重量、缺陷及警告快照。管理端和小程序共用领域服务，权限和数据范围由后端控制。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React、Ant Design、微信原生小程序、Node test scripts。

**Implementation Status:** Completed and verified locally with Docker on 2026-08-24.

---

### Task 1: 浇注计算与失败测试

**Files:**
- Create: `apps/api/src/production/pouring.calculations.ts`
- Create: `apps/api/scripts/test-pouring-calculations.mjs`
- Modify: `apps/api/package.json`

- [x] **Step 1: 写计算失败测试**

覆盖以下规则：

```js
assert.equal(calculateTheoreticalPouringWeight(30, 2, 2, 65), 4160)
assert.equal(calculateTransferBalance(4000, [1200, 3000]), -200)
assert.equal(pouringHoldLevel(89), 'NORMAL')
assert.equal(pouringHoldLevel(90), 'WARNING')
assert.equal(pouringHoldLevel(121), 'CRITICAL')
assert.deepEqual(allocatePouringMoldBatches(12, [
  { id: 'a', remainingQuantity: 5, closingTime: '2026-08-24T08:00:00Z' },
  { id: 'b', remainingQuantity: 10, closingTime: '2026-08-24T09:00:00Z' },
]), [
  { batchId: 'a', quantity: 5 },
  { batchId: 'b', quantity: 7 },
])
assert.throws(() => allocatePouringMoldBatches(16, candidates), /待浇箱数不足/)
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm --prefix apps/api run build && node apps/api/scripts/test-pouring-calculations.mjs`

Expected: FAIL，计算模块不存在。

- [x] **Step 3: 实现纯计算函数**

实现：

- 非负整数箱数校验。
- `理论重量 = (合格 + 废品) × 型腔数 × 单件浇注毛重`。
- 铁水包余额和超用量。
- 90/120 分钟预警分级。
- 按 `closingTime -> id` 排序的 FIFO 待浇批次分配。
- 任务队列状态和浇注节点完成判断。

- [x] **Step 4: 注册并运行计算测试**

在 `package.json` 增加 `test:pouring-calculations`，运行后应输出：

```json
{"ok":true,"suite":"pouring-calculations"}
```

### Task 2: Prisma 数据模型和真实关系

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/production/pouring.types.ts`（若文件不存在则创建）

- [x] **Step 1: 增加枚举和模型**

新增：

- `PouringMoldBatchStatus`
- `PouringReportStatus`
- `PouringHoldLevel`
- `PouringMoldBatch`
- `PouringReport`
- `PouringMoldConsumption`
- `PouringReportDefect`

模型必须真实关联：

- `MoldingReport -> PouringMoldBatch` 一对一。
- `MoldingTask -> PouringMoldBatch / PouringReport`。
- `HeatOrderTransfer -> PouringReport`。
- `WorkOrder -> PouringMoldBatch / PouringReport`。
- `ProcessRoutingNode -> PouringMoldBatch / PouringReport`。
- `Furnace -> PouringReport` 作为浇注工位设备。
- `DefectCode -> PouringReportDefect`。
- `User -> PouringReport` 操作人与撤销人。

- [x] **Step 2: 增加唯一约束和索引**

至少包含：

```prisma
@@unique([moldingTaskId, requestId])
@@unique([pouringReportId, pouringMoldBatchId])
@@unique([pouringReportId, defectCodeId])
@@index([status, closingTime])
@@index([heatOrderTransferId, reportedAt])
```

`HeatOrderTransfer` 增加 `versionNo`，每次浇注报工和撤销都递增。

- [x] **Step 3: 生成 Prisma Client 并同步本地数据库**

Run:

```bash
npm --prefix apps/api run prisma:generate
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npx --prefix apps/api prisma db push
```

Expected: schema sync 完成且不删除已有数据。

### Task 3: 造型报工生成待浇批次

**Files:**
- Create: `apps/api/src/production/pouring.queue.ts`
- Modify: `apps/api/src/production/molding.service.ts`
- Modify: `apps/api/scripts/test-molding-execution.mjs`

- [x] **Step 1: 写造型到待浇队列失败测试**

新增断言：

- 合格数大于 0 的造型报工生成一条待浇批次。
- `originalQuantity = remainingQuantity = goodQty`。
- `closingTime = MoldingReport.reportedAt`。
- 造型废品不计入待浇数量。
- 零数量关闭不生成待浇批次。
- 路线中没有可达浇注汇合节点时，造型报工仍成功但不生成待浇批次。

- [x] **Step 2: 实现可达浇注节点解析**

`pouring.queue.ts` 根据工单锁定 `routingVersionId` 和真实 `ProcessRoutingEdge`，从造型节点向后查找 `OperationMaster.pouringMergePoint = true` 的首个可达节点。检测循环并拒绝多个同层候选，防止批次进入错误浇注节点。

- [x] **Step 3: 在造型报工事务中生成批次**

仅当 `goodQty > 0` 且存在可达汇合节点时生成。批次快照保存工单、产品、模具、造型节点和浇注节点信息。

- [x] **Step 4: 增加历史数据补建**

实现幂等 `backfillPouringMoldBatches(tx)`：为已有 `ACTIVE`、`goodQty > 0` 且尚无批次的造型报工补建队列。浇注队列首次读取和部署回归脚本均可调用，唯一约束保证重复执行不会重复创建。

- [x] **Step 5: 增加造型撤销保护**

若来源 `PouringMoldBatch` 已有有效 `PouringMoldConsumption`，返回“该造型报工已进入浇注追溯，请先撤销浇注报工”。未被浇注时撤销造型报工，将对应待浇批次置为 `CANCELED`。

- [x] **Step 6: 运行造型接口回归**

Run: `env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3001/api' npm --prefix apps/api run test:molding-execution`

Expected: PASS，测试清理新增待浇批次。

### Task 4: 浇注领域服务、接口与权限

**Files:**
- Create: `apps/api/src/production/pouring.service.ts`
- Create: `apps/api/src/production/pouring.controller.ts`
- Create: `apps/api/scripts/test-pouring-execution.mjs`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/shared/admin-default-permissions.ts`
- Modify: `apps/api/src/mold-development.controller.ts`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/package.json`

- [x] **Step 1: 写接口失败测试**

覆盖：

- 待浇队列按最早合型时间排序。
- 只返回同一生产工单分配、同材质、同汇合节点的转运包次。
- 检查接口返回理论重量、余额、`CRITICAL_HOLD` 和 `TRANSFER_OVERDRAW`。
- 未确认警告时正式提交返回 `409`。
- 确认后允许铁水包负余额。
- 一次报工跨两笔待浇批次 FIFO 扣减。
- 数量超过待浇余量返回 `400`。
- 废品缺陷必须绑定当前浇注工序且数量合计一致。
- 相同 `requestId` 重试不重复扣减。
- 撤销精确返还待浇批次，铁水包余额恢复。
- 旧 `versionNo` 返回 `409`。

- [x] **Step 2: 实现队列、包次和详情查询**

队列按造型任务聚合展示，内部保留具体批次。包次查询绑定所选队列工单并过滤真实 `HeatOrderAllocation`、材质和浇注节点。铁水余额从有效 `PouringReport.actualWeightKg` 汇总，不修改原始转运重量。

- [x] **Step 3: 实现检查接口**

`POST /pouring/check` 输入：

```ts
{
  moldingTaskId: string
  heatOrderTransferId: string
  stationEquipmentCode: string
  goodQty: number
  scrapQty: number
  actualWeightKg?: number
}
```

返回理论重量、实际重量默认值、待浇余量、包次余额、提交后余额、超用重量、停留分钟和警告代码。

- [x] **Step 4: 实现浇注报工事务**

正式提交增加 `requestId`、`transferVersionNo`、缺陷和 `confirmedWarningCodes`。事务按以下顺序执行：

1. 锁定 `HeatOrderTransfer`。
2. 校验幂等请求。
3. 重新计算匹配关系和警告。
4. 校验前端确认的警告代码。
5. 按 `closingTime -> id` 锁定待浇批次。
6. 创建报工、缺陷和批次消费。
7. 扣减待浇余量并更新批次状态。
8. 递增转运记录版本。

- [x] **Step 5: 实现撤销事务**

管理端撤销不删除报工，按消费明细返还原待浇批次并重新计算状态，递增转运记录版本，保存撤销人、时间和原因。预留后续工序引用校验入口。

- [x] **Step 6: 注册控制器和权限**

管理端：

- `production.pouring.view`
- `production.pouring.report`
- `production.pouring.reverse`

小程序：

- `mini.production.pouring.view`
- `mini.production.pouring.report`

路由、控制器、默认管理员权限和角色权限树必须同时注册。

- [x] **Step 7: 运行后端测试**

Run:

```bash
npm --prefix apps/api run build
npm --prefix apps/api run test:pouring-calculations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3001/api' npm --prefix apps/api run test:pouring-execution
```

Expected: 全部 PASS，测试数据完整清理。

### Task 5: 管理端合型浇注页面

**Files:**
- Create: `apps/admin/src/utils/pouring.ts`
- Create: `apps/admin/src/pages/production/PouringExecutionPage.tsx`
- Create: `apps/admin/src/pages/production/PouringReportModal.tsx`
- Create: `apps/admin/src/pages/production/PouringReportDetailPage.tsx`
- Create: `apps/admin/tests/pouring-ui.test.mjs`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Modify: `apps/admin/src/utils/roles.ts`

- [x] **Step 1: 写管理端页面失败测试**

断言：

- 页面路由和菜单受 `production.pouring.view` 控制。
- 页面标题右侧有查询和报工按钮。
- 标签页包含待浇、部分浇注、已完成、严重超时。
- 列表使用 `ResizableTable`，操作列固定右侧。
- 报工按钮受 `production.pouring.report` 控制。
- 撤销按钮受 `production.pouring.reverse` 控制。
- 页面调用真实 `/admin/production/pouring/*` 接口。

- [x] **Step 2: 实现 API 类型和调用封装**

定义队列、包次、预检、报工、详情、缺陷和撤销类型。所有请求使用现有 `apiRequest`，不得使用本地状态假成功。

- [x] **Step 3: 实现队列与报工页面**

页面遵循 BOM/造型列表标准。报工表单分为铁水包、待浇任务、浇注成果三个区块；理论重量只读，实际重量可修改；超时和超重合并到一个确认框。

- [x] **Step 4: 实现详情和撤销**

详情展示炉次、包次、造型批次分配、重量、缺陷、警告、操作人与时间。撤销填写原因，成功后刷新真实接口。

- [x] **Step 5: 运行管理端测试与构建**

Run:

```bash
node --test apps/admin/tests/pouring-ui.test.mjs
npm --prefix apps/admin run build
```

Expected: PASS；允许保留现有大包体积告警，不允许 TypeScript 错误。

### Task 6: 小程序合型浇注报工

**Files:**
- Create: `apps/miniprogram/src/pages/pouring/list/index.ts`
- Create: `apps/miniprogram/src/pages/pouring/list/index.wxml`
- Create: `apps/miniprogram/src/pages/pouring/list/index.wxss`
- Create: `apps/miniprogram/src/pages/pouring/report/index.ts`
- Create: `apps/miniprogram/src/pages/pouring/report/index.wxml`
- Create: `apps/miniprogram/src/pages/pouring/report/index.wxss`
- Create: `apps/miniprogram/tests/pouring-pages.test.cjs`
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/home/index.ts`
- Modify: `apps/miniprogram/src/pages/home/index.wxml`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/types/business.ts`

- [x] **Step 1: 写小程序失败测试**

断言：

- 注册列表和报工页面。
- 九宫格入口只由 `mini.production.pouring.view` 控制。
- 列表支持扫码、查询和下拉刷新。
- 报工支持包次选择/扫码、任务选择、数量快捷调整和一键清完。
- 实际重量默认理论值且可修改。
- 废品大于 0 时显示当前浇注工序缺陷。
- 超时和超重统一二次确认。
- 接口使用真实 `/mini/production/pouring/*`。

- [x] **Step 2: 实现真实 API 和业务类型**

复用现有请求层的超时、登录失效和 `409` 处理；图片功能不在本模块范围内。

- [x] **Step 3: 实现待浇列表**

卡片按最早合型时间排列，显示派工单、产品、剩余箱数、停留时长和颜色状态。支持扫码造型派工单、下拉刷新和状态标签页。

- [x] **Step 4: 实现报工页**

按步骤选择工位、具体包次和待浇任务；支持快捷数量、实际重量、缺陷明细、预检及统一确认。`requestId` 在页面实例内保持稳定，重复点击不产生重复报工。

- [x] **Step 5: 运行小程序测试和构建**

Run: `npm --prefix apps/miniprogram test`

Expected: 全部 PASS，`apps/miniprogram/dist` 已同步。

### Task 7: 文档、完整回归与 Docker 部署

**Files:**
- Modify: `docs/product/context-summary.md`
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/superpowers/plans/2026-08-24-pouring-execution.md`

- [x] **Step 1: 固化长期业务规则**

记录待浇批次、同工单/材质/汇合节点匹配、重量超用、停留预警、工序缺陷、撤销顺序、幂等和并发锁规则，并链接设计文档。

- [x] **Step 2: 执行完整回归**

Run:

```bash
npm --prefix apps/api run build
npm --prefix apps/api run test:pouring-calculations
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3001/api' npm --prefix apps/api run test:pouring-execution
env DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3001/api' npm --prefix apps/api run test:molding-execution
node --test apps/admin/tests/pouring-ui.test.mjs
npm --prefix apps/admin run build
npm --prefix apps/miniprogram test
git diff --check
```

- [x] **Step 3: 重建并验证 Docker**

Run:

```bash
npm run docker:up
npm run docker:ps
curl -fsS http://127.0.0.1:3000/api/health
```

Expected: PostgreSQL healthy，API 与管理端运行，健康接口返回 `status: ok`。
