# Heat Transfer Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成熔炼排产 75%/25% 自适应布局、实际熔炉防错选择、多次转运出炉、最终报工和工单联动，并同步管理端与微信小程序。

**Architecture:** 保留 `HeatOrder.furnaceCode` 作为计划熔炉，新增实际熔炉关系和独立的 `HeatOrderTransfer` 追溯表。后端统一计算可执行动作、转运累计和工单完成量，管理端与小程序只消费接口返回的权限和状态，不自行推断业务规则。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React、Ant Design、微信原生小程序、Node.js 集成测试。

---

### Task 1: 锁定熔炼执行业务契约

**Files:**
- Modify: `apps/api/scripts/test-production-execution.mjs`
- Modify: `apps/miniprogram/tests/heat-pages.test.cjs`

- [ ] 扩展接口测试，覆盖实际熔炉选择、更换确认、首次/多次转运、完成默认重量、工单联动字段。
- [ ] 扩展小程序静态测试，要求展示计划开始时间，并具备熔炉选择、扫码、转运和完成入口。
- [ ] 运行测试并确认因缺少新接口和状态而失败：`npm --prefix apps/api run test:production-execution`、`npm --prefix apps/miniprogram test`。

### Task 2: 扩展 Prisma 持久化模型

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260814090000_heat_transfer_execution/migration.sql`

- [ ] 为设备增加 `equipmentType`，默认并回填为“熔炼炉”。
- [ ] 为炉次增加 `TRANSFERRING` 状态、实际熔炉关系、转运关系和 `TRANSFERRED` 记录动作。
- [ ] 新建 `HeatOrderTransfer`，保存包设备、重量、来源、操作人、时间和备注。
- [ ] 运行 `npm --prefix apps/api run prisma:generate` 并校验 schema。

### Task 3: 实现后端熔炉防错和转运状态机

**Files:**
- Modify: `apps/api/src/production/production.types.ts`
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/api/src/production/heat-execution.controller.ts`
- Modify: `apps/api/src/production/production-permission.guard.ts`

- [ ] 新增执行选项接口，返回同车间、启用、满足配方和容量条件且未被占用的熔炼炉，以及启用的浇注包/球化包。
- [ ] 开始生产接收实际熔炉；更换计划熔炉时必须带二次确认标志，并保留计划熔炉快照。
- [ ] 新增可重复调用的转运接口；首次转运把炉次改为 `TRANSFERRING`，后续转运累加重量并保留明细。
- [ ] 完成接口只接受 `TRANSFERRING`，未填写实际重量时采用转运累计重量，并允许覆盖。
- [ ] DTO 返回实际熔炉、转运明细/累计、动作权限和操作人时间。

### Task 4: 联动生产工单与权限体系

**Files:**
- Modify: `apps/api/src/production/production.service.ts`
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/src/mold-development.controller.ts`

- [ ] 新增 `production.heat.transfer` 与 `mini.production.heat.transfer` 权限，并纳入管理员默认权限。
- [ ] 工单关联炉次返回计划/实际熔炉、状态、转运累计、最终重量和关键操作人时间。
- [ ] 保留完成件数按已完成炉次分配件数统计，新增 `meltCompletedWeightKg` 按最终分配重量统计。
- [ ] 运行生产执行集成测试直至通过。

### Task 5: 完善设备类型和业务筛选

**Files:**
- Modify: `apps/admin/src/utils/dictionaries.ts`
- Modify: `apps/admin/src/pages/basic/DictionarySettingsPage.tsx`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/admin/src/pages/modeling/modelingConfigs.tsx`
- Modify: `apps/api/src/modeling.controller.ts`

- [ ] 新增设备类型字典，默认包含熔炼炉、浇注包、球化包、其他设备。
- [ ] 设备表单改为字典下拉；容量与单位保持可选。
- [ ] 配方适用设备只返回熔炼炉，转运设备只返回浇注包和球化包。
- [ ] 构建 API 与管理端验证类型一致。

### Task 6: 更新管理端排产和熔炼执行

**Files:**
- Modify: `apps/admin/src/index.css`
- Modify: `apps/admin/src/pages/production/MeltSchedulingPage.tsx`
- Modify: `apps/admin/src/utils/production.ts`
- Modify: `apps/admin/src/pages/production/HeatOrderListPage.tsx`
- Modify: `apps/admin/src/pages/production/HeatOrderDetailPage.tsx`
- Create: `apps/admin/src/pages/production/HeatExecutionActions.tsx`

- [ ] 排产主体按内容区使用 `minmax(0, 3fr) minmax(400px, 1fr)`，收窄待排字段并将计算器表单排为两列；窄屏自动单列。
- [ ] 管理端开始生产弹窗选择实际熔炉；选择非计划炉时二次确认。
- [ ] 转运弹窗选择包设备、填写重量和备注，支持连续追加。
- [ ] 完成弹窗默认显示转运累计重量并允许修改。
- [ ] 详情和列表展示 `TRANSFERRING`、实际熔炉与转运记录。

### Task 7: 更新微信小程序熔炼执行

**Files:**
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/types/business.ts`
- Modify: `apps/miniprogram/src/services/api.ts`
- Modify: `apps/miniprogram/src/pages/heat/list/index.ts`
- Modify: `apps/miniprogram/src/pages/heat/list/index.wxml`
- Modify: `apps/miniprogram/src/pages/heat/detail/index.ts`
- Modify: `apps/miniprogram/src/pages/heat/detail/index.wxml`
- Modify: `apps/miniprogram/src/pages/heat/complete/index.ts`
- Create: `apps/miniprogram/src/pages/heat/start/index.{ts,json,wxml,wxss}`
- Create: `apps/miniprogram/src/pages/heat/transfer/index.{ts,json,wxml,wxss}`

- [ ] 列表与详情把“计划出炉”改为“计划开始”。
- [ ] 开始页面支持下拉选择或扫码炉号，并在更换熔炉时二次确认。
- [ ] 转运页面支持下拉选择或扫码包号，必填重量并可重复提交。
- [ ] 完成页面默认带入转运累计重量，详情按钮由后端 `can*` 字段控制。
- [ ] 运行 `npm --prefix apps/miniprogram run build`，确保 `dist` 与源码同步。

### Task 8: 全链路验证

**Files:**
- Modify: `docs/product/production-execution-context.md`
- Modify: `docs/product/production-execution-test-cases.md`

- [ ] 运行 `npm --prefix apps/api run build`、`npm run build:admin`、小程序测试与构建。
- [ ] 在本机 Docker 应用迁移并重启服务。
- [ ] 使用管理端验证 75%/25% 布局、换炉确认、多次转运和最终报工。
- [ ] 使用测试账号验证管理端/小程序权限与工单联动，并记录验证结果。
