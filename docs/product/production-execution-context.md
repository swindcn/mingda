# 生产工单与熔炼执行开发记录

更新时间：2026-08-26

## 功能范围

新增一级菜单“生产管理”：

- `/dashboard/production/work-orders`：生产工单。
- `/dashboard/production/melt-scheduling`：合炉排产。
- `/dashboard/production/heat-orders`：熔炼执行。
- 小程序 `pages/heat/*`：班组熔炼任务列表、详情和完成填报。

生产工单不提供草稿。提交时后端锁定已生效 BOM 和适用的已生效工艺路线版本，按 BOM 单件重量计算总净重、铁水需求和回料重量；熔炼工序需在工单详情中手动释放后才进入合炉排产池。

## 阶段开发总结

本阶段完成了从生产基础数据到熔炼报工的第一条真实生产闭环：

```text
物料 + 已生效 BOM + 默认工艺路线 + 材质牌号
  -> 提交生产工单并锁定业务快照
  -> 在工单详情手动释放熔炼
  -> 按材质进入待排池
  -> 按整数件拆分或合并生成炉次
  -> 锁定车间、计划熔炉、配方、班组和设备占用时间
  -> 班组在管理端/小程序选择实际熔炉开始生产
  -> 一次或多次转运到浇注包/球化包
  -> 按转运累计重量预填最终完成重量
  -> 完成炉次并回写工单熔炼完成数量与重量
```

关键实现结果：

- 生产工单提交即进入排产池，不保留草稿；缺少 BOM、默认路线、材质或生效配方时由后端明确阻止。
- 工单锁定 BOM、工艺路线、材质和重量快照，主数据后续升版不会改变历史工单。
- 创建工单时只允许选择当前产品状态为 `ACTIVE` 的 BOM；更新时间更晚的草稿不能被自动选择，也不能通过传入草稿版本 ID 绕过。新建或改换 BOM 时，API 在事务内使用与 BOM 生效/停用相同的 advisory lock 重新校验状态，避免并发升版后锁入已停用版本。查看或编辑已有工单时，页面展示工单锁定的 BOM/路线快照，不重新读取产品当前生效版本覆盖历史显示；只修改交期、备注等可编辑字段时，即使工单锁定的旧 BOM 后续已停用，也继续使用历史快照计算，不强制切换当前版本。
- 排产按材质隔离，支持一单多炉、一炉多单和按整数件拆单；设备容量、配方适用设备、车间班组均走真实关系校验。
- 配方的熔炼、转运、清炉时长共同构成设备占用时间，排产冲突采用提示后二次确认，不做绝对阻断。
- 设备概览展示当天全部熔炼设备、炉次占比和 24 小时时间线；待生产炉次支持按 15 分钟吸附调整开始时间和兼容熔炉。
- 实际执行支持计划炉与实际炉防错、多次转运、包设备绑定、累计转运重量、操作人和时间追溯。
- 管理端和小程序共用后端状态机。小程序权限与管理端权限隔离，并叠加执行班组任务关系限制。
- 所有关键动作使用事务、`versionNo` 乐观锁和过程记录，防止管理端旧页面覆盖小程序或其他终端的新数据。
- `meltCompletedQuantity` 表示已经过完成炉次覆盖的工单分配件数，不按实际铁水重量反推合格件数；重量偏差独立保存在炉次和分配记录中，最终合格件数由后续工序报工确定。

本阶段的“完成”只表示熔炼环节完成。生产工单最终完成必须由后续工艺路线运行实例的末节点报工触发，不能在炉次完成时直接将整张工单标记为完工。

## 核心数据关系

```text
Product
  -> CastingBomVersion（锁定材质和重量快照）
  -> ProcessRoutingVersion（锁定节点与前后关系）
  -> WorkOrder
       -> HeatOrderAllocation <- HeatOrder
                                  -> Furnace（计划熔炉）
                                  -> Furnace（实际熔炉）
                                  -> MeltRecipe
                                  -> Team -> TeamMember
                                  -> HeatOrderTransfer -> Furnace（浇注包/球化包）
                                  -> HeatOrderRecord
```

- `WorkOrder` 保存版本外键和业务快照，基础资料升版不影响历史工单。
- `HeatOrderAllocation` 是工单与炉次之间唯一关联，支持一单多炉、一炉多单。
- 排产池不建独立表，通过计划件数减去未撤销炉次分配件数实时生成。
- 炉次完成后按各分配计划重量比例写入实际重量分摊。
- `DocumentSequence` 在数据库事务内生成 `WOYYYYMMDDNNN` 和 `HEAT-YYYYMMDD-NN`。

