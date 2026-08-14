# Production Work Order and Melt Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent production work-order, same-material melt scheduling, heat-order execution, and mobile execution workflow on top of the existing BOM, routing, recipe, equipment, team, permission, and PostgreSQL foundations.

**Architecture:** Add immutable work-order snapshots and explicit heat-order allocation records to Prisma. Keep the pending pool derived from active allocations, and centralize all numbering, validation, optimistic locking, status recomputation, cancellation, and completion transactions in a production service shared by admin and mini-program controllers. Add three management views and a minimal mini-program heat execution flow using the existing API, permission, table, and page conventions.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, React 19, TypeScript, Ant Design, native WeChat mini-program, Node integration tests, Docker Compose.

---

## File Structure

- `apps/api/prisma/schema.prisma`: production enums, work orders, heat orders, allocations, records, and sequence relations.
- `apps/api/prisma/migrations/20260813090000_work_order_melt_execution/migration.sql`: reproducible PostgreSQL migration.
- `apps/api/src/production/production.types.ts`: request payload and status types.
- `apps/api/src/production/production.service.ts`: calculations, numbering, transactions, status recomputation, DTO construction, and access queries.
- `apps/api/src/production/production-permission.guard.ts`: route-to-permission enforcement.
- `apps/api/src/production/work-order.controller.ts`: admin work-order endpoints.
- `apps/api/src/production/melt-scheduling.controller.ts`: pending-pool and heat creation/cancellation endpoints.
- `apps/api/src/production/heat-execution.controller.ts`: shared admin and mobile heat execution endpoints.
- `apps/api/scripts/test-production-execution.mjs`: full API integration flow and cleanup.
- `apps/admin/src/utils/production.ts`: management DTOs, labels, and API wrappers.
- `apps/admin/src/pages/production/WorkOrderListPage.tsx`: work-order list.
- `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`: create, view, and edit work orders.
- `apps/admin/src/pages/production/MeltSchedulingPage.tsx`: same-material pool and furnace utilization calculator.
- `apps/admin/src/pages/production/HeatOrderListPage.tsx`: heat monitoring and actions.
- `apps/admin/src/pages/production/HeatOrderDetailPage.tsx`: allocation, recipe, and operation record detail.
- `apps/miniprogram/src/pages/heat/list/*`: assigned heat list with pull-to-refresh.
- `apps/miniprogram/src/pages/heat/detail/*`: mobile heat detail and start action.
- `apps/miniprogram/src/pages/heat/complete/*`: actual-output completion form.

