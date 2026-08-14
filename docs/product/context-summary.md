# 闽大铸件上下文压缩摘要

> 历史上下文提示：本文包含项目早期的 mock 和后端骨架描述，不能单独作为当前状态依据。接手项目请优先阅读 `docs/product/project-handoff.md`，再把本文作为历史业务规则索引。

本文用于快速恢复项目上下文。继续开发前优先阅读本文，再按需阅读更详细文档：

- `docs/product/development-context.md`
- `docs/product/miniprogram-context.md`
- `docs/product/miniprogram-plan.md`
- `docs/api/backend-plan.md`

## 项目结构

```text
/Users/swindcn/Documents/摩尔元数/闽大铸件
apps/admin         管理端 React + Vite + Ant Design
apps/api           后端 NestJS + Prisma 骨架
apps/miniprogram   微信原生小程序 + TypeScript
docs/product       产品、业务、上下文文档
docs/api           后端规划
```

根脚本：

```bash
npm run dev:admin
npm run build:admin
npm run dev:api
npm run build:api
npm run prisma:generate
npm run prisma:migrate
npm run typecheck:miniprogram
npm run build:miniprogram
```

## 管理端现状

管理端路径：

```text
apps/admin
```

技术栈：

- React
- TypeScript
- Vite
- React Router
- Ant Design
- dayjs
- lucide-react

已完成功能：

- 登录页（早期为模拟登录，当前已接入后端账号密码登录和两小时 token）
- 后台布局，左侧菜单，主内容独立滚动
- 部门管理，含层级部门和第三方同步配置入口
- 用户管理，含组织机构、部门、第三方同步、回收站
- 角色权限，含菜单权限、数据权限、字段权限、授权用户
- 客户管理
- 供应商管理
- 产品管理
- 模具开发列表
- 模具开发详情

重要路径：

```text
/dashboard/departments
/dashboard/departments/help
/dashboard/users
/dashboard/roles
/dashboard/customers
/dashboard/suppliers
/dashboard/products
/dashboard/mold/development
/dashboard/mold/development/:id
```

## 管理端页面标准

二级页面返回：

- 统一用 `apps/admin/src/components/SubPageHeader.tsx`
- 左侧为返回箭头图标按钮
- 不再使用“返回”文字按钮

业务列表：

- 优先使用 `apps/admin/src/components/ResizableTable.tsx`
- 操作列固定右侧
- 列宽支持表头拖拽并保存到 `localStorage`
- 操作按钮使用 `apps/admin/src/components/TableActions.tsx`
- 操作超过 3 个时，第 4 个开始进入“更多”
- 操作数量按当前用户实际有权限看到的操作计算
- 三段紧凑操作列宽建议约 210px

图片上传：

- 管理端统一使用 `apps/admin/src/components/ImageUploadField.tsx`
- 方形缩略图，横向展示
- 只保留虚线方形上传块作为入口，不显示浏览器原生“选择文件 / 未选择任何文件”
- 点击缩略图预览大图
- 可逐张删除
- 上传前前端自动压缩图片：最长边默认 1280px，JPEG 质量默认 0.78
- 后端 JSON 请求体上限已调到 25MB；后续正式文件服务上线前，图片仍暂以字符串数组方式保存
- 发货、收货图片最多 3 张；试模、量产、模具档案、芯盒档案支持多图

布局滚动：

- `body` 是 `overflow: hidden`
- 主内容区域自己滚动
- 不依赖页面 body 滚动

编码规则：

- 通用编码校验在 `apps/admin/src/pages/modeling/ModelingMasterPage.tsx`
- 编码允许数字、英文字母和符号，例如 `. @ # - _`
- 编码禁止中文和空格
- 示例：`SXMJ.000002`、`A@01`、`B#02` 均应通过

列表页状态保持：

- 带页签、筛选状态的一级列表，应把状态写入 URL 查询参数
- 进入二级详情页时，通过 `navigate(..., { state: { from } })` 记录来源地址
- 二级页返回时优先 `navigate(from)`，确保返回一级页后停留在原页签和筛选态
- 模具开发已落地：`/dashboard/mold/development?tab=completed`
- 进行中状态筛选示例：`/dashboard/mold/development?tab=active&status=待确认`

前端权限与安全约束：

