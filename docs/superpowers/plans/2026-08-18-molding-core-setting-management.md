# Molding Core-Setting Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build persistent management and mini-program execution for molding/core-setting tasks, including work-order generation, same-work-order core readiness, transactional backflush, operation-bound defects, reporting, and reversal.

**Architecture:** Add a focused `molding` production domain beside the existing work-order and coremaking domains. The service locks BOM/routing/mold snapshots at task creation and consumes existing core inventory through persisted allocation rows in a serializable transaction. Admin and mini-program clients call the same domain rules through separately permissioned controllers.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, Ant Design, native WeChat Mini Program, Node integration tests.

---

## File Map

New backend files:

- `apps/api/src/production/molding.types.ts`: request and response contracts.
- `apps/api/src/production/molding.calculations.ts`: quantity, readiness, status, and allocation pure functions.
- `apps/api/src/production/molding.service.ts`: task generation, execution, inventory transaction, reversal, and DTO composition.
- `apps/api/src/production/molding.controller.ts`: admin and mini-program routes.
- `apps/api/scripts/test-molding-calculations.mjs`: pure calculation tests.
- `apps/api/scripts/test-molding-execution.mjs`: database-backed lifecycle and concurrency tests.

New admin files:

- `apps/admin/src/utils/molding.ts`: typed API client and labels.
- `apps/admin/src/pages/production/MoldingTaskGenerationModal.tsx`: generation preview and assignment form.
- `apps/admin/src/pages/production/MoldingTaskListPage.tsx`: filterable task list.
- `apps/admin/src/pages/production/MoldingTaskDetailPage.tsx`: snapshots, readiness, reports, defects, consumption, and actions.

New mini-program files:

- `apps/miniprogram/src/pages/molding/list/*`: task tabs, scan/manual lookup, pull-to-refresh.
- `apps/miniprogram/src/pages/molding/detail/*`: task and readiness details with start action.
- `apps/miniprogram/src/pages/molding/report/*`: quantity steppers, defect rows, completion mode, and confirmation.
- `apps/miniprogram/tests/molding-pages.test.cjs`: built-page contract tests.

Existing files changed:

- `apps/api/prisma/schema.prisma`: molding models, enums, relations, and defect-operation relation.
- `apps/api/package.json`: molding test scripts.
- `apps/api/src/app.module.ts`: register service/controllers.
- `apps/api/src/modeling.controller.ts`: operation relation CRUD for defects and reference-safe deletion.
- `apps/api/src/production/production-permission.guard.ts`: admin and mini molding route permissions.
- `apps/api/src/shared/admin-default-permissions.ts`: administrator defaults.
- `apps/admin/src/App.tsx`, `apps/admin/src/layouts/AppLayout.tsx`, `apps/admin/src/utils/roles.ts`: routes, menu, and permission tree.
- `apps/admin/src/pages/modeling/modelingConfigs.tsx`: defect operation multi-select.
- `apps/admin/src/pages/modeling/ModelingMasterPage.tsx`, `apps/admin/src/utils/modeling.ts`: persist and display relation-backed option arrays.
- `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`: generation button and existing-task status.
- `apps/miniprogram/src/app.json`, `apps/miniprogram/src/pages/home/index.*`, `apps/miniprogram/src/services/api.ts`, `apps/miniprogram/src/types/business.ts`: entry, routes, clients, and types.
- `docs/product/context-summary.md`: durable module rules and downstream integration notes.

### Task 1: Pure Quantity And Allocation Rules

