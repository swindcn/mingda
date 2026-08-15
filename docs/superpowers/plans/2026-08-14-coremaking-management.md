# 制芯工序与砂芯库存管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为生产工单增加手动制芯任务拆分、派工、多次报工、砂芯批次库存、烘干与保质期管理，并提供管理端、小程序及未来造型领用服务接口。

**Architecture:** 在现有生产模块旁新增独立 `coremaking` 领域服务和控制器，使用真实 Prisma relation 关联生产工单、BOM、路线节点、芯盒、设备、班组和用户。管理端负责生成、派工和库存管理，小程序负责班组任务执行；库存校验和扣减作为无页面依赖的领域方法供未来造型模块复用。

**Tech Stack:** NestJS 11、Prisma 6、PostgreSQL、React 19、Ant Design 6、微信原生小程序、Node test scripts、Docker Compose。

---

### Task 1: 制芯计算函数与 Prisma 数据模型

**Files:**
- Create: `apps/api/src/production/coremaking.calculations.ts`
- Create: `apps/api/scripts/test-coremaking-calculations.mjs`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 写计算函数失败测试**

覆盖需求量向上取整、压盒次数向上取整、保质期为空、免烘干从报工时间起算、需烘干从烘干确认时间起算、24 小时临期边界和超期边界。

```js
assert.equal(calculateCoreDemand(100, 2, 0.03), 206)
assert.equal(calculatePressCount(206, 4), 52)
assert.equal(coreBatchStatus(now, addHours(now, 24)), 'WARNING')
assert.equal(coreBatchStatus(now, now), 'EXPIRED')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node apps/api/scripts/test-coremaking-calculations.mjs`
Expected: FAIL，提示模块或函数不存在。

- [ ] **Step 3: 实现纯计算函数**

实现并导出：

```ts
calculateCoreDemand(workOrderQuantity, quantityPerProduct, expectedScrapRate)
calculatePressCount(plannedQuantity, cavityCount)
calculateCoreExpiresAt(baseTime, shelfLifeHours)
coreBatchStatus(now, expiresAt)
```

所有数量先校验有限数和正数，再用 `Math.ceil` 计算计划整数。

- [ ] **Step 4: 增加 Prisma enum 与 relation**

新增：

```prisma
enum CoreTaskStatus { PENDING_DISPATCH WAITING IN_PROGRESS COMPLETED CANCELED }
enum CoreBatchStatus { UNDRIED AVAILABLE WARNING EXPIRED LOCKED SCRAPPED CONSUMED }
enum CoreInventoryAction { PRODUCED CONSUMED LOCKED UNLOCKED SCRAPPED ADJUSTED }
```

新增 `CoreProductionTask`、`CoreProductionReport`、`CoreInventoryBatch`、`CoreInventoryLedger`，并在 `WorkOrder`、`CastingBomVersion`、`ProcessRoutingNode`、`CoreBoxMaster`、`Furnace`、`Team`、`User` 上补反向 relation。任务添加 `@@unique([workOrderId, coreBoxCode])`，批次编码添加 `@unique`，任务和批次添加 `versionNo`。

- [ ] **Step 5: 生成 Prisma Client 并同步测试数据库**

Run: `npm --prefix apps/api run prisma:generate`
Run: `DATABASE_URL=postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public npm --prefix apps/api exec prisma db push`
Expected: Prisma Client 生成成功，数据库结构同步成功。

- [ ] **Step 6: 运行计算测试并提交**

Run: `node apps/api/scripts/test-coremaking-calculations.mjs`
Expected: PASS。

Commit: `feat: add coremaking domain models`

### Task 2: 任务预览、生成与派工后端

