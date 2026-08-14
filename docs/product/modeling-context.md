# 生产建模模块开发记录

更新时间：2026-08-12

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
- 模具、芯盒属于可重复使用的生产工装，不计入物理领料单耗。BOM 版本可从全部启用的模具档案中多选生产模具；选择模具后自动带入其已绑定的启用芯盒，芯盒仍允许手动增删调整。砂芯仍在物理用料明细中维护单件标准用量和损耗率。
- 同一产品同一时间只能有一个 `ACTIVE` 版本。新版本以现有版本为模板复制为下一主版本草稿；新版本生效时，事务内将同产品旧生效版本改为已停用。
- 首版创建、版本号分配和生效切换使用 PostgreSQL 产品维度事务锁，避免并发请求生成重复版本或出现多个已生效版本。
- 草稿可编辑、删除、提交生效；已生效可查看、停用、创建新版本和跨产品克隆；已停用可查看、创建新版本和跨产品克隆。
- 草稿允许跨产品克隆，但已产生派生版本的来源草稿不能删除；创建新版本只允许以已生效或已停用版本为来源。
- 跨产品克隆必须选择已存在的成品或半成品，不自动创建物料。目标产品无 BOM 时生成 `V1.0`，已有 BOM 时生成下一版本草稿，并保存来源版本关系。
- 同产品创建新版本时复制全部模具和芯盒关系；跨产品克隆只复制档案关联物料与目标产品匹配的工装，没有匹配工装时目标草稿保持为空。
- 后端以净重和浇注毛重重新计算：`工艺收得率 = 净重 / 毛重 × 100%`，`单件回料重量 = 毛重 - 净重`，不能信任前端计算值。
- 稳定计算接口为 `GET /admin/modeling/boms/:id/calculate?quantity=N`，返回铁水需求、回料重量、含损耗的物理用料需求，以及同材质当前可用的已生效熔炼配方摘要。
- 计算接口同时返回生产模具与芯盒摘要，供后续排产做工装齐套检查，但工装不参与物理用料数量计算。
- 未来生产工单、制令单、领料和调度模块必须保存 `bomVersionId`、BOM 版本号及下达时明细快照，不能只通过产品读取当前生效版本，避免历史单据随 BOM 升版变化。
- 当前物料主档尚未提供启用/停用生命周期，现有物料均按可用处理；未来增加物料停用状态时，BOM 生效接口必须同步校验主物料状态。材质牌号停用校验本期已生效。

### 工序与工艺路线规则

- 工序是独立主档，工段来自字典 `operationSections`。工序禁用后保留历史路线关系，但新路线不可选择；同一状态权限可重新启用。
- 一条路线可绑定多个成品或半成品；材质牌号由关联产品聚合展示，不冗余保存在路线中。
- 路线详情分为“工艺线路”和“适用产品”两个标签页。工序节点、连接关系、设备和工艺参数属于版本化内容；适用产品是独立维护范围，不因新增或移除产品触发路线升版。
- 草稿和已生效路线可通过 `PUT /admin/modeling/routings/:id/applicable-products` 直接增减适用产品；已停用历史版本只读。移除当前默认产品时，同一事务内取消其 `ProductDefaultRouting` 关系。
- 适用产品调整只影响后续路线选择。已创建生产工单保存了 `routingVersionId` 和路线快照，不随适用范围变化。
- 每个节点关联一个标准工序，可多选适用设备，并保存路线属性、报工点、质检要求、标准节拍和生产绑定规则。
- 路线工作台采用受控可视化拖拽，分为熔炼副线、制芯副线、造型主线、关键汇合和汇合后主线。节点和连线都是真实 Prisma relation。
- 后端拒绝自环、重复边和循环。发布时还要求节点全部可达、仅有一个终点，汇合节点至少有两个前置，并按拓扑顺序生成 `10/20/30...` 工序号。
- 浇注汇合工序强制转为关键汇合节点，强制炉批次、铁水包号和砂芯批次绑定，为后续 PDA 报工防错提供依据。
- 路线编码稳定，版本按 `V1.0/V2.0/V3.0...` 升级。新版本发布时自动停用同编码旧生效版本，并迁移仍属于新版本产品范围的默认关系。
- 克隆生成新路线编码和 `V1.0` 草稿，复制产品、节点、设备和边，不复制默认产品关系。
- 同一产品可有多条已生效替代路线，但 `ProductDefaultRouting` 保证同一时间只有一条默认路线。
- 所有详情和状态操作先校验 `modeling:routings` 数据归属，不允许通过已知 ID 越权查看或修改。
- 数据库迁移先将旧 `ProcessRoutingStep` 直线数据转为 `V1.0` 节点和有向边，然后才删除旧结构，不丢失历史路线。

关键关联规则：

- 产线、班组、设备和排班引用车间编码。
- 熔炼配方引用材质牌号编码。
- 模具档案引用物料；工艺路线版本通过 `RoutingApplicableProduct` 多选成品/半成品。
- 路线节点引用工序主档，通过 `RoutingNodeEquipment` 多选设备。
- 芯盒档案引用模具编码。
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
