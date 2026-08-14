# Melt Duration And Equipment Occupancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为熔炼配方增加标准时长，并在合炉排产中形成可调整、可冲突确认、可按车间查看的设备占用时间区间。

**Architecture:** 配方保存标准分钟数，炉次下达时保存车间、时长和时间区间快照。后端统一计算自动完成时间并在串行化事务中检查设备区间冲突；管理端只负责联动展示和二次确认。设备概览通过单次设备查询和单次炉次查询生成卡片及 24 小时时间线。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React、Ant Design、Day.js、Node 接口测试脚本。

---

### Task 1: 时间计算与数据库字段

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260813160000_melt_duration_equipment_occupancy/migration.sql`
- Modify: `apps/api/src/production/production.calculations.ts`
- Modify: `apps/api/scripts/test-production-calculations.mjs`

- [ ] 先增加失败测试，覆盖分钟合计、自动完成时间、左闭右开重叠、相邻不冲突、日期窗口裁切。
- [ ] 运行 `npm --prefix apps/api run test:production-calculations`，确认新断言因函数缺失而失败。
- [ ] 实现纯计算函数，并在 Prisma 中增加配方时长、炉次车间与占用快照字段及索引。
- [ ] 执行 `npm --prefix apps/api run prisma:generate` 和计算测试，确认通过。

### Task 2: 配方时长维护

**Files:**
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/api/scripts/test-recipes.mjs`
- Modify: `apps/admin/src/utils/recipes.ts`
- Modify: `apps/admin/src/pages/modeling/RecipeManagementPage.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] 增加配方接口失败测试：非整数、负数、总时长为零拒绝；新建、克隆、新版本保留时长。
- [ ] 后端输入校验、DTO、克隆和版本升级统一读写三个时长。
- [ ] 配方基本信息区增加同一行三个分钟输入及总占用时长，只允许非负整数。
- [ ] 运行配方接口测试和管理端构建。

### Task 3: 车间联动、炉次时间与冲突确认

**Files:**
- Modify: `apps/api/src/production/production.types.ts`
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/api/src/production/melt-scheduling.controller.ts`
- Modify: `apps/api/scripts/test-production-execution.mjs`
- Modify: `apps/admin/src/utils/production.ts`
- Modify: `apps/admin/src/pages/production/MeltSchedulingPage.tsx`
- Modify: `apps/admin/src/pages/production/HeatOrderListPage.tsx`
- Modify: `apps/admin/src/pages/production/HeatOrderDetailPage.tsx`

- [ ] 增加接口失败测试：零时长不可排产、错误车间/设备/班组关系拒绝、自动完成时间、人工调整、冲突检查、首次 409、确认后创建及记录。
- [ ] 排产选项返回可用熔炼车间和配方时长；新增无副作用冲突检查接口。
- [ ] 创建炉次保存真实车间和配方时长快照，事务内重查冲突，并保持 `plannedOutputAt` 兼容。
- [ ] 管理端按车间、设备、配方、班组联动，自动计算完成时间；冲突时展示清单并二次确认。
- [ ] 炉次列表与详情展示计划区间、时长快照和调整标识。
- [ ] 运行生产接口测试、API 与管理端构建。

### Task 4: 设备排程概览

**Files:**
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/api/src/production/melt-scheduling.controller.ts`
- Modify: `apps/api/scripts/test-production-execution.mjs`
- Create: `apps/admin/src/pages/production/EquipmentScheduleOverview.tsx`
- Modify: `apps/admin/src/pages/production/MeltSchedulingPage.tsx`
- Modify: `apps/admin/src/utils/production.ts`
- Modify: `apps/admin/src/index.css`

- [ ] 增加接口测试：空闲设备、跨日裁切、取消炉次排除、已完成展示、重叠警告和稳定排序。
- [ ] 实现 `GET /admin/production/equipment-schedule`，一次查询设备、一次查询炉次并按设备分组。
- [ ] 页面底部增加独立车间/日期筛选和手动查询，渲染响应式设备卡片与可横向滚动的 24 小时时间线。
- [ ] 快速查询使用请求序号防止旧响应覆盖，不改变上方排产表单。
- [ ] 运行接口测试、前端构建和定向 ESLint。

### Task 5: 迁移与浏览器验收

**Files:**
- Modify: `docs/product/production-execution-context.md`
- Modify: `docs/product/production-execution-test-cases.md`

- [ ] 使用临时 PostgreSQL schema 验证 migration 和接口测试。
- [ ] 将变更合并进本地 Docker 环境并重新构建 API、Admin 容器。
- [ ] 在浏览器验证配方时长、车间联动、自动完成、冲突提示和设备概览。
- [ ] 更新生产执行上下文及测试用例，记录历史零时长配方需要维护后才能排产。
- [ ] 检查 git diff，确保没有覆盖用户已有改动。