**Files:**
- Create: `apps/api/src/production/coremaking.types.ts`
- Create: `apps/api/src/production/coremaking.service.ts`
- Create: `apps/api/src/production/coremaking.controller.ts`
- Create: `apps/api/scripts/test-coremaking-tasks.mjs`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/production/production.service.ts`

- [ ] **Step 1: 写任务接口失败测试**

准备两类生产工单：无制芯节点、有制芯节点且 BOM 包含多个芯盒。断言：

```js
assert.equal(noCoreWorkOrder.canGenerateCoreTasks, false)
assert.equal(preview.rows.length, 3)
assert.equal(preview.rows[0].plannedQuantity, Math.ceil(100 * 2 * 1.03))
assert.equal(preview.rows[0].plannedPressCount, Math.ceil(preview.rows[0].plannedQuantity / 4))
```

同时覆盖 BOM 无芯盒、重复生成、非法路线节点、节点未绑定设备、设备停用、班组与设备车间不一致。

- [ ] **Step 2: 运行测试确认失败**

Run: `node apps/api/scripts/test-coremaking-tasks.mjs`
Expected: FAIL，接口不存在。

- [ ] **Step 3: 实现预览与生成服务**

`CoremakingService.previewTasks()` 读取工单锁定的路线节点及 BOM 芯盒关系，只返回尚未生成的芯盒。`createTasks()` 在串行化事务中重新计算，不信任前端计划量，并保存全部快照和数据归属。

接口：

```ts
POST /admin/production/work-orders/:id/core-tasks/preview
POST /admin/production/work-orders/:id/core-tasks
```

- [ ] **Step 4: 实现列表、详情与派工**

接口：

```ts
GET /admin/production/core-tasks
GET /admin/production/core-tasks/:id
PUT /admin/production/core-tasks/:id/dispatch
POST /admin/production/core-tasks/:id/cancel
```

派工只允许 `PENDING_DISPATCH/WAITING` 且没有报工记录的任务；取消只允许无报工记录任务。DTO 返回快照、累计数量、状态和 `canDispatch/canStart/canReport/canCancel`。

- [ ] **Step 5: 把生成能力与汇总接入生产工单详情**

`workOrderDto` 增加：

```ts
requiresCoremaking
canGenerateCoreTasks
coreTaskCount
coreTaskSummary
```

无制芯路线返回 `requiresCoremaking: false`。

- [ ] **Step 6: 运行任务测试和 API 构建**

Run: `node apps/api/scripts/test-coremaking-tasks.mjs`
Run: `npm --prefix apps/api run build`
Expected: PASS。

Commit: `feat: add core task scheduling api`

### Task 3: 多次报工、砂芯批次与库存服务

**Files:**
- Create: `apps/api/scripts/test-coremaking-execution.mjs`
- Modify: `apps/api/src/production/coremaking.types.ts`
- Modify: `apps/api/src/production/coremaking.service.ts`
- Modify: `apps/api/src/production/coremaking.controller.ts`

- [ ] **Step 1: 写执行与库存失败测试**

覆盖开始任务、两次报工、多批次编码唯一、累计完成、超产、待烘干不可用、烘干确认、免烘干直接可用、失效时间计算、重复报工版本冲突、冻结与报废。

```js
assert.equal(firstBatch.status, 'UNDRIED')
assert.equal(driedBatch.status, 'AVAILABLE')
assert.equal(task.qualifiedQuantity, report1.qualifiedQuantity + report2.qualifiedQuantity)
assert.equal(task.status, 'COMPLETED')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node apps/api/scripts/test-coremaking-execution.mjs`
Expected: FAIL，执行接口不存在。

- [ ] **Step 3: 实现开始和报工事务**

接口：

```ts
POST /admin/production/core-tasks/:id/start
POST /admin/production/core-tasks/:id/report
```

报工事务同时创建 `CoreProductionReport`、`CoreInventoryBatch`、`CoreInventoryLedger(PRODUCED)`，累计任务数量并按计划量判断完成。批次编码使用业务日期、班次和三位流水，唯一冲突自动重试。

- [ ] **Step 4: 实现烘干、冻结、解冻和报废**

接口：

```ts
POST /admin/production/core-batches/:id/dry
POST /admin/production/core-batches/:id/lock
POST /admin/production/core-batches/:id/unlock
POST /admin/production/core-batches/:id/scrap
```

烘干设备必须是启用且类型明确包含“烘干”或“干燥”的设备，射芯机和制芯机不能被误选。每个状态操作校验 `versionNo` 并写库存流水或状态记录。

- [ ] **Step 5: 实现库存列表与实时状态刷新**

```ts
GET /admin/production/core-inventory
```

读取前按当前时间刷新临期/超期；超期批次更新为 `EXPIRED`，但不修改 `currentQuantity`，由状态阻止使用。

- [ ] **Step 6: 运行执行测试和构建**

Run: `node apps/api/scripts/test-coremaking-execution.mjs`
Run: `npm --prefix apps/api run build`
Expected: PASS。

Commit: `feat: add core batch inventory execution`

### Task 4: 齐套计算、未来造型接口与定时刷新

**Files:**
- Create: `apps/api/scripts/test-core-readiness.mjs`
- Modify: `apps/api/src/production/coremaking.service.ts`
- Modify: `apps/api/src/production/coremaking.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 写齐套和领用服务失败测试**

断言待烘干、超期、冻结和报废批次不计可用库存；`WARNING` 计入并优先领用；错误产品 BOM、错误芯盒、库存不足和并发扣减被拒绝。

- [ ] **Step 2: 实现齐套接口**

```ts
GET /admin/production/work-orders/:id/core-readiness
```