### Task 1: Add production persistence and pure calculation contracts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260813090000_work_order_melt_execution/migration.sql`
- Create: `apps/api/src/production/production.types.ts`
- Create: `apps/api/src/production/production.calculations.ts`
- Create: `apps/api/src/production/production.calculations.test.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write failing pure-calculation tests**

Cover integer allocation, kg/t capacity normalization, utilization, proportional actual-weight allocation with remainder correction, and combined status priority. Run:

```bash
npm --prefix apps/api run test:production-calculations
```

Expected: FAIL because `production.calculations.js` does not exist.

- [ ] **Step 2: Implement the calculation module**

Export these stable functions:

```ts
export function capacityToKg(value: number, unit: string): number
export function allocationWeightKg(quantity: number, unitGrossWeightKg: number): number
export function maxAllocatableQuantity(remainingCapacityKg: number, unitGrossWeightKg: number): number
export function allocateActualWeight<T extends { id: string; plannedWeightKg: number }>(rows: T[], actualWeightKg: number): Array<T & { actualWeightKg: number }>
export function displayWorkOrderStatus(scheduleStatus: WorkOrderScheduleStatus, productionStatus: WorkOrderProductionStatus): string
```

- [ ] **Step 3: Add Prisma models and migration**

Add enums `WorkOrderScheduleStatus`, `WorkOrderProductionStatus`, `HeatOrderStatus`, and `HeatOrderAction`; add `WorkOrder`, `HeatOrder`, `HeatOrderAllocation`, `HeatOrderRecord`, and `DocumentSequence` with the relations and unique constraints defined in the approved design. Use `Decimal(14,4)` for weight values and integer `versionNo` for optimistic locking.

- [ ] **Step 4: Generate Prisma and verify tests pass**

```bash
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run test:production-calculations
npm run build:api
```

Expected: all calculation assertions pass and API TypeScript builds.

### Task 2: Implement work-order submission and editing with locked snapshots

**Files:**
- Create: `apps/api/src/production/production.service.ts`
- Create: `apps/api/src/production/work-order.controller.ts`
- Create: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/shared/admin-context.ts`
- Create: `apps/api/scripts/test-production-execution.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write failing work-order API tests**

The test must create an active BOM, active default routing, active recipe, enabled furnace, workshop/team/users, then assert:

```text
POST work order -> PENDING + RELEASED
product snapshot and locked version IDs persist
totalNetWeightKg = quantity * unitNetWeightKg
totalMeltWeightKg = quantity * unitGrossWeightKg
GET pending pool contains the order
PUT before allocation succeeds
invalid product/BOM/routing/quantity is rejected
```

Run `npm --prefix apps/api run test:production-execution`; expected FAIL with 404 for missing endpoints.

- [ ] **Step 2: Implement permission guard and admin work-order endpoints**

Map HTTP actions to:

```text
GET -> production.work_order.view
POST -> production.work_order.create
PUT -> production.work_order.edit
POST /close -> production.work_order.close
```

All endpoints use `AdminAuthGuard`; work-order list/detail use `visibleOwnershipEntityIds(..., 'production:work-orders')` and creation calls `upsertOwnership`.

- [ ] **Step 3: Implement snapshot preparation and transactional create/edit**

The service must query the selected active BOM version and active applicable routing version, calculate all weights server-side, generate `WOYYYYMMDDNNN` through `DocumentSequence`, and save snapshot fields. Editing uses `updateMany({ where: { id, versionNo, allocations: { none: { heatOrder: { status: { not: 'CANCELED' } } } } } })` semantics and returns a conflict when no row updates.

- [ ] **Step 4: Run work-order tests and build**

```bash
npm --prefix apps/api run test:production-execution
npm run build:api
```

Expected: work-order cases pass; later heat cases still fail at their first missing endpoint.

### Task 3: Implement same-material scheduling, allocation, cancellation, and heat completion

**Files:**
- Modify: `apps/api/src/production/production.service.ts`
- Create: `apps/api/src/production/melt-scheduling.controller.ts`
- Create: `apps/api/src/production/heat-execution.controller.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/scripts/test-production-execution.mjs`

- [ ] **Step 1: Extend failing integration tests**

Assert same-material multi-order heat creation, split allocations by integer quantity, cross-material rejection, capacity overflow rejection, recipe/furnace/team validation, edit locking, waiting cancellation with quantity restoration, start/complete transitions, duplicate action rejection, proportional actual weight allocation, and `MELT_COMPLETED` only after every planned quantity is completed.

- [ ] **Step 2: Implement pending-pool and option queries**

Return material groups and derived values:

```ts
remainingQuantity = plannedQuantity - activeAllocationQuantity
remainingWeightKg = remainingQuantity * unitGrossWeightKg
```

Return active material-compatible recipes, their applicable enabled furnaces with kg-normalized capacities, and enabled teams filtered by furnace workshop.

- [ ] **Step 3: Implement serialized heat creation**

Inside one serializable transaction, re-read work orders and active allocations, validate remaining quantities and one material, calculate target weight, validate active recipe/furnace/team relations and capacity, generate `HEAT-YYYYMMDD-NN`, create allocations and a `CREATED` record, then recompute every related work order schedule status.

- [ ] **Step 4: Implement cancellation and execution actions**

Cancellation only updates `WAITING` to `CANCELED`, writes a reason record, and recomputes work orders. Start only changes `WAITING` to `IN_PROGRESS`. Complete only changes `IN_PROGRESS` to `COMPLETED`, proportionally writes actual allocation weights, creates a record, and recalculates related work-order production status.

- [ ] **Step 5: Implement mobile team access**

Mobile list and detail require `production.heat.view` and either super-admin access or membership in `HeatOrder.teamCode`. Start and completion additionally require `production.heat.start` or `production.heat.complete`.

- [ ] **Step 6: Run full API regression**

```bash
npm --prefix apps/api run test:production-calculations
npm --prefix apps/api run test:production-execution
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:process-routings
npm run build:api
```

Expected: all pass.

### Task 4: Add permission tree, routes, menu, and API contracts

**Files:**
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Create: `apps/admin/src/utils/production.ts`

- [ ] **Step 1: Add permission hierarchy**

Create the `production` group and all approved work-order, schedule, and heat permissions. Include them in super-admin defaults without granting them to ordinary existing roles.

- [ ] **Step 2: Add protected routes and menu**

Every route must use its `*.view`, `*.create`, or `*.edit` permission. Add a “生产管理” menu between production modeling and process management.

- [ ] **Step 3: Add typed API wrappers**

Define DTOs matching server responses and wrappers for options, preview, list, create/edit/close, pool, create/cancel heat, heat list/detail, start, and complete.

- [ ] **Step 4: Build admin**

Run `npm run build:admin`; expected PASS.

### Task 5: Build management work-order and scheduling pages

**Files:**
- Create: `apps/admin/src/pages/production/WorkOrderListPage.tsx`
- Create: `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`
- Create: `apps/admin/src/pages/production/MeltSchedulingPage.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: Build work-order list and workbench**