- 角色功能权限继续使用树形配置，但每个业务资源的第一项必须是“数据列表”权限。
- “数据列表”权限对应 `*.view` 或历史基础资料中的模块查看权限，只控制列表/详情可见，不代表新增、编辑、删除。
- 新增、编辑、删除、下达、一键生成等操作按钮必须配置独立权限；勾选操作时可自动补选数据列表，取消数据列表时不能保留该资源下的操作权限。
- 页面顶部、筛选区右侧、卡片右上角、表格行、详情页底部等所有按钮都必须走 `hasPermission(...)` 或等价权限判断；按钮不在数据列表上方时也不能绕过角色权限。
- 前端渲染操作按钮前，必须先按当前用户实际权限过滤，再交给 `TableActions` 计算是否显示“更多”。如果过滤后只有 2 个操作，就不能因为资源总操作数大于 3 而显示“更多”。
- 常规资源权限命名规则：`xxx.view` 或历史模块键表示数据列表，`xxx.create` 表示新增/下达，`xxx.edit` 表示编辑/业务推进，`xxx.delete` 表示删除；特殊动作单独命名，例如 `model.schedule.batch`、`basic.user.sync`、`basic.role.config`。
- 基础资料历史模块键继续兼容：`basic.user`、`basic.role`、`basic.customer`、`basic.supplier`、`basic.product`、`basic.dictionary` 表示数据列表；新增、编辑、删除、同步、配置权限必须使用独立权限键。
- 当前基础资料按钮权限包括：`basic.department.create/edit/delete/sync`、`basic.user.create/edit/delete/sync`、`basic.role.create/edit/delete/config/users/copy`、`basic.customer.create/edit/delete`、`basic.supplier.create/edit/delete`、`basic.product.create/edit/delete`、`basic.dictionary.edit`。
- 同一页面有多个数据列表时，每个列表必须建独立资源权限，例如 `basic.product` 与 `basic.product-bom.view` 不能混用。
- 数据行权限区域支持多选：本人、本部门、本部门及下级、自定义部门可以组合使用，用于支持“自己创建的数据 + 分管部门数据”等场景。
- 全组织数据与其他数据范围互斥；选择全组织时代表可见全部业务数据。
- 数据行权限区域增加“包含第三方同步公共数据”复选项。
- 第三方同步公共数据不走“待分配归属”，无法识别业务归属时按公共数据处理；当前物料公共同步数据补充权限为 `basic.product.view_synced_public`。
- 有 `basic.product.view_synced_public` 的角色，可在本人/部门/自定义部门范围外额外查看公共同步物料；全组织数据天然可看全部。
- 一级菜单隐藏不是安全边界，二级路由也必须做登录与权限守卫。
- 所有 `/dashboard/*` 路由必须包在 `RequireAuth` 内。
- `RequireAuth` 不能只信 localStorage；必须调用后端 `/api/auth/me` 验证 token 有效后才渲染页面。
- token 无效、用户被禁用、用户被删除时，应清理 `mingda-admin-token` 和 `mingda-admin-user` 并跳回登录页。
- 登录 token 由后端签名生成，格式为 `db-token-v2.*`，有效期固定 2 小时。
- 旧版长期有效的 `db-token-{userId}` 不再兼容；遇到旧 token 时必须要求用户重新登录。
- token 校验统一走 `apps/api/src/shared/auth-token.ts`，不要在业务代码中手写解析 userId。
- 新增业务页面时，必须通过 `protectedPage('xxx.view', page)` 或等价机制绑定查看权限。
- 新增后端管理接口时，必须使用 `AdminAuthGuard`；资源型建模接口还要叠加资源权限 Guard。后端必须按 HTTP 动作或业务动作校验 `create/edit/delete/sync/config` 等权限，不能只校验数据列表权限。
- `/auth/me` 必须从后端重新返回当前用户最新权限，并覆盖本地 `mingda-admin-user`；角色权限变更后，用户刷新页面即可拿到最新权限，不应依赖旧 localStorage。
- 前端权限只用于体验和减少误操作；真实数据安全以后端 Guard 为准。
- 管理端与小程序端必须使用独立权限命名空间和独立权限树。管理端使用业务键（如 `production.heat.*`），小程序使用 `mini.*`（如 `mini.production.heat.*`），禁止用管理端角色直接授权小程序接口。
- 小程序生产执行必须同时校验功能权限和任务关系。例如熔炼任务需具有 `mini.production.heat.view/start/complete`，并且当前用户属于任务指定班组；菜单显示不能替代接口校验。
- 角色配置弹窗必须根据角色的“应用”字段显示对应权限树。角色从管理端切换为小程序端或反向切换时，不得保留另一应用的权限键。

## 模具开发关键规则

列表下达字段：

