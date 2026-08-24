# 合型浇注执行设计

## 1. 目标与范围

本期实现工艺路线中“合型浇注”汇合节点的极简生产执行，将造型下芯产生的待浇砂型批次与熔炼转运产生的具体铁水包次绑定，并通过浇注报工实时扣减待浇箱数和铁水包重量。

本期包含：

- 造型报工生成待浇砂型批次。
- 待浇队列和合型停留预警。
- 具体铁水转运记录与造型任务绑定。
- 多次浇注报工、砂型批次扣减和铁水重量扣减。
- 浇注废品及工序缺陷记录。
- 管理端查看、报工和撤销。
- 小程序浇注报工。
- 炉次、包次、生产工单、造型报工和浇注结果追溯。

本期不包含：

- 质检员双人放行。
- 自动采集铁水重量。
- 浇注后的清理、热处理或终检执行。
- 独立审批流。

## 2. 方案选择

采用显式待浇批次模型。每笔有效造型报工生成一条待浇批次，保存原始箱数、剩余箱数和合型完成时间。浇注报工按先进先出扣减具体批次。

不采用实时聚合造型报工的方案，因为该方案难以安全处理并发扣减、撤销和批次级停留时间。不采用任务级单一余额，因为会丢失每笔造型报工的时间和追溯关系。

## 3. 上下游关系

```text
WorkOrder
  -> locked ProcessRoutingVersion
       -> molding node
       -> melting node
       -> pouring merge node (OperationMaster.pouringMergePoint = true)

MoldingTask
  -> MoldingReport
       -> PouringMoldBatch

HeatOrderAllocation
  -> HeatOrder
       -> HeatOrderTransfer
            -> PouringReport
                 -> PouringMoldConsumption
                 -> PouringReportDefect
```

合型浇注不是独立登记模块。所选造型节点和熔炼工单必须来自生产工单锁定的同一工艺路线版本，并能够沿真实 `ProcessRoutingEdge` 汇合到同一个 `pouringMergePoint` 节点。

## 4. 数据模型

### 4.1 PouringMoldBatch

每笔状态为 `ACTIVE`、合格箱数大于 `0` 的 `MoldingReport` 在同一事务中生成一条待浇批次。

主要字段：

- `id`、`code`
- `sourceMoldingReportId`，唯一
- `moldingTaskId`
- `workOrderId`
- `routingVersionId`
- `pouringRoutingNodeId`
- 工单、产品、模具、造型工序和浇注工序快照
- `originalQuantity`
- `remainingQuantity`
- `closingTime`，取造型报工时间
- `status`：`WAITING / PARTIAL / CONSUMED / CANCELED`
- `versionNo`
- `createdAt`、`updatedAt`

造型废品不进入待浇队列。零数量关闭造型任务不生成待浇批次。

### 4.2 PouringReport

每次浇注报工只绑定一个具体 `HeatOrderTransfer` 和一个 `MoldingTask`，但允许同一包次、同一造型任务分多次报工。

主要字段：

- `id`、`code`
- `requestId`，同一业务范围内唯一
- `heatOrderTransferId`
- `moldingTaskId`
- `workOrderId`
- `pouringRoutingNodeId`
- `stationEquipmentCode` 及设备快照
- `goodQty`
- `scrapQty`
- `theoreticalWeightKg`
- `actualWeightKg`
- `transferBalanceBeforeKg`
- `transferBalanceAfterKg`
- `overdrawWeightKg`
- `holdMinutesSnapshot`
- `holdLevelSnapshot`：`NORMAL / WARNING / CRITICAL`
- `operatorUserId`、操作人快照、报工时间和备注
- `status`：`ACTIVE / REVERSED`
- 撤销人、撤销时间和撤销原因

### 4.3 PouringMoldConsumption

记录一笔浇注报工对具体待浇批次的扣减：

- `pouringReportId`
- `pouringMoldBatchId`
- `quantity`
- `quantityBefore`
- `quantityAfter`

