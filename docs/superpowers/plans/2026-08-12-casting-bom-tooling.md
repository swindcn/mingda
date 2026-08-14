# 铸造 BOM 工装关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为铸造 BOM 版本增加生产模具与芯盒工装关联，同时保持砂芯作为物理消耗物料维护单耗。

**Architecture:** 在现有 `CastingBomVersion` 下新增模具、芯盒两个真实关系表；BOM API 负责档案有效性、芯盒从属、状态和删除约束。管理端新增两个多选字段，模具从全部启用档案中选择并自动带出绑定芯盒，新版本完整复制，跨产品克隆仅保留目标产品匹配工装。

**Tech Stack:** PostgreSQL 16、Prisma 6、NestJS 11、React 19、Ant Design 6、TypeScript、Node.js integration tests。

---

### Task 1: 先增加失败的工装关联接口测试

**Files:**
- Modify: `apps/api/scripts/test-casting-boms.mjs`

- [x] 在测试数据中创建与 `productA` 关联的启用模具、该模具下的启用芯盒、与 `productB` 关联的另一套模具，以及一个停用模具。
- [x] 扩展 `options` 断言：返回启用模具和启用芯盒，停用模具不返回。
- [x] 新建 V1.0 时提交 `moldCodes`、`coreBoxCodes`，断言详情返回名称和从属模具。
- [x] 提交不匹配产品的模具、未选择所属模具的芯盒，断言 API 返回失败。
- [x] 运行 `npm --prefix apps/api run test:casting-boms`，预期因 `options.molds` 或详情 `molds` 不存在而失败。

### Task 2: 增加 Prisma 工装关系

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [x] 在 `CastingBomVersion` 增加 `molds`、`coreBoxes` relation。
- [x] 在 `MoldMaster`、`CoreBoxMaster` 增加反向 BOM relation。
- [x] 新增 `CastingBomVersionMold`：联合主键 `bomVersionId + moldCode`，保存 `moldNameSnapshot`。
- [x] 新增 `CastingBomVersionCoreBox`：联合主键 `bomVersionId + coreBoxCode`，保存 `coreBoxNameSnapshot`、`moldCodeSnapshot`。
- [x] 执行：

```bash
DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npm --prefix apps/api run prisma:generate
cd apps/api && DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' npx prisma db push
npm --prefix apps/api run build
```

预期 Prisma generate、db push、API build 全部退出码为 0。

### Task 3: 实现 BOM 工装校验和持久化

**Files:**
- Modify: `apps/api/src/casting-bom.controller.ts`

- [x] 扩展请求体：

```ts
interface BomBody {
  productCode?: string
  materialGradeCode?: string
  moldCodes?: string[]
  coreBoxCodes?: string[]
  netWeightKg?: number
  grossWeightKg?: number
  items?: BomItemBody[]
  remark?: string
}
```

- [x] `options` 返回：

```ts
molds: Array<{ code: string; name: string; itemCode: string }>
coreBoxes: Array<{ code: string; name: string; moldCode: string }>
```

只返回状态为“启用”的记录。

- [x] `normalize` 去重编码并验证：模具存在且启用；芯盒存在、启用且 `moldCode` 在所选模具集合内。模具档案关联物料不作为 BOM 保存限制。
- [x] `include` 和 `dto` 返回：

```ts
moldCodes: string[]
coreBoxCodes: string[]
molds: Array<{ code: string; name: string }>
coreBoxes: Array<{ code: string; name: string; moldCode: string }>
```

- [x] 首版创建、草稿编辑在原事务中写入或替换两个关系表；关系和数据归属保持原子提交。
- [x] 运行 BOM 测试，预期新增、详情、非法关系用例通过。

### Task 4: 完成版本复制、克隆和计算服务

**Files:**
- Modify: `apps/api/src/casting-bom.controller.ts`
- Modify: `apps/api/scripts/test-casting-boms.mjs`

- [x] 同产品 `new-version` 复制全部模具与芯盒关系。
- [x] 跨产品 `clone` 只复制 `itemCode === targetProductCode` 的模具，以及这些模具下的芯盒；无匹配关系时返回空数组。
- [x] `calculate` 返回当前版本 `molds`、`coreBoxes` 摘要，不把工装计入物理领料数量。
- [x] 测试断言同产品 V2.0 保留工装关系，跨产品克隆不错误沿用来源产品工装。
- [x] 运行 `npm --prefix apps/api run test:casting-boms`，预期 V1.0-V4.0、工装复制、克隆过滤和用量计算全部通过。

### Task 5: 增加模具和芯盒删除约束

**Files:**
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/api/scripts/test-casting-boms.mjs`

- [x] `assertCanDelete('molds')` 增加 `castingBomVersionMold.count({ where: { moldCode: id } })`。
- [x] `assertCanDelete('coreboxes')` 增加 `castingBomVersionCoreBox.count({ where: { coreBoxCode: id } })`。
- [x] 在接口测试中尝试删除被 BOM 引用的模具、芯盒，断言返回“当前数据已被其他资料引用，不能删除”。
- [x] 清理顺序固定为：BOM 关系与版本、芯盒、模具、临时产品，确保测试执行后无残留。

### Task 6: 管理端增加联动多选

**Files:**
- Modify: `apps/admin/src/utils/castingBoms.ts`
- Modify: `apps/admin/src/pages/modeling/CastingBomManagementPage.tsx`
- Modify: `apps/admin/src/index.css`

- [x] 扩展前端类型：

```ts
interface BomPayload {
  productCode: string
  materialGradeCode: string
  moldCodes: string[]
  coreBoxCodes: string[]
  netWeightKg: number
  grossWeightKg: number
  items: BomItem[]
  remark?: string
}
```

- [x] `BomOptions` 增加模具和芯盒选项，`BomRecord` 增加详情摘要。
- [x] 在“产品基本信息与重量参数”和“零件物理用料明细”之间增加“生产工装”区块。
- [x] 生产模具使用多选 Select，展示全部启用模具档案及关联物料；芯盒使用多选 Select，只展示已选模具下芯盒。
- [x] 产品变化时清除原工装选择；新增选择模具时自动带入其绑定的启用芯盒，移除模具时清除不再从属的芯盒，芯盒可手动调整。
- [x] 查看态显示已保存工装名称；编辑态正确回填编码。
- [x] 保持砂芯在物理用料区，不在芯盒选项中重复表达。
- [x] 执行：

```bash
npm run build:admin
cd apps/admin && npx eslint src/pages/modeling/CastingBomManagementPage.tsx
```

预期构建与单文件 lint 均通过。

### Task 7: 文档、Docker 和端到端验收

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`
- Modify: `docs/superpowers/plans/2026-08-12-casting-bom-tooling.md`

- [x] 记录工装与物理消耗物料的边界、版本复制、跨产品克隆过滤和删除约束。
- [x] 更新本地 Docker API、Prisma schema、管理端静态资源。
- [x] 运行：

```bash
npm run build:api
npm run build:admin
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:recipes
npm --prefix apps/api run test:material-grades
npm run test:permissions
git diff --check
```

- [x] 未登录请求 `/api/admin/modeling/boms` 返回 401；测试产品、BOM、模具、芯盒和归属数据残留均为 0。
- [x] Playwright 验证 `/dashboard/model/bom`：选择产品后模具正确过滤，选择模具后芯盒正确过滤，工装区布局无重叠。
- [x] 将本计划全部复选框更新为完成。