**Files:**
- Create: `apps/api/src/production/molding.calculations.ts`
- Create: `apps/api/scripts/test-molding-calculations.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write failing calculation tests**

Cover these exact cases:

```js
assert.equal(calculatePlannedBoxes(101, 4), 26)
assert.equal(calculateCoreDemandPerBox('1.5', 4), 6)
assert.equal(calculateReportCoreDemand(10, 2, 6), 72)
assert.equal(calculateOverproduction(26, 28), 2)
assert.deepEqual(
  allocateCoreBatches(9, [
    { id: 'later', quantity: 8, status: 'AVAILABLE', expiresAt: '2026-08-20', producedAt: '2026-08-18' },
    { id: 'warning', quantity: 4, status: 'WARNING', expiresAt: '2026-08-19', producedAt: '2026-08-17' },
  ]),
  [{ batchId: 'warning', quantity: 4 }, { batchId: 'later', quantity: 5 }],
)
assert.throws(() => allocateCoreBatches(20, [{ id: 'only', quantity: 3, status: 'AVAILABLE' }]), /库存不足/)
```

- [ ] **Step 2: Run the calculation test and verify it fails**

Run: `npm --prefix apps/api run test:molding-calculations`

Expected: failure because `molding.calculations.js` does not exist.

- [ ] **Step 3: Implement deterministic pure functions**

Export:

```ts
calculatePlannedBoxes(plannedPieces: number, cavityCount: number): number
calculateCoreDemandPerBox(quantityPerProduct: DecimalLike, cavityCount: number): number
calculateReportCoreDemand(goodBoxes: number, scrapBoxes: number, perBox: DecimalLike): number
calculateOverproduction(plannedBoxes: number, cumulativeGoodBoxes: number): number
allocateCoreBatches(required: number, batches: CoreBatchCandidate[]): CoreBatchAllocation[]
```

Validate positive cavity count, non-negative quantities, integral physical core demand, and sort `WARNING` before expiry and production time.

- [ ] **Step 4: Add the npm script and rerun**

Add `test:molding-calculations` as `npm run build && node scripts/test-molding-calculations.mjs`.

Expected: all calculation cases pass.

### Task 2: Persist The Molding Aggregate And Defect Relations

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add status enums and relation models**

Add:

```prisma
enum MoldingTaskStatus { PENDING IN_PROGRESS COMPLETED CANCELED }
enum MoldingCompletionType { NORMAL SHORT }
enum MoldingReportStatus { ACTIVE REVERSED }

model DefectOperation {
  defectCodeId  String
  operationCode String
  defectCode    DefectCode      @relation(fields: [defectCodeId], references: [id], onDelete: Cascade)
  operation     OperationMaster @relation(fields: [operationCode], references: [code], onUpdate: Cascade, onDelete: Restrict)
  createdAt     DateTime        @default(now())
  @@id([defectCodeId, operationCode])
  @@index([operationCode])
}
```

Add `MoldingTask`, `MoldingReport`, `MoldingCoreConsumption`, and `MoldingReportDefect` using the approved design. Required constraints are:

```prisma
@@unique([workOrderId, routingNodeId])
@@unique([taskId, requestId])
@@unique([reportId, defectCodeId])
@@index([status, plannedStartAt])
@@index([workOrderId])
@@index([coreInventoryBatchId])
```

Add relation arrays to `User`, `WorkOrder`, `CastingBomVersion`, `ProcessRoutingVersion`, `ProcessRoutingNode`, `MoldMaster`, `ProductionLine`, `Team`, `CoreInventoryBatch`, `DefectCode`, and `OperationMaster`.

- [ ] **Step 2: Validate schema formatting and generation**

Run:

```bash
npm --prefix apps/api exec prisma format
npm --prefix apps/api run prisma:generate
```

Expected: Prisma schema validates and client generation succeeds.

- [ ] **Step 3: Apply schema to local Docker PostgreSQL**

Run: `npm --prefix apps/api exec prisma db push`

Expected: database synchronization succeeds without destructive reset.

### Task 3: Make Defect Codes Operation-Aware

**Files:**
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/admin/src/pages/modeling/modelingConfigs.tsx`
- Modify: `apps/admin/src/pages/modeling/ModelingMasterPage.tsx`
- Modify: `apps/admin/src/utils/modeling.ts`
- Create: `apps/api/scripts/test-defect-operations.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write a failing API test**

The test creates two operations, saves a defect with `operationCodes: ['OP-CORE', 'OP-MOLD']`, reloads it, updates to `['OP-MOLD']`, verifies replacement, and verifies deleting `OP-MOLD` is rejected while referenced.

- [ ] **Step 2: Run and confirm current generic CRUD loses the relation**

Run: `npm --prefix apps/api run test:defect-operations`

Expected: response lacks `operationCodes` or relation persistence fails.

- [ ] **Step 3: Add transactional relation CRUD**

For `resource === 'defects'`:

```ts
const operationCodes = toStringArray(body.operationCodes)
await tx.defectCode.create({
  data: { code, name, category, status, remark, operations: { create: operationCodes.map((operationCode) => ({ operationCode })) } },
  include: { operations: { include: { operation: true } } },
})
```

Update with `deleteMany: {}` followed by `create`. Return `operationCodes` and `operationNames` in DTOs. Add operation deletion reference checking.

- [ ] **Step 4: Change the management form**

Replace free text `sourceOperation` with:

```ts
{ name: 'operationCodes', label: '适用工序', type: 'multiSelect', optionSource: 'operations', width: 220 }
```

Ensure generic option loading supplies enabled standard operations and tables display `operationNames.join('、')`.

- [ ] **Step 5: Add and verify initial defect data**

Create the approved coremaking and molding defect codes idempotently in the test/seed setup and bind them to actual `section = 制芯` and `section = 造型` operations.

Run: `npm --prefix apps/api run test:defect-operations`

Expected: relation CRUD, filtering prerequisites, and delete protection pass.

### Task 4: Implement Task Preview, Creation, List, And Readiness

**Files:**
- Create: `apps/api/src/production/molding.types.ts`
- Create: `apps/api/src/production/molding.service.ts`
- Create: `apps/api/scripts/test-molding-execution.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write failing lifecycle setup tests**

