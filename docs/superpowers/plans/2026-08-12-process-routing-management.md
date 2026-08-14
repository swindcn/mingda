# 工序与工艺路线管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立标准工序主档，以及支持多产品、多设备、主副线汇合、版本和默认路线的可视化工艺路线管理。

**Architecture:** 使用独立 `OperationController` 和 `ProcessRoutingController` 替换通用建模 Controller 中的 JSON 路线实现；Prisma 使用路线主档、版本、产品、默认关系、节点、设备和边的真实外键。管理端使用 `@xyflow/react` 实现固定泳道的受控画布，列表、权限和状态流转沿用材质牌号、熔炼配方和铸造 BOM 的现有模式。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React 19、Ant Design 6、`@xyflow/react`、TypeScript、Playwright CLI。

---

### Task 1: 增加失败的工序与路线接口测试

**Files:**
- Create: `apps/api/scripts/test-process-routings.mjs`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 编写测试夹具与认证请求函数**

测试脚本登录 `admin / 13665068911`，创建两个成品、一个半成品、两台启用设备和六个标准工序，所有编码使用 `TEST-ROUTING-${Date.now()}` 前缀并在 `finally` 中反向清理。

- [ ] **Step 2: 编写核心失败断言**

覆盖以下真实接口行为：

```js
const draft = await request('/admin/modeling/routings', {
  method: 'POST',
  body: JSON.stringify({
    code: routeCode,
    name: '测试通用铸造路线',
    productCodes: [productA, productB, semiProduct],
    nodes: [meltNode, coreNode, moldNode, pourNode, inspectNode],
    edges: [meltToPour, coreToPour, moldToPour, pourToInspect],
  }),
})
assert.equal(draft.version, 'V1.0')
assert.deepEqual(draft.productCodes.sort(), [productA, productB, semiProduct].sort())
assert.equal(draft.nodes.find((node) => node.operationCode === 'OP-POUR').requireFurnaceBatch, true)
```

继续断言循环、孤立节点、多个终点、无效设备发布失败；生效、新版本、默认产品切换和克隆成功。

- [ ] **Step 3: 注册测试命令**

在 `apps/api/package.json` 增加：

```json
"test:process-routings": "node scripts/test-process-routings.mjs"
```

- [ ] **Step 4: 运行测试并确认 RED**

Run: `npm --prefix apps/api run test:process-routings`

Expected: FAIL，`/admin/modeling/operations` 或新版 `/admin/modeling/routings` 接口不存在。

### Task 2: 建立 Prisma 真实关系与迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260812090000_process_routing_v2/migration.sql`

- [ ] **Step 1: 修改 Prisma 模型**

新增 `OperationMaster`、`ProcessRoutingVersion`、`RoutingApplicableProduct`、`ProductDefaultRouting`、`ProcessRoutingNode`、`RoutingNodeEquipment`、`ProcessRoutingEdge`；将 `ProcessRouting` 改为稳定主档。关键唯一约束：

