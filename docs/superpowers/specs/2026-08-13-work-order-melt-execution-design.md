# 生产工单与熔炼合炉排产执行设计

更新时间：2026-08-13

## 1. 目标与范围

本模块将现有静态生产建模数据转化为可执行的生产任务，建立以下闭环：

```text
生产工单提交
  -> 按 BOM 计算件数、净重和铁水需求
  -> 同材质工单进入待合炉排产池
  -> 按整数件数拆分并组合成熔炼任务单
  -> 人工选择设备、配方和执行班组
  -> 管理端监控、小程序执行
  -> 回写工单排产与熔炼状态
```

一期包含：

- 生产工单创建、查询、编辑、查看和强制关闭。
- 锁定已生效 BOM 与已生效工艺路线版本。
- 根据 BOM 自动计算重量需求。
- 待合炉排产池、同材质合炉和按整数件数拆单。
- 熔炼任务生成、撤销、开始生产和完成生产。
- 管理端排产与监控页面。
- 小程序熔炼任务列表、详情、开始和完成操作。
- 权限、数据范围、班组任务访问权和操作记录。

一期不包含：

- 工单草稿。
- APS 自动有限产能排程。
- 工厂日历自动匹配班组。
- 光谱仪自动采集。
- 熔炼中间阶段明细记录。
- 完整工艺路线逐节点报工、返工和异常结炉。
- 生产中或已完成炉次的报废、重开和撤销。

## 2. 已确认业务规则

### 2.1 工单提交和编辑

- 不提供草稿功能。
- 新建工单只有“提交排产”，提交成功后立即进入待合炉排产池。
- 尚未产生任何有效炉次分配时，允许修改计划件数、BOM 和工艺路线，并重新计算需求。
- 已部分或全部排产后，锁定产品、BOM、材质、计划件数和重量等关键字段。
- 若关联炉次尚未开始，可先撤销炉次，使分配数量返回排产池；当工单不再存在有效分配后，才允许修改。

### 2.2 合炉与拆单

- 不同材质牌号禁止合炉。
- 调度按整数件数分配，不直接输入任意铁水重量。
- 系统使用工单锁定的单件浇注毛重计算本炉计划铁水重量。
- 排产池同时显示剩余件数和剩余铁水重量。
- 容量不足时，系统计算不超过容量的最大建议件数，调度员可继续减少。
- 一张工单可以拆分到多个炉次，一个炉次可以合并多张同材质工单。

### 2.3 炉次执行与撤销

- 生成熔炼任务单后直接进入“待生产”。
- 只有待生产炉次可以撤销，撤销必须填写原因。
- 撤销后自动释放分配件数和铁水重量，并重新计算工单状态。
- 生产中和已完成炉次不允许撤销。
- 完成生产必须填写大于零的实际出炉重量。
- 实际重量与目标重量的偏差只记录和展示，一期不做超差拦截。

### 2.4 工单完成判定

- 炉次完成只代表熔炼完成，不代表生产工单最终完工。
- 工单所有计划件数均已排产，且对应有效炉次全部完成后，工单进入“熔炼完成”。
- 最终“已完工”预留给后续工艺路线末节点报工完成时触发。
- 强制关闭前必须撤销全部待生产炉次。
- 存在生产中炉次时禁止强制关闭。

## 3. 现有功能关联

### 3.1 主数据来源

生产工单复用现有真实数据：

- `Product`：成品或半成品物料。
- `CastingBomVersion`：已生效 BOM，提供材质、净重、浇注毛重、收得率和回料重量。
- `ProcessRoutingVersion`：适用于产品的已生效工艺路线；默认路线优先自动选择。
- `MaterialGrade`：合炉隔离维度。
- `MeltRecipe`：已生效熔炼配方。
- `RecipeApplicableFurnace`：配方与适用设备关系。
- `Furnace`：熔炼设备、设备能力和所属车间。
- `Team`、`TeamMember`：人工选择执行班组及小程序任务人员范围。
- `BusinessDataOwnership`：工单和炉次的角色数据范围。

### 3.2 版本锁定

工单必须保存具体 `bomVersionId` 和 `routingVersionId`。BOM 或工艺路线后续停用、升版，不改变历史工单。

工单同时保存以下快照，保证列表、详情和计算结果不受主数据名称修改影响：

- 产品编码和名称。
- 材质编码和名称。
- BOM 编码和版本。
- 工艺路线编码、名称和版本。
- 单件净重、单件浇注毛重、收得率和单件回料重量。

