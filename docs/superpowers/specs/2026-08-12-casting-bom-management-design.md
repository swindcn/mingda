# 铸造 BOM 管理设计

## 1. 目标与范围

本模块建立适合铸造生产的 BOM 体系，为后续排产、领料、熔炼调度和生产追溯提供稳定主数据。

一期范围：

- 零件物理 BOM 维护。
- 毛坯净重、浇注毛重、工艺收得率和单件回料重量计算。
- 砂芯、铸造辅材、工装耗材等单件用料维护。
- BOM 绑定材质牌号。
- 多版本、草稿、生效、停用、创建新版本和跨产品克隆。
- 根据生产数量计算物理领料、铁水和回料需求的稳定 API。
- 根据材质牌号预览可用熔炼配方。
- 关联生产模具和芯盒工装，供后续排产进行工装齐套与可用性校验。

一期不包含：

- 自制砂芯的多层树状 BOM 展开。
- 工程变更单（ECO）审批流。
- BOM 与具体熔炼配方直接绑定。
- 生产工单、领料单和熔炼任务的正式下达。

## 2. 业务关系

### 2.1 双层 BOM 边界

零件物理 BOM 定义单件铸件所需物理用料和重量参数；熔炼配方定义每吨铁水的原料及辅料配比。两者通过材质牌号衔接，但不直接互相绑定。

```text
Product
  └─ CastingBom
       ├─ CastingBomVersion V1.0 / DISABLED
       │    └─ CastingBomItem[]
       ├─ CastingBomVersion V2.0 / ACTIVE
       │    └─ CastingBomItem[]
       └─ CastingBomVersion V3.0 / DRAFT
            └─ CastingBomItem[]

CastingBomVersion
  ├─ MaterialGrade
  ├─ CastingBomVersionMold[] -> MoldMaster
  └─ CastingBomVersionCoreBox[] -> CoreBoxMaster

MaterialGrade
  └─ MeltRecipe[]（只预览已生效配方）
```

- BOM 的产品和用料全部关联现有 `Product`，不使用历史 `MesItem`。
- 一个产品最多一个 `CastingBom` 主档，可拥有多个版本。
- BOM 版本绑定材质牌号，不绑定具体熔炼配方。
- 排产时可将多个生产单按材质牌号归并铁水需求，再根据设备和炉型选择该材质下的已生效配方。
- 生产单未来必须保存 `bomVersionId`、BOM 版本号及明细快照，不能只读取 BOM 当前版本。

### 2.2 物理用料范围

物理 BOM 明细只允许选择以下一级物料类型：

- `半成品`，砂芯归入 `半成品/砂芯`。
- `铸造辅材`。
- `工装耗材`。

生铁、废钢、回炉料、合金等 `原材料` 由熔炼配方管理，不进入零件物理 BOM；成品也不能作为用料明细。若物料类型字典缺少上述类型，实施时补充字典节点。

### 2.3 生产工装与消耗物料边界

- `MoldMaster` 和 `CoreBoxMaster` 是可重复使用的生产工装，不计入单件物理领料用量。
- `半成品/砂芯` 是生产过程中实际投入或领用的物料，继续维护在 `CastingBomItem` 中，并填写单件标准用量与损耗率。
- 一个 BOM 版本可关联多个生产模具，用于表达主用模、备用模或多套并行模具。
- 一个 BOM 版本可关联多个芯盒；芯盒必须归属于该版本已选的模具。
- 模具选项包含全部状态为启用的模具档案，并显示其关联物料作为选择辅助信息，不按 BOM 产品编码强制过滤。
- 选择模具时自动带入该模具已绑定的启用芯盒，用户可继续手动增删；芯盒选项仅包含已选模具下状态为启用的芯盒。
- BOM 草稿保存时后端重新验证模具、芯盒是否存在且启用，以及芯盒是否属于已选模具，不能只依赖前端过滤。

## 3. 数据模型

### 3.1 CastingBom

- `id`：主键。
- `code`：唯一编码，格式 `BOM-产品编码`。
- `productCode`：关联产品编码，唯一。
- `createdAt / updatedAt`。

### 3.2 CastingBomVersion

- `id`：版本主键，供未来生产单稳定引用。
- `bomId`：关联 BOM 主档。
- `version`：`V1.0 / V2.0 / V3.0`。
- `materialGradeCode`：关联材质牌号。
- `productNameSnapshot`：产品名称快照。
- `netWeightKg`：毛坯净重。
- `grossWeightKg`：浇注毛重。
- `yieldRate`：工艺收得率。
- `returnWeightKg`：单件回料重量。
- `status`：`DRAFT / ACTIVE / DISABLED`。
- `sourceVersionId`：创建新版本或克隆时的来源版本。
- `createdByUserId`：创建人。
- `remark`。
- `createdAt / updatedAt`。