Build isolated fixtures for a work order with active BOM, active route, one `section = 造型` node, enabled molds, core box requirements, production line, and team. Assert:

```js
preview.planBoxQty === Math.ceil(workOrder.plannedQuantity / selectedMold.cavityCount)
preview.coreRequirements[0].quantityPerBox === quantityPerProduct * selectedMold.cavityCount
created.status === 'PENDING'
created.readiness.code === 'WAITING_CORE'
```

Also assert inactive BOM/routes, a missing molding node, and duplicate generation are rejected.

- [ ] **Step 2: Implement request contracts**

Define strict parsing for:

```ts
MoldingTaskPreviewBody { moldCode?: string }
CreateMoldingTaskBody { moldCode: string; productionLineCode: string; teamCode?: string; plannedStartAt?: string; remark?: string }
DispatchMoldingTaskBody { versionNo: number; productionLineCode: string; teamCode?: string; plannedStartAt?: string }
```

- [ ] **Step 3: Implement snapshot loading and readiness**

`MoldingService` must load the locked work-order BOM and route version, locate `operation.section === '造型'`, validate the selected BOM mold, calculate task/core snapshots, and compute readiness from same-work-order completed core tasks and eligible inventory batches.

Readiness output:

```ts
type MoldingReadiness = {
  ready: boolean
  code: 'READY' | 'WAITING_CORE_TASK' | 'INSUFFICIENT_CORE'
  requirements: Array<{ coreBoxCode: string; required: number; available: number; shortage: number }>
}
```

- [ ] **Step 4: Implement create/list/detail/dispatch**

Use existing admin data-scope helpers for list and detail visibility. For mini-program calls, restrict to the assigned team membership unless superadmin. Return state-derived `allowedActions`.

- [ ] **Step 5: Run lifecycle tests**

Run: `npm --prefix apps/api run test:molding-execution`

Expected: preview, creation, uniqueness, list/detail visibility, assignment filtering, and readiness cases pass.

### Task 5: Implement Atomic Start, Report, And Reversal

**Files:**
- Modify: `apps/api/src/production/molding.types.ts`
- Modify: `apps/api/src/production/molding.service.ts`
- Modify: `apps/api/scripts/test-molding-execution.mjs`

- [ ] **Step 1: Add failing execution cases**

Tests must cover:

- start blocked until same-work-order cores are ready;
- cross-work-order batches ignored;
- multiple eligible batches consumed in priority order;
- multiple defect quantities must equal scrap quantity;
- duplicate `requestId` returns the original report;
- stale `versionNo` returns conflict;
- insufficient stock rolls back report and all ledgers;
- short completion requires reason;
- overproduction is persisted;
- reversal restores original batches and task totals;
- reversal rejects a subsequently scrapped batch.

