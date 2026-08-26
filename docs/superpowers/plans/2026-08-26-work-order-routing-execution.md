# Work Order Routing Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the locked process routing on a work-order detail page into the single entry point for dispatching and inspecting each production operation, while changing melt scheduling from automatic pool entry to an explicit manual release.

**Architecture:** Add a nullable melt-release marker to `WorkOrder`, then introduce a focused `WorkOrderRoutingExecutionService` that aggregates real task and queue data into one node DTO without duplicating domain write logic. The admin page renders this server-owned summary, reuses the existing core/molding generation modals, calls one new melt-release endpoint, and routes all task viewing to module lists filtered by `workOrderId`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, React 19, TypeScript 6, Ant Design 6, native Node integration tests.

---

## File Structure

- Create `apps/api/src/production/work-order-routing-execution.types.ts`: stable response types and operation-module constants.
- Create `apps/api/src/production/work-order-routing-execution.service.ts`: node classification, task aggregation, action permissions, and melt release transaction.
- Create `apps/api/scripts/test-work-order-routing-execution.mjs`: integration and source-contract regression coverage.
- Create `apps/admin/tests/work-order-routing-execution-ui.test.mjs`: static UI contract checks for route actions and removal of header task controls.
- Modify `apps/api/prisma/schema.prisma`: persist melt release time and operator relation.
- Modify `apps/api/src/production/work-order.controller.ts`: expose routing summary and melt-release endpoints.
- Modify `apps/api/src/production/production.service.ts`: stop automatic pool entry and filter the melt pool by explicit release.
- Modify `apps/api/src/production/production-permission.guard.ts`: guard summary and melt release with separate permissions.
- Modify `apps/api/src/shared/admin-default-permissions.ts`: grant the new release permission to the super administrator.
- Modify `apps/api/src/app.module.ts`: register the routing execution service.
- Modify list controllers/services for core, heat, molding, pouring, shake-clean, and inspection: accept `workOrderId` filters.
- Modify `apps/admin/src/utils/production.ts`: add route execution DTO and API functions.
- Modify task-specific admin utilities: forward `workOrderId` to list APIs.
- Modify `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`: replace the static routing preview and remove top-right task controls.
- Modify six task list pages: read, retain, and forward `workOrderId`.
- Modify `apps/admin/src/utils/roles.ts`: add “合炉排产-下达工单”.
- Modify `apps/api/package.json`: add a focused test command.

### Task 1: Persist Explicit Melt Release

**Files:**
- Modify: `apps/api/prisma/schema.prisma:1196-1272`
- Test: `apps/api/scripts/test-work-order-routing-execution.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write the failing schema contract test**

Create `apps/api/scripts/test-work-order-routing-execution.mjs` with an initial source contract:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.match(schema, /meltReleasedAt\s+DateTime\?/, 'WorkOrder must persist explicit melt release time')
assert.match(schema, /meltReleasedByUserId\s+String\?/, 'WorkOrder must persist the release operator')
console.log('work-order routing execution schema contract passed')
```

Add to `apps/api/package.json`:

```json
"test:work-order-routing": "npm run prisma:generate && npm run build && node scripts/test-work-order-routing-execution.mjs"
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node apps/api/scripts/test-work-order-routing-execution.mjs`

Expected: FAIL with `WorkOrder must persist explicit melt release time`.

- [ ] **Step 3: Add fields and relations**

Add to `WorkOrder`:

```prisma
meltReleasedAt       DateTime?
meltReleasedByUserId String?
meltReleasedBy       User? @relation("WorkOrderMeltReleaser", fields: [meltReleasedByUserId], references: [id], onUpdate: Cascade, onDelete: SetNull)
```

Add the inverse relation to `User` using the existing relation-array naming pattern:

```prisma
meltReleasedWorkOrders WorkOrder[] @relation("WorkOrderMeltReleaser")
```

Add `@@index([meltReleasedAt])` and `@@index([meltReleasedByUserId])` to `WorkOrder`.

- [ ] **Step 4: Generate Prisma client and verify the contract**

Run:

```bash
npm --prefix apps/api run prisma:generate
node apps/api/scripts/test-work-order-routing-execution.mjs
```

Expected: Prisma generation succeeds and the schema contract prints PASS.

- [ ] **Step 5: Commit the schema slice**

```bash
git add apps/api/prisma/schema.prisma apps/api/scripts/test-work-order-routing-execution.mjs apps/api/package.json
git commit -m "feat(api): persist work order melt release"
```