逐芯盒返回 `requiredQuantity/availableQuantity/undriedQuantity/shortageQuantity/minRemainingHours/readinessStatus`，总齐套率按需求量加权计算。

- [ ] **Step 3: 实现无页面依赖的未来造型领域方法**

```ts
validateCoreConsumption(workOrderId, batchCode, quantity)
consumeCoreBatch(workOrderId, batchCode, quantity, operatorContext)
```

消费使用事务和版本条件更新，写 `CONSUMED` 流水，禁止负库存。批次耗尽后状态改为 `CONSUMED`。

- [ ] **Step 4: 加入定时状态刷新**

安装 `@nestjs/schedule`，在 `AppModule` 注册 `ScheduleModule.forRoot()`。服务每 10 分钟刷新临期与超期批次；读写接口仍实时刷新目标批次。

- [ ] **Step 5: 运行齐套测试和全部后端回归**

Run: `node apps/api/scripts/test-core-readiness.mjs`
Run: `npm --prefix apps/api run test:casting-boms`
Run: `npm --prefix apps/api run test:mold-coreboxes`
Run: `npm --prefix apps/api run test:production-execution`
Expected: 全部 PASS。

Commit: `feat: add core readiness and consumption services`

### Task 5: 权限树、管理端 API 类型和导航

**Files:**
- Create: `apps/admin/src/utils/coremaking.ts`
- Create: `apps/admin/tests/coremaking-permissions.test.mjs`
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/api/src/production/production-permission.guard.ts`

- [ ] **Step 1: 写权限失败测试**

断言管理端和小程序权限树包含设计规范全部权限，导航项和路由分别由 `production.core_task.view`、`production.core_inventory.view` 保护，页面外按钮使用具体操作权限。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test apps/admin/tests/coremaking-permissions.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 增加权限树与后端守卫映射**

添加：

```text
production.core_task.view/create/dispatch/edit/cancel/report/dry
production.core_inventory.view/dry/lock/scrap
mini.production.core.view/start/report/dry
```

后端根据路径和动作映射到最小权限，不让 `view` 隐含业务操作。

- [ ] **Step 4: 增加前端类型和请求函数**

`coremaking.ts` 定义任务、批次、齐套、预览、派工、报工 DTO，并实现所有 `/admin/production/core-*` 请求。

- [ ] **Step 5: 增加导航和受保护路由占位**

路由：

```text
/dashboard/production/core-tasks
/dashboard/production/core-tasks/:id
/dashboard/production/core-inventory
```

- [ ] **Step 6: 运行权限测试和构建**

Run: `node --test apps/admin/tests/coremaking-permissions.test.mjs`
Run: `npm --prefix apps/admin run build`
Expected: PASS。

Commit: `feat: register coremaking permissions and routes`

### Task 6: 管理端任务、库存和工单齐套页面

**Files:**
- Create: `apps/admin/src/pages/production/CoreTaskListPage.tsx`
- Create: `apps/admin/src/pages/production/CoreTaskDetailPage.tsx`
- Create: `apps/admin/src/pages/production/CoreTaskGenerationModal.tsx`
- Create: `apps/admin/src/pages/production/CoreInventoryPage.tsx`
- Create: `apps/admin/src/pages/production/CoreBatchLabel.tsx`
- Create: `apps/admin/src/pages/production/CoreReadinessPanel.tsx`
- Create: `apps/admin/tests/coremaking-ui.test.mjs`
- Modify: `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: 写页面结构失败测试**

断言生成按钮由 `requiresCoremaking/canGenerateCoreTasks` 和权限共同控制；生成工作台展示废品率、需求量、压盒次数、工序、设备、班组；列表使用 `ResizableTable` 和 `TableActions`；库存有状态页签；操作按钮均权限控制。

- [ ] **Step 2: 实现生产工单制芯入口与齐套面板**

无制芯路线显示“该工单无需制芯”且不渲染生成按钮；有制芯路线按 API 能力显示生成或查看入口。详情底部展示齐套明细。

- [ ] **Step 3: 实现制芯任务生成工作台**

芯盒逐行编辑预计废品率、工序、设备、班组和计划时间，需求量与压盒次数实时联动；提交前后端都重新校验。

- [ ] **Step 4: 实现任务列表和详情**

支持查询刷新、状态标签、派工、取消、管理端开始/报工/烘干操作；操作列固定且最多三个可见操作。

- [ ] **Step 5: 实现砂芯库存和标签打印**

库存按状态标签筛选，显示剩余小时；提供烘干确认、冻结、解冻、报废和标签预览。标签使用二维码图片接口或前端二维码组件并提供 `window.print()` 打印样式。

- [ ] **Step 6: 运行全部管理端测试和构建**

