# 生产建模模块开发记录

更新时间：2026-05-27

## 本次新增范围

以 `/Users/swindcn/Downloads/数据建模.md` 为准，新增管理端“生产建模”模块，并复用现有 `apps/admin`、`apps/api`、Prisma、PostgreSQL、角色权限和标准数据列表。

已新增管理端入口：

- `/dashboard/model/workshop-line`：车间与产线，页面内用页签维护车间、产线。
- `/dashboard/model/team`：班组配置。
- `/dashboard/model/equipment`：设备配置。
- `/dashboard/model/item`：物料主档。
- `/dashboard/model/material`：材质牌号。
- `/dashboard/model/recipe`：熔炼配方。
- `/dashboard/mold/model`：模具档案。
- `/dashboard/mold/corebox`：芯盒档案。
- `/dashboard/model/routing`：工艺路线。
- `/dashboard/model/calendar`：工厂日历。
- `/dashboard/model/shift`：班次主档，作为工厂日历和动态排班的基础资料。
- `/dashboard/model/schedule`：动态排班表。
- `/dashboard/model/defect`：缺陷代码库。

## 后端接口

新增控制器：`apps/api/src/modeling.controller.ts`

统一挂载：`/api/admin/modeling`

主要接口：

- `GET /admin/modeling/options`：返回车间、产线、班组、物料、材质、模具、班次、内部员工下拉。
- `GET /admin/modeling/:resource`：资源列表，支持 `keyword`，日历/排班支持日期范围。
- `GET /admin/modeling/:resource/:id`：详情。
- `POST /admin/modeling/:resource`：新增。
- `PUT /admin/modeling/:resource/:id`：编辑。
- `DELETE /admin/modeling/:resource/:id`：删除，存在引用时返回错误，不做假删除。
- `POST /admin/modeling/schedules/batch-generate`：动态排班一键生成，同一日期 + 车间 + 班次已存在则更新班组，不重复插入。

资源名：

- `workshops`
- `lines`
- `teams`
- `equipment`
- `items`
- `materials`
- `recipes`
- `molds`
- `coreboxes`
- `routings`
- `shifts`
- `calendars`
- `schedules`
- `defects`

## 数据模型

已在 `apps/api/prisma/schema.prisma` 新增：

- `Workshop`
- `ProductionLine`
- `Team`
- `MesItem`
- `MaterialGrade`
- `Furnace`
- `MeltRecipe`
- `MoldMaster`
- `CoreBoxMaster`
- `ProcessRouting`
- `ProcessRoutingStep`
- `ShiftMaster`
- `FactoryCalendar`
- `ShiftSchedule`
- `DefectCode`

关键关联规则：

- 产线、班组、设备、工序步骤、排班引用车间编码。
- 熔炼配方引用材质牌号编码。
- 模具档案、工艺路线引用 MES 物料编码。
- 芯盒档案引用模具编码。
- 动态排班引用车间编码、班次编码、班组编码。
- 删除被引用的车间、产线、班组、物料、材质、模具、班次时，后端阻止删除。

## 权限

已扩展 `apps/admin/src/utils/roles.ts`、`apps/api/src/basic-data.controller.ts`、`apps/api/src/mold-development.controller.ts` 的系统管理员权限。

新增权限前缀：

- `model.workshop-line`
- `model.team`
- `model.equipment`
- `model.item`
- `model.material`
- `model.recipe`
- `model.routing`
- `model.calendar`
- `model.schedule`
- `model.defect`
- `mold.model`
- `mold.corebox`

动态排班额外权限：

- `model.schedule.batch`

## 页面标准

普通主档页面使用：

- 查询按钮。
- `ResizableTable` 可拖动列宽。
- 固定右侧操作列。
- `TableActions` 操作按钮超过 3 个时进入“更多”。
- 表单下拉走 `/admin/modeling/options`。

动态排班页面：

- 月历视图。
- 支持车间切换。
- 支持单日新增、编辑、删除排班。
- 支持一键生成排班。

## 验证情况

已通过：

- `npm --prefix apps/api run prisma:generate`
- `npm --prefix apps/api run build`
- `npm run build:admin`

未完成：

- 本地未执行 `prisma db push`，原因是 `apps/api` 本地没有 `.env`，缺少 `DATABASE_URL`。部署或本地联调前需要配置 PostgreSQL 连接后执行数据库同步。
- 尚未部署测试服务器。
- 尚未做浏览器端实际点击验收。
