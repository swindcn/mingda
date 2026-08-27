# Molding Dispatch And Readiness Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate persisted molding dispatch status from real-time core readiness so a dispatched task remains “已派工” while unavailable cores only prevent starting production.

**Architecture:** Extend the Prisma task status enum with `DISPATCHED`, write that state when a fully assigned task is created or dispatched, and keep readiness as the existing computed DTO object. Admin and mini-program clients display task status and readiness independently; backend start validation remains the authoritative concurrency-safe gate.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, Ant Design, native WeChat Mini Program, Node integration tests, Docker Compose.

---

## File Map

- Modify `apps/api/prisma/schema.prisma`: add `DISPATCHED` to `MoldingTaskStatus`.
- Modify `apps/api/src/production/molding.service.ts`: status transitions, allowed actions, DTO display status, cancellation and start rules.
- Modify `apps/api/scripts/test-molding-execution.mjs`: verify dispatch succeeds before readiness and start remains blocked until readiness.
- Modify `apps/admin/src/utils/molding.ts`: add dispatched status labels/types and remove readiness-as-status filtering.
- Modify `apps/admin/src/pages/production/MoldingTaskListPage.tsx`: add dispatched tab and readiness column.
- Modify `apps/admin/src/pages/production/MoldingTaskDetailPage.tsx`: remove the top readiness warning.
- Modify `apps/miniprogram/src/types/business.ts`: add dispatched status and remove `WAITING_CORE` display status.
- Modify `apps/miniprogram/src/pages/molding/list/index.ts`: update tabs, labels and tones.
- Modify `apps/miniprogram/src/pages/molding/detail/index.ts`: update labels.
- Modify `apps/miniprogram/tests/molding-pages.test.cjs`: assert dispatched status and no warning contract.
- Modify `docs/product/context-summary.md`: preserve the state/readiness separation rule.

### Task 1: Backend Status Regression

**Files:**
- Modify: `apps/api/scripts/test-molding-execution.mjs`

- [x] **Step 1: Add a failing dispatch/readiness lifecycle case**

Create a task with a non-empty core requirement and no matching same-work-order core inventory. Dispatch it and assert:

```js
assert.equal(dispatched.status, 201)
assert.equal(dispatched.body.data.status, 'DISPATCHED')
assert.equal(dispatched.body.data.readiness.ready, false)
assert.equal(dispatched.body.data.allowedActions.start, false)
```

Then call start with the latest `versionNo` and assert `400` with `砂芯尚未齐套`.

- [x] **Step 2: Run the lifecycle test and verify red**

Run:

```bash
DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:molding-execution
```

Expected: fail because dispatched tasks still return `PENDING` or `WAITING_CORE`.

### Task 2: Persist And Enforce DISPATCHED

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/production/molding.service.ts`

- [x] **Step 1: Add the enum state**

Change the Prisma enum to:

```prisma
enum MoldingTaskStatus {
  PENDING
  DISPATCHED
  IN_PROGRESS
  COMPLETED
  CANCELED
}
```

- [x] **Step 2: Change creation and dispatch transitions**

New tasks use `status: 'DISPATCHED'` because the current creation form requires a production line and team. `dispatchTask()` accepts `PENDING` and `DISPATCHED`, persists `DISPATCHED`, and still rejects tasks with reports.

- [x] **Step 3: Change action and start rules**

Use these state predicates:

```ts
const dispatchable = ['PENDING', 'DISPATCHED'].includes(record.status) && reportCount === 0
const startable = record.status === 'DISPATCHED' && readiness.ready
const cancelable = ['PENDING', 'DISPATCHED'].includes(record.status) && reportCount === 0
```

Inside the start transaction, require `task.status === 'DISPATCHED'`, then recompute readiness and reject when it is not ready.

- [x] **Step 4: Remove readiness-derived main status**

Return `displayStatus: record.status`. Keep the existing `readiness` DTO unchanged.

- [x] **Step 5: Generate Prisma and rebuild API**

Run:

```bash
npm run prisma:generate
npm run build:api
```

Expected: both commands exit `0`.

- [x] **Step 6: Rebuild Docker and rerun lifecycle test**

Run:

```bash
npm run docker:up
DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:molding-execution
```

Expected: dispatch/readiness lifecycle passes.

### Task 3: Admin Status And Readiness Presentation

**Files:**
- Modify: `apps/admin/src/utils/molding.ts`
- Modify: `apps/admin/src/pages/production/MoldingTaskListPage.tsx`
- Modify: `apps/admin/src/pages/production/MoldingTaskDetailPage.tsx`

- [x] **Step 1: Update shared types and labels**

Use:

```ts
export type MoldingTaskStatus = 'PENDING' | 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED'
export type MoldingDisplayStatus = MoldingTaskStatus
```

Add `DISPATCHED: '已派工'` with blue/cyan styling. Remove the client-side `WAITING_CORE` filter branch.

- [x] **Step 2: Update list tabs and columns**

Tabs become `ALL`, `PENDING`, `DISPATCHED`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`. Add a compact readiness column rendering `已齐套` in green or `未齐套` in orange from `record.readiness.ready`.

- [x] **Step 3: Remove the detail warning**

Delete the conditional alert with message `砂芯尚未齐套，当前任务不能开工`. Do not remove the readiness detail table.

- [x] **Step 4: Build and lint focused files**

Run:

```bash
npm run build:admin
cd apps/admin && npx eslint src/utils/molding.ts src/pages/production/MoldingTaskListPage.tsx src/pages/production/MoldingTaskDetailPage.tsx
```

Expected: build and focused lint exit `0`.

### Task 4: Mini-Program Status Presentation

**Files:**
- Modify: `apps/miniprogram/src/types/business.ts`
- Modify: `apps/miniprogram/src/pages/molding/list/index.ts`
- Modify: `apps/miniprogram/src/pages/molding/detail/index.ts`
- Modify: `apps/miniprogram/tests/molding-pages.test.cjs`

- [x] **Step 1: Add failing page contract assertions**

Assert built source contains `DISPATCHED` and `已派工`, and does not use `WAITING_CORE` as a task tab or status label.

- [x] **Step 2: Run mini tests and verify red**

Run: `npm --prefix apps/miniprogram test`

Expected: new dispatched status assertion fails.

- [x] **Step 3: Update mini types, tabs and labels**

Use the same persisted status union as admin. Default list tab becomes `DISPATCHED`; list filtering sends the selected persisted status directly to the API. Keep readiness fields on each record for detail display and action control.

- [x] **Step 4: Build and rerun tests**

Run:

```bash
npm run typecheck:miniprogram
npm run build:miniprogram
npm --prefix apps/miniprogram test
```

Expected: typecheck, build and all mini tests pass.

### Task 5: Durable Rules And Final Verification

**Files:**
- Modify: `docs/product/context-summary.md`

- [x] **Step 1: Record the state-machine rule**

Document that task status and readiness are orthogonal, creation/dispatch persists `DISPATCHED`, and readiness is recomputed transactionally at start.

- [x] **Step 2: Run focused regression suite**

Run:

```bash
npm run build:api
npm run build:admin
npm run typecheck:miniprogram
DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run test:molding-execution
npm --prefix apps/miniprogram test
npm run test:permissions
git diff --check
```

Expected: all commands exit `0` with no failed tests.

- [x] **Step 3: Verify the running local environment**

Verify `GET /api/health`, the admin task list, and a dispatched but unready task detail. Confirm the page shows `已派工`, shows readiness shortage only in the detail/table, and does not show the removed top alert.
