# 工序与工艺路线管理设计

> 交互变更说明（2026-08-12）：实施后已取消固定泳道和区域位置约束，改为自由画布。节点有向边仍是唯一流程依赖依据，`routeType` 仅保留兼容和关键汇合校验。本文后续泳道段落属于原始设计记录。

## 1. 目标与范围

本阶段新增标准工序主档和可视化工艺路线管理，为后续排产、派工、现场报工、质量追溯、成本核算提供结构化基础数据。

一期包含：

- 标准工序主档维护。
- 工艺路线主档和版本管理。
- 一条路线关联多个产品或半成品。
- 路线节点关联多个适用设备。
- 熔炼、制芯、造型主副线并行及浇注汇合建模。
- 受控可视化拖拽编排。
- 草稿、生效、停用状态流转。
- 新版本、克隆和按产品设置默认路线。
- 后端拓扑、引用状态、权限和数据范围校验。

一期不包含：

- 工程变更单审批。
- PDA、生产大屏和现场报工页面。
- 实际炉号、铁水包号、砂芯批次号采集；本期只保存后续执行所需的强制绑定规则。
- 任意节点类型和任意图形语义扩展。

## 2. 业务原则

### 2.1 路线复用

- 工艺路线与产品或半成品是多对多关系。
- 一条通用路线可以被多个产品复用，避免同类铸件逐个维护路线。
- 工艺路线不保存材质牌号。列表和查询中的材质牌号由关联产品实时汇总。
- 物料材质发生变化后，路线无需同步修改材质字段。

### 2.2 默认路线

- 默认关系按产品维度设置，不按整条路线统一设置。
- 同一产品可以关联多条已生效路线，但同一时间只能有一条默认路线。
- 一条路线绑定产品 A、B、C 时，可以只作为 A、B 的默认路线。
- 默认路线必须是已生效版本，且该版本必须关联对应产品。

### 2.3 版本状态

- 路线编号在所有版本间保持稳定，例如 `RT-CAST-01`。
- 路线版本按 `V1.0、V2.0、V3.0` 依次递增。
- 草稿可以编辑和删除。
- 已生效版本不能直接编辑。
- 修改已生效路线时创建新版本，完整复制产品、默认关系、节点、连线和设备关系。
- 新版本生效后，同路线编号的旧生效版本自动停用。
- 旧版本原来承担的产品默认关系自动切换至新生效版本，但仅限新版本仍关联的产品。
- 停用版本保留全部过程配置和引用关系。
- 克隆生成独立路线，版本从 `V1.0` 开始；名称默认增加“复制”，路线编号必须重新填写，产品和默认关系由用户确认。

## 3. 菜单与权限

### 3.1 菜单结构

一级菜单顺序：

1. 模具业务
2. 生产建模
3. 工艺管理
4. 基础资料
5. 知识资源

“工艺管理”子菜单顺序：

1. 材质牌号
2. 熔炼配方
3. 铸造 BOM
4. 工序管理
5. 工艺路线
6. 缺陷代码库

管理端路由：

- `/dashboard/model/operation`：工序管理。
- `/dashboard/model/routing`：工艺路线列表。
- `/dashboard/model/routing/new`：新建路线。
- `/dashboard/model/routing/:id`：查看路线版本。
- `/dashboard/model/routing/:id/edit`：编辑草稿版本。

### 3.2 权限键

工序管理：

- `model.operation.view`
- `model.operation.create`
- `model.operation.edit`
- `model.operation.disable`

工艺路线：

- `model.routing.view`
- `model.routing.create`
- `model.routing.edit`
- `model.routing.delete`
- `model.routing.version`
- `model.routing.clone`
- `model.routing.activate`
- `model.routing.disable`
- `model.routing.default`

“数据列表”权限与操作权限相互独立。页面顶部、画布内部、抽屉和列表操作列的按钮都必须校验对应权限；后端 API 再执行同一权限校验。工序和路线记录接入现有复选数据范围、部门范围和第三方同步数据补充权限规则。