Follow BOM page standards: title-aligned query/create controls, compact filters, `ResizableTable`, fixed operation column, and `TableActions`. Product selection requests server preview; only “提交排产” is available. View mode shows snapshots, allocation progress, related heats, and routing node preview.

- [ ] **Step 2: Build material-tab scheduling workbench**

Show pending materials as tabs, work-order checkbox rows with editable integer allocation quantities, and a right-side calculator for furnace, recipe, team, output time, capacity utilization, total pieces, and total kg. Disable generation until all server-side-required data is present.

- [ ] **Step 3: Enforce button permissions**

Use `hasPermission` for all page-header and row actions: create, edit, close, create heat, and cancel. Do not infer authorization solely from status.

- [ ] **Step 4: Build and browser-check**

```bash
npm run build:admin
```

Use Playwright at desktop width to verify no overlap, fixed operation columns, compact filters, material tabs, and direct-link login protection.

### Task 6: Build management heat execution pages

**Files:**
- Create: `apps/admin/src/pages/production/HeatOrderListPage.tsx`
- Create: `apps/admin/src/pages/production/HeatOrderDetailPage.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: Build status-filtered heat list**

Use tags for `WAITING`, `IN_PROGRESS`, `COMPLETED`, and `CANCELED`; provide query refresh, equipment/date filters, view, start, complete, and cancel actions with independent permissions.

- [ ] **Step 2: Build heat detail**

Display snapshots, allocations, recipe material preview, target/actual deviation, execution team, and chronological records. Completion requests actual output kg and optional remark; cancellation requires a reason.

- [ ] **Step 3: Build and browser-check**

Run `npm run build:admin` and inspect list/detail at desktop and mobile-like browser widths for overflow and action visibility.

### Task 7: Build mini-program assigned heat execution

**Files:**
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/home/index.ts`
- Modify: `apps/miniprogram/src/pages/home/index.wxml`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/types/business.ts`
- Create: `apps/miniprogram/src/pages/heat/list/index.{json,ts,wxml,wxss}`
- Create: `apps/miniprogram/src/pages/heat/detail/index.{json,ts,wxml,wxss}`
- Create: `apps/miniprogram/src/pages/heat/complete/index.{json,ts,wxml,wxss}`
- Create: `apps/miniprogram/tests/heat-pages.test.mjs`

- [ ] **Step 1: Write failing mini-program contract tests**

Assert all three pages are registered, APIs use `/mini/production/heat-orders`, list enables pull-down refresh, and start/complete actions are present. Run `npm --prefix apps/miniprogram run test`; expected FAIL before pages exist.

- [ ] **Step 2: Add types and API wrappers**

Expose list/detail/start/complete functions and DTOs for heat status, allocations, records, and action flags supplied by the backend.

- [ ] **Step 3: Implement list and detail**

Use card rows and status tabs, perform real API refresh on `onPullDownRefresh`, and display backend action flags. The detail page has a fixed bottom action bar only when an action is currently allowed.

- [ ] **Step 4: Implement completion form**

Require a positive actual output weight, show kg explicitly, prevent duplicate submission, call the real API, and redirect back to refreshed detail after success.

- [ ] **Step 5: Build and test**

```bash
npm --prefix apps/miniprogram run test
npm run typecheck:miniprogram
npm run build:miniprogram
```

Expected: PASS and generated `dist` contains all heat pages.

### Task 8: Complete regression, Docker migration, and project documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/product/project-handoff.md`
- Modify: `docs/product/modeling-context.md`
- Create: `docs/product/production-execution-context.md`
- Create: `docs/product/production-execution-test-cases.md`

- [ ] **Step 1: Document implemented relationships and operational rules**

Record routes, permissions, models, APIs, status transitions, mobile assignment, Docker commands, current limitations, and follow-up integration with routing-node execution.

- [ ] **Step 2: Run complete build and tests**

```bash
npm --prefix apps/api run test:production-calculations
npm --prefix apps/api run test:production-execution
npm --prefix apps/api run test:recipes
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:process-routings
npm run build:api
npm run build:admin
npm --prefix apps/miniprogram run test
npm run typecheck:miniprogram
npm run build:miniprogram
```

- [ ] **Step 3: Rebuild local Docker and apply schema**

```bash
ADMIN_PORT=8081 npm run docker:up
npm run docker:ps
curl -fsS http://127.0.0.1:3000/api/health
```

Expected: admin, API, and PostgreSQL containers are up; database is healthy; production integration test passes against Docker.

- [ ] **Step 4: Browser and mobile acceptance**

Verify admin login, work-order submission, same-material heat creation, split order allocation, mobile team user start/complete, work-order status update, and waiting heat cancellation with quantity restoration.