### Task 2: Stop Automatic Melt-Pool Entry

**Files:**
- Modify: `apps/api/src/production/production.service.ts:520-710`
- Modify: `apps/api/scripts/test-work-order-routing-execution.mjs`

- [ ] **Step 1: Add failing source and integration assertions**

Extend the test to verify:

```js
const productionSource = await readFile(new URL('../src/production/production.service.ts', import.meta.url), 'utf8')
assert.match(productionSource, /meltReleasedAt:\s*\{\s*not:\s*null\s*\}/, 'melt pool must require explicit release')
assert.doesNotMatch(productionSource, /data:\s*\{[^}]*meltReleasedAt:\s*new Date\(\)/s, 'work-order creation must not auto-release melt')
```

When `DATABASE_URL` is available, create two isolated work orders with the existing test fixture helpers: leave one unreleased and set the second `meltReleasedAt`. Call `ProductionService.meltPool()` with an all-access request and assert only the released order is present.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm --prefix apps/api run test:work-order-routing`

Expected: FAIL because `meltPool()` currently returns every open order with remaining quantity.

- [ ] **Step 3: Filter the pool at the database boundary**

Change `meltPool()` to query only released orders instead of filtering the unrestricted work-order list in memory:

```ts
const records = await this.prisma.workOrder.findMany({
  where: {
    ...(ids ? { id: { in: ids } } : {}),
    meltReleasedAt: { not: null },
    productionStatus: { not: 'CLOSED' },
  },
  include: this.workOrderInclude(),
  orderBy: { createdAt: 'desc' },
})
const pendingRecords = records.filter((record) => record.scheduledQuantity < record.plannedQuantity)
```

Prisma does not provide a portable field-to-field comparison for this query, so the explicit-release and open-order conditions stay in PostgreSQL while the remaining-quantity comparison stays in application code. Do not reintroduce unreleased records.

New `WorkOrder` rows keep `meltReleasedAt = null`; no create-path assignment is added.

- [ ] **Step 4: Add a one-time historical backfill command**

Add `apps/api/scripts/backfill-work-order-melt-release.mjs` that runs:

```js
await prisma.$executeRaw`
  UPDATE "WorkOrder"
  SET "meltReleasedAt" = "createdAt"
  WHERE "meltReleasedAt" IS NULL
`
```

The deployment sequence runs this immediately after `prisma db push` and before restarting the API. It preserves all work orders created under the old automatic-release rule.

- [ ] **Step 5: Run focused and existing production tests**

Run:

```bash
npm --prefix apps/api run test:work-order-routing
npm --prefix apps/api run test:production-execution
```

Expected: PASS; an unreleased new work order is absent from the pool while historical/released work orders remain visible.

- [ ] **Step 6: Commit the pool behavior**

```bash
git add apps/api/src/production/production.service.ts apps/api/scripts/test-work-order-routing-execution.mjs apps/api/scripts/backfill-work-order-melt-release.mjs
git commit -m "feat(api): require manual melt release"
```

### Task 3: Build the Routing Execution Summary Service

**Files:**
- Create: `apps/api/src/production/work-order-routing-execution.types.ts`
- Create: `apps/api/src/production/work-order-routing-execution.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/scripts/test-work-order-routing-execution.mjs`

- [ ] **Step 1: Add failing status-mapper tests**

Export pure helpers and test at least these cases:

```js
assert.equal(classifyExecutionModule({ code: 'OP-CORE', section: '制芯' }), 'CORE')
assert.equal(classifyExecutionModule({ code: 'CUSTOM-CORE', section: '制芯' }), 'CORE')
assert.equal(classifyExecutionModule({ code: 'OP-POUR', section: '浇注' }), 'POURING')
assert.equal(classifyExecutionModule({ code: 'CUSTOM-UNKNOWN', section: '后处理' }), 'UNSUPPORTED')

assert.deepEqual(summarizeStatuses(['WAITING', 'COMPLETED']), {
  progressStatus: 'PARTIAL_COMPLETED',
  progressLabel: '部分完成',
})
```

- [ ] **Step 2: Run the test and verify missing module failure**

Run: `npm --prefix apps/api run test:work-order-routing`

Expected: FAIL because the service and helpers do not exist.

- [ ] **Step 3: Define the stable DTO**

Create the types file with:

```ts
export type ExecutionModule = 'CORE' | 'MELT' | 'MOLDING' | 'POURING' | 'SHAKE_CLEAN' | 'INSPECTION' | 'UNSUPPORTED'
export type DispatchStatus = 'PENDING' | 'PARTIAL' | 'RELEASED' | 'WAITING_UPSTREAM' | 'UNSUPPORTED'
export type RoutingNodeAction = 'CREATE' | 'RELEASE_MELT' | 'VIEW' | 'WAIT' | 'NONE'