```prisma
model ProcessRoutingVersion {
  id        String @id @default(cuid())
  routingId String
  version   String
  status    String @default("DRAFT")
  routing   ProcessRouting @relation(fields: [routingId], references: [id], onDelete: Cascade)
  products  RoutingApplicableProduct[]
  nodes     ProcessRoutingNode[]
  edges     ProcessRoutingEdge[]
  @@unique([routingId, version])
  @@index([status])
}

model ProductDefaultRouting {
  productCode     String @id
  routingVersionId String
  product         Product @relation(fields: [productCode], references: [code], onDelete: Cascade)
  routingVersion  ProcessRoutingVersion @relation(fields: [routingVersionId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: 编写旧路线迁移 SQL**

将旧路线复制为路线主档和 `V1.0/DRAFT` 版本；旧步骤转换为节点并按 `seqNo` 生成相邻边；`standardHours * 3600` 转换为秒。先重命名旧表，再创建新表，迁移完成后删除旧表。

- [ ] **Step 3: 生成 Prisma Client 并验证 schema**

Run: `npm --prefix apps/api run prisma:generate`

Expected: Prisma Client generated successfully。

- [ ] **Step 4: 应用本地迁移**

Run: `DATABASE_URL=postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public npm --prefix apps/api run prisma:migrate`

Expected: migration applied successfully，既有基础资料保留。

### Task 3: 实现标准工序 API

**Files:**
- Create: `apps/api/src/operation.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`
- Modify: `apps/api/src/basic-data.controller.ts`
- Modify: `apps/api/src/mold-development.controller.ts`

- [ ] **Step 1: 注册工序权限和资源识别**

权限映射：`operations -> model.operation`；`disable` 动作识别 `/operations/:id/disable`。管理员默认权限加入 `view/create/edit/disable`。

- [ ] **Step 2: 实现工序 CRUD 和禁用**

Controller 提供列表、选项、新增、编辑、禁用。编码执行统一编码校验；所属工段必须存在于 `operationSections` 字典；被引用工序不删除，禁用后历史关系可读。

- [ ] **Step 3: 初始化工段字典和六个标准工序**

使用幂等 `upsert`，只在目标编码不存在时创建，不覆盖用户修改的数据。

- [ ] **Step 4: 运行接口测试确认工序部分通过**

Run: `npm --prefix apps/api run test:process-routings`

Expected: 工序测试通过，路线接口仍失败。

### Task 4: 实现路线拓扑、版本和默认关系 API

**Files:**
- Create: `apps/api/src/process-routing/process-routing.types.ts`
- Create: `apps/api/src/process-routing/process-routing.graph.ts`
- Create: `apps/api/src/process-routing/process-routing.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modeling.controller.ts`
- Modify: `apps/api/src/shared/modeling-permission.guard.ts`

- [ ] **Step 1: 实现纯函数图校验和稳定拓扑排序**

`validateAndOrderGraph(nodes, edges, publishing)` 返回按拓扑排序更新后的节点；使用 Kahn 算法拒绝循环。发布态校验孤立节点、单一终点和汇合点至少两个前置节点，`seqNo` 按 10 递增。

- [ ] **Step 2: 实现 DTO 规范化和引用校验**

只允许成品或半成品；工序、设备必须存在。草稿允许停用引用继续保存历史，但发布要求全部启用。浇注汇合节点后端强制三个绑定标志为 true。

- [ ] **Step 3: 实现列表、选项、详情、新增和草稿编辑**

详情返回：

```ts
{
  id, routingId, code, name, version, status,
  productCodes, products, materialGrades, defaultProductCodes,
  nodes: [{ id, operationCode, operationName, routeType, equipmentCodes, positionX, positionY }],
  edges: [{ id, sourceNodeId, targetNodeId }]
}
```

- [ ] **Step 4: 实现发布、停用、新版本和克隆事务**

发布使用 PostgreSQL advisory lock 锁定路线编号；新版本按最大主版本递增；新版本发布后停用旧版本并迁移仍适用产品的默认关系；克隆要求新路线编号并生成 `V1.0/DRAFT`。

- [ ] **Step 5: 实现默认产品事务**

`PUT /:id/default-products` 只接受当前已生效版本已关联的产品编码，使用 `ProductDefaultRouting.upsert` 替换旧默认关系，并删除用户取消的本版本默认项。

- [ ] **Step 6: 移除通用 Controller 的旧 routings 分支**

删除 `ModelingController` 中旧 `routings` 资源配置、JSON 步骤创建/更新和 DTO 分支，避免路由冲突和双写。

- [ ] **Step 7: 运行路线接口测试确认 GREEN**

Run: `npm --prefix apps/api run test:process-routings`

Expected: 输出 `{ "ok": true, ... }`，测试数据残留为 0。

### Task 5: 完善权限树、菜单和前端 API 类型

**Files:**
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/src/utils/roles.ts`
- Modify: `apps/admin/src/layouts/AppLayout.tsx`
- Create: `apps/admin/src/utils/operations.ts`
- Create: `apps/admin/src/utils/processRoutings.ts`

- [ ] **Step 1: 安装流程画布依赖**

Run: `npm --prefix apps/admin install @xyflow/react`

Expected: package lock 更新，依赖安装成功。

- [ ] **Step 2: 更新权限树**

新增工序权限和路线 `version/clone/activate/disable/default` 权限；保留 `model.routing.delete`，但前后端只允许删除草稿版本。系统管理员默认拥有全部新增权限。

- [ ] **Step 3: 调整菜单顺序**

工艺管理中新增“工序管理”；将“基础资料”放在“知识资源”之前。保持现有图标库和菜单权限过滤。

- [ ] **Step 4: 定义前端接口类型和请求函数**

`operations.ts` 负责工序列表和编辑；`processRoutings.ts` 负责列表、详情、版本动作、默认产品和画布 DTO，不在页面内拼接接口。

