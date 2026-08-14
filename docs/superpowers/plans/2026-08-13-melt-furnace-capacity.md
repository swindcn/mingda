# Melt Furnace Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore selectable target melting equipment and add single-heat remaining-capacity calculation and validation to combined melt scheduling.

**Architecture:** Extend the shared production capacity converter to recognize per-heat weight units, while preserving rejection of rate and count units. The API remains authoritative: scheduling options expose normalized capacity and diagnostics, and heat creation recalculates capacity inside the serializable transaction. The admin calculator derives remaining capacity from server-provided normalized capacity and selected work-order quantities.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, TypeScript, Ant Design, Node integration scripts, Docker Compose.

---

## File Structure

- Modify `apps/api/src/production/production.calculations.ts`: normalize supported single-heat capacity units.
- Modify `apps/api/scripts/test-production-calculations.mjs`: regression coverage for per-heat units and invalid rate units.
- Modify `apps/api/src/production/production.service.ts`: return usable furnace options and enforce descriptive capacity validation.
- Modify `apps/api/scripts/test-production-execution.mjs`: API coverage for furnace options, exact capacity, overflow, and invalid equipment.
- Modify `apps/admin/src/utils/production.ts`: describe furnace option capacity metadata.
- Modify `apps/admin/src/pages/production/MeltSchedulingPage.tsx`: display device options, empty diagnostics, remaining capacity, and utilization.
- Modify `docs/product/modeling-test-cases.md`: record manual acceptance scenarios.

### Task 1: Capacity Unit Regression Coverage

**Files:**
- Modify: `apps/api/scripts/test-production-calculations.mjs`
- Test: `apps/api/scripts/test-production-calculations.mjs`

- [ ] **Step 1: Add failing per-heat unit assertions**

Add assertions equivalent to:

```js
assert.equal(capacityToKg(1, '吨/炉'), 1000)
assert.equal(capacityToKg(2200, 'kg/炉'), 2200)
assert.equal(capacityToKg(1, ' t / 炉 '), 1000)
assert.throws(() => capacityToKg(10, '件/班'), /单炉重量/)
assert.throws(() => capacityToKg(1, '吨/小时'), /单炉重量/)
```

- [ ] **Step 2: Run the calculation suite and verify RED**

Run:

```bash
npm --prefix apps/api run test:production-calculations
```

Expected: FAIL because `吨/炉` and `kg/炉` are currently unsupported.

- [ ] **Step 3: Commit the failing regression test**

```bash
git add apps/api/scripts/test-production-calculations.mjs
git commit -m "test: cover per-heat furnace capacity units"
```

### Task 2: Normalize Single-Heat Capacity Units

**Files:**
- Modify: `apps/api/src/production/production.calculations.ts`
- Test: `apps/api/scripts/test-production-calculations.mjs`

- [ ] **Step 1: Implement strict unit normalization**

Normalize whitespace and case, then accept only these aliases:

```ts
const normalized = unit.trim().toLowerCase().replaceAll(' ', '')
const kilograms = new Set(['kg', '千克', 'kg/炉', '千克/炉'])
const tonnes = new Set(['t', '吨', 't/炉', '吨/炉'])
if (kilograms.has(normalized)) return roundWeight(value)
if (tonnes.has(normalized)) return roundWeight(value * 1000)
throw new Error('设备能力单位必须是单炉重量（kg、kg/炉、t 或吨/炉）')
```

- [ ] **Step 2: Run the calculation suite and verify GREEN**

Run:

```bash
npm --prefix apps/api run test:production-calculations
```

Expected: PASS with `{ "ok": true, "suite": "production-calculations" }`.

- [ ] **Step 3: Commit the converter change**

```bash
git add apps/api/src/production/production.calculations.ts
git commit -m "fix: support per-heat furnace capacity units"
```

### Task 3: Scheduling API Capacity Tests

**Files:**
- Modify: `apps/api/scripts/test-production-execution.mjs`
- Test: `apps/api/scripts/test-production-execution.mjs`

- [ ] **Step 1: Configure the test furnace with a production-like unit**

Create the test furnace with:

```js
{ capacity: 10, capacityUnit: '吨/炉' }
```

Assert the scheduling option returns:

```js
item.capacityKg === 10000
item.capacity === 10
item.capacityUnit === '吨/炉'
```

- [ ] **Step 2: Add exact-capacity and overflow requests**

Create one heat whose allocations total exactly `10000 kg` and expect success. Submit another request totaling more than `10000 kg` and expect a business failure whose message includes the device name, capacity, target weight, and excess weight.

- [ ] **Step 3: Run the production integration suite and verify RED**

Run:

```bash
npm --prefix apps/api run test:production-execution
```

Expected: FAIL because option metadata and descriptive overflow output are not yet implemented.

- [ ] **Step 4: Commit the failing API regression tests**

```bash
git add apps/api/scripts/test-production-execution.mjs
git commit -m "test: cover furnace remaining capacity rules"
```