## 状态规则

工单排产状态：`PENDING / PARTIAL / FULL`。

工单生产状态：`RELEASED / IN_PRODUCTION / MELT_COMPLETED / COMPLETED / CLOSED`。

炉次状态：

```text
WAITING -> IN_PROGRESS -> TRANSFERRING -> COMPLETED
   |
   +-> CANCELED
```

- 尚无有效分配的工单允许修改。
- 部分或全部排产后锁定关键字段。
- 只有待生产炉次允许撤销，撤销后分配数量返回排产池。
- 全部计划件数对应炉次完成后，工单进入“熔炼完成”，不会错误标记为最终完工。
- 最终完工由未来工艺路线末节点报工触发。

## 后端实现

主要文件：

- `apps/api/src/production/production.service.ts`
- `apps/api/src/production/work-order.controller.ts`
- `apps/api/src/production/melt-scheduling.controller.ts`
- `apps/api/src/production/heat-execution.controller.ts`
- `apps/api/src/production/production-permission.guard.ts`
- `apps/api/src/production/production.calculations.ts`

所有编号、容量、剩余件数、状态转换、实际重量分摊均由后端处理。管理端与小程序共用 `ProductionService`，不能在前端复制状态机。

排产、撤销、开工和完工使用事务及 `versionNo` 乐观锁。生成炉次使用可串行化事务并重试并发冲突。

## 权限与任务可见性

- `production.work_order.*`：工单列表、创建、编辑、关闭及同步数据补充权限。
- `production.schedule.*`：排产列表、生成炉次、撤销炉次和调整排程；其中 `production.schedule.adjust` 独立控制待生产炉次的设备/时间调整。
- 管理端熔炼权限使用 `production.heat.view/start/transfer/complete`。
- 小程序熔炼权限独立使用 `mini.production.heat.view/start/transfer/complete`；管理端权限不能替代小程序权限，小程序权限也不能访问管理端接口。
- 工单和管理端炉次接入 `BusinessDataOwnership`。
- 设备排程概览同样按 `production:heat-orders` 数据归属过滤炉次；无权数据不能通过甘特图或设备摘要泄露。
- 小程序炉次采用“功能权限 + 任务关系”双重校验：普通用户必须具有相应 `mini.production.heat.*` 权限，并且属于炉次指定班组。缺少功能权限返回 403，不属于班组时按任务不可见处理。
- 角色权限页根据角色的“应用”字段切换权限树。管理端角色只显示管理端菜单和操作，小程序角色只显示小程序功能；角色切换应用时清空原应用权限，禁止混合保存。
- 小程序登录和 `/auth/me` 返回最新权限，首页“熔炼任务”入口仅在具有 `mini.production.heat.view` 时显示；后端 Guard 仍是最终安全边界。
- 超管可以查看和应急操作全部炉次。

## 当前限制与后续衔接

- 一期人工选择班组，不依赖尚未完善的工厂日历自动匹配。
- 一期只记录开始和完成，不记录加料、光谱、调质和测温中间阶段。
- 后续工序报工应根据 `WorkOrder.routingVersionId` 生成运行节点实例。
- 要求炉批绑定的浇注节点可关联已完成 `HeatOrder.code`，实现炉、包、件追溯。

## 自动化测试

```bash
npm --prefix apps/api run test:production-calculations
npm --prefix apps/api run test:production-execution
npm --prefix apps/miniprogram run test
```

生产接口测试会创建并清理临时产品、BOM、路线、配方、炉子、班组、用户、工单和炉次，只能在本地测试数据库执行。

## 熔炼设备时间占用（2026-08-13）