后续工序执行根据工单锁定的路线版本生成运行实例。一期不提前创建全部工序实例。

## 4. 数据模型

### 4.1 `WorkOrder`

建议字段：

```text
id, code, source, externalNo
productCode, productCodeSnapshot, productNameSnapshot
bomVersionId, bomCodeSnapshot, bomVersionSnapshot
routingVersionId, routingCodeSnapshot, routingNameSnapshot, routingVersionSnapshot
materialGradeCode, materialGradeNameSnapshot
plannedQuantity, plannedStartDate, plannedDeliveryDate, priority
unitNetWeightKg, unitGrossWeightKg, yieldRate, unitReturnWeightKg
totalNetWeightKg, totalMeltWeightKg, expectedReturnWeightKg
scheduleStatus, productionStatus
completedQuantity, meltCompletedAt, completedAt, closedAt, closeReason
versionNo
createdByUserId, createdAt, updatedAt
```

约束：

- `code` 唯一。
- `plannedQuantity` 为正整数。
- `plannedDeliveryDate` 必填，`plannedStartDate` 可选。
- 产品、BOM、路线和材质使用真实外键。
- `versionNo` 用于状态和编辑操作的乐观锁。

### 4.2 `HeatOrder`

建议字段：

```text
id, code
materialGradeCode, materialGradeNameSnapshot
furnaceCode, furnaceNameSnapshot, furnaceCapacityKgSnapshot
recipeCode, recipeNameSnapshot, recipeVersionSnapshot
teamCode, teamNameSnapshot, shiftCode
plannedOutputAt, targetWeightKg, actualOutputWeightKg
status, versionNo
startedByUserId, startedAt
completedByUserId, completedAt
canceledByUserId, canceledAt, cancelReason
createdByUserId, createdAt, updatedAt
```

`teamCode` 一期由调度员人工选择。`shiftCode` 保留为空或人工选择，为未来工厂日历自动推荐班组预留。

### 4.3 `HeatOrderAllocation`

该表是工单与炉次之间的唯一业务关联：

```text
id, heatOrderId, workOrderId
allocatedQuantity
plannedWeightKg
actualWeightKg
createdAt, updatedAt
```

约束：

- 同一炉次和工单只保留一条分配记录。
- `allocatedQuantity` 为正整数。
- `plannedWeightKg = allocatedQuantity * WorkOrder.unitGrossWeightKg`，由后端计算。
- 炉次完成时，按照每条分配的计划重量占比计算 `actualWeightKg`。

### 4.4 `HeatOrderRecord`

保存炉次业务操作审计：

```text
id, heatOrderId, action
fromStatus, toStatus
operatorUserId, operatorNameSnapshot
remark, payload
createdAt
```

操作至少包括：创建下发、开始生产、完成生产、撤销。

### 4.5 `DocumentSequence`

使用数据库序列表生成工单号和炉次号，避免并发读取最大编号造成重复：

```text
documentType, businessDate, currentValue, updatedAt
```

编号格式：

- 工单：`WOYYYYMMDDNNN`。
- 炉次：`HEAT-YYYYMMDD-NN`。

## 5. 排产池设计

排产池不单独建业务表。每张工单的有效排产数量由未撤销炉次分配聚合得到：

```text
已排产件数 = SUM(未撤销炉次分配件数)
剩余件数 = 计划件数 - 已排产件数
剩余铁水重量 = 剩余件数 * 单件浇注毛重
```

这样可以保证撤销炉次后数量自然返回排产池，不产生两套来源不一致的问题。

为提高列表性能，`WorkOrder` 可以保存已排产数量缓存，但缓存只能在同一事务中由分配明细重算，不能由前端直接修改。

## 6. 状态机

### 6.1 工单排产状态

```text
PENDING  待排产
PARTIAL  部分排产
FULL     已全部排产
```

### 6.2 工单生产状态

```text
RELEASED        已下达
IN_PRODUCTION   生产中
MELT_COMPLETED  熔炼完成
COMPLETED       已完工
CLOSED          已关闭
```

页面组合主状态的显示优先级：

```text
已关闭 > 已完工 > 熔炼完成 > 生产中 > 已排产 > 部分排产 > 待排产
```

### 6.3 炉次状态

```text
WAITING -> IN_PROGRESS -> COMPLETED
   |
   +-> CANCELED
```

- `WAITING -> IN_PROGRESS`：记录开始人和开始时间。
- `IN_PROGRESS -> COMPLETED`：记录完成人、完成时间和实际出炉重量。
- `WAITING -> CANCELED`：记录撤销人、撤销时间和原因，释放全部分配。