同一浇注报工在后台可以依次消耗同一造型任务下的多笔待浇批次。

### 4.4 PouringReportDefect

保存缺陷代码、名称快照、数量和备注。缺陷代码必须通过 `DefectOperation` 绑定当前合型浇注标准工序。

## 5. 待浇队列

队列按最早仍有余量的 `closingTime` 正序排列，即先完成合型的砂型优先浇注。管理端和小程序可按造型派工单聚合展示，但后台扣减必须保留到具体 `PouringMoldBatch`。

任务级展示字段：

- 造型派工单号
- 产品编码和名称
- 模具名称
- 已造型合格箱数
- 已浇注箱数
- 剩余待浇箱数
- 最早合型时间
- 当前停留时长和预警级别
- 造型任务状态
- 浇注节点执行状态

队列状态：

```text
WAITING -> PARTIAL -> CONSUMED
```

造型来源报工撤销且尚未被浇注时，批次转为 `CANCELED`。已有有效浇注引用时，必须先撤销浇注报工。

## 6. 铁水包匹配与重量

页面选择的是具体 `HeatOrderTransfer`，不能只选择可重复使用的包设备编码。可选择条件：

- 转运记录真实存在。
- 转运设备启用，类型为浇注包或球化包。
- 对应炉次包含所选生产工单的 `HeatOrderAllocation`。
- 炉次材质牌号与生产工单一致。
- 炉次和造型节点能汇合到同一个工艺路线浇注节点。
- 转运记录已产生；炉次处于 `TRANSFERRING` 或 `COMPLETED` 均可继续浇注。

理论重量：

```text
(goodQty + scrapQty) * moldCavityCount * workOrder.unitGrossWeightKg
```

实际重量默认等于理论重量，允许人工修改。铁水包余额按有效浇注报工动态汇总：

```text
transferBalance = HeatOrderTransfer.weightKg - sum(active PouringReport.actualWeightKg)
```

实际重量允许超过当前余额。提交前必须提示超用数量，确认后保存负余额和超用差额，不修改原始转运重量。

## 7. 停留预警

停留时长按任务下最早仍有余量的待浇批次计算：

```text
now - closingTime
```

- 小于 90 分钟：`NORMAL`，绿色。
- 90 至 120 分钟：`WARNING`，黄色，提示优先浇注。
- 超过 120 分钟：`CRITICAL`，红色，提示存在吸潮风险。

本期严重超时不要求质检员或双人确认。提交前进行一次二次确认，并在浇注报工中保存实际停留分钟数和预警级别。

预警实时计算，不依赖定时任务。列表点击查询、小程序下拉刷新或提交校验时重新计算。

## 8. 报工规则

提交前调用检查接口，后端返回：

- 当前待浇余量
- 理论重量
- 当前铁水包余额
- 提交后余额和超用重量
- 当前停留分钟数和预警级别
- 需要确认的警告代码

前端集中展示警告，用户确认后提交警告代码。正式提交时后端必须重新计算，不能信任检查结果。

扣减数量：

```text
goodQty + scrapQty
```

后台按 `closingTime -> id` 固定顺序锁定待浇批次并扣减。浇注数量不得超过造型任务当前待浇余量；铁水重量允许超过包余额。

废品箱数大于 `0` 时：

- 至少选择一个当前浇注工序适用的缺陷代码。
- 缺陷数量之和必须等于废品箱数。
- 同一缺陷代码不得重复。

建议预置浇注缺陷：跑火、浇不足、冷隔、夹渣。具体可选值仍以缺陷代码库为准。

## 9. 工序完成判断

合型浇注节点完成条件：

- 造型任务状态为 `COMPLETED`。
- 该任务全部有效待浇批次的 `remainingQuantity = 0`。

如果当前队列已清空但造型任务仍在生产中，显示“等待后续造型”，不能认定浇注节点完成。

浇注节点完成只表示该工序完成，不直接更新生产工单最终完成数量。后续工序通过浇注报工中的合格数量继续执行；生产工单最终完成仍由工艺路线最后节点决定。

