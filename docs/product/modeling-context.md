# 生产建模模块开发记录

更新时间：2026-08-15

生产建模数据已被生产工单与熔炼执行模块正式引用，运行期关系和状态规则见 `docs/product/production-execution-context.md`。

## 本次新增范围

以 `/Users/swindcn/Downloads/数据建模.md` 为准，新增管理端“生产建模”模块，并复用现有 `apps/admin`、`apps/api`、Prisma、PostgreSQL、角色权限和标准数据列表。

已新增管理端入口：

- `/dashboard/model/workshop-line`：车间与产线，页面内用页签维护车间、产线。
- `/dashboard/model/team`：班组配置。
- `/dashboard/model/equipment`：设备配置。
- `/dashboard/model/item`：物料主档。
- `/dashboard/model/material`：材质牌号。
- `/dashboard/model/recipe`：熔炼配方。
- `/dashboard/model/bom`：铸造 BOM。
- `/dashboard/model/operation`：标准工序主档。
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
- `GET /admin/modeling/recipe-options`：返回启用材质牌号、熔炼车间启用设备和“原材料”类型物料。
- `POST /admin/modeling/recipes/:code/activate`：草稿配方提交生效。
- `POST /admin/modeling/recipes/:code/clone`：复制配方及全部明细，生成新的草稿编码。
- `POST /admin/modeling/recipes/:code/disable`：停用已生效配方。
- `GET/POST /admin/modeling/operations`：工序列表与新增；`PUT /:id` 编辑；`POST /:id/enable|disable` 启用或禁用。
- `GET/POST /admin/modeling/routings`：版本化工艺路线列表与新增。
- `GET/PUT/DELETE /admin/modeling/routings/:id`：路线版本详情、草稿修改与删除。
- `POST /admin/modeling/routings/:id/activate|disable|new-version|clone`：发布、停用、升版与独立克隆。
- `PUT /admin/modeling/routings/:id/default-products`：设置该路线的默认产品关系。

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
- `OperationMaster`
- `ProcessRoutingVersion`
- `RoutingApplicableProduct`
- `ProductDefaultRouting`
- `ProcessRoutingNode`
- `RoutingNodeEquipment`
- `ProcessRoutingEdge`
- `ShiftMaster`
- `FactoryCalendar`
- `ShiftSchedule`
- `DefectCode`

材质牌号是质量标准主数据，不是物料或配方字典。当前关系为：

```text
Product.materialGradeCode -> MaterialGrade
MaterialGrade -> MaterialGradeElement（化学成分上下限）
MaterialGrade -> MaterialGradeProperty（力学性能上下限、检测方法）
MaterialGrade -> MaterialGradeProcessRule（熔炼/浇注/热处理控制要求）
MaterialGrade -> MaterialGradeStandardVersion（历史标准版本）
MaterialGrade -> MeltRecipe
MeltRecipe -> RecipeApplicableFurnace -> Furnace
MeltRecipe -> RecipeTargetElement
MeltRecipe -> MeltRecipeItem -> Product
CastingBom -> Product（每个产品一个 BOM 主档）
CastingBom -> CastingBomVersion（保留全部历史版本）
CastingBomVersion -> MaterialGrade
CastingBomVersion -> CastingBomItem -> Product（物理用料）
CastingBomVersion -> CastingBomVersionMold -> MoldMaster（生产模具工装）
CastingBomVersion -> CastingBomVersionCoreBox -> CoreBoxMaster（芯盒工装）
```

材质牌号通过唯一 `code` 被配方和物料引用；删除被引用的牌号时后端拒绝删除。标准明细采用独立 Prisma relation 保存，旧 `elementLimits` JSON 字段仅作为历史数据兼容字段保留。设备不再维护“允许材质”，适用关系由配方关联一个或多个熔炼设备表达。后续炉批与化验模块应绑定配方编码、牌号编码及标准版本。

### 熔炼配方规则

