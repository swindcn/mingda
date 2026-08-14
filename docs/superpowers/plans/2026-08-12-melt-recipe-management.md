# 熔炼配方管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有简易熔炼配方 CRUD 升级为关联材质牌号、熔炼设备、目标成分和原材料配比的真实配方管理功能。

**Architecture:** 保留 `/dashboard/model/recipe` 菜单和路由，新建专用 `RecipeManagementPage`，复用项目现有表格、操作列、弹窗和权限组件。后端继续挂载在 `ModelingController`，但为配方提供专用查询、选项、克隆、生效和停用接口，Prisma 使用主表与三个关系明细表事务保存。

**Tech Stack:** React, Ant Design, NestJS, Prisma, PostgreSQL, TypeScript.

---

### Task 1: 配方 Prisma 关系与 API 回归测试

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/scripts/test-recipes.mjs`
- Modify: `apps/api/package.json`

- [x] 写 API 集成测试：管理员登录，读取配方选项，新建草稿，保存目标成分与配料，生效校验，克隆，停用，删除状态限制，并在清理阶段反向删除测试数据。
- [x] 运行 `npm --prefix apps/api run test:recipes`，确认因专用接口不存在而失败。
- [x] 扩展 `MeltRecipe`：基准重量、来源配方、创建人、状态；新增 `RecipeApplicableFurnace` 和 `RecipeTargetElement`，扩展 `MeltRecipeItem.materialCategory`。
- [x] 运行 `npm --prefix apps/api run prisma:generate && npm --prefix apps/api run build`。

### Task 2: 配方专用后端接口与状态机

**Files:**
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`

- [x] 新增配方查询参数 `materialGradeCode / furnaceCode / status / keyword`，DTO 返回材质、炉型、创建人、目标成分和物料明细。
- [x] 新增 `recipe-options`，仅返回启用材质、熔炼车间启用设备，以及一级类型为“原材料”的物料。
- [x] 创建/编辑草稿使用嵌套关系写入；创建人从鉴权上下文获取。
- [x] 新增 activate/clone/disable 接口；克隆使用 `REC-YYYYMMDD-NNN` 编码并复制全部关系。
- [x] 生效时校验元素、配料、原材料与回炉料比例合计 100%、数值和重复项；非草稿拒绝编辑/删除。
- [x] 权限守卫映射 clone/activate/disable 业务动作。
- [x] 同步本地 schema，运行 `test:recipes` 直到通过。

### Task 3: 权限树与设备字段收敛

**Files:**
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/admin/src/pages/basic/RolePermissionPage.tsx`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/src/mold-development.controller.ts`
- Modify: `apps/admin/src/pages/modeling/modelingConfigs.tsx`

- [x] 增加 `model.recipe.clone / activate / disable` 到管理员默认权限和角色权限树。
- [x] 为新增业务操作补充“数据列表”父权限依赖。
- [x] 从设备页面移除允许材质字段，但保留数据库历史字段。
- [x] API/admin 构建验证权限 key 一致。

### Task 4: 专用配方页面

**Files:**
- Create: `apps/admin/src/pages/modeling/RecipeManagementPage.tsx`
- Create: `apps/admin/src/utils/recipes.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/index.css`

- [x] 封装配方列表、详情、保存、克隆、生效、停用、删除和选项 API。
- [x] 实现查询条件和 ResizableTable；操作按状态与权限计算并交给 TableActions。
- [x] 实现与材质牌号一致的大弹窗，分基本信息、目标化学成分、标准配料三个区块。
- [x] 选择材质自动带入成分；已有内容时确认覆盖。
- [x] 配料只选择后端返回的原材料物料，按分类实现比例与用量计算。
- [x] 保存草稿和提交生效使用真实接口；查看/生效/停用状态只读。
- [x] 切换 `/dashboard/model/recipe` 到专用页面。

### Task 5: 构建、接口和页面验证

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`

- [x] 记录配方与材质、设备、物料和未来炉批的关系及状态规则。
- [x] 运行 `npm --prefix apps/api run prisma:generate`、API build、`test:recipes`、`test:material-grades` 和 admin build。
- [x] 同步本地 Docker API/admin，检查 health 和配方接口。
- [x] 使用浏览器验证列表、查询、新建、自动带入、计算、克隆和状态按钮。
- [x] 运行 `git diff --check` 并审查本次相关 diff。