Run: `node --test apps/admin/tests/*.test.mjs`
Run: `npm --prefix apps/admin run build`
Expected: PASS。

Commit: `feat: add coremaking admin workspace`

### Task 7: 小程序制芯任务执行

**Files:**
- Create: `apps/miniprogram/src/pages/core/list/index.ts`
- Create: `apps/miniprogram/src/pages/core/list/index.wxml`
- Create: `apps/miniprogram/src/pages/core/list/index.wxss`
- Create: `apps/miniprogram/src/pages/core/list/index.json`
- Create: `apps/miniprogram/src/pages/core/detail/index.ts`
- Create: `apps/miniprogram/src/pages/core/detail/index.wxml`
- Create: `apps/miniprogram/src/pages/core/detail/index.wxss`
- Create: `apps/miniprogram/src/pages/core/detail/index.json`
- Create: `apps/miniprogram/src/pages/core/report/index.ts`
- Create: `apps/miniprogram/src/pages/core/report/index.wxml`
- Create: `apps/miniprogram/src/pages/core/report/index.wxss`
- Create: `apps/miniprogram/src/pages/core/report/index.json`
- Create: `apps/miniprogram/src/pages/core/dry/index.ts`
- Create: `apps/miniprogram/src/pages/core/dry/index.wxml`
- Create: `apps/miniprogram/src/pages/core/dry/index.wxss`
- Create: `apps/miniprogram/src/pages/core/dry/index.json`
- Create: `apps/miniprogram/tests/coremaking-pages.test.cjs`
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/home/index.ts`
- Modify: `apps/miniprogram/src/pages/home/index.wxml`
- Modify: `apps/miniprogram/src/pages/home/index.wxss`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/types/business.ts`

- [ ] **Step 1: 写小程序页面失败测试**

断言 app 路由、首页权限入口、列表下拉刷新、状态页签、详情 `canStart/canReport/canDry`、报工两个数量字段、混砂批次扫码入口和烘干设备选择均存在。

- [ ] **Step 2: 增加 DTO 与 API 请求**

实现 `/mini/production/core-tasks` 列表、详情、开始、报工和 `/mini/production/core-batches/:id/dry` 请求。

- [ ] **Step 3: 实现首页入口和任务列表**

首页按 `mini.production.core.view` 显示入口；任务列表只展示后端返回数据，支持下拉刷新和待生产/生产中/已完成页签。

- [ ] **Step 4: 实现详情、报工和烘干确认**

报工显示当前操作人，输入合格数、报废数、废品原因，扫码或手输混砂批次，选择烘干要求；烘干确认选择设备并展示预计失效时间。

- [ ] **Step 5: 构建并运行小程序测试**

Run: `npm --prefix apps/miniprogram test`
Run: `npm run typecheck:miniprogram`
Expected: PASS，`apps/miniprogram/dist` 含全部新增页面。

Commit: `feat: add coremaking miniprogram execution`

### Task 8: 文档、Docker 集成和端到端回归

**Files:**
- Modify: `docs/product/context-summary.md`
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`
- Modify: `README.md`

- [ ] **Step 1: 更新项目上下文和业务关系**

记录生产工单、BOM 芯盒、制芯任务、砂芯批次、库存流水及未来造型领用的关系；注明任务手动生成、保质期起算规则和权限键。

- [ ] **Step 2: 增加 MDM 自动化测试用例**

从 `MDM-093` 起覆盖生成、计算、派工、多次报工、烘干、临期、超期、齐套、权限和并发。

- [ ] **Step 3: 执行完整构建**

Run: `npm --prefix apps/api run build`
Run: `npm --prefix apps/admin run build`
Run: `npm --prefix apps/miniprogram test`
Expected: 全部 PASS。

- [ ] **Step 4: 更新本地 Docker**

同步 Prisma schema、API dist、管理端 dist，重启 `mingda-api-dev`，重新加载 `mingda-admin-dev`，确认：

```text
http://127.0.0.1:3000/api/health
http://127.0.0.1:8080/dashboard/production/core-tasks
```

- [ ] **Step 5: 在 Docker 端口执行接口回归**

Run: `npm --prefix apps/api run test:coremaking-tasks`
Run: `npm --prefix apps/api run test:coremaking-execution`
Run: `npm --prefix apps/api run test:core-readiness`
Expected: 全部 PASS 且测试数据自动清理。

- [ ] **Step 6: 浏览器与微信开发者工具验收**

验证未登录子路由保护、权限按钮、生产工单生成入口、制芯任务列表、库存状态；确认小程序 `dist` 页面可加载且正式接口地址配置未被覆盖。

- [ ] **Step 7: 最终提交**

Commit: `docs: complete coremaking implementation`
