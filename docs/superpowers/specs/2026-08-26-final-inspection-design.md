# 成品终检与毛坯入库设计

## 目标

在落砂清理完成后，以 `BlankOutputBatch` 作为唯一上游输入，建立成品终检、清理返修、报废回炉和毛坯入库的真实持久化闭环。终检必须支持多次报检、移动端执行、并发防重和完整批次追溯。

本期不支持让步接收，不引入质量审批流。

## 业务边界

- 终检判定只有合格、返修、报废三种。
- 合格数量进入系统内置的“铸件毛坯库”。
- 报废数量生成报废单，报废回炉重量进入系统内置的“回炉料仓”。
- 返修作为终检内部的清理返修闭环，不在工艺路线上增加回退边。
- 小程序提供待检查看和终检报工，不提供撤销。
- 管理端提供查看、报工、返修处理和有权限的撤销操作。

## 上下游关系

```text
CleaningReport
  -> BlankOutputBatch
  -> InspectionBatch
  -> InspectionReport
       |- 合格 -> BlankWarehouseReceipt -> BlankInventoryBatch/Ledger
       |- 返修 -> CleaningReworkTask -> CleaningReworkReport -> 新 InspectionBatch
       `- 报废 -> ScrapWriteOff -> ReturnMeltInventoryLedger
```

终检只消费状态有效且下一节点为工单锁定路线版本中 `OP-INSP` 的 `BlankOutputBatch`。终检不得重新查询当前生效工艺路线替换工单锁定版本。

## 数据模型

### 系统仓库与库存

- `SystemWarehouse`：一期内置 `BLANK_WAREHOUSE`（铸件毛坯库）和 `RETURN_MELT_WAREHOUSE`（回炉料仓）。
- `BlankInventoryBatch`：按终检报告生成毛坯库存批次，保存产品、工单、数量、来源终检报告和快照。
- `BlankInventoryLedger`：毛坯库存不可变流水，保存数量变化、变化后结存、来源和操作人。
- `BlankWarehouseReceipt`：合格毛坯入库单，与终检报告一对一关联。
- `ScrapWriteOff`：终检报废单，与终检报告一对一关联。
- `ReturnMeltInventoryLedger`：回炉料重量不可变流水，以 kg 记录。

### 终检

- `InspectionBatch`：待检队列，保存来源毛坯批次或返修报告、原始数量、剩余数量、工单、路线版本和终检节点快照。
- `InspectionReport`：保存请求幂等键、合格数、返修数、报废数、回炉重量、质检员、时间、状态和乐观锁版本。
- `InspectionBatchConsumption`：保存每次报检对具体待检批次的 FIFO 消费前后数量。
- `InspectionReportDefect`：真实关联已启用且绑定 `OP-INSP` 的缺陷代码。
- `InspectionReportImage`：缺陷图片，当前最多一张。

### 清理返修

- `CleaningReworkTask`：由终检返修数量生成，保存来源终检报告、产品、工单、待返修数量和状态。
- `CleaningReworkReport`：保存返修合格数、返修报废数、操作人、时间和设备。
- 返修合格数量生成新的 `InspectionBatch`，并保留对原返修任务和首次终检的关联。
- 返修报废数量生成对应报废及回炉料流水，不再进入终检队列。

## 数量与状态规则

- 同一待检批次支持多次报检。
- 单次报检数量必须满足：

```text
合格数 + 返修数 + 报废数 > 0
合格数 + 返修数 + 报废数 <= 当前剩余待检数
```

- 缺陷数量总和不能超过返修数与报废数之和。
- 报废回炉重量默认值为 `报废件数 * 工单锁定 BOM 的毛坯净重`，允许质检员修改，最终按提交值入账。
- 所有数量、入库、返修、报废和流水写入必须在同一个数据库事务内完成。
- 每次写操作携带 `requestId` 防止重复提交，并携带 `versionNo` 防止管理端与小程序覆盖新数据。
- 当待检批次剩余数量为零时转为已消费；存在待返修、返修中或返修后待检数量时，终检节点仍未完成。
- 终检节点无后继节点时，所有待检和返修闭环处理完毕后，以累计合格入库数量更新工单完成数量；满足工单结束条件后将工单状态置为 `COMPLETED`。
- 若终检节点存在后继节点，则终检合格批次保留后继流转信息，不自动关闭工单。

## 撤销规则

- 只有管理端且具备终检撤销权限的用户可以撤销，必须填写原因。
- 撤销前锁定终检报告、待检批次、入库批次、返修任务和报废流水。
- 已发生毛坯出库、返修报工、返修后二次终检或其他下游消费时，禁止撤销并返回明确原因。
- 可撤销时，恢复待检数量，冲销毛坯库存和回炉料流水，取消未执行返修任务，并记录撤销人、时间及原因。

## 权限

管理端：

- `production.inspection.view`
- `production.inspection.report`
- `production.inspection.reverse`
- `production.cleaning_rework.view`
- `production.cleaning_rework.report`

小程序：

- `mini.production.inspection.view`
- `mini.production.inspection.report`
- `mini.production.cleaning_rework.view`
- `mini.production.cleaning_rework.report`

菜单、路由、按钮和 API 分别校验权限，后端是最终安全边界。

## 页面与接口

### 管理端

- `生产执行 / 成品终检`：待检、检验中、返修中、已完成页签。
- 终检详情展示来源清理批次、终检记录、返修记录、入库单和回炉料流水。
- 终检报工使用数量步进器、一键全部合格、缺陷选择和单图上传。
- 落砂清理模块增加清理返修任务入口和返修报工。

### 小程序

- 首页九宫格增加受权限控制的“成品终检”。
- 支持待检列表、详情、选择或扫描批次、数量快捷调整、缺陷选择及拍照/选图。
- 清理返修任务在落砂清理入口内展示和处理。

### API

- 管理端统一挂载 `/admin/production/inspection-*` 和 `/admin/production/cleaning-rework-*`。
- 小程序统一挂载 `/mini/production/inspection-*` 和 `/mini/production/cleaning-rework-*`。
- 返回格式继续使用项目统一的 `{ code, message, data }`。

## 验证要求

- 清理合格批次只能生成一次待检队列。
- 多次报检、并发提交和重复请求不超扣、不重复入库。
- 合格入毛坯库、返修重新待检、报废入回炉料仓均为真实数据库事务。
- 缺陷只能选择绑定 `OP-INSP` 的启用代码。
- 撤销能够完整冲回尚未被下游消费的数据；存在下游消费时必须拒绝。
- 终检完成后工单完成数量、状态、操作人与时间保持一致。
- 管理端和小程序使用同一 API 业务规则，不在前端复制状态机。