- 配方与材质牌号为 N:1，材质牌号可对应多个版本或炉型的配方。
- 配方适用炉型为多选，只允许选择“熔炼”车间下的启用设备。
- 配方目标化学成分在选择材质牌号时自动带入，保存为配方快照，允许工艺员自由调整，不反向修改材质牌号标准。
- 配料物料只能选择物料管理中一级类型为“原材料”的物料；原材料、回炉料参与比例计算，辅料/合金直接填写标准用量。
- 基准重量默认 `1000 kg`；原材料和回炉料标准用量按 `基准重量 × 投料比例 / 100` 自动计算。
- 提交生效时，原材料与回炉料投料比例合计必须为 `100%`。草稿可编辑、删除；已生效只能查看、复制、停用；已停用只能查看、复制。
- 已停用配方允许修改。保存修改时保持配方编码不变，主版本按 `V1.0 -> V2.0 -> V3.0` 依次升级，状态回到草稿；草稿重复保存不重复升级，已生效配方必须先停用才能修改。
- 配方主档只保留当前版本。后续生产工单引用配方时必须保存配方编码、下达时版本号和配方明细快照，不能只读取主档当前内容。
- 复制配方生成 `REC-YYYYMMDD-NNN` 新编码，名称默认为“原配方名称-副本”，版本重置为 `V1.0`，状态为草稿，并保存来源配方编码。

### 铸造 BOM 规则

- 铸造 BOM 是产品的物理 BOM，不直接绑定某一条熔炼配方。BOM 绑定材质牌号；后续排产可将相同材质牌号的多个生产单合并熔炼，再按炉型选择该材质的已生效配方。
- `CastingBom` 与产品为 1:1；`CastingBomVersion` 保存 `V1.0/V2.0/...` 历史版本；`CastingBomItem` 保存砂芯、铸造辅材和工装耗材的单件用量。
- BOM 主物料只能选择一级类型为“成品”或“半成品”的物料。物理用料只允许一级类型为“半成品”“铸造辅材”“工装耗材”的物料；砂芯统一归档为 `半成品/砂芯`。
- 模具、芯盒属于可重复使用的生产工装，不计入物理领料单耗。一个模具可绑定多套芯盒；BOM 版本可从全部启用的模具档案中多选生产模具，选择后自动带入其全部启用芯盒，芯盒仍允许手动增删调整。
- 芯件比属于 BOM 版本与芯盒的关系属性，保存在 `CastingBomVersionCoreBox.quantityPerProduct`，不进入芯盒主档。默认值为 `1`，必须大于 `0`；后续制芯任务需求量按 `生产数量 × 芯件比` 计算。砂芯物料的领料单耗仍在物理用料明细中单独维护，两者不能混用。
- 芯盒保质期属于产品 BOM 工艺约束，保存在 `CastingBomVersionCoreBox.shelfLifeHours`，单位小时，允许为空；填写时必须大于 `0`。新版本、同产品复制和计算接口必须原样保留，用于后续制芯完成后的失效时间计算。
- 同一产品同一时间只能有一个 `ACTIVE` 版本。新版本以现有版本为模板复制为下一主版本草稿；新版本生效时，事务内将同产品旧生效版本改为已停用。
- 首版创建、版本号分配、草稿编辑/删除和生效/停用切换统一使用 PostgreSQL BOM 维度 advisory lock，锁内必须重新检查当前状态和派生引用，避免并发请求修改/删除刚生效的版本、生成重复版本或出现多个已生效版本。
- 草稿可编辑、删除、提交生效；已生效可查看、停用、创建新版本和跨产品克隆；已停用可查看、创建新版本和跨产品克隆。
- 草稿允许跨产品克隆，但已产生派生版本的来源草稿不能删除；创建新版本只允许以已生效或已停用版本为来源。
- 跨产品克隆必须选择已存在的成品或半成品，不自动创建物料。目标产品无 BOM 时生成 `V1.0`，已有 BOM 时生成下一版本草稿，并保存来源版本关系。
- 同产品创建新版本时复制全部模具和芯盒关系；跨产品克隆只复制档案关联物料与目标产品匹配的工装，没有匹配工装时目标草稿保持为空。
- 后端以净重和浇注毛重重新计算：`工艺收得率 = 净重 / 毛重 × 100%`，`单件回料重量 = 毛重 - 净重`，不能信任前端计算值。
- 稳定计算接口为 `GET /admin/modeling/boms/:id/calculate?quantity=N`，返回铁水需求、回料重量、含损耗的物理用料需求，以及同材质当前可用的已生效熔炼配方摘要。
- 计算接口同时返回生产模具、芯盒、芯件比和芯件需求量，供后续排产与制芯任务做工装齐套和数量计算，但工装本身不参与物理领料数量计算。
- 未来生产工单、制令单、领料和调度模块必须保存 `bomVersionId`、BOM 版本号及下达时明细快照，不能只通过产品读取当前生效版本，避免历史单据随 BOM 升版变化。
- 当前物料主档尚未提供启用/停用生命周期，现有物料均按可用处理；未来增加物料停用状态时，BOM 生效接口必须同步校验主物料状态。材质牌号停用校验本期已生效。