唯一约束：`bomId + version`。

### 3.3 CastingBomItem

- `id`：主键。
- `bomVersionId`：关联 BOM 版本。
- `itemCode`：关联物料编码。
- `itemNameSnapshot`：物料名称快照。
- `itemTypeSnapshot`：物料类型快照。
- `standardQuantity`：单件标准用量。
- `unit`：单位。
- `lossRate`：损耗率。
- `remark`。
- `createdAt / updatedAt`。

唯一约束：`bomVersionId + itemCode`。

### 3.4 CastingBomVersionMold

- `bomVersionId`：关联 BOM 版本。
- `moldCode`：关联模具档案。
- `moldNameSnapshot`：关联时的模具名称快照。
- `createdAt`。

联合主键：`bomVersionId + moldCode`。

### 3.5 CastingBomVersionCoreBox

- `bomVersionId`：关联 BOM 版本。
- `coreBoxCode`：关联芯盒档案。
- `coreBoxNameSnapshot`：关联时的芯盒名称快照。
- `moldCodeSnapshot`：所属模具编码快照。
- `createdAt`。

联合主键：`bomVersionId + coreBoxCode`。

## 4. 计算规则

用户输入毛坯净重和浇注毛重后，前端实时计算，后端保存时重新计算：

```text
工艺收得率 = 毛坯净重 / 浇注毛重 × 100%
单件回料重量 = 浇注毛重 - 毛坯净重
物理用料需求 = 生产数量 × 单件标准用量 × (1 + 损耗率 / 100)
铁水需求重量 = 生产数量 × 浇注毛重
回料重量 = 生产数量 × 单件回料重量
```

校验规则：

- 毛坯净重必须大于 `0`。
- 浇注毛重必须大于或等于毛坯净重。
- 收得率和回料重量为系统计算字段，不信任前端提交值。
- 标准用量必须大于 `0`。
- 损耗率范围为 `0–100%`。
- 同一 BOM 版本不能重复选择同一物料。

## 5. 材质与熔炼配方

- 新建 BOM 时默认带入产品主档的材质牌号。
- BOM 草稿允许修改材质牌号，但不反向修改产品主档。
- BOM 版本保存当时使用的材质牌号，历史版本不随产品主档变化。
- 页面根据所选材质查询全部 `ACTIVE` 熔炼配方，展示配方编码、名称、版本、适用炉型和一吨铁水配比概览。
- 配方预览为空不阻止 BOM 保存或生效，页面提示“当前材质暂无已生效配方”。

## 6. 版本与状态机

```text
首次新建：V1.0 / DRAFT

DRAFT --提交生效--> ACTIVE
ACTIVE --停用--> DISABLED
ACTIVE 或 DISABLED --创建新版本--> 下一版本 / DRAFT
任意版本 --克隆到目标产品--> 目标产品下一版本 / DRAFT
```

- 草稿：查看、编辑、删除、提交生效、克隆。
- 已生效：查看、创建新版本、克隆、停用。
- 已停用：查看、创建新版本、克隆。
- 历史版本不能直接修改。
- 创建新版本复制当前版本及全部用料，生成同一产品的下一主版本。
- 创建新版本同时复制生产模具和芯盒关系。
- 克隆必须选择物料管理中已有的目标产品或半成品，不自动创建物料。
- 跨产品克隆只复制与目标产品匹配的模具及其芯盒；没有匹配工装时目标草稿保持为空，由用户重新选择。
- 目标产品没有 BOM 时生成 `V1.0`；已有 BOM 时生成其下一版本。
- 同一产品同时最多一个 ACTIVE 版本。提交生效时，后端在事务中停用当前 ACTIVE 版本并启用目标草稿。

## 7. 页面设计

菜单位于“工艺管理”，路由为 `/dashboard/model/bom`：

```text
工艺管理
├─ 材质牌号
├─ 熔炼配方
├─ 铸造 BOM
├─ 工艺路线
└─ 缺陷代码库
```

### 7.1 列表

查询条件：

- 产品编码/名称。
- 材质牌号。
- 创建人。
- 状态标签：`全部 / 草稿 / 已生效 / 已停用`。

列表字段：

- 产品编码、产品名称、材质牌号。
- 毛坯净重、浇注毛重、工艺收得率。
- 版本号、状态、创建人、更新时间。
- 操作列：查看、编辑、创建新版本、克隆、停用、删除、提交生效，按状态和权限显示。