export interface WorkOrderRoutingExecutionNode {
  nodeId: string
  seqNo: number
  operationCode: string
  operationName: string
  module: ExecutionModule
  dispatchStatus: DispatchStatus
  dispatchLabel: string
  progressStatus: string
  progressLabel: string
  progressText: string
  progressCurrent: number | null
  progressTotal: number | null
  progressUnit: string
  equipmentNames: string[]
  teamNames: string[]
  taskCount: number
  action: RoutingNodeAction
  actionEnabled: boolean
  actionPermission: string
  actionHint: string
}
```

- [ ] **Step 4: Implement focused per-module aggregators**

Create `WorkOrderRoutingExecutionService` with one private aggregator per module:

```ts
private summarizeCore(workOrder: WorkOrderExecutionContext, nodeId: string): WorkOrderRoutingExecutionNode
private summarizeMelt(workOrder: WorkOrderExecutionContext, nodeId: string): WorkOrderRoutingExecutionNode
private summarizeMolding(workOrder: WorkOrderExecutionContext, nodeId: string): WorkOrderRoutingExecutionNode
private summarizePouring(workOrder: WorkOrderExecutionContext, nodeId: string): WorkOrderRoutingExecutionNode
private summarizeShakeClean(workOrder: WorkOrderExecutionContext, nodeId: string): WorkOrderRoutingExecutionNode
private summarizeInspection(workOrder: WorkOrderExecutionContext, nodeId: string): WorkOrderRoutingExecutionNode
```

Rules must match the design spec: task existence controls dispatch state; task status/report quantities control progress; actual task equipment/team snapshots populate resource columns; route-compatible equipment is never shown as assigned equipment.

- [ ] **Step 5: Register the service and run tests**

Add `WorkOrderRoutingExecutionService` to `AppModule.providers`.

Run: `npm --prefix apps/api run test:work-order-routing`

Expected: all pure mapping and aggregate fixture assertions PASS.

- [ ] **Step 6: Commit the summary service**

```bash
git add apps/api/src/production/work-order-routing-execution.types.ts apps/api/src/production/work-order-routing-execution.service.ts apps/api/src/app.module.ts apps/api/scripts/test-work-order-routing-execution.mjs
git commit -m "feat(api): summarize routing node execution"
```

### Task 4: Add Summary and Melt-Release Endpoints with Permissions

**Files:**
- Modify: `apps/api/src/production/work-order.controller.ts`
- Modify: `apps/api/src/production/work-order-routing-execution.service.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/shared/admin-default-permissions.ts`
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/api/scripts/test-work-order-routing-execution.mjs`

- [ ] **Step 1: Add failing endpoint and permission tests**

Assert the controller exposes:

```text
GET  /admin/production/work-orders/:id/routing-execution
POST /admin/production/work-orders/:id/melt-release
```

Test that an all-access user can read and release, a user without `production.schedule.release` receives 403, and a user outside the work-order data scope cannot read or release the order.

- [ ] **Step 2: Implement controller methods**

Inject the new service and add:

```ts
@Get(':id/routing-execution')
routingExecution(@Req() request: RequestWithAdmin, @Param('id') id: string) {
  return this.routingExecutionService.getSummary(request, id)
}

@Post(':id/melt-release')
releaseMelt(@Req() request: RequestWithAdmin, @Param('id') id: string) {
  return this.routingExecutionService.releaseMelt(request, id)
}
```

- [ ] **Step 3: Implement idempotent release**

Within a Prisma transaction:

```ts
await lockWorkOrder(tx, id)
const current = await tx.workOrder.findUnique({ where: { id }, include: releaseReadinessInclude })
if (!current) throw new NotFoundException('生产工单不存在')
if (current.productionStatus === 'CLOSED') throw new BadRequestException('已关闭工单不能下达熔炼')
if (!current.meltReleasedAt) {
  await tx.workOrder.update({
    where: { id },
    data: { meltReleasedAt: new Date(), meltReleasedByUserId: user.id },
  })
}
```

Return `{ released: true, releasedAt, warnings }`. `warnings` includes unfinished core task and undried batch counts, but never blocks release.