## 10. 撤销与追溯

浇注报工撤销仅在管理端提供：

- 报工状态改为 `REVERSED`，不物理删除。
- 按原 `PouringMoldConsumption` 精确返还待浇批次。
- 铁水包余额通过有效报工重新汇总恢复。
- 缺陷和工序统计排除已撤销报工。
- 保存撤销人、时间和原因。
- 已被后续工序引用的浇注报工禁止撤销。

造型报工撤销前检查有效 `PouringMoldConsumption`。存在引用时返回明确错误，要求先撤销对应浇注报工。

完整追溯链：

```text
HeatOrder
  -> HeatOrderTransfer
  -> PouringReport
  -> PouringMoldConsumption
  -> PouringMoldBatch
  -> MoldingReport
  -> MoldingTask
  -> WorkOrder / Product / BOM / RoutingVersion
```

## 11. 页面与接口

### 11.1 管理端

新增“生产执行 > 合型浇注”：

- 待浇队列、部分浇注、已完成、严重超时标签页。
- 铁水包使用情况。
- 浇注报工记录和详情。
- 查询、报工、查看、撤销。

列表继续使用查询按钮、可拖动列宽、固定操作列和统一 `TableActions`。

### 11.2 小程序

新增“合型浇注”九宫格入口：

1. 选择或扫码浇注工位。
2. 选择或扫码具体铁水包次。
3. 选择待浇造型派工单。
4. 展示剩余箱数、合型停留时长和预警。
5. 录入合格箱数、废品箱数和缺陷。
6. 自动计算理论重量，实际重量可修改。
7. 统一确认超时和铁水超用警告。
8. 提交浇注报工。

### 11.3 API

```text
GET  /admin/production/pouring/queue
GET  /admin/production/pouring/transfers
GET  /admin/production/pouring/reports
GET  /admin/production/pouring/reports/:id
POST /admin/production/pouring/check
POST /admin/production/pouring/reports
POST /admin/production/pouring/reports/:id/reverse

GET  /mini/production/pouring/queue
GET  /mini/production/pouring/transfers
POST /mini/production/pouring/check
POST /mini/production/pouring/reports
```

## 12. 权限与数据范围

管理端权限：

- `production.pouring.view`
- `production.pouring.report`
- `production.pouring.reverse`

小程序权限：

- `mini.production.pouring.view`
- `mini.production.pouring.report`

没有小程序菜单权限时，不显示九宫格入口、待浇数量和相关待办，接口也必须拒绝访问。生产执行人员的数据可见范围以生产工单、执行班组和角色数据范围为基础，不能只依赖前端身份判断。

## 13. 并发与防呆

- 报工使用 `requestId` 保证网络重试幂等。
- 待浇批次使用 `versionNo`。
- 正式提交在可串行化事务中执行。
- 先锁定具体 `HeatOrderTransfer`，再按固定顺序锁定待浇批次。
- 旧页面、重复提交或并发扣减返回 `409`，客户端刷新最新详情。
- 检查接口只用于交互，正式提交必须重新校验全部条件。
- 报工、批次扣减、缺陷和追溯关系整体成功或整体回滚。

## 14. 验收重点

- 一笔造型报工只生成一条待浇批次，造型废品和零数量关单不生成。
- 一次浇注可按先进先出消耗多笔造型报工批次。
- 同一包次和造型任务支持多次浇注。
- 不同工单、不同材质或不同浇注汇合节点不能错误绑定。
- 超时预警随时间和最早剩余批次正确变化。
- 铁水超用经确认后允许提交并保留负余额。
- 浇注废品只能选择当前工序缺陷，数量必须一致。
- 并发提交不能造成待浇箱数重复扣减。
- 撤销准确恢复原待浇批次和铁水包余额。
- 已被浇注引用的造型报工不能直接撤销。
- 造型未结束时，即使当前队列清空也不能提前判定浇注节点完成。
