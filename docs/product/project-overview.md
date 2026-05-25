# 闽大铸件项目概括

更新时间：2026-05-25

本文用于快速了解当前项目状态，后续继续开发前建议先阅读本文，再按需查看详细上下文文档。

## Git 状态

当前项目目录不是 Git 仓库：

```text
/Users/swindcn/Documents/摩尔元数/闽大铸件
```

已执行检查：

```bash
git rev-parse --show-toplevel
```

结果：

```text
fatal: not a git repository (or any of the parent directories): .git
```

因此本次不能执行 `git pull`、`git commit`、`git push` 等同步操作。后续如需同步，需要先提供远端仓库地址，或在本目录初始化 Git 仓库后再关联远端。

## 项目定位

闽大铸件是面向铸件行业的业务管理系统。

当前重点是管理端 Web 应用，已开始接入后端 API 和 PostgreSQL 数据库。微信小程序端已初始化，主要用于供应商协同处理模具开发任务。

## 工程结构

```text
apps/admin         管理端，React + TypeScript + Vite + Ant Design
apps/api           后端服务，NestJS + Prisma + PostgreSQL
apps/miniprogram   微信原生小程序，TypeScript
docs               产品、后端、部署和上下文文档
```

常用命令：

```bash
npm run build:admin
npm --prefix apps/api run build
npm run typecheck:miniprogram
```

## 测试环境

服务器：

```text
公网 IP：124.223.2.193
系统：OpenCloudOS 9
项目目录：/opt/mingda-casting
管理端目录：/var/www/mingda/admin
API 服务端口：127.0.0.1:3000
```

访问地址：

```text
管理端：http://124.223.2.193
API：http://124.223.2.193/api
健康检查：http://124.223.2.193/api/health
```

后端已由 systemd 托管：

```bash
systemctl status mingda-api.service
systemctl restart mingda-api.service
journalctl -u mingda-api.service -f
```

PM2 中的旧 `mingda-api` 进程已删除，避免和 systemd 同时抢占 `3000` 端口。

管理员账号：

```text
账号：admin
密码：13665068911
```

## 管理端现状

已完成主要模块：

- 登录
- 部门管理
- 用户管理
- 角色权限
- 字典设置
- 客户管理
- 供应商管理
- 产品管理
- 模具开发列表
- 模具开发详情

主要页面：

```text
/dashboard/departments
/dashboard/departments/help
/dashboard/users
/dashboard/roles
/dashboard/customers
/dashboard/suppliers
/dashboard/products
/dashboard/dictionaries
/dashboard/mold/development
/dashboard/mold/development/:id
```

页面标准：

- 二级页面统一使用 `SubPageHeader`
- 业务列表优先使用 `ResizableTable`
- 操作列固定右侧
- 数据列支持横向滚动
- 列宽支持拖拽调整并保存
- 操作按钮超过 3 个时，第 4 个开始进入“更多”
- 操作数量按当前用户实际权限过滤后的可见操作计算
- 图片上传使用方形缩略图，点击可预览大图

## 后端现状

后端技术栈：

- NestJS
- Prisma
- PostgreSQL
- TypeScript

已完成：

- `/api/health`
- `/api/auth/login`
- `/api/mobile/home`
- `/api/mobile/todos`
- `/api/mobile/molds`
- `/api/admin/molds`
- `/api/admin/departments`
- `/api/admin/users`
- `/api/admin/roles`

登录已返回权限上下文：

- `roles`
- `permissions`
- `dataScope`
- `columnPermissions`

Prisma 已覆盖核心模型：

- Department
- User
- Role
- UserRole
- Customer
- Supplier
- Product
- MoldDevelopment
- MoldDevelopmentFlowRecord
- MoldProductionRecord
- BusinessDataOwnership

当前基础资料接入状态：

- 部门管理：优先读写后端 API，接口异常时保留本地 fallback
- 用户管理：优先读写后端 API，接口异常时保留本地 fallback
- 角色权限：优先读写后端 API，接口异常时保留本地 fallback
- 登录：已接数据库账号和角色权限返回

## 模具开发业务规则

固定流程：

1. 开发下达
2. 供应商确认
3. 供应商发货
4. 收货确认

提交后才显示在时间线的记录：

- 试模记录
- 量产记录
- 模具评判记录
- 开发中止记录

状态规则：

- 已下达到确认之间：待确认
- 已确认到未发货之间：待发货
- 已发货到收货之间：待收货
- 收货到试单/量产之间：待试产
- 有试单、量产、评判数据时：试产中
- 评判设置开发完成时：已完成
- 被中止开发时：已中止

限制规则：

- 已完成后不能再提交试模、量产，也不能中止
- 已中止后不能再发货、收货、确认图纸，也不能提交试模、量产、评判
- 模具开发列表只有已中止状态可以删除
- 删除后小程序端同步删除
- 供应商员工查看模具开发时，不显示客户名称、产品编号

## 小程序端现状

小程序路径：

```text
apps/miniprogram
```

当前规划功能：

- 登录
- 首页
- 我的
- 模具开发任务列表
- 模具开发详情
- 图纸确认
- 发货
- 收货
- 试产
- 量产
- 模具评判

小程序端已经从 mock 数据逐步切到 API，但仍需要继续和后端真实权限、真实用户身份、供应商归属进行联调。

## 当前待办

优先级较高：

- 把客户、供应商、产品也迁移到后端 API 和 PostgreSQL
- 完善用户回收站的后端持久化
- 完善部门同步配置的后端保存和第三方接口预留
- 后端真正校验 token，而不是只返回前端权限上下文
- API 层落地菜单权限、操作权限、数据行权限、字段权限
- 小程序端按供应商员工身份过滤任务
- 小程序真机联调 HTTPS 域名

工程治理：

- 初始化 Git 仓库或关联远端仓库
- 增加部署脚本，避免手动打包上传
- 增加数据库迁移/种子脚本
- 增加基础接口测试

## 相关文档

```text
docs/product/context-summary.md
docs/product/development-context.md
docs/product/miniprogram-context.md
docs/product/miniprogram-plan.md
docs/api/backend-plan.md
docs/deployment/tencent-cloud-test.md
```