- 熔炼配方新增 `meltingDurationMinutes`、`transferDurationMinutes`、`cleaningDurationMinutes`，三项均为非负整数且合计必须大于 0。
- 历史配方迁移后默认时长为 0；管理端可以查看，但不能用于新排产。必须先停用配方、补充时长并保存为下一版本后重新生效。
- 炉次保存车间、配方版本、三个时长、总占用时长、自动完成时间和最终完成时间快照。配方后续升级不改变历史炉次。
- 新排产顺序固定为：熔炼车间 -> 设备 -> 配方 -> 班组 -> 计划开始 -> 预计完成。设备与班组必须属于所选启用熔炼车间。
- 自动完成时间等于计划开始加配方总占用分钟，允许人工调整；兼容字段 `plannedOutputAt` 暂时同步保存最终预计完成时间。
- 设备冲突采用左闭右开区间 `[plannedStartAt, plannedFinishAt)`；相邻炉次不冲突，待生产和生产中炉次参与新计划冲突。
- 冲突为软校验：首次提交返回结构化 `409/HEAT_SCHEDULE_CONFLICT`，确认后可继续创建，并在 `HeatOrderRecord.CREATED.payload` 保存确认的冲突清单。
- `GET /admin/production/equipment-schedule` 一次读取车间设备和当日相交炉次，返回空闲设备、跨日裁切区间、冲突标识和炉次摘要，不允许按设备执行 N+1 查询。
- 设备卡片的当前/下一炉次显示容量占比，统一按 `目标铁水重量 / 设备单炉容量 * 100%` 计算，并同时展示排产吨位和单炉容量；超过 100% 使用异常状态提示。
- 合炉排产页底部设备概览不依赖待排工单：排产池为空时仍显示。首次进入默认选择首个有效熔炼车间并自动查询当天数据；后续切换独立筛选条件时由用户点查询刷新，不定时刷新，不反向清空上方排产表单，也不提供快速排产或拖动调整。

数据库迁移：`20260813160000_melt_duration_equipment_occupancy`。已有本地环境若最初通过 `prisma db push` 建库且没有迁移历史，继续使用同版本 Prisma CLI 执行 `prisma db push`；正式受管环境使用 `prisma migrate deploy`。

## 实际熔炉与多次转运（2026-08-14）

- 设备新增字典字段 `equipmentType`，默认值为“熔炼炉”；标准类型为熔炼炉、浇注包、球化包、其他设备。配方和排产只允许引用熔炼炉，转运只允许引用同车间启用的浇注包或球化包。
- `HeatOrder.furnaceCode` 永久保留计划熔炉；开始生产时必须选择实际熔炉并写入 `actualFurnaceCode`。实际炉与计划炉不同时必须二次确认，但仍需满足同车间、配方适用、容量足够和当前未占用。
- 待生产炉次按计划熔炉展示；开始生产后的炉次按实际熔炉计算设备占用、冲突和甘特图归属。活动炉次超过预计完成时间仍保持设备占用，直到完成或撤销。
- 每次转运独立写入 `HeatOrderTransfer`，记录包设备、类型、重量、来源、操作人、时间和备注。首次转运进入 `TRANSFERRING`，之后允许继续追加转运。
- 执行选项接口返回 `targetWeightKg`、`transferTotalWeightKg`、`remainingTransferWeightKg`；可转运数量按“炉批目标重量 - 累计转运重量”计算，最低为 0。转运页面在重量标题右侧展示该值，前后端均禁止本次转运重量超过剩余可转运数量。
- 完成生产只允许从 `TRANSFERRING` 提交；实际出炉重量默认采用转运累计，可人工修改。最终报工重量是产出权威值，转运累计保留为过程追溯值。
- 工单继续按已完成炉次分配件数计算 `meltCompletedQuantity`，并新增 `meltCompletedWeightKg` 汇总已完成炉次最终分摊重量。工单关联炉次同步显示实际熔炉、转运累计、最终重量及开始/完成人时间。
- 管理端合炉排产内容区采用 `3fr/1fr`，右侧最小 400px；侧栏不参与比例计算。窄屏改为单列，计算器六个字段按两列三行排列。
- 小程序开始页支持选择或扫码炉号，转运页支持选择或扫码包号；扫码结果必须命中后端返回的可用设备，不能绕过业务校验。列表和详情统一展示计划开始时间。
- 管理端开始、转运、完成操作在打开弹窗前重新读取最新炉次，提交时继续使用 `versionNo` 乐观锁。若手机端或其他管理端已更新数据，HTTP `409` 会触发统一提示、关闭旧操作并刷新页面；炉次详情在浏览器重新获得焦点时也会自动刷新。
- `TRANSFERRING` 属于活动生产状态：关联工单禁止关闭，设备概览显示“转运中”。开始、转运和完成前重新校验执行班组及熔炼车间仍处于启用状态。

数据库迁移：`20260814090000_heat_transfer_execution`。