列表继续使用 `ResizableTable`，列宽可拖动并持久化，操作列固定右侧；实际可见操作超过三个时交给 `TableActions` 的“更多”菜单。

### 7.2 创建/编辑工作台

复用材质牌号和熔炼配方的大弹窗交互，分为：

1. 产品基本信息与重量参数。
2. 生产工装：生产模具从启用档案中多选；选中后自动带出绑定芯盒，芯盒按已选模具联动过滤且允许手动调整。
3. 零件物理用料明细，砂芯按 `半成品/砂芯` 物料维护单耗。
4. 关联材质的已生效熔炼配方预览。

重量字段实时联动；产品、材质、物料、创建人和配方预览全部来自真实接口。

方案采用独立的模具、芯盒关系表。相比 JSON 字段，该方案具备真实外键、删除约束和排产查询能力；相比 BOM 版本直接保存单个模具/芯盒外键，可支持备用模、多套并行模具及多个芯盒。

## 8. 权限

- `model.bom.view`
- `model.bom.create`
- `model.bom.edit`
- `model.bom.delete`
- `model.bom.clone`
- `model.bom.activate`
- `model.bom.disable`
- `model.bom.new_version`

所有页面按钮按实际授权计算；后端权限守卫是安全边界。角色仅有 `view` 时可看列表和详情，不能执行其他操作。

## 9. API

```text
GET    /admin/modeling/boms
GET    /admin/modeling/boms/options
GET    /admin/modeling/boms/:versionId
POST   /admin/modeling/boms
PUT    /admin/modeling/boms/:versionId
DELETE /admin/modeling/boms/:versionId
POST   /admin/modeling/boms/:versionId/activate
POST   /admin/modeling/boms/:versionId/disable
POST   /admin/modeling/boms/:versionId/new-version
POST   /admin/modeling/boms/:versionId/clone
GET    /admin/modeling/boms/:versionId/calculate?quantity=100
```

列表支持产品、材质、创建人和状态查询。`calculate` 是未来排产、领料和调度模块的稳定计算服务，返回：

- BOM 版本和材质牌号。
- 生产数量。
- 铁水需求重量。
- 回料重量。
- 按明细计算的物理用料需求。
- 当前材质可用的已生效熔炼配方摘要。
- 该 BOM 版本的生产模具和芯盒工装摘要。

`options` 返回启用模具及其产品编码、启用芯盒及其所属模具编码。详情、新增和编辑接口使用 `moldCodes`、`coreBoxCodes` 数组。

## 10. 事务与删除约束

- 新建 BOM 主档和首个版本在事务内完成。
- 创建新版本和克隆必须在事务内计算版本并复制明细。
- 创建新版本复制全部工装关系；跨产品克隆仅复制与目标产品匹配的工装关系。
- 生效操作在事务内停用旧 ACTIVE 并启用新版本。
- 删除仅允许草稿。
- 产品、材质和明细物料均使用真实 Prisma relation。
- 模具和芯盒使用真实 Prisma relation；被任一 BOM 版本引用后不能删除，停用不影响历史版本查看。
- 产品或材质已停用时，历史 BOM 可查看，但新草稿不能提交生效。
- 被未来生产单引用的 BOM 版本必须禁止删除；一期在服务边界中保留引用检查位置。

## 11. 测试计划

1. 新建 `V1.0` 草稿，校验收得率和回料重量。
2. 非法重量、重复用料、非法物料类型被拒绝。
3. 首个版本生效。
4. 创建 `V2.0` 并复制全部明细。
5. `V2.0` 生效时自动停用同产品的旧 ACTIVE。
6. 克隆到无 BOM 的产品生成 `V1.0` 草稿。
7. 克隆到已有 BOM 的产品生成下一版本草稿。
8. 多个产品绑定相同材质，计算结果可按材质牌号汇总铁水需求。
9. 配方预览只返回所选材质的 ACTIVE 配方。
10. 无权限用户的菜单、按钮和 API 被拦截。
11. 未登录访问返回 `401`。
12. 浏览器验证自动计算、状态标签、配方预览、版本操作和固定操作列。
13. 模具下拉显示全部启用模具档案及关联物料；选择模具后自动选择其启用芯盒，并允许手动调整。
14. 提交其他物料关联的有效模具可以保存；提交不属于已选模具的芯盒时后端拒绝。
15. 创建新版本后模具、芯盒关系完整复制。
16. 跨产品克隆只保留目标产品匹配的工装；无匹配工装时保持为空。
17. 被 BOM 版本引用的模具和芯盒不能删除。