- [ ] **Step 2: Add report and reversal contracts**

```ts
ReportMoldingTaskBody {
  versionNo: number
  requestId: string
  goodQty: number
  scrapQty: number
  finishTask: boolean
  earlyCompletionReason?: string
  defects: Array<{ defectCode: string; quantity: number; remark?: string }>
  remark?: string
}

ReverseMoldingReportBody { versionNo: number; reason: string }
```

- [ ] **Step 3: Implement serializable execution**

Inside one serializable transaction:

1. lock task and check `versionNo`/status;
2. return existing report for the same task/request id;
3. validate operation-bound enabled defects;
4. lock eligible same-work-order inventory batches;
5. allocate and decrement inventory;
6. insert report, defect rows, consumption rows, and `CONSUMED` ledgers;
7. recompute task totals, completion metadata, status, and `versionNo`.

- [ ] **Step 4: Implement reversal from immutable consumption rows**

Lock report, task, and consumed batches; reject reversed reports, scrapped batches, stale versions, and downstream references. Add inventory quantities back, create compensating `ADJUSTED` ledgers, mark report reversed, and recompute task state.

- [ ] **Step 5: Run the full execution test**

Run: `npm --prefix apps/api run test:molding-execution`

Expected: all lifecycle, transaction, idempotency, and reversal cases pass.

### Task 6: Expose Controllers, Permissions, And Administrator Defaults