所有状态动作校验请求携带的 `versionNo`，过期版本返回“数据已被其他用户更新，请刷新后重试”。

## 7. 管理端设计

新增一级菜单“生产管理”。

### 7.1 生产工单

路由：

```text
/dashboard/production/work-orders
/dashboard/production/work-orders/new
/dashboard/production/work-orders/:id
/dashboard/production/work-orders/:id/edit
```

功能：

- 查询、新建、查看、编辑和强制关闭。
- 选择产品后自动带入唯一已生效 BOM、默认已生效路线、材质和重量参数。
- 产品存在多条可用路线时，默认选择产品默认路线，并允许选择其他适用的已生效路线。
- 无已生效 BOM、无可用路线或无对应已生效配方时，禁止提交并返回明确原因。
- 页面只有“提交排产”，不提供保存草稿。
- 详情展示基础快照、排产进度、炉次分配和工艺路线预览。

### 7.2 合炉排产

路由：`/dashboard/production/melt-scheduling`

功能：

- 按材质页签展示待排总量。
- 列表展示工单、产品、剩余件数、剩余铁水重量、交期和优先级。
- 仅允许选择当前材质页签中的工单。
- 逐单填写本炉分配件数，系统计算重量。
- 人工选择设备、配方、计划出炉时间和执行班组。
- 设备由当前材质已生效配方的适用设备集合提供。
- 配方必须已生效、材质一致且适用于所选设备。
- 班组按设备所属车间筛选，班组和设备车间必须一致。
- 设备能力只接受 `kg` 和 `t`，统一转换成 kg。
- 无容量配置的设备不能用于排产；超容量禁止生成，未满炉只提示利用率。

### 7.3 熔炼执行

路由：

```text
/dashboard/production/heat-orders
/dashboard/production/heat-orders/:id
```

功能：

- 按待生产、生产中、已完成、已撤销筛选。
- 展示设备、材质、目标重量、配方、班组、计划时间和实际时间。
- 详情展示关联工单、分配件数、计划重量、配方明细和操作记录。
- 管理端根据独立按钮权限显示开始、完成和撤销操作，作为管理和应急入口。

所有列表延续项目标准：查询按钮、可拖动列宽、固定右侧操作列、实际可见操作超过三个时进入“更多”。

## 8. 小程序设计

首页新增“熔炼任务”入口。

建议页面：

```text
pages/production/heat/list/index
pages/production/heat/detail/index
pages/production/heat/complete/index
```

功能：

- 待生产、生产中、已完成三个页签。
- 下拉刷新。
- 列表展示炉次、设备、材质、目标重量和计划出炉时间。
- 详情展示配方、配料提示、关联工单和执行记录。
- 待生产任务显示“开始生产”。
- 生产中任务显示“完成生产”。
- 完成页面填写实际出炉重量和备注。
- 按钮固定在底部并遵循已有小程序按钮尺寸规范。
- 操作成功后重新请求后端数据，不做本地假成功。

管理端和小程序调用相同的状态动作服务，状态判断和权限判断只能在后端完成。

## 9. 权限与数据范围

权限键：

```text
production
production.work_order.view
production.work_order.create
production.work_order.edit
production.work_order.close
production.work_order.view_synced_public
production.schedule.view
production.schedule.create
production.schedule.cancel
production.heat.view
production.heat.start
production.heat.complete
```

规则：

- 数据列表、创建、编辑、关闭、生成炉次、撤销、开始和完成均为独立权限。
- 页面标题区按钮和表格操作按钮必须使用相同权限判断。
- 后端权限守卫是安全边界，前端隐藏只改善交互。
- 工单接入 `BusinessDataOwnership`，继续支持自己、部门、自定义部门、全部数据的复选范围。
- ERP 同步且没有创建人的工单，通过 `production.work_order.view_synced_public` 补充可见。
- 不增加待分配归属清单。
- 小程序班组成员在拥有 `production.heat.view` 的前提下，可查看分配给本班组的炉次。
- 开始和完成仍分别要求按钮权限，并校验当前用户属于执行班组。
- 非本班组用户直接访问炉次接口时返回无权访问。
- 超管可查看和操作全部炉次。

## 10. 后端接口

建议按职责拆分：

### 10.1 工单

```text
GET  /admin/production/work-orders
GET  /admin/production/work-orders/options
GET  /admin/production/work-orders/product-preview/:productCode
GET  /admin/production/work-orders/:id
POST /admin/production/work-orders
PUT  /admin/production/work-orders/:id
POST /admin/production/work-orders/:id/close
```

