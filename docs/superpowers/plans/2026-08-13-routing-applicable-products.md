# Routing Applicable Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split process routing editing into route and applicable-product tabs, allowing product associations on active routes without creating a new route version.

**Architecture:** Keep `RoutingApplicableProduct` attached to `ProcessRoutingVersion`, but expose a dedicated transactional replacement endpoint. Route graph updates retain existing version rules, while applicable products become independently editable for draft and active versions. The frontend uses a focused table component inside the second tab and persists saved routes through the dedicated endpoint.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, TypeScript, Ant Design, existing API test scripts and Playwright CLI.

---

### Task 1: Backend regression coverage

**Files:**
- Modify: `apps/api/scripts/test-process-routings.mjs`

- [ ] Add assertions that an active route can add and remove an applicable finished/semi-finished product through `PUT /admin/modeling/routings/:id/applicable-products` without changing version or status.
- [ ] Add assertions that removing a default product deletes its `ProductDefaultRouting` relation.
- [ ] Add assertions that disabled routes and raw-material product codes are rejected.
- [ ] Run `npm --prefix apps/api run test:process-routings` and confirm failure because the endpoint does not exist.

### Task 2: Applicable-product API

**Files:**
- Modify: `apps/api/src/process-routing/process-routing.controller.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`

- [ ] Add `PUT :id/applicable-products` guarded by `model.routing.edit`.
- [ ] Validate that status is not `DISABLED`, all products exist, and types start with `成品` or `半成品`.
- [ ] In one transaction, replace `RoutingApplicableProduct` rows and remove default-route rows for removed products.
- [ ] Return the refreshed route DTO.
- [ ] Run the process-routing regression and API build; confirm both pass.

### Task 3: Applicable-product tab component

**Files:**
- Create: `apps/admin/src/pages/modeling/routing/RoutingApplicableProducts.tsx`
- Modify: `apps/admin/src/utils/processRoutings.ts`
- Modify: `apps/admin/src/index.css`

- [ ] Add API helper `updateRoutingApplicableProducts(id, productCodes)`.
- [ ] Build a table using existing `ResizableTable` and page action standards, with product code, name, type, material grade, default marker, and delete action.
- [ ] Add query refresh and add-products modal; hide editing controls without edit permission or for disabled routes.
- [ ] Persist saved-route changes immediately and refresh from the returned DTO; for unsaved new routes, update parent form state only.

### Task 4: Workbench tabs and route payload separation

**Files:**
- Modify: `apps/admin/src/pages/modeling/ProcessRoutingWorkbenchPage.tsx`

- [ ] Add Ant Design tabs: first `工艺线路`, second `适用产品`.
- [ ] Remove the multi-select product field from route basic information.
- [ ] Keep product codes in initial create and draft route payloads so new-route selections are saved.
- [ ] Let active routes edit only applicable products; keep graph and basic fields read-only.
- [ ] Refresh parent record, form values, and product table after independent updates.

### Task 5: Verification and documentation

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`

- [ ] Document that route content is versioned while applicable products can change independently on draft and active versions.
- [ ] Run API process-routing tests, API build, admin build, and `git diff --check`.
- [ ] Update local Docker API/admin artifacts and verify both route tabs with Playwright.
- [ ] Confirm disabled routes are read-only and browser console has no unexpected errors.
