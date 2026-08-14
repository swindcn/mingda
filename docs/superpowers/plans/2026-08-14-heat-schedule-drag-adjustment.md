# Heat Schedule Drag Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow authorized administrators to edit and drag WAITING heat orders across compatible furnace rows with 15-minute snapping, conflict confirmation, audit history, and optimistic concurrency protection.

**Architecture:** Add one transactional schedule-adjustment endpoint to `ProductionService`, protected by a new `production.schedule.adjust` permission and `versionNo`. Reuse the endpoint from a shared admin adjustment action used by both the heat detail page and the equipment Gantt; isolate pointer geometry in a small drag helper and keep all business validation on the API.

**Tech Stack:** NestJS, Prisma/PostgreSQL, React 19, Ant Design 6, Pointer Events, Node integration tests.

---

### Task 1: Schedule Adjustment API Contract And Regression Tests

**Files:**
- Modify: `apps/api/scripts/test-production-execution.mjs`
- Modify: `apps/api/src/production/production.types.ts`
- Modify: `apps/api/src/production/melt-scheduling.controller.ts`

- [ ] Add integration assertions for same-device adjustment, cross-device adjustment, preserved duration, incompatible recipe rejection, non-WAITING rejection, conflict confirmation, stale `versionNo`, and audit payload.
- [ ] Run `npm --prefix apps/api run test:production-execution` and verify the new schedule endpoint assertions fail with 404.
- [ ] Add `AdjustHeatScheduleBody` with `versionNo`, `furnaceCode`, `plannedStartAt`, `confirmScheduleConflict`, and optional `remark`.
- [ ] Add `PUT :id/schedule` to `HeatSchedulingController`.

### Task 2: Prisma Action And Transactional Schedule Adjustment

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260814150000_heat_schedule_adjustment/migration.sql`
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`

- [ ] Add `SCHEDULE_ADJUSTED` to `HeatOrderAction` and the PostgreSQL enum migration.
- [ ] Extend `heatConflicts` with optional `excludeHeatOrderId` so adjustment does not conflict with itself.
- [ ] Implement `adjustHeatOrderSchedule`: validate quarter-hour input, WAITING status, same workshop, enabled melting furnace, capacity, recipe applicability, and preserved original duration.
- [ ] Return structured `409/HEAT_SCHEDULE_CONFLICT` before mutation unless confirmed.
- [ ] Update furnace snapshots, planned/calculated/final finish fields, increment `versionNo`, and create an audit record in one retryable transaction.
- [ ] Map `PUT /heat-orders/:id/schedule` to `production.schedule.adjust`.
- [ ] Generate Prisma client and run the integration suite until green.

### Task 3: Permission Tree And Admin API Utilities

**Files:**
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/src/mold-development.controller.ts`
- Modify: `apps/admin/src/utils/production.ts`

- [ ] Add `production.schedule.adjust` to administrator defaults and the role permission tree as “合炉排产-调整排程”.
- [ ] Add the permission to backend administrator permission constants.
- [ ] Extend equipment schedule DTOs with `versionNo`, recipe details, and draggable compatibility inputs returned by the API.
- [ ] Add `adjustHeatOrderSchedule` API utility and payload/result types.

### Task 4: Shared Adjustment Dialog And Detail Entry

**Files:**
- Create: `apps/admin/src/pages/production/HeatScheduleAdjustment.tsx`
- Modify: `apps/admin/src/pages/production/HeatOrderDetailPage.tsx`
- Modify: `apps/admin/tests/heat-execution-concurrency.test.mjs`

- [ ] Add a failing source regression test for permission-gated adjustment, preflight refresh, conflict retry, and stale-data refresh.
- [ ] Implement a shared adjustment confirmation operation that accepts a proposed furnace/start time, shows old/new values, retries confirmed conflicts, and refreshes on success or `409`.
- [ ] Add a WAITING-only “调整排程” button to the detail header and a form modal for compatible furnace and quarter-hour DatePicker selection.
- [ ] Run `npm --prefix apps/admin run test:heat-execution` and `npm run build:admin` until green.

### Task 5: Pointer Geometry And Gantt Dragging

**Files:**
- Create: `apps/admin/src/pages/production/heatScheduleDrag.ts`
- Modify: `apps/admin/src/pages/production/EquipmentScheduleOverview.tsx`
- Modify: `apps/admin/src/index.css`
- Create: `apps/admin/tests/heat-schedule-drag.test.mjs`
- Modify: `apps/admin/package.json`

- [ ] Add failing tests for 15-minute snapping, date-to-axis conversion, click/drag threshold markers, WAITING/permission gating, and pointer capture usage.
- [ ] Implement pure helpers for minute snapping, date construction, and preserved-duration finish calculation.
- [ ] Add pointer-down/move/up/cancel state to the timeline, horizontal auto-scroll, vertical furnace-row hit testing, original-position placeholder, and drag preview.
- [ ] Reject incompatible target rows in the preview and use the shared adjustment confirmation after pointer release.
- [ ] Keep normal click navigation when movement stays below the drag threshold.
- [ ] Run the new UI tests and admin build until green.

### Task 6: Documentation, Full Verification, And Local Docker Update

**Files:**
- Modify: `docs/product/production-execution-context.md`
- Modify: `docs/product/production-execution-test-cases.md`

- [ ] Document permission, API, 15-minute snapping, cross-device checks, soft conflicts, audit action, and mobile read-only behavior.
- [ ] Run `npm --prefix apps/api run test:production-execution`.
- [ ] Run `npm --prefix apps/admin run test:heat-execution` and `npm --prefix apps/admin run test:heat-schedule-drag`.
- [ ] Run `npm run build:api`, `npm run build:admin`, and `git diff --check`.
- [ ] Apply the local Prisma schema, update local Docker API/admin artifacts, and verify `/api/health` plus the management page.