- 客户
- 产品
- 客户告知时间
- 模具类型
- 模具供应商
- 期望完成时间
- 跟单人
- 图纸/图片附件
- 备注需求

详情页固定流程节点：

- 开发下达
- 供应商确认
- 供应商发货
- 收货确认

只有提交后才显示在时间线的记录：

- 试模记录
- 量产记录
- 模具评判记录
- 开发中止记录

流程动作：

- 供应商确认：按钮“图纸确认”，弹窗文案“是否确认图纸”，确认后记录确认人、确认时间。
- 供应商发货：按钮“发货”，填写快递单号，上传发货图片，最多 3 张且至少 1 张，记录发货人、发货时间。
- 收货确认：按钮“收货”，上传收货图片，最多 3 张且至少 1 张，记录收货人、收货时间。
- 收货完成后，开发进度流程标题右侧显示三个蓝色主按钮：试模生成、批量生产、模具评判。
- 试模生成和批量生产可多次提交。
- 时间线按次数独立显示，例如：`试模记录（一次）`、`试模记录（二次）`、`量产记录（一次）`。
- 模具评判字段：评判人、评判结果、是否开发完成、评判理由。
- “是否开发完成”放在“评判结果”右侧同一行，默认是。
- 模具评判提交且“是否开发完成”为是后，本单状态为已完成。
- 已完成后不能再提交试模、量产，也不能中止。
- 中止开发在详情页右上角，填写中止理由后状态变为已中止，保留已有过程数据。
- 已中止后不能再推进发货/收货/图纸确认，也不能提交试模、量产、评判。

## 模具开发到建档阶段总结

本阶段目标：

- 打通“模具开发单完成后，生成模具档案与可选芯盒档案”的管理端闭环。
- 开发单用于流程协同和过程记录；模具档案/芯盒档案用于后续生产建模、寿命管理和工装管理。
- 不允许假成功：建档、编辑、删除、关联字段均应走 API 和 PostgreSQL。

关键页面：

```text
管理端模具开发列表        /dashboard/mold/development
管理端模具开发详情        /dashboard/mold/development/:id
管理端模具档案            /dashboard/mold/model
管理端芯盒档案            /dashboard/mold/corebox
```

核心代码位置：

```text
apps/admin/src/pages/mold/MoldDevelopmentPage.tsx
apps/admin/src/pages/mold/MoldDevelopmentDetailPage.tsx
apps/admin/src/pages/modeling/ModelingMasterPage.tsx
apps/admin/src/pages/modeling/modelingConfigs.tsx
apps/admin/src/components/ImageUploadField.tsx
apps/api/src/mold-development.controller.ts
apps/api/src/modeling.controller.ts
apps/api/prisma/schema.prisma
```

模具开发列表规则：

- 列表分为 `进行中 / 已完成 / 已中止` 三个页签。
- 页签状态写入 URL，进入详情再返回时必须保持原页签。
- 已完成、未建档的开发单才显示 `建档` 操作。
- 是否已建档以真实关联为准：优先看开发单 `archivedMoldCode`，并通过模具档案 `sourceMoldDevelopmentCode` 兜底确认。
- 不再使用 `MD001-MOLD -> MD001` 这种编码推断作为来源开发单规则。
- 建档完成后，开发单应不再显示建档按钮。

模具开发详情规则：

- 固定流程节点：开发下达、供应商确认、供应商发货、收货确认。
- 试模、量产、模具评判、中止开发不是固定流程节点；只有提交后才显示为时间线记录。
- 收货完成后才允许试模、量产、模具评判。
- 已完成或已中止后隐藏试模、量产、评判、中止等继续操作按钮。
- 供应商确认、供应商发货由供应商用户操作；收货、试模、量产、评判由跟单人操作。

模具档案字段与交互：

- 基础字段：编码、名称、关联物料、模具供应商、模具类型、规格型号、关联开发单号、型腔数、使用寿命、已用次数、模具图片、状态、备注。
- 关联物料与模具供应商同一行两列显示。
- 模具类型、规格型号、关联开发单号同一行三列显示。
- 型腔数、使用寿命、已用次数同一行三列显示。
- 模具图片放在型腔数/寿命字段下方。
- 关联开发单号允许为空。
- 手工新增时，关联开发单号下拉只显示已完成且未被选择过的开发单。
- 从开发单点击建档时，自动带入开发单信息和关联开发单号。
- 从开发单建档时，模具图片默认带入收货确认图片；允许删除或补充。
- 模具档案和芯盒档案都支持 `查看 / 编辑 / 删除` 操作；查看态必须只读。

芯盒建档规则：