### Task 4: Scheduling Options and Authoritative Validation

**Files:**
- Modify: `apps/api/src/production/production.service.ts`
- Test: `apps/api/scripts/test-production-execution.mjs`

- [ ] **Step 1: Return normalized and original capacity metadata**

Each furnace option must return:

```ts
{
  code: furnace.code,
  name: furnace.name,
  workshopCode: furnace.workshopCode || '',
  workshopName: furnace.workshop?.name || '',
  capacity: decimal(furnace.capacity),
  capacityUnit: furnace.capacityUnit,
  capacityKg: capacityToKg(decimal(furnace.capacity), furnace.capacityUnit),
}
```

Return an `unavailableReason` when the current material has no valid devices:

```ts
unavailableReason: furnaceMap.size
  ? ''
  : '当前材质暂无可用熔炼设备，请检查已生效配方和设备容量配置'
```

- [ ] **Step 2: Improve overflow validation inside the transaction**

Calculate:

```ts
const excessKg = roundWeight(targetWeightKg - capacityKg)
if (excessKg > 0) {
  throw new BadRequestException(
    `${furnace.name}单炉容量为 ${capacityKg} kg，目标铁水为 ${targetWeightKg} kg，超出 ${excessKg} kg`,
  )
}
```

Keep recipe/material/device/team checks and serializable transaction behavior unchanged.

- [ ] **Step 3: Run API tests and verify GREEN**

Run:

```bash
npm --prefix apps/api run test:production-calculations
npm --prefix apps/api run test:production-execution
```

Expected: both suites PASS.

- [ ] **Step 4: Commit the API implementation**

```bash
git add apps/api/src/production/production.service.ts
git commit -m "feat: expose and validate single-heat capacity"
```

### Task 5: Admin Remaining-Capacity Calculator

**Files:**
- Modify: `apps/admin/src/utils/production.ts`
- Modify: `apps/admin/src/pages/production/MeltSchedulingPage.tsx`

- [ ] **Step 1: Extend the furnace option type**

Define furnace options as:

```ts
furnaces: Array<{
  code: string
  name: string
  workshopCode: string
  workshopName: string
  capacity: number
  capacityUnit: string
  capacityKg: number
}>
unavailableReason: string
```

- [ ] **Step 2: Derive remaining capacity and utilization**

Use:

```ts
const remainingCapacityKg = capacityKg - targetWeightKg
const isOverCapacity = remainingCapacityKg < 0
const utilization = capacityKg ? targetWeightKg / capacityKg * 100 : 0
```

Do not send these derived values to the API.

- [ ] **Step 3: Improve device selection and empty state**

Show device labels as `设备名称（1.00 t/炉）`. Add `showSearch` and `optionFilterProp="label"`. When no device is available, set `notFoundContent` to the API diagnostic and display the same diagnostic below the field.

- [ ] **Step 4: Display the capacity summary**

Display separate summary values for target iron weight, single-heat capacity, and remaining capacity. Render a negative remaining value in danger color. Keep the progress bar layout stable when values change.

- [ ] **Step 5: Enforce button behavior**

Disable generation when no orders are selected, no valid device capacity exists, or `isOverCapacity` is true. The backend remains the final enforcement boundary.

- [ ] **Step 6: Build the admin app**

Run:

```bash
npm run build:admin
```

Expected: TypeScript and Vite build PASS.

- [ ] **Step 7: Commit the admin implementation**

```bash
git add apps/admin/src/utils/production.ts apps/admin/src/pages/production/MeltSchedulingPage.tsx
git commit -m "feat: show melt furnace remaining capacity"
```

### Task 6: Documentation and Local Docker Verification

**Files:**
- Modify: `docs/product/modeling-test-cases.md`

- [ ] **Step 1: Add acceptance cases**

Document cases for `吨/炉` device visibility, exact-capacity submission, overflow blocking, invalid-unit exclusion, recipe-device compatibility, and workshop-team compatibility.

- [ ] **Step 2: Run full focused verification**

Run:

```bash
npm run build:api
npm --prefix apps/api run test:production-calculations
npm --prefix apps/api run test:production-execution
npm run build:admin
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Sync local Docker services**

```bash
docker cp apps/api/dist/. mingda-api-dev:/app/apps/api/dist/
docker restart mingda-api-dev
docker cp apps/admin/dist/. mingda-admin-dev:/usr/share/nginx/html/
docker restart mingda-admin-dev
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS -o /dev/null http://127.0.0.1:8081/
```

Expected: API health returns code 0 and admin returns HTTP 200.

- [ ] **Step 4: Verify the browser workflow**

Open `http://127.0.0.1:8081/dashboard/production/melt-scheduling`, select a material and confirm the bound melting furnaces are selectable. Select orders, change quantities, verify remaining capacity updates, verify overflow blocks submission, then submit a valid heat and confirm it appears in the heat-order list.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/product/modeling-test-cases.md
git commit -m "docs: add melt capacity acceptance cases"
```