### 工序与工艺路线规则

- 工序是独立主档，工段来自字典 `operationSections`。工序禁用后保留历史路线关系，但新路线不可选择；同一状态权限可重新启用。
- 一条路线可绑定多个成品或半成品，但一个产品物料编码只能归属一个当前工艺路线主档。工艺路线与材质牌号无直接关系，主列表不提供材质筛选和材质列；产品自身的材质信息仍由物料、BOM 和生产业务使用。
- 工艺路线主列表展示“关联产品数”，按当前路线版本的 `RoutingApplicableProduct` 实际数量计算，不再展示“默认产品”统计。
- 路线详情分为“工艺线路”和“适用产品”两个标签页。工序节点、连接关系、设备和工艺参数属于版本化内容；适用产品是独立维护范围，不因新增或移除产品触发路线升版。
- 草稿和已生效路线可通过 `PUT /admin/modeling/routings/:id/applicable-products` 直接增减适用产品；已停用历史版本只读。移除当前默认产品时，同一事务内取消其 `ProductDefaultRouting` 关系。
- 草稿和已生效版本都会占用产品归属。同一路线主档的历史版本和新版本可共同保留产品；其他路线主档不能再选择该产品。路线停用后释放当前归属，允许产品改配到其他路线。
- 产品归属校验必须在后端事务中执行，并按产品编码获取 PostgreSQL advisory lock，避免两个请求并发绕过唯一性检查。前端选项过滤只用于改善交互，不能替代后端约束。
- 适用产品调整只影响后续路线选择。已创建生产工单保存了 `routingVersionId` 和路线快照，不随适用范围变化。
- 每个节点关联一个标准工序，可多选适用设备，并保存路线属性、报工点、质检要求、标准节拍和生产绑定规则。
- 路线工作台采用受控可视化拖拽，分为熔炼副线、制芯副线、造型主线、关键汇合和汇合后主线。节点和连线都是真实 Prisma relation。
- 后端拒绝自环、重复边和循环。发布时还要求节点全部可达、仅有一个终点，汇合节点至少有两个前置，并按拓扑顺序生成 `10/20/30...` 工序号。
- 浇注汇合工序强制转为关键汇合节点，强制炉批次、铁水包号和砂芯批次绑定，为后续 PDA 报工防错提供依据。
- 路线编码稳定，版本按 `V1.0/V2.0/V3.0...` 升级。新版本发布时自动停用同编码旧生效版本，并迁移仍属于新版本产品范围的默认关系。
- 克隆生成新路线编码和 `V1.0` 草稿，只复制节点、设备和边，不复制适用产品及默认产品关系；复制后由用户重新选择尚未归属的产品。
- `ProductDefaultRouting` 继续用于定位生产工单采用的当前生效版本；由于产品只能归属一个路线主档，不再支持将同一产品配置到多个替代路线主档。
- 已停用路线版本可通过 `POST /admin/modeling/routings/:id/recycle` 移入回收站，普通列表默认按 `recycledAt = null` 过滤；回收站通过 `recycled=true` 查询并可调用 `restore` 恢复。回收仅归档显示，不删除路线、节点、工单或追溯关系，也不参与产品归属释放。
- 回收与恢复使用独立权限 `model.routing.recycle`。已回收版本只允许查看和恢复，创建新版本、克隆及其他业务动作必须先恢复。
- 所有详情和状态操作先校验 `modeling:routings` 数据归属，不允许通过已知 ID 越权查看或修改。
- 数据库迁移先将旧 `ProcessRoutingStep` 直线数据转为 `V1.0` 节点和有向边，然后才删除旧结构，不丢失历史路线。