## 待生产炉次调整排程（2026-08-14）

- 仅 `WAITING` 炉次允许调整计划，管理端必须具有 `production.schedule.adjust`；移动端仅读取调整后的最新计划，不提供调整入口。
- 管理端炉次详情提供“调整排程”表单。设备排程概览支持 Pointer Events 拖动待生产炉次，可在兼容熔炉行之间移动，时间按 15 分钟吸附，时间轴仍按小时显示。
- 拖动松开后必须确认目标熔炉、计划开始和预计完成时间；取消时不提交接口，炉次恢复原位置。原计划占用时长保持不变，预计完成时间随开始时间等量平移。
- 跨设备调整时，目标设备必须属于原车间、处于启用状态、设备类型为熔炼炉、容量满足炉次目标重量，且当前配方已配置为适用该设备。不满足时前端标红并拒绝放置，后端再次校验。
- 设备占用冲突采用软校验：第一次提交返回结构化 `409/HEAT_SCHEDULE_CONFLICT` 及冲突清单，用户二次确认后携带 `confirmScheduleConflict=true` 重试。
- `PUT /admin/production/heat-orders/:id/schedule` 使用 `versionNo` 乐观锁。服务端在事务内重新读取炉次，非待生产状态或版本不一致返回 409，避免管理端旧页面覆盖小程序或其他终端的新数据。
- 调整成功更新计划/计算完成时间、设备快照并递增 `versionNo`，同时写入 `HeatOrderRecord.SCHEDULE_ADJUSTED`，记录调整前后设备、时间、操作人和已确认冲突。

数据库迁移：`20260814150000_heat_schedule_adjustment`。

## 落砂清理双阶段执行（2026-08-24）

落砂清理沿生产工单锁定路线运行，一个路线节点对应两个内部阶段：

1. 浇注有效报工按 `goodQty × cavityCountSnapshot` 生成 `ShakeBatch`，浇注废品不进入队列。
2. 落砂报工按浇注时间 FIFO 消费待落砂批次，并生成等于落砂合格数的 `CleaningBatch`。
3. 清理打磨按可用时间 FIFO 消费待清理批次，清理合格数生成 `BlankOutputBatch`，废品和浇冒口重量保留在报工追溯中。
4. `BlankOutputBatch` 是后续热处理、机加工、检验或毛坯入库的唯一标准输入；后续模块应创建自己的消费明细和撤销保护。

冷却时长来自锁定路线节点，仅提醒、不做硬卡控。提前落砂必须显式确认，系统保存要求分钟、实际分钟和提前标志。报工设备必须通过设备类型字典、启用状态和路线节点绑定三重校验；缺陷只能来自绑定 `OP-SHAKE` 的启用缺陷代码。

节点状态不等于单次队列状态：上游浇注未结束而当前队列为空时为 `WAITING_POURING`；只有浇注上游结束且待落砂、待清理均清零时才为 `COMPLETED`。当前节点没有后继时毛坯为 `WAITING_WAREHOUSE`，一个后继时保存目标节点，多个后继时拒绝提交并要求修正路线。

一致性规则：

- 客户端每次提交稳定 `requestId`，重试不重复生成报工、消费或毛坯。
- 批次提交最新 `versionNo`；旧页面收到 `409` 后必须原地刷新。
- 报工和撤销使用 `Serializable` 事务，锁顺序为 `MoldingTask -> FIFO 批次`。
- 浇注报工以 `shakeQueueResolution` 持久化待落砂队列解析结果：`PENDING` 为待解析，创建或发现已有批次后为 `CREATED`，撤销、无有效合格数或锁定路线无可达落砂节点时为 `NOT_APPLICABLE`。只有 `PENDING` 属于历史缺口，`NOT_APPLICABLE` 不得阻断详情和报工，也不得因未来路线变化重新入队。
- 历史浇注到待落砂批次的解析只能通过 `npm --prefix apps/api run backfill:shake-batches` 运维命令执行。命令逐页独立提交且可幂等重跑；正常列表保持只读，详情或报工检测到 `PENDING` 历史缺口时返回明确升级提示。
- 撤销必须从下游向上游：先清理、后落砂、再浇注；有有效下游消费时上游撤销接口拒绝。
- 管理端按 `production.shake_clean.*` 权限控制，小程序按 `mini.production.shake_clean.*` 控制，统一叠加 `production:molding_tasks` 数据范围。
- 管理端列表后端分页；小程序列表稳定 cursor。页面动作只根据服务端 `allowedActions` 展示。

