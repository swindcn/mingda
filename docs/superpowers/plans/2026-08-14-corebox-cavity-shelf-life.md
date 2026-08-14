# Corebox Cavity Count And BOM Shelf Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist corebox cavity count in the corebox master and persist optional shelf life in hours on each BOM-version/corebox relation.

**Architecture:** Extend the existing Prisma models rather than adding new tables. Reuse the current mold nested-corebox transaction and casting-BOM structured `coreBoxes[]` contract, adding strict normalization and preserving both values through DTOs, version copy, calculations, and the existing compact Ant Design forms.

**Tech Stack:** Prisma 6, PostgreSQL 16, NestJS, React 19, Ant Design 6, TypeScript, Node integration tests, Docker Compose.

---

## File Structure

- Modify `apps/api/prisma/schema.prisma`: add `CoreBoxMaster.cavityCount` and `CastingBomVersionCoreBox.shelfLifeHours`.
- Modify `apps/api/src/modeling.controller.ts`: normalize, validate, persist, and return corebox cavity count.
- Modify `apps/api/src/casting-bom.controller.ts`: normalize, validate, persist, copy, and return BOM corebox shelf life.
- Modify `apps/api/scripts/test-mold-coreboxes.mjs`: integration coverage for cavity count and legacy default.
- Modify `apps/api/scripts/test-casting-boms.mjs`: integration coverage for shelf life, invalid values, version copy, and calculation response.
- Modify `apps/admin/src/utils/modeling.ts`: type the corebox cavity count.
- Modify `apps/admin/src/utils/castingBoms.ts`: type BOM shelf life.
- Modify `apps/admin/src/pages/modeling/MoldCoreBoxEditor.tsx`: maintain cavity count in nested corebox rows.
- Modify `apps/admin/src/pages/modeling/modelingConfigs.tsx`: expose cavity count on the independent corebox page.
- Modify `apps/admin/src/pages/modeling/CastingBomManagementPage.tsx`: maintain shelf life beside core quantity ratio.
- Modify `apps/admin/src/index.css`: keep the expanded BOM tooling table compact.
- Modify `apps/admin/tests/mold-corebox-bom-ui.test.mjs` and `apps/admin/tests/casting-bom-corebox-ui.test.mjs`: UI contract regression.
- Modify `docs/product/context-summary.md`, `docs/product/modeling-context.md`, and `docs/product/modeling-test-cases.md`: long-term business and test guidance.

## Task 1: Add Failing Integration Coverage

- [ ] Extend `test-mold-coreboxes.mjs` so created rows use cavity counts `2`, `4`, and `1`; assert returned and stored values, update one value, and assert an omitted value defaults to `1`.
- [ ] Add invalid cavity-count requests for `0`, `-1`, `1.5`, and a non-numeric value; each must return a business error containing `穴数`.
- [ ] Extend `test-casting-boms.mjs` so structured corebox rows include `shelfLifeHours: 8.5` and `24`; assert detail values, copied-version values, and calculation values.
- [ ] Add invalid shelf-life requests for `0` and `-1`; assert a business error containing `保质期`.
- [ ] Run both scripts against the current API and verify failure occurs because the new fields are not implemented.

## Task 2: Add Prisma Fields And API Behavior

- [ ] Add `cavityCount Int @default(1)` to `CoreBoxMaster`.
- [ ] Add `shelfLifeHours Decimal? @db.Decimal(12, 4)` to `CastingBomVersionCoreBox`.
- [ ] Run `npm --prefix apps/api run prisma:generate` and synchronize the local PostgreSQL schema with `prisma db push`.
- [ ] In `coreBoxesFromBody`, normalize omitted cavity count to `1` and reject non-integer or non-positive values with `芯盒穴数必须为大于 0 的整数`.
- [ ] Return `cavityCount` from nested mold and independent corebox DTOs.
- [ ] In BOM normalization, preserve missing shelf life as `null`, accept decimal hours greater than zero, and return `保质期必须大于 0 小时` otherwise.
- [ ] Include `shelfLifeHours` in BOM DTOs, new-version/clone copying, and calculation responses.
- [ ] Run API build and both integration scripts; expect success.
- [ ] Commit backend and test changes.

## Task 3: Add Management UI Fields

- [ ] Add `cavityCount: number` to `MoldCoreBoxRecord` and `shelfLifeHours?: number` to BOM corebox types and payload rows.
- [ ] Add an integer `穴数` input to `MoldCoreBoxEditor`; new rows initialize with `1` and existing values are returned unchanged.
- [ ] Add `穴数` to the independent corebox list and create/view/edit configuration with minimum `1`, integer precision, and default `1`.
- [ ] Add `保质期（小时）` to BOM corebox rows beside `芯件比`; allow empty values and decimal input greater than zero.
- [ ] Preserve shelf life when opening existing BOMs and when molds add their default corebox rows.
- [ ] Update the static UI tests first, verify they fail, then implement the fields and run all admin tests and the admin build.
- [ ] Commit frontend changes.

## Task 4: Documentation And Docker Verification

- [ ] Document that corebox cavity count is master data, BOM quantity ratio is per-product quantity, and BOM shelf life is an optional process constraint in hours.
- [ ] Add test cases covering defaults, validation, persistence, version copy, and calculation responses.
- [ ] Run `git diff --check`, Prisma validation, API build, all admin tests, admin build, and both API integration scripts.
- [ ] Update the local Docker API schema/client/build output and admin static build; restart containers.
- [ ] Verify `/api/health`, mold archive edit, independent corebox edit, and BOM detail in the browser with no console errors.
- [ ] Commit documentation and report the Docker Hub image-build limitation separately if network metadata retrieval still times out.