- [ ] **Step 4: Add permission mapping**

Map routes before the generic `/work-orders` branch:

```ts
if (/\/work-orders\/[^/]+\/routing-execution$/.test(path) && method === 'GET') return 'production.work_order.view'
if (/\/work-orders\/[^/]+\/melt-release$/.test(path) && method === 'POST') return 'production.schedule.release'
```

Add `production.schedule.release` to administrator defaults and add “合炉排产-下达工单” under the existing schedule permission group.

- [ ] **Step 5: Run permission and concurrency tests**

Run:

```bash
npm --prefix apps/api run test:work-order-routing
npm run test:permissions
```

Expected: PASS, including two concurrent release calls producing one persisted release marker.

- [ ] **Step 6: Commit API actions**

```bash
git add apps/api/src/production/work-order.controller.ts apps/api/src/production/work-order-routing-execution.service.ts apps/api/src/production/production-permission.guard.ts apps/api/src/shared/admin-default-permissions.ts apps/admin/src/utils/roles.ts apps/api/scripts/test-work-order-routing-execution.mjs
git commit -m "feat: add routing execution actions"
```

### Task 5: Support Work-Order Filters in Every Execution List

**Files:**
- Modify: `apps/api/src/production/melt-scheduling.controller.ts`
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/api/src/production/molding.controller.ts`
- Modify: `apps/api/src/production/molding.service.ts`
- Modify: `apps/api/src/production/pouring.controller.ts`
- Modify: `apps/api/src/production/pouring.service.ts`
- Modify: `apps/api/src/production/shake-clean.controller.ts`
- Modify: `apps/api/src/production/shake-clean.service.ts`
- Modify: `apps/api/src/production/final-inspection.controller.ts`
- Modify: `apps/api/src/production/final-inspection.service.ts`
- Modify: `apps/admin/src/utils/production.ts`
- Modify: `apps/admin/src/utils/molding.ts`
- Modify: `apps/admin/src/utils/pouring.ts`
- Modify: `apps/admin/src/utils/shakeClean.ts`
- Modify: `apps/admin/src/utils/finalInspection.ts`
- Test: `apps/api/scripts/test-work-order-routing-execution.mjs`

- [ ] **Step 1: Add failing list-filter tests**

For each module, create records for two work orders, request the list with `workOrderId` for the first, and assert every row belongs to that order. Core already supports this parameter and acts as the reference implementation.

- [ ] **Step 2: Add optional controller query parameters**

Use the same shape in each controller:

```ts
@Query('workOrderId') workOrderId?: string
```

Pass it into service filters without replacing keyword/status filters.

- [ ] **Step 3: Apply database-level relation filters**

Examples:

```ts
// HeatOrder
...(workOrderId ? { allocations: { some: { workOrderId } } } : {})

// MoldingTask
...(workOrderId ? { workOrderId } : {})

// Pouring/Shake/Inspection queues
...(workOrderId ? { workOrderId } : {})
```

Do not fetch all records and filter after pagination.

- [ ] **Step 4: Forward filters in admin API utilities**

Change utility signatures to parameter objects where needed, for example:

```ts
export function fetchHeatOrders(params: { status?: HeatOrderStatus; workOrderId?: string } = {}) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.workOrderId) query.set('workOrderId', params.workOrderId)
  return apiRequest<HeatOrderRecord[]>(`/admin/production/heat-orders${query.size ? `?${query}` : ''}`)
}
```

- [ ] **Step 5: Run focused module tests**

Run:

```bash
npm --prefix apps/api run test:work-order-routing
npm --prefix apps/api run test:molding-execution
npm --prefix apps/api run test:pouring-execution
npm --prefix apps/api run test:shake-clean-execution
npm --prefix apps/api run test:final-inspection-execution
```

Expected: all lists return only the requested work order and existing status/keyword behavior still passes.

- [ ] **Step 6: Commit list filtering**

```bash
git add apps/api/src/production/melt-scheduling.controller.ts apps/api/src/production/production.service.ts apps/api/src/production/molding.controller.ts apps/api/src/production/molding.service.ts apps/api/src/production/pouring.controller.ts apps/api/src/production/pouring.service.ts apps/api/src/production/shake-clean.controller.ts apps/api/src/production/shake-clean.service.ts apps/api/src/production/final-inspection.controller.ts apps/api/src/production/final-inspection.service.ts apps/admin/src/utils/production.ts apps/admin/src/utils/molding.ts apps/admin/src/utils/pouring.ts apps/admin/src/utils/shakeClean.ts apps/admin/src/utils/finalInspection.ts apps/api/scripts/test-work-order-routing-execution.mjs
git commit -m "feat: filter execution tasks by work order"
```

### Task 6: Build the Work-Order Routing Execution Table

**Files:**
- Modify: `apps/admin/src/utils/production.ts`
- Modify: `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`
- Create: `apps/admin/tests/work-order-routing-execution-ui.test.mjs`

- [ ] **Step 1: Write failing UI contract tests**

Assert the workbench source:

```js
assert.match(source, /工序状态/)
assert.match(source, /工序进度/)
assert.match(source, /设备/)
assert.match(source, /班组/)
assert.match(source, /releaseWorkOrderMelt/)
assert.doesNotMatch(source, />生成制芯任务</)
assert.doesNotMatch(source, />生成造型下芯任务</)
```

- [ ] **Step 2: Add admin DTO and API functions**

Add `WorkOrderRoutingExecutionNode` matching the backend type plus:

```ts
export function fetchWorkOrderRoutingExecution(id: string) {
  return apiRequest<WorkOrderRoutingExecutionNode[]>(`/admin/production/work-orders/${id}/routing-execution`)
}

