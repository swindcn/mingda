# Mold Multi-Corebox and BOM Ratio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple corebox archives under one mold and store each corebox's per-product core quantity on a BOM version, with compact archive and BOM editing interfaces.

**Architecture:** Keep the existing `MoldMaster -> CoreBoxMaster[]` Prisma relation and replace the single-corebox synchronization path with a transactional collection synchronizer. Add `quantityPerProduct` to the BOM-version/corebox join record so tooling master data stays independent from product-specific quantity. Use a dedicated mold archive page for the multi-row editor while retaining the generic master page for independent corebox maintenance.

**Tech Stack:** NestJS, Prisma 6, PostgreSQL 16, React 19, Ant Design 6, TypeScript, Node integration scripts, Playwright CLI.

---

## File Structure

### Create

- `apps/api/scripts/test-mold-coreboxes.mjs`: API integration coverage for transactional multi-corebox creation, update, conflict rollback, and removal-to-disable behavior.
- `apps/admin/src/pages/modeling/MoldArchivePage.tsx`: dedicated list and compact mold/corebox form; owns multi-corebox form state and archive actions.
- `apps/admin/src/pages/modeling/MoldCoreBoxEditor.tsx`: focused `Form.List` editor for multiple coreboxes, images, status, and compact row layout.
- `apps/admin/tests/mold-corebox-bom-ui.test.mjs`: static regression checks for route wiring, multi-corebox form fields, and BOM ratio controls.

### Modify

- `apps/api/prisma/schema.prisma`: add BOM corebox `quantityPerProduct`.
- `apps/api/src/modeling.controller.ts`: normalize `coreBoxes[]`, save mold and coreboxes atomically, disable omitted existing coreboxes, and return all coreboxes.
- `apps/api/src/casting-bom.controller.ts`: accept structured BOM corebox rows, validate ratios, preserve legacy input, copy ratios, and return ratios from detail/calculation endpoints.
- `apps/api/scripts/test-casting-boms.mjs`: cover default, custom, invalid, copied, and calculated corebox quantities.
- `apps/api/package.json`: expose the mold/corebox integration test command.
- `apps/admin/src/App.tsx`: route mold archives to the dedicated page.
- `apps/admin/src/utils/modeling.ts`: add typed mold/corebox archive payloads.
- `apps/admin/src/utils/castingBoms.ts`: replace form payload `coreBoxCodes[]` with structured `coreBoxes[]` while retaining response compatibility.
- `apps/admin/src/pages/modeling/CastingBomManagementPage.tsx`: replace the corebox multi-select with a configuration table and automatic ratio defaults.
- `apps/admin/src/pages/modeling/modelingConfigs.tsx`: remove the obsolete embedded single-corebox form fields; retain independent corebox configuration.
- `apps/admin/src/index.css`: compact mold/corebox modal and BOM tooling table styles.
- `docs/product/context-summary.md`: record the final one-to-many and ratio rules.
- `docs/product/modeling-context.md`: update production-modeling relationships and future core-making calculation contract.
- `docs/product/modeling-test-cases.md`: add multi-corebox and core quantity scenarios.