关键关联规则：

- 产线、班组、设备和排班引用车间编码。
- 熔炼配方引用材质牌号编码。
- 模具档案引用物料；工艺路线版本通过 `RoutingApplicableProduct` 多选成品/半成品，并由服务层保证产品只归属一个当前路线主档。
- 路线节点引用工序主档，通过 `RoutingNodeEquipment` 多选设备。
- 芯盒档案引用模具编码，关系为模具 `1:N` 芯盒；移除历史芯盒使用停用，不做物理删除。
- 芯盒档案的 `cavityCount` 表示芯盒穴数，新增默认 `1`，必须为正整数；与模具型腔数和 BOM 芯件比分开维护。
- BOM 版本通过 `CastingBomVersionMold` 关联模具，通过 `CastingBomVersionCoreBox` 关联多套芯盒并保存芯件比和可选的保质期小时数。
- 动态排班引用车间编码、班次编码、班组编码。
- 删除被引用的车间、产线、班组、物料、材质、模具、班次时，后端阻止删除。
- 模具或芯盒被任一 BOM 历史版本引用时禁止删除；停用不影响历史 BOM 查看。

## 权限

已扩展 `apps/admin/src/utils/roles.ts`、`apps/api/src/basic-data.controller.ts`、`apps/api/src/mold-development.controller.ts` 的系统管理员权限。

新增权限前缀：

- `model.workshop-line`
- `model.team`
- `model.equipment`
- `model.item`
- `model.material`
- `model.recipe`
- `model.bom`
- `model.operation`
- `model.routing`
- `model.calendar`
- `model.schedule`
- `model.defect`
- `mold.model`
- `mold.corebox`

动态排班额外权限：

- `model.schedule.batch`

熔炼配方额外业务权限：

- `model.recipe.clone`
- `model.recipe.activate`
- `model.recipe.disable`

铸造 BOM 额外业务权限：

- `model.bom.clone`
- `model.bom.activate`
- `model.bom.disable`
- `model.bom.new_version`

工序与工艺路线额外业务权限：

- `model.operation.disable`：启用/禁用工序。
- `model.routing.version`：创建新版本。
- `model.routing.clone`：克隆独立路线。
- `model.routing.activate`：发布生效。
- `model.routing.disable`：停用路线。
- `model.routing.default`：设置产品默认路线。
- `model.routing.edit`：编辑草稿工艺内容，并维护草稿或已生效路线的适用产品；已停用版本不可修改。

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

## 制芯计划与砂芯库存实现

### 上下游关系与生成规则

生产工单提交后锁定 `bomVersionId` 和 `routingVersionId`，制芯模块只读取锁定版本及快照，不回读产品当前生效版本：

```text
WorkOrder（锁定 BOM / 路线）
  -> CastingBomVersionCoreBox（quantityPerProduct / shelfLifeHours）
  -> CoreProductionTask（手动生成，workOrderId + coreBoxCode 唯一）
  -> CoreProductionReport（允许多次）
  -> CoreInventoryBatch（每次报工唯一）
  -> CoreInventoryLedger（入库及后续库存动作）
  -> 未来造型 validateCoreConsumption / consumeCoreBatch
```

