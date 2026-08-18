# 造型下芯管理设计

## 目标与范围

本期新增独立的“造型下芯”生产执行模块，承接生产工单中的造型工序节点，完成派工、砂芯齐套校验、开工、分批报工、砂芯库存倒冲、缺陷记录和管理端撤销。

模块复用现有生产工单、生效 BOM、生效工艺路线、模具/芯盒档案、制芯任务、砂芯库存、产线、班组、用户和权限体系。造型任务不得绕过这些主数据另建本地映射或前端状态。

本期不自动生成造型任务，不实现造型设备数采、混砂管理、浇注执行和复杂通用工序引擎，但为后续浇注任务与工单流程完工判断保留稳定接口。

## 核心业务规则

### 任务生成

- 造型任务由生产工单详情页人工生成。
- 只有工艺路线中存在 `OperationMaster.section = 造型` 的工序节点时才显示生成入口。
- 一个生产工单与一个造型工序节点只能对应一个造型任务，禁止重复生成。
- 生成时锁定工单当前的 BOM 版本、工艺路线版本和工序节点。
- BOM 只能引用该产品当前已生效版本，不能引用草稿或已停用版本。
- BOM 存在多个启用模具时必须选择模具；仅有一个时默认选中。
- 保存模具、型腔数、产品、BOM、路线和工序快照，避免后续主数据调整改变已生成任务的计算口径。
- 执行资源选择 `ProductionLine`，不选择熔炉等设备。产线必须启用，班组只能从产线所属车间的启用班组中选择。手工造型工位也按生产线配置。

### 数量换算

- 生产工单计划数量的单位为“件”，造型任务计划数量的单位为“箱”。
- 计划箱数：`ceil(工单计划件数 / 模具型腔数快照)`。
- 每箱砂芯需求：`BOM 单件芯件比 × 模具型腔数快照`。
- 本次砂芯倒冲：`(本次合格箱数 + 本次废品箱数) × 每箱砂芯需求`。
- 报工允许超过计划箱数，但提交前必须二次确认，并记录超产数量。
- 造型任务只更新工单的造型进度和当前工序状态，不直接增加工单最终完工数量。

### 砂芯齐套与开工

- BOM 不含砂芯时，任务生成后可直接进入待开工状态。
- BOM 包含砂芯时，任务可以提前生成和派工，但页面显示计算状态“待砂芯齐套”。
- “待砂芯齐套”是实时计算的业务状态，不作为长期缓存的任务状态。
- 开工前必须重新校验：
  - 同一生产工单关联的全部所需制芯任务已经完成；
  - 砂芯库存批次与当前生产工单直接关联；
  - 需要烘干的批次已经烘干；
  - 批次未过保质期、未报废且可用；
  - 各芯盒对应砂芯库存足以覆盖整个造型任务。
- 不允许跨生产工单借用砂芯库存。
- 不满足条件时返回各芯盒的需求量、可用量和缺口，禁止开工。

### 报工与砂芯倒冲

- 任务状态为 `IN_PROGRESS` 时允许多次报工。
- 报工填写本次合格箱数、废品箱数、完工选择和缺陷明细。
- 本次合格与废品数不能同时为零。
- 废品数大于零时必须填写一个或多个缺陷明细；缺陷数量合计必须等于本次废品箱数。
- 缺陷选项仅返回已启用且绑定当前造型工序的缺陷代码。
- 砂芯批次仅在同一生产工单内自动分配，依次使用临近过期批次、最早过期批次和最早生产批次，可跨多个批次扣减。
- 库存不足时整次报工失败，不保存部分报工或部分扣减。
- 累计合格箱数达到计划箱数时默认勾选结束。
- 未达到计划箱数也可提前结束，但必须填写提前结束原因，任务标识为短缺完工并保存计划差额。
- 提前结束后的剩余砂芯继续归属当前生产工单，不自动转移给其他工单。

### 撤销与追溯

- 小程序不提供历史报工修改或撤销。
- 管理端具有撤销权限的用户可以撤销报工，必须填写原因。
- 报工记录不物理删除，保存撤销人、撤销时间、原因并在时间线中显示。
- 撤销按原 `MoldingCoreConsumption` 明细精确返还砂芯库存，不能重新按当前规则计算。
- 若涉及的砂芯批次后来已报废，禁止直接撤销并返回明确原因。
- 撤销后重新汇总任务合格数、废品数、超产数和状态；已完工任务数量不足时回到生产中。
- 为后续浇注模块保留下游引用校验：造型产出被浇注任务引用后，应禁止直接撤销。

## 数据模型

### MoldingTask

造型任务主表，主要字段：

