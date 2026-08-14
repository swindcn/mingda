# 熔炼配方停用修改与版本升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许已生效配方停用后修改，保存时依次升级主版本并回到草稿，同时把状态查询改为单行标签选择。

**Architecture:** 版本升级由后端根据数据库当前状态和版本计算，前端只显示下一版本预览，不能决定最终版本。继续复用现有配方 PUT 接口、权限守卫、ResizableTable 和 Ant Design 控件，不增加历史版本表或新配方编码。

**Tech Stack:** NestJS, Prisma, PostgreSQL, React, Ant Design, TypeScript, Node.js API integration tests.

---

### Task 1: 配方停用修改 API 回归测试

**Files:**
- Modify: `apps/api/scripts/test-recipes.mjs`

- [x] 扩展测试流程：创建 `V1.0` 草稿并生效，验证 ACTIVE 直接 PUT 失败。
- [x] 停用后 PUT 修改配方，断言返回 `status === 'DRAFT'` 且 `version === 'V2.0'`。
- [x] 对 `V2.0` 草稿再次 PUT，断言版本仍为 `V2.0`。
- [x] 再次生效、停用、PUT，断言版本为 `V3.0`。
- [x] 运行 `npm --prefix apps/api run test:recipes`，确认当前实现因 DISABLED 不可编辑而失败，错误信息为“仅草稿配方可以编辑”。

### Task 2: 后端版本升级状态机

**Files:**
- Modify: `apps/api/src/modeling.controller.ts`

- [x] 新增私有函数解析并升级 `V<主版本>.0`：

```ts
private nextRecipeVersion(version: string) {
  const matched = /^V(\d+)\.0$/.exec(version)
  if (!matched) throw new BadRequestException('配方版本格式不正确，无法自动升级')
  return `V${Number(matched[1]) + 1}.0`
}
```

- [x] 调整 `updateRecipe`：ACTIVE 继续拒绝；DRAFT 保存时保留数据库版本；DISABLED 保存时忽略请求版本，升级数据库版本并把状态改为 DRAFT。
- [x] 保持嵌套关系更新逻辑不变，版本、状态和配方明细在同一次 Prisma update 中提交。
- [x] 运行 `npm --prefix apps/api run build && npm --prefix apps/api run test:recipes`，确认升级链 `V1.0 -> V2.0 -> V3.0` 通过。

### Task 3: 管理端编辑入口与状态标签

**Files:**
- Modify: `apps/admin/src/pages/modeling/RecipeManagementPage.tsx`
- Modify: `apps/admin/src/index.css`

- [x] 已停用记录在拥有 `model.recipe.edit` 权限时显示“编辑”；已生效记录仍不显示编辑。
- [x] 打开已停用配方编辑时，将表单版本显示为下一主版本预览；版本输入框只读，最终值以后端响应为准。
- [x] 编辑停用配方保存后刷新列表，状态显示草稿、版本显示升级后的值。
- [x] 删除状态下拉框，改为 `全部 / 草稿 / 已生效 / 已停用` 标签按钮，点击后更新查询状态并立即刷新列表。
- [x] 查询区使用 `240px 180px 180px auto` 的单行布局；小屏允许换行。未修改 ResizableTable 的默认列宽。
- [x] 运行 `npm --prefix apps/admin run build`，确认 TypeScript 和 Vite 构建通过。

### Task 4: 本地 Docker 与浏览器验证

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`

- [x] 在建模上下文中记录停用修改、版本递增和“生产工单应保存配方版本/快照”的约束。
- [x] 在测试用例中增加 ACTIVE 禁止编辑、DISABLED 保存升级、草稿重复保存不升级、连续升级到 V3.0。
- [x] 构建 API/admin，并把 dist 同步到本地 `mingda-api-dev`、`mingda-admin-dev` 容器后重启。
- [x] 执行 `test:recipes`、`test:material-grades`、API health 和未登录 401 验证。
- [x] 浏览器验证状态标签单行排布、已停用编辑入口、版本预览、保存后的版本与状态。
- [x] 运行 `git diff --check`，确认无空白错误，未提交或推送其他工作区改动。