主要实现：

- 后端：`apps/api/src/production/shake-clean.queue.ts`、`shake-clean.service.ts`、`shake-clean.controller.ts`。
- 管理端：`apps/admin/src/pages/production/ShakeCleanTaskListPage.tsx`、`ShakeCleanTaskDetailPage.tsx`。
- 小程序：`apps/miniprogram/src/pages/shake-clean/`，修改后必须构建同步到 `dist`。
- 设计文档：`docs/superpowers/specs/2026-08-24-shake-cleaning-execution-design.md`。

## 成品终检执行（2026-08-26）

终检的标准输入为清理阶段生成的有效 `BlankOutputBatch`。`final-inspection.queue.ts` 在清理事务内解析工单锁定路线的下一节点，只有该节点为 `OP-INSP` 时才幂等创建 `InspectionBatch`；历史数据由 `backfill:inspection-batches` 显式回填，列表查询不得写数据。

1. `InspectionReport.goodQty` 生成毛坯入库单、库存批次和 `RECEIPT` 流水。
2. `InspectionReport.reworkQty` 生成清理返修任务；返修合格数生成新 `InspectionBatch`，返修报废数写回炉料流水。
3. `InspectionReport.scrapQty` 生成报废单和回炉料流水。重量默认按工单 BOM 净重计算，客户端未填写时必须省略字段，不能传 `0` 覆盖默认值。
4. 完成条件是待检和返修全部清零、上游执行队列全部完成；工单完成数量以有效毛坯入库单汇总为准。

一致性规则：终检与返修按工单串行锁定，待检批次 FIFO 消费；客户端提交当前批次版本，版本变化返回 `409`。同一工单或返修任务内的 `requestId` 唯一。撤销前检查返修下游和毛坯出库，采用反向库存流水恢复余额，原报告保留审计状态。

系统仓库由 `seed:final-inspection-warehouses` 初始化，编码固定为 `BLANK_WAREHOUSE` 和 `RETURN_MELT_WAREHOUSE`。管理端、小程序共用 `FinalInspectionService` 状态机；页面动作使用服务端 `allowedActions`，API 权限守卫和 `production:work-orders` 数据范围是最终边界。

主要入口：后端 `final-inspection.service.ts/controller.ts/queue.ts/calculations.ts`；管理端 `FinalInspectionTaskListPage.tsx`、`FinalInspectionTaskDetailPage.tsx`；小程序 `pages/inspection/`。

## 工单工艺路线统一执行入口（2026-08-26）

生产工单详情页的“绑定工艺路线预览”已升级为“工艺路线执行”，工单锁定的 `routingVersionId` 是后续生产执行的统一入口。该入口只读取锁定路线和各业务模块已有的真实任务/队列数据，不复制制芯、熔炼、造型、浇注、落砂清理或终检的写入逻辑。

### 工序执行摘要

每一个锁定路线节点返回一行实时摘要，至少包含：

- 工序顺序、工序编码、工序名称。
- 工序状态：`待下达`、`部分下达`、`已下达`、`等待上游`、`未接入`。
- 工序进度：真实任务状态、累计完成量/计划量及业务单位，例如件、箱、公斤；落砂清理在同一节点内展示落砂与清理两个阶段。
- 设备、班组：只展示已经实际下达、排产或执行任务绑定的设备和班组；不能用工艺路线中的“适用设备”冒充已排设备，未产生任务时显示 `-`。
- 操作：根据服务端返回的动作和权限展示“下达任务”“查看任务”或禁用态原因。

工序与执行模块的映射使用明确编码/工段约定：`OP-CORE` 为制芯、`OP-MELT` 为熔炼、`OP-MOLD` 为造型、`OP-POUR` 为浇注、`OP-SHAKE` 为落砂清理、`OP-INSP` 为成品终检。其他工序显示“暂未接入”，不得仅通过相似中文名称推断模块。

### 工序下达和上游驱动