- `code`：任务编号。
- `workOrderId`、`routingVersionId`、`routingNodeId`、`operationId`。
- `productId`、`bomId`、`moldId`。
- `productionLineId`、`teamId`。
- `planPieceQty`、`planBoxQty`、`cavityCountSnapshot`。
- `completedGoodQty`、`completedScrapQty`、`overproductionQty`。
- `status`：`PENDING / IN_PROGRESS / COMPLETED / CANCELED`。
- `completionType`：正常完工或短缺完工。
- `earlyCompletionReason`、计划/实际开始结束时间。
- 产品、模具、BOM、路线、工序和砂芯需求快照。
- `versionNo`、创建人、更新人及审计时间。

生产工单与路线节点建立唯一约束，确保同一节点不会重复生成任务。取消任务保留原记录和审计关系，不通过新建重复任务绕过约束。

### MoldingReport

分批报工记录，主要字段：

- `taskId`、`reportCode`、`requestId`。
- `goodQty`、`scrapQty`、`finishTask`。
- `operatorId`、`reportedAt`、备注。
- `status`：有效或已撤销。
- 撤销人、撤销时间和撤销原因。

`requestId` 建立唯一约束，防止网络超时或重复点击造成重复报工。

### MoldingCoreConsumption

记录每次报工对每个砂芯库存批次的实际扣减：

- `reportId`、`coreInventoryBatchId`、`coreBoxId`。
- `workOrderId`、`quantity`。
- 扣减前后数量和库存台账关联信息。

该表既支持完整追溯，也作为撤销时精确返还库存的唯一依据。

### MoldingReportDefect

保存一次报工中的多条缺陷：

- `reportId`、`defectCodeId`、`quantity`、`remark`。

### DefectOperation

新增缺陷代码与标准工序的多对多关系：

- `defectCodeId`、`operationId`，组合唯一。
- 缺陷代码管理使用标准工序多选，不再依靠 `sourceOperation` 自由文本判断。

已有自由文本字段仅用于历史兼容展示，不参与新报工选项过滤。

## 状态与执行流程

1. 工单详情请求生成预览，后端返回生效 BOM、路线造型节点、可用模具、产线、班组和砂芯需求。
2. 用户选择模具、产线、班组后生成任务并保存全部业务快照。
3. 列表和详情实时计算砂芯齐套状态。
4. 开工接口重新读取任务、工单、产线、班组、制芯任务和砂芯库存后决定是否允许开始。
5. 报工接口校验版本、数量、缺陷和完工选择，在同一事务中写入报工、缺陷、砂芯扣减明细、库存台账并汇总任务。
6. 撤销接口检查下游引用和库存状态，按原明细返还并重新计算任务状态。
7. 后续工单流程引擎根据各路线节点执行状态判断是否推进；造型任务完成不等同于整张工单完成。

## 事务、并发与错误处理

- 开工、报工、撤销携带 `versionNo`，后端执行乐观锁校验。
- 数据已被其他终端更新时返回 HTTP 409 和当前状态，前端提示刷新后重试。
- 报工事务锁定任务、编号序列和本次涉及的砂芯库存批次。
- 报工主表、缺陷明细、库存扣减、消费明细、库存台账、任务汇总必须原子提交。
- 相同 `requestId` 的重复请求返回首次成功结果，不重复扣减。
- 后端错误使用统一 `{ code, message, data }` 结构，并在 `data` 中返回缺料明细或最新版本号。

## 管理端设计

### 导航与页面

- 一级归属：生产管理。
- 列表路由：`/dashboard/production/molding-tasks`。
- 详情路由：`/dashboard/production/molding-tasks/:id`。
- 工单详情增加“生成造型下芯任务”按钮，按钮由路线节点、是否已生成任务和权限共同控制。

### 列表与详情

- 页签：待砂芯齐套、待开工、生产中、已完工、已取消。
- 列表展示任务号、工单号、产品、模具、产线、班组、计划箱数、完成箱数、进度和状态。
- 右上角统一放置查询和有权限的新增/业务按钮，不自动定时刷新。
- 使用现有 `ResizableTable`、固定操作列和 `TableActions`；实际可见操作超过三个时进入“更多”。
- 详情展示任务快照、BOM 下芯配方、齐套明细、报工时间线、缺陷、砂芯批次扣减和撤销日志。
- 管理端支持派工调整、开工、报工、取消和撤销，按钮按最新状态与后端 `allowedActions` 显示。

## 小程序设计