## Task 1: Persist Core Quantity on BOM Versions

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/scripts/test-casting-boms.mjs`

- [ ] **Step 1: Add a failing schema assertion to the BOM integration script**

Add `readFileSync` to the imports in `apps/api/scripts/test-casting-boms.mjs`, then add this before creating test records:

```js
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const coreBoxModel = /model CastingBomVersionCoreBox \{([\s\S]*?)\n\}/.exec(schema)?.[1] || ''
if (!/quantityPerProduct\s+Decimal/.test(coreBoxModel)) {
  throw new Error('CastingBomVersionCoreBox 缺少 quantityPerProduct')
}
```

Also add the definitive persistence assertion after a BOM is created:

```js
const storedCoreBox = await prisma.castingBomVersionCoreBox.findUnique({
  where: {
    bomVersionId_coreBoxCode: {
      bomVersionId: v1.id,
      coreBoxCode: coreBoxA,
    },
  },
})
if (Number(storedCoreBox?.quantityPerProduct) !== 2) {
  throw new Error('BOM 芯件比未持久化')
}
```

- [ ] **Step 2: Run the test to verify the schema assertion fails**

Run:

```bash
npm --prefix apps/api run test:casting-boms
```

Expected: FAIL with `CastingBomVersionCoreBox 缺少 quantityPerProduct` before API test records are created.

- [ ] **Step 3: Add the Prisma field**

Change `CastingBomVersionCoreBox` to include:

```prisma
model CastingBomVersionCoreBox {
  bomVersionId        String
  coreBoxCode         String
  coreBoxNameSnapshot String
  moldCodeSnapshot    String
  quantityPerProduct  Decimal           @default(1) @db.Decimal(12, 4)
  createdAt           DateTime          @default(now())
  bomVersion          CastingBomVersion @relation(fields: [bomVersionId], references: [id], onUpdate: Cascade, onDelete: Cascade)
  coreBox             CoreBoxMaster     @relation(fields: [coreBoxCode], references: [code], onUpdate: Cascade, onDelete: Restrict)

  @@id([bomVersionId, coreBoxCode])
  @@index([coreBoxCode])
}
```

- [ ] **Step 4: Generate the client and update the local Docker database**

Run:

```bash
npm --prefix apps/api run prisma:generate
DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' \
  npx --prefix apps/api prisma db push --schema apps/api/prisma/schema.prisma
```

Expected: Prisma generation succeeds and `db push` reports the database is synchronized. Existing join rows receive `1.0000`.

- [ ] **Step 5: Commit the schema change**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat: add BOM corebox quantity ratio"
```

## Task 2: Replace Single-Corebox Mold Synchronization

**Files:**
- Create: `apps/api/scripts/test-mold-coreboxes.mjs`
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write a failing API integration test**

Create `apps/api/scripts/test-mold-coreboxes.mjs` with a unique product and mold. The core test body must submit three rows:

```js
const moldPayload = {
  code: moldCode,
  name: '发动机缸体组合模具',
  itemCode: productCode,
  status: '启用',
  images: [],
  coreBoxes: [
    { code: `${moldCode}-WATER`, name: '水道芯盒', maxLife: 30000, usedLife: 0, images: [], status: '启用' },
    { code: `${moldCode}-CRANK`, name: '曲轴箱芯盒', maxLife: 25000, usedLife: 0, images: [], status: '启用' },
    { code: `${moldCode}-OIL`, name: '油道芯盒', maxLife: 20000, usedLife: 0, images: [], status: '启用' },
  ],
}

const created = await request('/admin/modeling/molds', {
  method: 'POST',
  headers,
  body: JSON.stringify(moldPayload),
})
if (created.coreBoxes.length !== 3) throw new Error('模具未保存三套芯盒')
```

Then update the payload by changing the water-core name, omitting the oil-core row, and adding an intake-core row. Assert:

```js
const updated = await request(`/admin/modeling/molds/${moldCode}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    ...moldPayload,
    coreBoxes: [
      { ...moldPayload.coreBoxes[0], name: '发动机水道芯盒' },
      moldPayload.coreBoxes[1],
      { code: `${moldCode}-INTAKE`, name: '进气道芯盒', images: [], status: '启用' },
    ],
  }),
})
if (updated.coreBoxes.length !== 4) throw new Error('返回结果应包含启用和停用芯盒')
const disabled = updated.coreBoxes.find((item) => item.code === `${moldCode}-OIL`)
if (disabled?.status !== '停用') throw new Error('移除的已有芯盒未转为停用')
```

Add a conflict case that creates another mold using one existing corebox code, expects failure, and verifies the second mold was not created. Clean up ownership, coreboxes, molds, and the product in `finally`.

- [ ] **Step 2: Run the test and verify it fails on the current single-corebox implementation**

Run:

```bash
npm --prefix apps/api run build
node apps/api/scripts/test-mold-coreboxes.mjs
```

Expected: FAIL because `coreBoxes[]` is ignored and only the legacy single row is synchronized.

- [ ] **Step 3: Add typed normalization helpers**

In `apps/api/src/modeling.controller.ts`, add:

```ts
interface MoldCoreBoxInput {
  code: string
  name: string
  images: unknown[]
  maxLife?: number
  usedLife: number
  status: string
  remark?: string
}