## 4. 数据模型

### 4.1 OperationMaster

标准工序主档：

- `id`
- `code`：工序编码，唯一，遵循项目统一编码规则。
- `name`：工序名称。
- `section`：所属工段，取字典 `operationSections`。
- `reportMode`：`BATCH` 批次报工或 `SINGLE` 单件报工。
- `qualityControlPoint`：默认是否质量控制点。
- `pouringMergePoint`：是否浇注汇合点。
- `status`：`ENABLED` 或 `DISABLED`。
- `remark`
- `createdAt`、`updatedAt`

预置工段字典：熔炼、制芯、造型、浇注、清理、后处理、质检。工段允许通过字典继续增加。

预置工序：

- `OP-MELT`：电炉熔炼，批次报工，熔炼工段。
- `OP-CORE`：射芯制芯，批次报工，制芯工段。
- `OP-MOLD`：造型下芯，批次报工，造型工段。
- `OP-POUR`：合型浇注，批次报工，浇注工段，浇注汇合点。
- `OP-SHAKE`：落砂清理，批次报工，清理工段。
- `OP-INSP`：成品终检，单件报工，质检工段，质量控制点。

### 4.2 ProcessRouting

稳定路线主档：

- `id`
- `code`：路线编号。
- `name`：路线名称。
- `createdAt`、`updatedAt`

路线编号由用户输入，遵循项目统一编码规则。不同版本复用同一路线编号。

### 4.3 ProcessRoutingVersion

- `id`
- `routingId`
- `version`
- `status`：`DRAFT`、`ACTIVE`、`DISABLED`。
- `sourceVersionId`：新版本或克隆的来源版本。
- `remark`
- `createdByUserId`
- `createdAt`、`updatedAt`

`routingId + version` 唯一。同一路线只允许一个 `ACTIVE` 版本，由事务和数据库约束共同保障。

### 4.4 RoutingApplicableProduct

- `routingVersionId`
- `productCode`
- `createdAt`

关联 `Product`，只允许一级类型为成品或半成品的物料。

### 4.5 ProductDefaultRouting

- `productCode`：主键，保证产品默认路线唯一。
- `routingVersionId`
- `updatedAt`

设置新默认路线时使用事务替换旧关系。路线停用时删除其默认关系；新版本生效时按规则迁移旧默认关系。

### 4.6 ProcessRoutingNode

- `id`
- `routingVersionId`
- `operationCode`
- `seqNo`：拓扑顺序号，按 10 递增。
- `routeType`：固定枚举 `MELT_BRANCH`、`CORE_BRANCH`、`MOLD_MAIN`、`MERGE_POINT`、`AFTER_MERGE`。
- `reportEnabled`：是否作为报工采集点。
- `qualityControlEnabled`：是否质检控制点。
- `qualityRequirement`：质检要求说明。
- `requireFurnaceBatch`：需要炉批次绑定。
- `requireLadle`：需要铁水包号绑定。
- `requireCoreBatch`：需要砂芯批次绑定。
- `standardCycleSeconds`：标准节拍秒数。
- `positionX`、`positionY`：画布位置。
- `remark`
- `createdAt`、`updatedAt`

添加工序时从工序主档继承报工和质量默认值。路线节点允许修改报工采集、质检要求、适用设备和标准节拍；工序编码、名称、所属工段和浇注汇合点属性不可覆盖。

### 4.7 RoutingNodeEquipment

- `routingNodeId`
- `equipmentCode`
- `createdAt`

节点与 `Furnace` 设备主档为多对多关系。只允许选择启用设备，前端选项显示设备编码、名称和所属车间。

### 4.8 ProcessRoutingEdge

- `id`
- `routingVersionId`
- `sourceNodeId`
- `targetNodeId`
- `createdAt`