- 工单创建不自动产生制芯任务。只有锁定路线含 `operation.section === '制芯'` 的节点时，工单详情才显示手动生成入口；无制芯节点显示“该工单无需制芯”。判定在 `apps/api/src/production/production.service.ts`，入口在 `apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx`。
- 同一工单按 BOM 芯盒逐行生成任务，一套芯盒一条任务；多套芯盒生成多条。数据库使用 `CoreProductionTask.@@unique([workOrderId, coreBoxCode])`，服务还通过工单行锁、可串行化事务和冲突重试阻止重复生成。
- 计划需求量：`ceil(工单计划数量 × BOM芯件比 × (1 + 预计废品率))`。
- 计划压盒次数：`ceil(计划需求量 ÷ 芯盒穴数)`。
- `apps/api/src/production/coremaking.calculations.ts` 将最多四位小数转换为 `Prisma.Decimal` 缩放整数计算，避免 `1.1 × 100` 一类浮点误差；非法精度、溢出、非正芯件比和非正整数穴数均拒绝。
- 任务保存产品、工单、BOM、路线、工序、芯盒、模具、芯件比、穴数和保质期快照。后续 BOM 升版、路线适用范围变化或芯盒档案调整不修改历史任务。
- 生成和派工只能选择工单锁定路线中的制芯节点。节点配置了启用设备时严格限定为节点设备；节点未配置启用设备时，回退到设备档案中名称或类型明确为射芯/制芯/造芯的设备。候选设备本身及其所属车间都必须启用；班组及其所属车间也必须启用，并且与设备同车间。预览、生成/派工、任务选项和开工使用同一可用性规则。设备、班组、计划开始时间未补齐为 `PENDING_DISPATCH`，补齐后为 `WAITING`；已有报工后禁止改派。

### 报工、库存与状态机

- 任务状态：`PENDING_DISPATCH` 待派工、`WAITING` 待生产、`IN_PROGRESS` 生产中、`COMPLETED` 已完成、`CANCELED` 已取消。开始前重新校验设备、班组、车间和父工单状态。
- `IN_PROGRESS` 任务可多次报工。每次报工在同一可串行化事务内累计合格/报废数，并生成一条 `CoreProductionReport`、一条 `reportId` 唯一的 `CoreInventoryBatch` 和一条 `CoreInventoryLedger(PRODUCED)`；累计合格数达到计划量后完成，超产数量保留。
- 免烘干批次从报工时间 `reportedAt` 起算保质期，直接成为 `AVAILABLE` 或 `WARNING`。需烘干批次先为 `UNDRIED`，确认烘干后从 `driedAt` 起算并转为 `AVAILABLE` 或 `WARNING`。
- 保质期为空表示不自动失效；剩余时间 `<= 24h` 为 `WARNING`，到期为 `EXPIRED`。`UNDRIED`、`EXPIRED`、`LOCKED`、`SCRAPPED`、`CONSUMED` 均不可领用，`WARNING` 可用且未来造型应优先使用。
- `apps/api/src/production/core-inventory.scheduler.ts` 每 10 分钟集合更新状态；库存列表、详情、齐套和领用仍按当前时间实时计算。
- 冻结和解冻不改变数量，报废将当前数量清零，未来领用扣减数量并在归零后转 `CONSUMED`。入库、冻结、解冻、报废和领用均写不可变 `CoreInventoryLedger`，保存变化量、结存、来源、操作人和原因。

### 齐套与未来造型边界

- `GET /admin/production/work-orders/:id/core-readiness` 按目标工单锁定 BOM 的每套芯盒返回需求量、可用量、待烘干量、缺口、最短剩余小时和 `READY/PARTIAL/SHORTAGE`。
- 齐套和消费兼容规则是“同产品 + 目标锁定 BOM 包含同一芯盒”，不要求库存来自当前工单。因此同一产品跨工单、跨 BOM 版本的同芯盒有效库存可以共用；不同产品即使芯盒编码相同也拒绝。
- `apps/api/src/production/coremaking.service.ts` 已实现领域方法 `validateCoreConsumption(workOrderId, batchCode, quantity, operatorContext?)` 和 `consumeCoreBatch(workOrderId, batchCode, quantity, operatorContext)`。通用领用仍使用批次行锁、`versionNo` 和库存条件更新，写 `CONSUMED` 流水并禁止并发负库存。造型报工是明确的业务例外：允许对同工单可追溯来源批次透支，必须通过 `MoldingService` 的事务消费和台账实现，其他模块不得直接复用该例外。
- 通用 `validate/consume` 方法仍未挂接控制器；造型下芯已由独立 `MoldingService`、管理端页面和小程序页面实现。造型的工单隔离齐套、负库存透支和撤销返还不得回退到通用领用逻辑。

### 页面、接口与权限

管理端路由：

