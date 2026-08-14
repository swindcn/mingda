# 材质牌号管理模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将材质牌号从简单元素 JSON 配置升级为可被物料、熔炼配方及后续炉批/化验追溯引用的质量标准主数据。

**Architecture:** 继续复用 `apps/api` 的 ModelingController 和 PostgreSQL/Prisma；MaterialGrade 保留既有编码主键，并新增独立的化学成分、力学性能、工艺要求、标准版本关系。管理端仍使用统一 ModelingMasterPage，通过结构化 JSON 编辑兼容现有页面，同时后端将明细拆分持久化并在 DTO 中回传。

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, Ant Design, TypeScript.

---

### Task 1: 建立材质牌号关系模型

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/scripts/test-material-grades.mjs`

- [x] 新增 `MaterialGradeElement`、`MaterialGradeProperty`、`MaterialGradeProcessRule`、`MaterialGradeStandardVersion`，分别通过 `materialGradeCode` 关联 `MaterialGrade`，删除牌号时级联删除明细，配方/设备引用继续 Restrict。
- [x] 为 `MaterialGrade` 增加 `category`、`materialType`、`standardVersion`，保留 `elementLimits` 作为兼容字段；后端写入时同步更新独立元素关系。
- [x] 写 API 集成测试，覆盖新增带明细、详情回传明细、配方引用、被引用牌号禁止删除。

### Task 2: 完善后端材质牌号接口

**Files:**
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`

- [x] `materials` 新增/编辑接受 `category`、`materialType`、`standardVersion`、`elements`、`properties`、`processRules`、`standardVersions`。
- [x] 用 Prisma transaction 保存主表和全部明细，编辑时只替换当前标准维护明细，不改变历史版本记录。
- [x] 列表和详情 DTO 返回结构化明细，并保留 `elementLimits` 兼容旧数据。
- [x] 校验同一牌号同一元素/指标/参数/版本不重复；编码继续采用项目通用非中文/无空白规则。

### Task 3: 管理端表单和列表关联

**Files:**
- Modify: `apps/admin/src/pages/modeling/modelingConfigs.tsx`
- Modify: `apps/admin/src/pages/modeling/ModelingMasterPage.tsx`

- [x] 材质牌号基础字段增加材料类别、材料类型、执行标准、标准版本、状态。
- [x] 将元素红线、力学性能、工艺要求、历史标准版本以结构化 JSON 明细录入并在查看时回显。
- [x] 保持熔炼配方目标材质、设备允许材质使用材质牌号真实编码。
- [x] 避免把未来炉批/化验字段混入当前主档，接口保留明细字段供后续模块引用。

### Task 4: 关联约束与回归验证

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`

- [x] 记录 Product/BOM -> MaterialGrade -> MeltRecipe -> HeatBatch -> QualityResult 的规划关系及当前已实现边界。
- [x] 运行 Prisma generate、API/admin build 和材质牌号集成测试。
- [x] 使用本地 PostgreSQL 验证新增、详情、配方关联和删除阻断；测试数据自动清理。

### Task 5: 字典驱动的标准明细录入

**Files:**
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/admin/src/utils/dictionaries.ts`
- Modify: `apps/admin/src/pages/basic/DictionarySettingsPage.tsx`
- Modify: `apps/admin/src/pages/modeling/ModelingMasterPage.tsx`
- Modify: `apps/admin/src/pages/modeling/modelingConfigs.tsx`
- Test: `apps/api/scripts/test-material-grades.mjs`

- [x] 字典新增材料类型、化学成分、力学性能、工艺要求四类配置；指标字典保存名称、单位、检测方法或值类型。
- [x] 材质牌号录入不再使用 JSON 文本，改为从字典选择指标，并按固定值或范围填写。
- [x] 独立明细表增加 `valueMode` 与 `fixedValue`，范围使用 `minValue/maxValue`，保留既有明细关系和历史兼容字段。
- [x] 集成测试验证默认字典、球铁类型、固定值和范围值均可保存并回传。