同版本内 `sourceNodeId + targetNodeId` 唯一。所有节点和边使用真实 Prisma relation，不使用 JSON 保存业务关系。

### 4.9 旧数据迁移

现有 `ProcessRouting` 和 `ProcessRoutingStep` 数据转换为新结构：

- 原路线转换为稳定路线主档和 `V1.0` 草稿版本。
- 原 `itemCode` 转换为适用产品关系。
- 原步骤按 `seqNo` 生成节点和相邻边。
- 原 `productionLineCode` 不直接转换为设备；保存在迁移备注中，避免错误绑定。
- 原 `standardHours` 转换为 `standardCycleSeconds = standardHours * 3600`。

## 5. 管理端交互

### 5.1 工序管理

使用现有页面标准：查询按钮、可拖动列宽、固定操作列、超过三个实际授权操作进入“更多”。

列表字段：工序编码、工序名称、所属工段、报工采集模式、是否质量控制点、是否浇注汇合点、状态、更新时间、操作。

被任一路线版本引用的工序不允许删除。禁用不影响历史路线查看，但新路线不能选择，草稿发布时若引用已禁用工序则拒绝发布。

### 5.2 工艺路线列表

查询条件：

- 路线编号或名称。
- 产品编码或名称。
- 材质牌号，通过关联产品查询。
- 路线版本。
- 状态标签：全部、草稿、已生效、已停用。

列表字段：路线编号、路线名称、关联产品/半成品、材质牌号汇总、版本号、默认产品数量、工序总数、状态、创建人、更新时间、操作。

操作包括查看、编辑、新版本、克隆、发布、停用、设置默认和删除草稿，并按权限和状态显示。

### 5.3 工艺路线工作台

工作台为全宽二级页面，沿用项目统一返回样式和标签页状态恢复规则。

顶部基本信息：路线编号、名称、版本、状态、关联产品/半成品多选、备注。

中部工作区：

- 左侧为启用工序库，可按编码、名称和工段搜索。
- 中间为 `@xyflow/react` 受控流程画布。
- 画布固定显示熔炼副线、制芯副线、造型主线、关键汇合、汇合后主线泳道。
- 工序从左侧拖入画布，节点可以在允许的泳道间移动。
- 用户可连接前后节点；系统显示方向箭头。
- 点击节点打开右侧配置抽屉。
- 查看模式复用同一画布，但禁止新增、移动、连线、删除和编辑。

右侧节点抽屉：工序编码、名称、所属工段、路线属性、是否报工采集、是否质检控制、质检要求、适用设备多选、标准节拍、绑定规则和备注。

底部操作：取消、保存草稿、发布生效。

### 5.4 默认路线设置

独立弹窗列出当前路线版本关联的产品。用户勾选该路线作为哪些产品的默认路线。保存时后端事务替换所选产品的旧默认路线；取消某项勾选时只删除当前路线对应的默认关系，不影响其他产品。

## 6. 画布和发布校验

草稿保存允许暂时不完整，但仍校验引用存在、自连接、重复边和跨版本边。发布执行完整校验：

1. 至少关联一个成品或半成品。
2. 至少包含一个工序节点。
3. 节点工序和设备必须存在且启用。
4. 不允许自连接、重复连线和循环依赖。
5. 不允许孤立节点；每个节点都必须属于从某个起点到终点的完整路径。
6. 允许多个起始节点，但只能有一个最终结束节点。
7. `MERGE_POINT` 至少有两个前置节点。
8. 浇注汇合工序强制设置 `MERGE_POINT`，并强制 `requireFurnaceBatch`、`requireLadle`、`requireCoreBatch` 为 true，前端不可关闭，后端覆盖并校验。
9. 同一路线不能同时存在多个已生效版本。