- `/dashboard/production/core-tasks`：制芯任务列表。
- `/dashboard/production/core-tasks/:id`：任务详情、派工、开始、报工、烘干。
- `/dashboard/production/core-inventory`：库存筛选、详情、流水、标签、烘干、冻结/解冻和报废。
- `/dashboard/production/work-orders/:id`：工单详情中的生成入口、任务汇总和齐套面板。

管理端接口由 `apps/api/src/production/coremaking.controller.ts` 提供：

- `POST /admin/production/work-orders/:id/core-tasks/preview`
- `POST /admin/production/work-orders/:id/core-tasks`
- `GET /admin/production/work-orders/:id/core-readiness`
- `GET /admin/production/core-tasks`、`GET /admin/production/core-tasks/:id`、`GET /admin/production/core-tasks/:id/options`
- `PUT /admin/production/core-tasks/:id/dispatch`
- `POST /admin/production/core-tasks/:id/cancel`
- `POST /admin/production/core-tasks/:id/start`
- `POST /admin/production/core-tasks/:id/report`
- `GET /admin/production/core-inventory`、`GET /admin/production/core-inventory/options`、`GET /admin/production/core-inventory/:id`
- `POST /admin/production/core-batches/:id/dry`
- `POST /admin/production/core-batches/:id/lock`
- `POST /admin/production/core-batches/:id/unlock`
- `POST /admin/production/core-batches/:id/scrap`

小程序页面在 `apps/miniprogram/src/pages/core/` 下，包括 `list`、`detail`、`report`、`dry`、`label`；真实接口为 `/mini/production/core-tasks*`、`/mini/production/core-tasks/:id/execution-options`、`/drying-batches` 和 `/mini/production/core-batches/:id/dry`。小程序支持班组任务查看、开始、多次报工、混砂批次扫码、烘干和二维码标签，不提供派工、取消、库存冻结或报废。

完整权限键：

- 管理端任务：`production.core_task.view/create/dispatch/edit/cancel/start/report/dry`。
- 管理端库存：`production.core_inventory.view/dry/lock/scrap`。
- 小程序任务：`mini.production.core.view/start/report/dry`。

`production.core_task.edit` 已在角色权限树和系统管理员默认权限中注册，但当前没有通用任务编辑接口；现有任务修改分别由 `dispatch`、`cancel`、`start`、`report`、`dry` 专用权限保护。

管理端任务继续使用 `production:core_tasks` 数据归属；库存可见范围跟随来源任务。小程序普通用户还必须是任务执行班组成员，超级管理员例外；无班组关系时列表不返回，已知 ID 访问也按不存在处理。

### 统一防并发与交互防呆

- 派工、取消、开始、报工、烘干、冻结、解冻、报废都提交最新 `versionNo`。旧版本或重复动作返回 `409`，管理端和小程序在当前页面刷新最新详情后提示重试。
- 管理端 `apps/admin/src/utils/latestRequest.ts` 与小程序 `apps/miniprogram/src/utils/latest-request.ts` 隔离列表、详情、标签和动作请求；后返回的旧响应、已卸载页面和旧筛选结果不能覆盖当前页面。
- 管理端制芯任务列表和工单砂芯齐套面板也必须使用 latest-request gate；连续查询或切换工单时，只允许最后一次请求写入页面状态。
- 报工存在报废数量时必须填写缺陷原因，规则由 API 强制执行。烘干设备仅接受启用且类型包含“烘干”或“干燥”的设备，不能用“射芯/制芯”关键字做宽泛匹配。
- 生成任务锁 `WorkOrder`，开始/报工锁 `CoreProductionTask`，烘干及库存消费锁 `CoreInventoryBatch`；任务编码和批次编码使用 `DocumentSequence` 事务序列。任何报工失败必须同时回滚任务累计、报工、批次和流水。
- `apps/api/src/production/production-permission.guard.ts` 在权限匹配前统一移除请求尾斜杠，`/report` 与 `/report/`、`/dry` 与 `/dry/` 使用同一最小权限，不能通过尾斜杠退化为查看权限。
- 现有图片上传/预览、编码校验、详情标签页、`ResizableTable`、固定操作列和 `TableActions` 标准继续适用，制芯页面不得另建冲突规则。