**Files:**
- Create: `apps/api/src/production/molding.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/shared/admin-default-permissions.ts`
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/api/scripts/test-molding-execution.mjs`

- [ ] **Step 1: Add route-permission test cases**

Verify view-only users can list/detail but receive 403 for create, dispatch, start, report, cancel, and reverse. Verify mini permissions are independent from admin permissions.

- [ ] **Step 2: Register admin and mini controllers**

Expose the routes from the approved design under `/admin/production` and `/mini/production`. Add a by-code mini lookup and defect-options endpoint.

- [ ] **Step 3: Map every route to a distinct permission**

Extend `permissionFor()` before generic work-order matching. Unknown molding paths must return 404, not fall through to a broader permission.

- [ ] **Step 4: Add permission tree entries**

Add all `production.molding.*` and `mini.production.molding.*` keys to frontend tree and backend administrator defaults. Keep data-list permission separate from action permissions.

- [ ] **Step 5: Rerun permission and execution tests**

Run:

```bash
npm run test:permissions
npm --prefix apps/api run test:molding-execution
```

Expected: existing permissions remain green and molding route checks pass.

### Task 7: Add Work-Order Generation And Admin Task List

**Files:**
- Create: `apps/admin/src/utils/molding.ts`
- Create: `apps/admin/src/pages/production/MoldingTaskGenerationModal.tsx`
- Create: `apps/admin/src/pages/production/MoldingTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`

- [ ] **Step 1: Add typed API helpers**

Define DTOs for preview, task summary/detail, readiness, report, defect, and consumption. API failures must reject; no local fallback data is allowed.

- [ ] **Step 2: Add the generation modal**

Load preview when opened. Require mold when multiple choices exist, production line, optional same-workshop team, planned start, and remark. Display planned pieces, cavity count, planned boxes, and per-box core requirements before submit.

- [ ] **Step 3: Integrate the work-order button**

Show “生成造型下芯任务” only when the backend reports a molding node, no existing task, and the user has `production.molding.create`. Refresh work-order detail after success and link to the generated task.

- [ ] **Step 4: Build the list using project standards**

Use a title-aligned right-side Query button, status tabs, compact filters, `ResizableTable`, fixed right action column, and `TableActions`. Include computed “待砂芯齐套” before persisted status labels.

- [ ] **Step 5: Build and lint the admin app**

Run:

```bash
npm run lint:admin
npm run build:admin
```

Expected: no new lint errors and production build succeeds.

### Task 8: Add Admin Detail, Actions, And Report Reversal

**Files:**
- Create: `apps/admin/src/pages/production/MoldingTaskDetailPage.tsx`
- Modify: `apps/admin/src/utils/molding.ts`
- Modify: `apps/admin/src/App.tsx`

- [ ] **Step 1: Build compact task detail sections**

Display task/work-order snapshots, assignment, quantity progress, BOM core requirements, real-time readiness, active/reversed reports, defects, batch consumption, and audit timeline.

- [ ] **Step 2: Add state and permission-controlled actions**

Implement dispatch, start, report, cancel, and reverse forms. Each mutation sends `versionNo`; HTTP 409 shows “数据已更新，请刷新后重试” and reloads the detail.

- [ ] **Step 3: Implement report form rules**

Use integer good/scrap boxes, finish selection, conditional early-completion reason, dynamic defect rows, defect-sum validation, and overproduction confirmation.

- [ ] **Step 4: Add route protection and verify navigation**

Protect list/detail with `production.molding.view`; action controls use their specific keys. Verify detail back-navigation preserves list tab/query through URL search parameters.

- [ ] **Step 5: Build the admin app**

Run: `npm run build:admin`

Expected: production build succeeds.

### Task 9: Add Mini-Program Molding Execution

**Files:**
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/home/index.ts`
- Modify: `apps/miniprogram/src/pages/home/index.wxml`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/types/business.ts`
- Create: `apps/miniprogram/src/pages/molding/list/index.{ts,wxml,wxss,json}`
- Create: `apps/miniprogram/src/pages/molding/detail/index.{ts,wxml,wxss,json}`
- Create: `apps/miniprogram/src/pages/molding/report/index.{ts,wxml,wxss,json}`
- Create: `apps/miniprogram/tests/molding-pages.test.cjs`

- [ ] **Step 1: Write failing built-page contract tests**

Assert registered pages, API routes, pull-down refresh, task status tabs, scan/manual code lookup, start, quantity controls, defect rows, completion mode, and no reversal control.

- [ ] **Step 2: Add shared types and API functions**

Implement list/detail/by-code/start/report/defect-options calls. Report creates one stable request id before submission and reuses it on retry.

- [ ] **Step 3: Build list and detail pages**

Add home entry guarded by `mini.production.molding.view`. List uses cards and pull-to-refresh. Detail shows core readiness and only backend-provided `allowedActions`.

- [ ] **Step 4: Build the report page**

Implement `-10/-1/+1/+10`, fill remaining, scrap controls, dynamic defect code/quantity/remark rows, finish selection, early completion reason, and confirmation summary. Disable the submit button while a request is active.

- [ ] **Step 5: Build and run mini tests**

Run:

```bash
npm run typecheck:miniprogram
npm run build:miniprogram
node apps/miniprogram/tests/molding-pages.test.cjs
```

Expected: source typecheck, dist build, and page contract tests pass.

### Task 10: End-To-End Verification And Project Documentation

**Files:**
- Modify: `apps/api/scripts/test-molding-execution.mjs`
- Modify: `docs/product/context-summary.md`

- [ ] **Step 1: Add an end-to-end fixture lifecycle**

Create real workshop, line, team, users, product, material, BOM, mold, core boxes, routing, core tasks, inventory, defects, and work order. Exercise generation, readiness, start, two reports, completion, reversal, and permission isolation.

- [ ] **Step 2: Run focused regressions**

Run:

```bash
npm --prefix apps/api run test:molding-calculations
npm --prefix apps/api run test:defect-operations
npm --prefix apps/api run test:molding-execution
npm --prefix apps/api run test:coremaking-execution
npm --prefix apps/api run test:production-execution
npm run test:permissions
```

Expected: all tests pass without changing existing fixture ownership or leaving test records behind.

- [ ] **Step 3: Run all builds**

Run:

```bash
npm run prisma:generate
npm run build:api
npm run build:admin
npm run typecheck:miniprogram
npm run build:miniprogram
```

Expected: all builds complete successfully.

- [ ] **Step 4: Update durable context**

Document module routes, permissions, models, same-work-order inventory rule, quantity formulas, defect-operation relation, reversal constraints, downstream contract, test commands, and known phase-two boundaries in `docs/product/context-summary.md`.

- [ ] **Step 5: Review the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional project changes remain. Do not include unrelated pre-existing changes in a feature commit.