每次保存时对有向无环图执行稳定拓扑排序，按顺序生成 `10、20、30...`。同一拓扑层中的并行节点按 `positionX`、`positionY` 稳定排序。画布坐标用于恢复布局；生产调度和报工依赖以边关系及 `seqNo` 为准。

## 7. API 设计

工序管理：

- `GET /admin/modeling/operations`
- `GET /admin/modeling/operations/options`
- `POST /admin/modeling/operations`
- `PUT /admin/modeling/operations/:id`
- `POST /admin/modeling/operations/:id/disable`

工艺路线：

- `GET /admin/modeling/routings`
- `GET /admin/modeling/routings/options`
- `GET /admin/modeling/routings/:id`
- `POST /admin/modeling/routings`
- `PUT /admin/modeling/routings/:id`
- `DELETE /admin/modeling/routings/:id`
- `POST /admin/modeling/routings/:id/activate`
- `POST /admin/modeling/routings/:id/disable`
- `POST /admin/modeling/routings/:id/new-version`
- `POST /admin/modeling/routings/:id/clone`
- `PUT /admin/modeling/routings/:id/default-products`

接口统一返回 `{ code, message, data }`。详情接口返回路线主档、版本、适用产品、材质牌号汇总、默认产品编码、节点、设备和边。

## 8. 关联模块

- `Product`：提供成品、半成品和材质牌号，作为路线适用范围。
- `MaterialGrade`：不由路线持久化，通过产品关系查询和汇总。
- `Furnace`：作为节点适用设备主档。设备“允许材质”不参与路线判断。
- `CastingBomVersion`：后续排产根据产品取得已生效 BOM，再取得产品默认路线。
- `MeltRecipe`：后续熔炼节点根据产品材质和炉型选择已生效配方。
- `DefectCode`：后续可关联工序主档，本阶段保持现有易发工序文本字段，避免扩大迁移范围。
- 排产与报工：后续优先通过“产品默认路线”解析节点依赖和设备候选集合，不直接解析画布坐标。

## 9. 测试设计

### 9.1 后端自动化测试

- 工序编码唯一、工段字典、状态和引用限制。
- 路线创建、多产品关系、多设备关系和详情回读。
- 材质牌号按关联产品实时汇总。
- 草稿保存允许未完成图，发布拒绝孤立节点、循环、重复边和多个终点。
- 浇注汇合点强制绑定规则。
- 稳定拓扑排序和 `seqNo` 自动生成。
- 同一路线版本递增和单一生效版本。
- 新版本复制节点、边、设备、产品和默认关系。
- 克隆创建独立路线和 `V1.0` 草稿。
- 产品默认路线唯一和事务替换。
- 数据列表权限与操作权限独立。
- 自己、部门、自定义部门、全部和第三方同步数据范围。
- 未登录接口返回 401，无权限操作返回 403。

### 9.2 管理端自动化验证

- 工序列表查询、新增、编辑、禁用和权限按钮。
- 工序从左侧拖入正确泳道。
- 节点移动和连线后保存，刷新详情可恢复布局。
- 节点抽屉可多选启用设备。
- 浇注节点强制显示三项绑定规则且不可关闭。
- 发布错误定位到具体节点或连线。
- 查看模式不可修改。
- 多产品默认路线弹窗正确替换旧默认关系。
- 浏览器前进后退保持列表查询和状态标签。
- 操作列固定、列宽拖动和超过三项操作进入“更多”。

## 10. 实施约束

- 不再沿用通用 `ModelingMasterPage` 的 JSON 工序明细，工序和路线使用专属页面与专属 Controller。
- 流程画布使用成熟的 `@xyflow/react`，不自行实现拖拽和连线引擎。
- 业务关系必须使用 Prisma 外键关系，不使用 JSON 代替节点、设备、产品或边关系。
- 后端是权限、状态和拓扑校验的最终边界；前端隐藏按钮只用于改善交互。
- 所有新增、编辑、版本、发布和默认关系操作必须真实持久化，不允许本地态或假成功。