- 模具档案表单底部显示“是否有芯盒”。
- 勾选后展开芯盒资料，随模具档案一起提交。
- 芯盒字段：编码、名称、关联模具、使用寿命、已用次数、芯盒图片、备注。
- 芯盒没有型腔数字段。
- 关联模具自动带入当前模具名称与编码，建立 `物料 -> 模具 -> 芯盒` 关系。
- 从开发单建档时，芯盒图片默认可带入收货确认图片；允许删除或补充。
- 编辑模具档案时，应回填已关联芯盒的编码、名称、寿命、使用次数、图片等信息。
- 编辑芯盒档案时，应显示已分配的编码、芯盒名称和关联模具字段。

后端与数据模型：

- `MoldDevelopment.archivedMoldCode`：开发单已建档后的模具编码标识。
- `MoldMaster.sourceMoldDevelopmentCode`：模具档案关联的开发单号，允许为空。
- `MoldMaster` 保存模具类型、供应商编码、规格型号、图片、型腔数、寿命、已用次数、是否有芯盒。
- `CoreBoxMaster` 通过 `moldCode` 关联 `MoldMaster`，保存芯盒图片、寿命、已用次数。
- `modeling.controller.ts` 的 `/admin/modeling/options` 提供模具档案下拉选项，包括未占用的已完成开发单。
- 新增或编辑模具档案时，`syncCoreBoxForMold` 负责同步创建或更新芯盒档案。
- 删除模具档案时，如果已有关联芯盒，后端会阻止删除，避免破坏关系。

后续修改定位：

- 调整建档字段和布局：优先看 `apps/admin/src/pages/modeling/modelingConfigs.tsx`
- 调整建模通用表单渲染、查看态、图片字段：看 `ModelingMasterPage.tsx`
- 调整开发单是否显示建档按钮：看 `MoldDevelopmentPage.tsx`
- 调整开发详情流程和动作按钮：看 `MoldDevelopmentDetailPage.tsx`
- 调整建档保存、芯盒同步、开发单下拉：看 `apps/api/src/modeling.controller.ts`
- 调整开发单列表返回字段或已建档判定：看 `apps/api/src/mold-development.controller.ts`
- 调整数据库字段：看 `apps/api/prisma/schema.prisma`

## 后端现状

后端路径：

```text
apps/api
```

技术栈：

- NestJS
- Prisma 6.x
- PostgreSQL
- TypeScript

已完成：

- NestJS 应用入口
- `/api` 前缀
- `/api/health`
- CORS
- 全局参数校验
- 统一成功响应格式
- 统一异常响应格式
- Prisma schema 草案

Prisma schema 已覆盖：

- Department
- User
- Role
- UserRole
- Customer
- Supplier
- Product
- MoldDevelopment
- BusinessDataOwnership

后端下一步优先级：

- Auth
- Departments
- Users
- Roles
- 再接 Customers、Suppliers、Products、MoldDevelopments

## 小程序端现状

小程序路径：

```text
apps/miniprogram
```

当前技术选择：

- 微信原生小程序
- TypeScript
- 不使用 Taro / uni-app

Figma Make 参考：

```text
https://www.figma.com/make/zo9WgXvpNGadzIcIy9ImOm/%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F%E7%99%BB%E5%BD%95%E9%A1%B5
```

已确认可读取 Figma Make 源码模块：

- 登录页
- 首页
- 待办列表
- 模具开发列表
- 模具开发详情
- 图纸确认
- 发货
- 收货
- 试模生成
- 批量生产
- 模具评判

已初始化页面：

- `pages/login/index`
- `pages/home/index`
- `pages/todos/index`
- `pages/mold/list/index`
- `pages/mold/detail/index`
- `pages/mold/edit/index`

注意：

- 微信开发者工具读取的是 `apps/miniprogram/dist`
- 源码在 `apps/miniprogram/src`
- 每次改 `src` 后必须运行：

```bash
npm run build:miniprogram
```

否则会出现 `app.json 未找到 pages/login/index.js` 之类错误。

## 当前仍需注意

- 管理端核心资料、模具开发、模具档案、芯盒档案已接入后端和 PostgreSQL。
- 图片目前仍以字符串数组方式保存，尚未接入真实对象存储。
- 快递单号 OCR 尚未实现，当前为手填或前端预留入口。
- 第三方通讯录同步配置已有页面和字段，真实钉钉/企微/飞书同步仍需后续接入。
- 后续新增功能必须避免本地态和假成功，优先补 API、Prisma relation 和权限校验。