function normalizeMoldCoreBoxes(value: unknown): MoldCoreBoxInput[] {
  return toJsonArray(value).map((entry) => {
    const row = entry as Record<string, unknown>
    const code = stringValue(row.code)
    const name = stringValue(row.name)
    if (!code || !name) throw new BadRequestException('芯盒编码和名称不能为空')
    if (!codePattern.test(code)) throw new BadRequestException(`芯盒编码 ${code} 不能包含中文或空格`)
    return {
      code,
      name,
      images: toJsonArray(row.images),
      maxLife: toInt(row.maxLife),
      usedLife: toInt(row.usedLife) ?? 0,
      status: stringValue(row.status) || '启用',
      remark: stringValue(row.remark),
    }
  })
}
```

Reject duplicate codes with a message that includes the duplicate code.

- [ ] **Step 4: Implement one transactional mold save path**

Replace calls to `syncCoreBoxForMold` for `resource === 'molds'` with a dedicated method whose contract is:

```ts
private async saveMoldWithCoreBoxes(
  request: RequestWithAdmin,
  mode: 'create' | 'update',
  id: string | undefined,
  body: Record<string, unknown>,
) {
  const coreBoxes = normalizeMoldCoreBoxes(body.coreBoxes)
  return this.prisma.$transaction(async (tx) => {
    // Validate every submitted code before writing.
    // Create/update the mold.
    // Create/update submitted rows owned by this mold.
    // updateMany omitted existing rows to status = '停用'.
    // Set hasCoreBox from enabled child count.
    // Upsert ownership inside the same transaction.
    // Return mold with supplier and every corebox ordered by createdAt.
  })
}
```

Use `tx.coreBoxMaster.findMany({ where: { code: { in: codes } } })` before writes. If a record has another `moldCode`, throw:

```ts
throw new BadRequestException(`芯盒编码 ${conflict.code} 已属于模具 ${conflict.moldCode}`)
```

For update, preserve omitted rows and run:

```ts
await tx.coreBoxMaster.updateMany({
  where: { moldCode, code: { notIn: submittedCodes }, status: { not: '停用' } },
  data: { status: '停用' },
})
```

- [ ] **Step 5: Keep legacy single-corebox requests compatible**

Before normalization, translate a legacy request only when `body.coreBoxes` is absent:

```ts
const requestedCoreBoxes = Array.isArray(body.coreBoxes)
  ? body.coreBoxes
  : body.hasCoreBox
    ? [{
        code: body.coreBoxCode,
        name: body.coreBoxName,
        images: body.coreBoxImages,
        maxLife: body.coreBoxMaxLife,
        usedLife: body.coreBoxUsedLife,
        status: body.status,
        remark: body.coreBoxRemark,
      }]
    : []
```

- [ ] **Step 6: Add the package command and run the integration test**

Add to `apps/api/package.json`:

```json
"test:mold-coreboxes": "node scripts/test-mold-coreboxes.mjs"
```

Run:

```bash
npm --prefix apps/api run build
npm --prefix apps/api run test:mold-coreboxes
```

Expected: PASS and cleanup leaves no `TEST-MOLD-*` records.

- [ ] **Step 7: Commit the API behavior**

```bash
git add apps/api/src/modeling.controller.ts apps/api/scripts/test-mold-coreboxes.mjs apps/api/package.json
git commit -m "feat: support multiple coreboxes per mold"
```

## Task 3: Build the Compact Mold Archive Workbench

**Files:**
- Create: `apps/admin/src/pages/modeling/MoldArchivePage.tsx`
- Create: `apps/admin/src/pages/modeling/MoldCoreBoxEditor.tsx`
- Create: `apps/admin/tests/mold-corebox-bom-ui.test.mjs`
- Modify: `apps/admin/src/utils/modeling.ts`
- Modify: `apps/admin/src/pages/modeling/modelingConfigs.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: Write a failing UI source regression test**