export function releaseWorkOrderMelt(id: string) {
  return apiRequest<{ released: boolean; releasedAt: string; warnings: string[] }>(
    `/admin/production/work-orders/${id}/melt-release`,
    { method: 'POST' },
  )
}
```

- [ ] **Step 3: Load summary independently from the edit preview**

On view pages, fetch the work order and routing execution summary together. Keep the static `preview.routingNodes` only for create/edit mode.

After any create/release modal succeeds, rerun both requests so stale row actions disappear.

- [ ] **Step 4: Replace the table columns**

Render:

```tsx
{ title: '顺序', dataIndex: 'seqNo', width: 70 },
{ title: '工序编码', dataIndex: 'operationCode', width: 130 },
{ title: '工序名称', dataIndex: 'operationName', width: 140 },
{ title: '工序状态', dataIndex: 'dispatchLabel', width: 100, render: renderDispatchTag },
{ title: '工序进度', key: 'progress', width: 170, render: renderProgress },
{ title: '设备', dataIndex: 'equipmentNames', width: 150, render: renderCompactNames },
{ title: '班组', dataIndex: 'teamNames', width: 130, render: renderCompactNames },
{ title: '操作', key: 'actions', fixed: 'right', width: 110, render: renderNodeAction },
```

Use `ResizableTable` with a new stable storage key and the existing fixed-right operation standard.

- [ ] **Step 5: Wire actions to existing domains**

- `CORE + CREATE`: open `CoreTaskGenerationModal`.
- `MOLDING + CREATE`: open `MoldingTaskGenerationModal`.
- `MELT + RELEASE_MELT`: show `Modal.confirm`; include `actionHint`; call release and refresh.
- `VIEW`: navigate to the module list with `workOrderId`.
- `WAIT/NONE`: render disabled text, not a clickable command.

- [ ] **Step 6: Remove right-top task scheduling controls**

Delete all top-right core and molding generation/view buttons and their now-unused icon imports. Keep only work-order-level commands such as save, edit, close, and return.

- [ ] **Step 7: Run UI tests and admin build**

Run:

```bash
node --test apps/admin/tests/work-order-routing-execution-ui.test.mjs
npm run build:admin
```

Expected: PASS; TypeScript has no stale imports and the route table compiles.

- [ ] **Step 8: Commit the workbench UI**

```bash
git add apps/admin/src/utils/production.ts apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx apps/admin/tests/work-order-routing-execution-ui.test.mjs
git commit -m "feat(admin): execute tasks from routing table"
```

### Task 7: Preserve Work-Order Filters Across Task Lists and Details

**Files:**
- Modify: `apps/admin/src/pages/production/CoreTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/HeatOrderListPage.tsx`
- Modify: `apps/admin/src/pages/production/MoldingTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/PouringTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/ShakeCleanTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/FinalInspectionTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/CoreTaskDetailPage.tsx`
- Modify: `apps/admin/src/pages/production/HeatOrderDetailPage.tsx`
- Modify: `apps/admin/src/pages/production/MoldingTaskDetailPage.tsx`
- Modify: `apps/admin/src/pages/production/PouringTaskDetailPage.tsx`
- Modify: `apps/admin/src/pages/production/ShakeCleanTaskDetailPage.tsx`
- Modify: `apps/admin/src/pages/production/FinalInspectionTaskDetailPage.tsx`
- Modify: `apps/admin/tests/work-order-routing-execution-ui.test.mjs`

- [ ] **Step 1: Add failing query-preservation assertions**

For each list, assert it reads `workOrderId` from `useSearchParams`, forwards it to the fetch utility, and appends it to detail navigation URLs.

- [ ] **Step 2: Add filter state without inventing a visible picker**

The work-order filter comes from navigation context, so retain it in the URL and show one removable Ant Design `Tag` near the existing query controls:

```tsx
{workOrderId && <Tag closable onClose={() => clearWorkOrderFilter()}>当前生产工单</Tag>}
```

Do not add a free-text work-order selector.

- [ ] **Step 3: Preserve return context**

When opening a task detail, include `fromWorkOrderId`. Detail back actions reconstruct the filtered list URL together with existing status, keyword, page, and tab parameters.

- [ ] **Step 4: Run admin tests and build**

Run:

```bash
node --test apps/admin/tests/work-order-routing-execution-ui.test.mjs
npm run build:admin
```

Expected: PASS and all six list modules retain the filter after detail navigation.

- [ ] **Step 5: Commit filter persistence**

```bash
git add apps/admin/src/pages/production/CoreTaskListPage.tsx apps/admin/src/pages/production/HeatOrderListPage.tsx apps/admin/src/pages/production/MoldingTaskListPage.tsx apps/admin/src/pages/production/PouringTaskListPage.tsx apps/admin/src/pages/production/ShakeCleanTaskListPage.tsx apps/admin/src/pages/production/FinalInspectionTaskListPage.tsx apps/admin/src/pages/production/CoreTaskDetailPage.tsx apps/admin/src/pages/production/HeatOrderDetailPage.tsx apps/admin/src/pages/production/MoldingTaskDetailPage.tsx apps/admin/src/pages/production/PouringTaskDetailPage.tsx apps/admin/src/pages/production/ShakeCleanTaskDetailPage.tsx apps/admin/src/pages/production/FinalInspectionTaskDetailPage.tsx apps/admin/tests/work-order-routing-execution-ui.test.mjs
git commit -m "feat(admin): retain work order task filters"
```

### Task 8: Full Regression, Docker Migration, and Documentation

**Files:**
- Modify: `docs/product/production-execution-context.md`
- Modify: `docs/product/production-execution-test-cases.md`
- Verify: Docker compose and existing local deployment files

- [ ] **Step 1: Update project context**

Document:

- The routing table is the single admin task-dispatch entry.
- `meltReleasedAt` gates melt-pool visibility.
- Core completion is a melt-release warning, not a hard block.
- Downstream queues remain upstream-generated.
- Every future production module must expose a `workOrderId` list filter and a routing-execution aggregator.

- [ ] **Step 2: Run complete focused regression**

Run:

```bash
npm --prefix apps/api run test:work-order-routing
npm --prefix apps/api run test:production-execution
npm --prefix apps/api run test:coremaking-execution
npm --prefix apps/api run test:molding-execution
npm --prefix apps/api run test:pouring-execution
npm --prefix apps/api run test:shake-clean-execution
npm --prefix apps/api run test:final-inspection-execution
node --test apps/admin/tests/work-order-routing-execution-ui.test.mjs
npm --prefix apps/api run build
npm run build:admin
npm --prefix apps/miniprogram run build
```

Expected: all tests and three builds PASS.

- [ ] **Step 3: Apply local Docker schema and backfill**

Run the project’s existing Docker commands, then inside the API container:

```bash
npx prisma db push
node scripts/backfill-work-order-melt-release.mjs
```

Restart API and admin containers. Verify `/api/health` returns success.

- [ ] **Step 4: Browser acceptance test**

Using the administrator and a limited production role, verify:

1. A newly created work order is absent from melt scheduling until the melt row is released.
2. Core/molding actions exist only in route rows and not in the upper-right page header.
3. Incomplete core tasks produce a confirmation warning but allow melt release.
4. Node progress updates after task/report changes and page refresh.
5. View-task actions open lists filtered to the current work order.
6. Users without create/release permissions see no actionable dispatch control.

- [ ] **Step 5: Commit documentation and final verification changes**

```bash
git add docs/product/production-execution-context.md docs/product/production-execution-test-cases.md
git commit -m "docs: record routing execution workflow"
```

Do not push or deploy to the public server unless the user requests it separately.
