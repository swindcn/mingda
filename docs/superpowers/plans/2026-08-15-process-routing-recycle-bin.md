# Process Routing Recycle Bin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recoverable archive for disabled process-routing versions without deleting traceability data.

**Architecture:** Add nullable `recycledAt` to the routing version, filter it at the controller boundary, and expose explicit recycle/restore actions protected by a dedicated permission. The existing routing list opens a modal recycle bin and reuses the shared table/action components.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, Ant Design, Node test scripts.

---

### Task 1: Backend lifecycle

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/process-routing/process-routing.controller.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`
- Modify: `apps/api/src/shared/admin-default-permissions.ts`
- Test: `apps/api/scripts/test-process-routings.mjs`

- [ ] Add a failing API test covering disabled-only recycle, normal/recycled list separation, and restore.
- [ ] Add `recycledAt`, list filtering, recycle/restore endpoints, and recycled-record action guards.
- [ ] Add and guard `model.routing.recycle`.
- [ ] Run `npm --prefix apps/api run test:process-routings` and confirm it passes.

### Task 2: Management UI

**Files:**
- Modify: `apps/admin/src/utils/processRoutings.ts`
- Modify: `apps/admin/src/pages/modeling/ProcessRoutingListPage.tsx`
- Modify: `apps/admin/src/utils/roles.ts`
- Test: `apps/admin/tests/process-routing-ui.test.mjs`

- [ ] Add a failing source regression test for the recycle-bin button, permission, recycle action, and restore action.
- [ ] Add API client methods and `recycledAt` typing.
- [ ] Add the page-header recycle-bin modal and permission-controlled row actions using shared controls.
- [ ] Run the admin source tests and production build.

### Task 3: Integration and documentation

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/context-summary.md`
- Modify: `docs/product/modeling-test-cases.md`

- [ ] Document the soft-recycle lifecycle and its independence from product assignment.
- [ ] Apply Prisma schema to local Docker PostgreSQL and rebuild API/admin containers.
- [ ] Run API regression, all admin source tests, both builds, health checks, and `git diff --check`.
