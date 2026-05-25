# 闽大铸件上下文压缩摘要

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

- 登录页，当前是前端模拟登录
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

- 方形缩略图
- 横向展示
- 点击预览大图

布局滚动：

- `body` 是 `overflow: hidden`
- 主内容区域自己滚动
- 不依赖页面 body 滚动

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

## 当前仍是模拟数据

管理端和小程序端大部分业务仍是前端本地状态或 mock 数据：

- 登录认证
- 用户/部门/角色
- 客户/供应商/产品
- 模具开发
- 文件上传
- 图片预览
- 快递单 OCR
- 第三方通讯录同步

下一阶段重点是把后端 API、共享模型、真实文件上传和权限体系串起来。