制芯快速验证命令：

```bash
npm --prefix apps/api run test:coremaking-calculations
npm --prefix apps/api run test:coremaking-tasks
npm --prefix apps/api run test:coremaking-execution
npm --prefix apps/api run test:core-readiness
node --test apps/admin/tests/coremaking-permissions.test.mjs apps/admin/tests/coremaking-ui.test.mjs
npm --prefix apps/miniprogram test
```

## 工艺路线与合型浇注衔接（2026-08-24）

- 合型浇注不单独配置产品范围，而是沿生产工单已锁定的工艺路线版本执行。即使该版本后续停用，历史工单仍使用锁定版本的真实节点和边。
- 造型报工后，系统从当前造型节点向后查找首个 `OperationMaster.pouringMergePoint = true` 的可达节点，并生成 `PouringMoldBatch` 待浇砂型批次。无可达汇合节点时不生成待浇队列，但不阻断造型报工。
- 浇注扣减以 `closingTime -> id` 固定 FIFO，支持一次报工跨多笔造型批次。浇注报工必须绑定同一工单、同材质的具体铁水转运包次，以及路线浇注节点上绑定的启用工位设备。
- 工艺路线的浇注节点应绑定启用的浇注工位设备；未绑定时可查看待浇队列，但不允许提交报工。浇注完成判断为“造型任务已完成且所有有效待浇批次余量为零”。
- 完整浇注业务规则见 `docs/product/context-summary.md` 的“合型浇注执行”，实施细节见 `docs/superpowers/specs/2026-08-24-pouring-execution-design.md` 和 `docs/superpowers/plans/2026-08-24-pouring-execution.md`。

## 工艺路线与落砂清理衔接（2026-08-24）

- 标准工序库使用一个 `OP-SHAKE / 落砂清理` 工序，工艺路线也只放置一个节点；现场执行在该节点内分为落砂、清理打磨两个阶段。
- 路线节点新增 `coolingDurationMinutes`，单位为分钟，只在 `OP-SHAKE` 或清理工段节点可编辑，默认 `0`。创建、编辑、克隆和新版本必须完整保留该字段。
- 冷却时长属于路线版本快照。历史工单继续按已锁定路线节点的数值执行，即使路线版本后来停用或新版本修改了冷却时长，也不能回写历史落砂批次。
- 落砂和清理设备均来自设备配置，并同时满足启用状态、节点设备绑定和设备类型字典。设备类型至少应维护“落砂、清理、抛丸、打磨、切割”，不能使用设备名称关键字代替字典关系。
- 缺陷代码通过 `DefectOperation` 绑定 `OP-SHAKE`；两个阶段共用该工序缺陷范围。其他自定义工序绑定的缺陷不能出现在落砂清理报工中。
- 路线后继约束：`0` 个后继生成待入库毛坯，`1` 个后继将 `BlankOutputBatch.nextRoutingNodeId` 指向该节点，`>1` 个直接后继视为配置歧义并阻止清理报工。
- 后续工序必须以有效 `BlankOutputBatch` 为输入队列，保存来源批次和消费关系，沿 `nextRoutingNodeId` 校验当前工序；不能绕过毛坯批次直接读取清理报工累计数。

## 验证情况

已通过：

- `npm --prefix apps/api run prisma:generate`
- `npm --prefix apps/api run build`
- `npm --prefix apps/api run test:material-grades`
- `npm --prefix apps/api run test:recipes`
- `npm --prefix apps/api run test:casting-boms`
- `npm --prefix apps/api run test:process-routings`
- `npm run build:admin`

本地 Docker 已执行最新 `prisma db push`，并完成材质牌号、熔炼配方、铸造 BOM、工序和工艺路线接口回归。工艺路线旧结构迁移已在临时 PostgreSQL 中验证，历史直线路线成功转换为版本、节点和边。管理端已在 `http://127.0.0.1:8081/dashboard/model/operation` 和 `/dashboard/model/routing/new` 完成列表、菜单顺序、拖入节点、配置抽屉和未登录直达保护检查。
