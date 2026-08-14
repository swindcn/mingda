# 铸造 BOM 管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可追溯的铸造零件物理 BOM、多版本状态机、跨产品克隆和未来排产可调用的需求计算 API。

**Architecture:** 使用 `CastingBom / CastingBomVersion / CastingBomItem` 三层 Prisma relation，独立 `CastingBomController` 挂载在 `/admin/modeling/boms`。管理端新增专用 `CastingBomManagementPage`，复用现有表格、操作列、权限和大弹窗样式。

**Tech Stack:** PostgreSQL, Prisma, NestJS, React, Ant Design, TypeScript, Node.js integration tests.

---

### Task 1: Prisma 关系和失败用例

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/scripts/test-casting-boms.mjs`
- Modify: `apps/api/package.json`

- [x] 编写集成测试，覆盖新建、重量计算、非法用料、激活、新版本、自动停用旧版本、克隆和 calculate。
- [x] 运行测试，确认因 `/admin/modeling/boms/options` 不存在而失败。
- [x] 新增三个模型及 Product、MaterialGrade、User 真实 relation 和必要唯一索引。
- [x] 执行 Prisma generate、db push 和 API build。

### Task 2: BOM 后端状态机和计算服务

**Files:**
- Create: `apps/api/src/casting-bom.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`

- [x] 实现 options、列表、详情、新建、编辑和草稿删除。
- [x] 后端重新计算收得率和单件回料，校验物料类型、重复项及数值。
- [x] 实现 activate、disable、new-version 和 clone 事务。
- [x] 实现 calculate，返回铁水、回料、物理用料及 ACTIVE 配方摘要。
- [x] 接入鉴权、按钮权限和数据归属；运行集成测试至通过。

### Task 3: 权限、菜单和路由

**Files:**
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/admin/src/pages/basic/RolePermissionPage.tsx`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/src/mold-development.controller.ts`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Modify: `apps/admin/src/App.tsx`

- [x] 增加 view/create/edit/delete/clone/activate/disable/new_version 权限。
- [x] 操作权限绑定 `model.bom.view` 父列表权限。
- [x] 在工艺管理中增加铸造 BOM 菜单和受保护路由。

### Task 4: 专用管理端页面

**Files:**
- Create: `apps/admin/src/utils/castingBoms.ts`
- Create: `apps/admin/src/pages/modeling/CastingBomManagementPage.tsx`
- Modify: `apps/admin/src/index.css`

- [x] 实现状态标签、产品/材质/创建人查询和 ResizableTable。
- [x] 实现基本信息、实时重量计算、物理用料 Form.List 和配方预览。
- [x] 按状态与权限实现编辑、生效、停用、创建新版本、克隆和删除。
- [x] 保持固定操作列和超过三个操作进入更多。

### Task 5: 文档和端到端验证

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`

- [x] 记录 BOM 与物料、材质、配方和未来生产单快照关系。
- [x] API/admin 构建，执行 BOM、配方、材质回归测试。
- [x] 同步本地 Docker，验证 health、401 和浏览器关键流程。
- [x] 清理自动化测试数据并执行 `git diff --check`。