- 制芯和造型下芯继续复用各自已有任务生成接口；一个工序存在多张任务单时显示“部分下达”，全部覆盖后显示“已下达”。
- 电炉熔炼改为工单详情中手动“下达熔炼”。工单新建成功时不会自动进入合炉排产池，也不会自动生成炉次；释放后由调度员继续完成凑吨、设备、配方、班组和开始时间排产。
- 制芯未完成或仍有待烘干数量时只返回软提示，页面需要二次确认，但后端不因该提示阻止熔炼释放。软提示必须展示服务端返回的实际风险内容，不能用固定文案代替。
- 浇注、落砂清理和成品终检由上游报工生成队列，队列未生成时显示“等待上游”，生成后提供“查看任务”，不显示虚假的下达按钮。
- 工序专属任务按钮不再放在工单详情右上角；工单级操作保留在右上角，工序任务的下达与查看统一从路线表格进入。

### 多任务查看与筛选

同一工序可能对应多张制芯任务、多个熔炼炉次或多个下游报工批次。点击“查看任务”统一跳转到对应模块列表，并携带 `workOrderId`：

```text
/dashboard/production/core-tasks?workOrderId=...
/dashboard/production/heat-orders?workOrderId=...
/dashboard/production/molding-tasks?workOrderId=...
/dashboard/production/pouring-tasks?workOrderId=...
/dashboard/production/shake-clean-tasks?workOrderId=...
/dashboard/production/inspection-tasks?workOrderId=...
```

列表后端必须在数据库查询边界按 `workOrderId` 过滤，同时继续叠加当前用户的数据范围；不能先查全量数据再由前端过滤。进入详情后返回列表，应保留工单筛选、状态、关键词和分页上下文。

### 熔炼释放与取消任务语义

熔炼释放使用独立字段 `WorkOrder.meltReleasedAt` 和 `meltReleasedByUserId`：

- 未释放工单不进入合炉排产池；已释放且未关闭、仍有剩余量的工单才进入排产池。
- `production.schedule.release` 仅控制“释放工单进入排产池”，与 `production.schedule.create` 的生成炉次权限分离。
- 释放接口按工单行锁执行，重复点击或重复请求返回当前已释放结果，不重复生成数据、不重复改变时间和操作人。
- 已关闭工单禁止释放；无工单数据范围时不能读取执行摘要或释放熔炼。
- 任务取消不等于从执行历史中删除。已取消的制芯任务和熔炼炉次仍表明该工序曾经下达，摘要状态保持“已下达”，进度显示“已取消”，设备/班组等历史信息可查看但不能被计入当前有效数量或活动设备汇总。
- 是否允许取消后重新生成由对应业务模块的现有唯一约束和状态机决定；本入口不绕过约束、不伪造重新下达。

### 并发、权限和接口约束

- `GET /api/admin/production/work-orders/:id/routing-execution` 返回工单锁定路线的执行摘要。
- `POST /api/admin/production/work-orders/:id/melt-release` 执行熔炼手动释放。
- 摘要读取使用 `production.work_order.view`；节点动作必须再满足对应模块权限，熔炼释放必须满足 `production.schedule.release`。
- 前端隐藏按钮只改善操作体验，后端权限守卫、数据范围和事务校验是最终安全边界。
- 摘要读取只反映提交时数据库状态。页面操作前后都必须重新读取数据；下达、派工和报工继续使用各模块的乐观锁/状态条件更新，旧页面不能覆盖移动端或其他管理端的新状态。
- 事务内的行锁和幂等判断必须覆盖并发双击、网络重试和两个终端同时释放的场景；所有状态、数量、设备、班组和操作记录以服务端为准。

### 数据库迁移与历史回填

- 熔炼释放字段的正式迁移为 `apps/api/prisma/migrations/20260826195000_work_order_melt_release/migration.sql`。受管环境使用 `prisma migrate deploy`；最初通过 `prisma db push` 建库且没有迁移历史的本地环境，按项目现有流程使用同版本 Prisma CLI 执行 `prisma db push`。
- 历史工单需要回填到排产池时，必须显式指定截止时间：`npm --prefix apps/api run backfill:work-order-melt-release -- --before=<ISO timestamp>`，或使用环境变量 `MELT_RELEASE_BACKFILL_BEFORE`。裸执行不得全量释放。
- 回填条件必须包含 `meltReleasedAt IS NULL` 且 `createdAt < cutoff`，输出截止时间和更新数量；按明确截止时间重跑应幂等，避免将回填命令误释放新建工单。
- 上线前先备份数据库并在测试库演练迁移、回填和回滚检查；迁移完成后验证新建工单不进池、历史工单按截止时间进入池、权限和数据范围仍有效。