### 10.2 排产

```text
GET  /admin/production/melt-pool
GET  /admin/production/melt-pool/options
POST /admin/production/heat-orders
POST /admin/production/heat-orders/:id/cancel
```

### 10.3 熔炼执行

```text
GET  /admin/production/heat-orders
GET  /admin/production/heat-orders/:id
POST /admin/production/heat-orders/:id/start
POST /admin/production/heat-orders/:id/complete
```

### 10.4 小程序

```text
GET  /mini/production/heat-orders
GET  /mini/production/heat-orders/:id
POST /mini/production/heat-orders/:id/start
POST /mini/production/heat-orders/:id/complete
```

控制器只处理参数和响应；编号生成、计算、状态转换和事务统一放入 `ProductionExecutionService`，避免管理端与小程序逻辑分叉。

## 11. 后端校验与事务

提交工单时：

- 产品必须为启用的成品或半成品。
- BOM 必须已生效且属于所选产品。
- 路线必须已生效且适用于所选产品。
- 材质取自锁定 BOM。
- 计划件数必须为正整数，计划交期必填。
- 所有重量由后端重新计算。

生成炉次时：

- 事务中重新读取工单和有效分配，计算剩余件数。
- 禁止跨材质。
- 禁止分配零件、负数、非整数或超过剩余件数。
- 重新计算每条分配重量和总目标重量。
- 校验设备、容量、配方、设备适用关系和班组车间。
- 使用可串行化事务或等效冲突重试，防止两个调度员重复占用同一剩余量。

执行动作时：

- 校验 token、菜单权限、按钮权限、班组任务访问权、当前状态和 `versionNo`。
- 炉次完成时按计划重量比例分摊实际出炉重量。
- 在同一事务中写入操作记录并重算所有关联工单状态。
- 任一步失败时全部回滚。

## 12. 与未来工序执行的衔接

- 工单锁定工艺路线版本，后续运行实例从该版本的节点和边生成。
- 熔炼任务与工单通过分配明细关联，支持同一工单分批熔炼和分批浇注。
- 每条已完成分配保留炉次号、实际重量和完成时间。
- 后续小程序执行要求 `requireFurnaceBatch` 的浇注节点时，扫描或选择炉次号进行校验。
- 工单级 `meltCompletedAt` 只表示全部计划熔炼完成；单批次是否可浇注以具体分配明细为准。
- 后续路线末节点完成时，将工单更新为 `COMPLETED` 并写入最终完工件数和时间。

## 13. 测试与验收

### 13.1 接口自动化

- 工单继承 BOM、路线和材质。
- 工单重量计算和版本锁定。
- 无草稿、提交后立即进入排产池。
- 有效分配存在时禁止编辑。
- 同材质多工单合炉。
- 一张工单拆分到多个炉次。
- 整数件数、剩余数量和容量校验。
- kg/t 单位换算。
- 撤销待生产炉次后数量返回排产池。
- 生产中和已完成炉次禁止撤销。
- 班组成员可见，非班组成员越权失败。
- 开始、完成和重复提交校验。
- 实际重量分摊。
- 工单熔炼完成判定。
- 并发排产不产生超排。

### 13.2 管理端

- 路由和菜单权限有效，未登录不能访问二级页面。
- 数据列表、创建和各动作权限相互独立。
- 查询、列宽拖动、固定操作列和“更多”符合项目标准。
- 产品联动和重量预览正确。
- 排产池材质页签、凑吨计算和容量提示正确。
- 操作后刷新页面数据仍正确，不出现本地假成功。

### 13.3 小程序

- 重新构建 `apps/miniprogram/dist`。
- 班组任务列表、页签和下拉刷新正确。
- 开始和完成按钮按权限及状态显示。
- 实际出炉重量校验正确。
- 非本班组用户不能通过直接请求查看或操作炉次。

### 13.4 构建与 Docker 验收

```bash
npm --prefix apps/api run prisma:generate
npm run build:api
npm run build:admin
npm run build:miniprogram
npm run typecheck:miniprogram
ADMIN_PORT=8081 npm run docker:up
```

完整验收流程：

```text
新建工单
-> 自动进入待排产池
-> 两张同材质工单合炉
-> 一张工单拆分到两个炉次
-> 小程序班组成员开始并完成炉次
-> 工单排产和熔炼状态正确回写
-> 撤销另一张待生产炉次
-> 分配件数返回排产池
```