Create `apps/admin/tests/mold-corebox-bom-ui.test.mjs` and assert:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('mold archive uses the multi-corebox editor', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/MoldArchivePage.tsx'), 'utf8')
  const editor = fs.readFileSync(path.join(root, 'src/pages/modeling/MoldCoreBoxEditor.tsx'), 'utf8')
  assert.match(app, /<MoldArchivePage\s*\/>/)
  assert.match(page, /coreBoxes/)
  assert.match(editor, /Form\.List name="coreBoxes"/)
  assert.match(editor, /新增芯盒/)
})
```

- [ ] **Step 2: Run the UI test and verify it fails because the dedicated files do not exist**

Run:

```bash
node --test apps/admin/tests/mold-corebox-bom-ui.test.mjs
```

Expected: FAIL with missing `MoldArchivePage.tsx`.

- [ ] **Step 3: Add typed archive interfaces**

In `apps/admin/src/utils/modeling.ts`, add:

```ts
export interface MoldCoreBoxRecord {
  id?: string
  code: string
  name: string
  images: string[]
  maxLife?: number
  usedLife?: number
  status: string
  remark?: string
}

export interface MoldArchiveRecord extends ModelingRecord {
  code: string
  name: string
  itemCode: string
  images: string[]
  coreBoxes: MoldCoreBoxRecord[]
}
```

- [ ] **Step 4: Implement the focused corebox editor**

`MoldCoreBoxEditor.tsx` must use `Form.List name="coreBoxes"`, render compact rows, and call `remove(field.name)` only for unsaved rows. For persisted rows, the remove action must set `status` to `停用` and keep the row visible. Each row must contain these registered values:

```tsx
<Form.Item name={[field.name, 'code']} rules={[{ required: true }]}><Input disabled={Boolean(row.id)} /></Form.Item>
<Form.Item name={[field.name, 'name']} rules={[{ required: true }]}><Input /></Form.Item>
<Form.Item name={[field.name, 'maxLife']}><InputNumber min={0} /></Form.Item>
<Form.Item name={[field.name, 'usedLife']}><InputNumber min={0} /></Form.Item>
<Form.Item name={[field.name, 'status']}><Select options={[{ value: '启用' }, { value: '停用' }]} /></Form.Item>
<Form.Item name={[field.name, 'images']}><ImageUploadField /></Form.Item>
<Form.Item name={[field.name, 'remark']}><Input /></Form.Item>
```

- [ ] **Step 5: Implement the mold archive page**

Build `MoldArchivePage.tsx` with the existing `ResizableTable`, `TableActions`, `fetchModelingRecords`, `fetchModelingOptions`, create/update/delete utilities, and permission checks:

```ts
const canCreate = hasPermission('mold.model.create')
const canEdit = hasPermission('mold.model.edit')
const canDelete = hasPermission('mold.model.delete')
```

Use three-column form sections. On edit/view, set all returned rows:

```ts
form.setFieldsValue({
  ...record,
  images: Array.isArray(record.images) ? record.images : [],
  coreBoxes: Array.isArray(record.coreBoxes) ? record.coreBoxes : [],
})
```

Do not derive the form from `coreBoxes[0]`. Keep the existing `fromMoldDevelopment` behavior and initialize `coreBoxes: []`; the user can add as many rows as required.

- [ ] **Step 6: Wire the route and remove obsolete config fields**

In `apps/admin/src/App.tsx` import `MoldArchivePage` and change only the mold route:

```tsx
<Route path="mold/model" element={protectedPage('mold.model.view', <MoldArchivePage />)} />
```

Remove `hasCoreBox`, `coreBoxCode`, `coreBoxName`, `coreBoxMoldCode`, `coreBoxMaxLife`, `coreBoxUsedLife`, and `coreBoxImages` from the mold entry in `modelingConfigs.tsx`. Keep the independent `coreboxes` page fields.

- [ ] **Step 7: Add compact styles**

Add stable layouts to `apps/admin/src/index.css`:

```css
.mold-archive-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 14px; }
.mold-corebox-table { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 4px; }
.mold-corebox-row { display: grid; grid-template-columns: 150px 180px 100px 100px 90px 110px minmax(140px, 1fr) 36px; gap: 8px; min-width: 1020px; padding: 8px; border-bottom: 1px solid #f0f0f0; align-items: start; }
.mold-corebox-row .ant-form-item { margin-bottom: 0; }
@media (max-width: 900px) { .mold-archive-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 8: Run tests and build**

```bash
node --test apps/admin/tests/mold-corebox-bom-ui.test.mjs apps/admin/tests/modeling-image-fields.test.mjs
npm --prefix apps/admin run build
```

Expected: all tests pass; TypeScript and Vite build succeed.

- [ ] **Step 9: Commit the mold archive interface**

```bash
git add apps/admin/src/App.tsx apps/admin/src/utils/modeling.ts apps/admin/src/pages/modeling/MoldArchivePage.tsx apps/admin/src/pages/modeling/MoldCoreBoxEditor.tsx apps/admin/src/pages/modeling/modelingConfigs.tsx apps/admin/src/index.css apps/admin/tests/mold-corebox-bom-ui.test.mjs
git commit -m "feat: add compact multi-corebox mold archive"
```

## Task 4: Upgrade BOM API to Structured Corebox Rows

**Files:**
- Modify: `apps/api/src/casting-bom.controller.ts`
- Modify: `apps/api/scripts/test-casting-boms.mjs`

- [ ] **Step 1: Change the integration payload and add failing ratio cases**

Change the primary test payload to:

```js
coreBoxes: [{ coreBoxCode: coreBoxA, quantityPerProduct: 2 }],
```

Retain one explicit legacy update using:

```js
coreBoxCodes: [coreBoxA],
```

Assert the legacy response ratio is `1`. Add rejected requests for `0`, `-1`, duplicate codes, and a corebox outside selected molds.

- [ ] **Step 2: Run the BOM test and verify it fails on the current DTO**

```bash
npm --prefix apps/api run test:casting-boms
```

Expected: FAIL because structured rows and `quantityPerProduct` are not accepted or returned.

- [ ] **Step 3: Define the new request types and compatibility normalizer**

In `casting-bom.controller.ts`, use:

```ts
interface BomCoreBoxBody {
  coreBoxCode?: string
  quantityPerProduct?: number
}

interface BomBody {
  productCode?: string
  materialGradeCode?: string
  moldCodes?: string[]
  coreBoxes?: BomCoreBoxBody[]
  coreBoxCodes?: string[]
  netWeightKg?: number
  grossWeightKg?: number
  items?: BomItemBody[]
  remark?: string
}

function requestedCoreBoxes(body: BomBody) {
  if (Array.isArray(body.coreBoxes)) return body.coreBoxes
  return (body.coreBoxCodes || []).map((coreBoxCode) => ({ coreBoxCode, quantityPerProduct: 1 }))
}
```

- [ ] **Step 4: Validate and persist quantities**

Normalize each row to `{ coreBoxCode, quantityPerProduct }`. Reject missing codes, duplicates, non-finite values, and values `<= 0`. Build the create data by joining normalized quantities to loaded records:

```ts
coreBoxes: coreBoxRows.map((row) => {
  const coreBox = coreBoxByCode.get(row.coreBoxCode)!
  return {
    coreBoxCode: coreBox.code,
    coreBoxNameSnapshot: coreBox.name,
    moldCodeSnapshot: coreBox.moldCode,
    quantityPerProduct: row.quantityPerProduct,
  }
}),
```

- [ ] **Step 5: Return and copy the quantity everywhere**

Add `quantityPerProduct: this.decimal(item.quantityPerProduct) || 1` to:

- detail/list DTO `coreBoxes[]`;
- new-version copy mapping;
- same-product copy mapping;
- cross-product clone mapping for retained tooling;
- calculate endpoint `coreBoxes[]` summary.

Keep `coreBoxCodes` in responses as a derived compatibility array.

- [ ] **Step 6: Run API tests**

```bash
npm --prefix apps/api run build
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:mold-coreboxes
```

Expected: both integration suites pass, including legacy ratio `1` and custom ratio copying.

- [ ] **Step 7: Commit the BOM API change**

```bash
git add apps/api/src/casting-bom.controller.ts apps/api/scripts/test-casting-boms.mjs
git commit -m "feat: persist BOM corebox ratios"
```

## Task 5: Replace the BOM Corebox Multi-select with a Ratio Table

**Files:**
- Modify: `apps/admin/src/utils/castingBoms.ts`
- Modify: `apps/admin/src/pages/modeling/CastingBomManagementPage.tsx`
- Modify: `apps/admin/src/index.css`
- Modify: `apps/admin/tests/mold-corebox-bom-ui.test.mjs`

- [ ] **Step 1: Extend the failing UI test**

Add assertions:

```js
test('BOM configures a quantity for every selected corebox', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/CastingBomManagementPage.tsx'), 'utf8')
  const types = fs.readFileSync(path.join(root, 'src/utils/castingBoms.ts'), 'utf8')
  assert.match(page, /Form\.List name="coreBoxes"/)
  assert.match(page, /芯件比/)
  assert.match(page, /quantityPerProduct/)
  assert.match(types, /quantityPerProduct: number/)
})
```

- [ ] **Step 2: Run the test and verify it fails while the old multi-select remains**

```bash
node --test apps/admin/tests/mold-corebox-bom-ui.test.mjs
```

Expected: FAIL because BOM still registers `coreBoxCodes`.

- [ ] **Step 3: Update frontend types**

Use this row shape in `castingBoms.ts`:

```ts
export interface BomCoreBox {
  code: string
  name?: string
  moldCode: string
  quantityPerProduct: number
  status?: string
}
```

Set `BomRecord.coreBoxes: BomCoreBox[]` and `BomPayload.coreBoxes` to:

```ts
Array<{ coreBoxCode: string; quantityPerProduct: number }>
```

Retain `BomRecord.coreBoxCodes: string[]` only for reading old responses.

- [ ] **Step 4: Initialize and load structured rows**

Create forms with `coreBoxes: []`. On detail load, map:

```ts
coreBoxes: detail.coreBoxes.map((item) => ({
  coreBoxCode: item.code,
  quantityPerProduct: item.quantityPerProduct || 1,
})),
```

- [ ] **Step 5: Replace automatic selection logic**

When mold codes change, preserve rows whose corebox still belongs to a selected mold. Append all enabled coreboxes of newly selected molds that are not already present:

```ts
const nextRows = currentRows.filter((row) => {
  const option = coreBoxRecords.find((item) => item.code === row.coreBoxCode)
  return option && selected.has(option.moldCode)
})
for (const option of options.coreBoxes.filter((item) => newlySelected.has(item.moldCode))) {
  if (!nextRows.some((row) => row.coreBoxCode === option.code)) {
    nextRows.push({ coreBoxCode: option.code, quantityPerProduct: 1 })
  }
}
form.setFieldValue('coreBoxes', nextRows)
```

- [ ] **Step 6: Render the compact BOM corebox table**

Replace the `coreBoxCodes` multi-select with `Form.List name="coreBoxes"`. Each row must display mold name, corebox code/name, status, and:

```tsx
<Form.Item
  name={[field.name, 'quantityPerProduct']}
  rules={[{ required: true, message: '请输入芯件比' }]}
>
  <InputNumber min={0.0001} precision={4} style={{ width: '100%' }} />
</Form.Item>
```

Provide an “添加芯盒” select restricted to enabled coreboxes under selected molds and exclude codes already in the form. Hide remove controls in view mode.

- [ ] **Step 7: Add compact table styles and run frontend verification**

Add:

```css
.bom-corebox-grid { display: grid; grid-template-columns: 180px 150px minmax(180px, 1fr) 110px 90px 36px; gap: 8px; min-width: 820px; align-items: center; }
.bom-corebox-list { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 4px; }
.bom-corebox-list .ant-form-item { margin-bottom: 0; }
```

Run:

```bash
node --test apps/admin/tests/*.test.mjs
npm --prefix apps/admin run build
```

Expected: all admin tests and build pass.

- [ ] **Step 8: Commit the BOM interface**

```bash
git add apps/admin/src/utils/castingBoms.ts apps/admin/src/pages/modeling/CastingBomManagementPage.tsx apps/admin/src/index.css apps/admin/tests/mold-corebox-bom-ui.test.mjs
git commit -m "feat: configure corebox ratios in casting BOM"
```

## Task 6: Update Product Context and Test Catalog

**Files:**
- Modify: `docs/product/context-summary.md`
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`

- [ ] **Step 1: Update the relationship documentation**

Record these exact rules in both context documents:

```text
MoldMaster 1 -> N CoreBoxMaster
CastingBomVersion N -> N MoldMaster
CastingBomVersion N -> N CoreBoxMaster through CastingBomVersionCoreBox
CastingBomVersionCoreBox.quantityPerProduct = 单件产品所需该芯盒对应砂芯数量
```

Remove statements saying the mold form synchronizes one optional corebox. State that omitted persisted rows are disabled, not deleted.

- [ ] **Step 2: Add test cases MDM-051 through MDM-058**

Add cases for multi-row create, full edit/view refill, omission-to-disable, transactional conflicts, automatic BOM population, ratio persistence, ratio validation, and new-version/legacy compatibility.

- [ ] **Step 3: Check documentation consistency**

Run:

```bash
rg -n "单个芯盒|一对一|coreBoxCode|芯件比|一模多芯盒" docs/product docs/superpowers/specs/2026-08-14-mold-corebox-bom-ratio-design.md
git diff --check
```

Expected: no remaining statement describes the active design as one mold to one corebox.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/product/context-summary.md docs/product/modeling-context.md docs/product/modeling-test-cases.md
git commit -m "docs: record mold corebox BOM relationships"
```

## Task 7: Full Verification and Local Docker Rollout

**Files:**
- Verify all files changed in Tasks 1-6.

- [ ] **Step 1: Run schema and builds**

```bash
npx --prefix apps/api prisma validate --schema apps/api/prisma/schema.prisma
npm --prefix apps/api run build
npm --prefix apps/admin run build
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run focused and regression suites**

```bash
npm --prefix apps/api run test:mold-coreboxes
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:production-calculations
node --test apps/admin/tests/*.test.mjs
```

Expected: all suites pass and test data is removed.

- [ ] **Step 3: Rebuild local Docker services**

```bash
docker compose build api admin
docker compose up -d api admin
docker compose ps
```

Expected: `mingda-api-dev`, `mingda-admin-dev`, and `mingda-postgres-dev` are running; PostgreSQL is healthy.

- [ ] **Step 4: Perform browser regression**

Use Playwright CLI against `http://127.0.0.1:8080` and verify:

1. `/dashboard/mold/model`: create a test mold with three coreboxes, then open view and edit.
2. `/dashboard/mold/corebox`: all three records appear and retain their parent mold.
3. Remove one corebox in the mold editor and save; it remains visible as stopped.
4. `/dashboard/model/bom`: select the mold, verify enabled coreboxes auto-populate, set ratios `1`, `2`, and `4`, save, reopen, and verify values.
5. Confirm the browser console contains no errors and neither modal requires unnecessary vertical scrolling at a `1440x900` viewport.

- [ ] **Step 5: Check the worktree after verification**

```bash
git diff --check
git status --short
```

Expected: only intentional feature changes are present. If verification finds a defect, return to the task that owns that file, add a failing regression assertion there, apply the correction, rerun that task's tests, and use that task's explicit `git add` command. Do not stage unrelated pre-existing changes.
