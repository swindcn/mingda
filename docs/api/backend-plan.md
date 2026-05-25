# 后端工程规划

## 当前工程

后端工程位于：

```text
apps/api
```

技术栈：

- NestJS
- Prisma
- PostgreSQL
- TypeScript

当前已完成：

- 应用入口
- `/api` 全局前缀
- `/api/health` 健康检查
- CORS 支持本地管理端
- 全局参数校验
- 统一成功响应格式
- 统一异常响应格式
- Prisma Client 集成
- Prisma 数据模型草案

当前本地验证：

```text
GET http://127.0.0.1:3000/api/health
```

响应格式：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": "2026-05-22T00:00:00.000Z"
}
```

## 运行方式

```bash
npm --prefix apps/api install
npm run prisma:generate
npm run dev:api
```

如需连接数据库：

```bash
cp apps/api/.env.example apps/api/.env
npm run prisma:migrate
```

## 数据模型范围

第一版 Prisma schema 已覆盖：

- Department：部门，支持层级
- User：用户，手机号唯一，支持禁用和回收站字段
- Role：角色，支持菜单权限、字段权限、数据权限
- Customer：客户
- Supplier：供应商
- Product：产品
- MoldDevelopment：模具开发
- BusinessDataOwnership：业务数据归属，用于未来数据权限过滤

## 接口模块优先级

第一批：

- Auth：登录、刷新 token、当前用户
- Departments：部门树、部门新增/编辑/删除、第三方同步配置占位
- Users：用户列表、新增/编辑、禁用、回收站、恢复、第三方同步占位
- Roles：角色列表、权限配置、数据权限配置

第二批：

- Customers：客户管理
- Suppliers：供应商管理
- Products：产品管理
- MoldDevelopments：模具开发、详情、流程事件

第三批：

- Files：文件上传和访问
- Sync：钉钉、企业微信、飞书真实同步任务
- AuditLogs：操作日志
- DataPermissions：查询过滤器和权限守卫

## 设计原则

- 前端不保存第三方密钥，密钥由后端安全保存。
- 手机号作为第三方同步用户唯一标识。
- 同步发现离职员工时，将账号设置为禁用，不删除。
- 删除用户进入回收站，保留恢复能力。
- 业务数据权限按数据发起人和所属部门判定。
- 未来小程序端与管理端共用同一后端服务。