### Task 6: 实现工序管理页面

**Files:**
- Create: `apps/admin/src/pages/modeling/OperationManagementPage.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: 实现标准列表和查询区**

使用 `ResizableTable`、`TableActions`、查询按钮和固定操作列。字段与设计文档一致，状态使用标签。

- [ ] **Step 2: 实现新增编辑弹窗**

所属工段取 `operationSections` 字典；报工模式使用下拉；质量控制点和浇注汇合点使用开关。顶部和行操作分别受权限控制。

- [ ] **Step 3: 实现禁用确认**

已禁用记录不再显示禁用按钮；禁用走真实接口并刷新列表。

- [ ] **Step 4: 注册受保护路由**

`/dashboard/model/operation` 使用 `model.operation.view`，未登录和无权限均不能访问。

### Task 7: 实现工艺路线列表和工作台

**Files:**
- Create: `apps/admin/src/pages/modeling/ProcessRoutingListPage.tsx`
- Create: `apps/admin/src/pages/modeling/ProcessRoutingWorkbenchPage.tsx`
- Create: `apps/admin/src/pages/modeling/routing/OperationLibrary.tsx`
- Create: `apps/admin/src/pages/modeling/routing/RoutingCanvas.tsx`
- Create: `apps/admin/src/pages/modeling/routing/RoutingNode.tsx`
- Create: `apps/admin/src/pages/modeling/routing/RoutingNodeDrawer.tsx`
- Create: `apps/admin/src/pages/modeling/routing/DefaultProductsModal.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: 实现路线列表**

查询支持关键词、产品、材质、版本和状态标签；表格字段、固定操作列、权限按钮及状态规则按设计文档实现。

- [ ] **Step 2: 实现五泳道受控画布**

使用 `ReactFlowProvider`、自定义节点和 `smoothstep` 边。泳道固定，拖入工序时按工段给出默认路线属性；节点拖动后保存坐标；只允许同版本节点连线。

- [ ] **Step 3: 实现节点配置抽屉**

显示只读工序信息，允许配置路线属性、报工、质检要求、设备多选、节拍和备注。浇注汇合点锁定路线属性和三项绑定规则。

- [ ] **Step 4: 实现保存与发布错误定位**

将 React Flow 节点和边转换为 API DTO。接口返回节点错误时选中节点并打开抽屉；边错误时在画布提示对应连接。

- [ ] **Step 5: 实现查看、新版本、克隆和默认产品**

查看模式禁用画布变更；新版本进入复制后的草稿；克隆要求新编号和名称；默认产品弹窗仅列出当前版本关联产品。

- [ ] **Step 6: 注册路由并移除旧通用页面**

注册列表、新建、查看、编辑四个受保护路由，删除 `modelingConfigs.tsx` 中旧工艺路线 JSON 配置，修正后续配置索引引用为按 resource 查找。

### Task 8: 文档、构建和端到端验证

**Files:**
- Modify: `docs/product/modeling-context.md`
- Modify: `docs/product/modeling-test-cases.md`
- Modify: `README.md`

- [ ] **Step 1: 更新长期项目规则**

记录标准工序、路线多产品、多设备、默认路线、版本、画布与拓扑边界，以及未来排产通过产品默认路线解析工序依赖。

- [ ] **Step 2: 运行完整后端测试**

Run:

```bash
npm --prefix apps/api run test:process-routings
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:recipes
npm --prefix apps/api run test:material-grades
npm run test:permissions
npm run build:api
```

Expected: 全部退出码 0。

- [ ] **Step 3: 运行管理端验证**

Run:

```bash
npm run build:admin
npm --prefix apps/admin run lint
```

Expected: 构建和 lint 退出码 0；仅允许已有 chunk size 警告。

- [ ] **Step 4: 更新本地 Docker 服务**

重建失败时使用已验证的 `docker cp dist` 方式更新容器，并确认 `/api/health` 返回 200。

- [ ] **Step 5: 使用 Playwright 验证主流程**

登录本地管理端，创建草稿路线，拖入三条前置线和浇注汇合节点，连线，配置多设备，发布，设置两个产品默认路线，刷新后确认布局与关系恢复。验证无权限用户看不到新增、发布和默认按钮。

- [ ] **Step 6: 检查测试残留和未登录保护**

确认数据库中无 `TEST-ROUTING-*` 数据；未登录请求工序与路线接口返回 401；直接访问工作台子链接跳转登录页。