- 首页增加“造型下芯”入口。
- 列表页签：待齐套、待开工、生产中、已完成，并支持下拉刷新。
- 支持扫码或手输任务编号进入详情。
- 开工页面展示任务、产品、模具、产线、班组和砂芯齐套信息。
- 报工页面提供 `-10 / -1 / +1 / +10`、一键拉满、废品数、缺陷多行录入和完工选择。
- 提交前展示合格、废品、超产或短缺完工的二次确认。
- 小程序不提供报工撤销和历史修改。
- 现场按钮完全依据接口返回的 `allowedActions`，不在小程序中硬编码用户类型。

## API 设计

### 管理端

- `POST /admin/production/work-orders/:id/molding-task/preview`
- `POST /admin/production/work-orders/:id/molding-task`
- `GET /admin/production/molding-tasks`
- `GET /admin/production/molding-tasks/:id`
- `PUT /admin/production/molding-tasks/:id/dispatch`
- `POST /admin/production/molding-tasks/:id/start`
- `POST /admin/production/molding-tasks/:id/report`
- `POST /admin/production/molding-reports/:id/reverse`
- `POST /admin/production/molding-tasks/:id/cancel`
- `GET /admin/production/molding-tasks/:id/defect-options`

### 小程序端

- `GET /mini/production/molding-tasks`
- `GET /mini/production/molding-tasks/:id`
- `GET /mini/production/molding-tasks/by-code/:code`
- `POST /mini/production/molding-tasks/:id/start`
- `POST /mini/production/molding-tasks/:id/report`
- `GET /mini/production/molding-tasks/:id/defect-options`

### 后续工序接口

- 按工单查询造型完成量、可浇注数量、有效报工批次和状态。
- 查询造型报工是否已被下游浇注任务引用。
- 后续制型或浇注模块通过服务接口读取，不直接拼接造型模块表数据。

## 权限与数据范围

管理端权限：

- `production.molding.view`
- `production.molding.create`
- `production.molding.dispatch`
- `production.molding.start`
- `production.molding.report`
- `production.molding.cancel`
- `production.molding.reverse`

小程序权限：

- `mini.production.molding.view`
- `mini.production.molding.start`
- `mini.production.molding.report`

数据列表与操作权限独立配置。管理端继续执行现有角色数据范围；小程序普通员工仅查看本人或所属执行班组可操作的任务，超管可查看全部。前端权限隐藏仅用于交互，所有接口必须由后端守卫验证权限、数据范围和任务状态。

## 缺陷代码基础数据

补充并绑定对应标准工序的测试数据。

制芯工序：

- `CORE-INCOMPLETE`：射砂不足/砂芯缺肉。
- `CORE-CRACK`：砂芯裂纹。
- `CORE-DAMAGE`：砂芯破损。
- `CORE-DEFORM`：砂芯变形。
- `CORE-DIMENSION`：尺寸超差。
- `CORE-STRENGTH`：强度不足。
- `CORE-COATING`：涂料不良。
- `CORE-DRYING`：烘干不良。

造型下芯工序：

- 砂型损伤。
- 塌箱。
- 下芯错位。
- 砂芯破损。
- 合型不到位。
- 错箱/偏箱。

## 测试要求

### 关联与状态

- 只使用当前产品已生效 BOM 和生效工艺路线。
- 无造型节点时不显示生成入口；相同工单和节点不能重复生成。
- 多模具必须选择，计划箱数和每箱砂芯需求按快照正确计算。
- 无砂芯产品直接待开工；有砂芯产品正确显示齐套状态。
- 同工单砂芯可用，跨工单砂芯不可用。

### 报工与库存

- 多批次按既定优先级扣减，消费明细和库存台账一致。
- 库存不足时所有写入回滚。
- 多缺陷数量之和必须等于废品数。
- 重复 `requestId`、并发报工和过期页面操作不会产生重复数据。
- 正常完工、短缺完工和超产均正确记录。
- 撤销精确恢复库存和任务状态，已报废批次及已有下游引用时正确拦截。

### 页面与权限

- 管理端列表、详情、生成、派工、报工、取消、撤销分别验证按钮和接口权限。
- 小程序员工仅看到本人或所属班组任务，扫码越权访问被后端拒绝。
- 无操作权限用户仍可在拥有 `view` 时查看列表和详情。
- 页面刷新、重复点击和多端交替操作均以服务端最新状态为准。

## 实施约束

- 所有数据必须接 PostgreSQL 和 Prisma，不使用 mock、本地数组或假成功。
- Prisma 使用真实 relation，并为任务唯一性、报工幂等、查询和库存分配建立必要约束与索引。
- 表单下拉全部读取真实接口。
- 编码、列表、页签记忆、操作列、图片和页面按钮遵循项目现有标准文档。
- 小程序改动完成后必须执行构建，将源码同步到 `apps/miniprogram/dist` 后再验证。
