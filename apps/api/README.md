# @mingda/api

闽大铸件后端服务，当前为 NestJS + Prisma 骨架。

## 运行

```bash
npm --prefix apps/api install
cp apps/api/.env.example apps/api/.env
npm run prisma:generate
npm run dev:api
```

健康检查：

```text
GET http://localhost:3000/api/health
```

## 当前范围

- NestJS 应用入口
- 全局 `/api` 前缀
- CORS 支持本地管理端
- 统一成功响应格式
- 统一异常响应格式
- Prisma 数据模型草案

## 下一步

- 确认 PostgreSQL 连接和 migration
- 增加认证模块
- 增加部门、用户、角色权限模块
- 前端 mock 数据逐步切换为 API 请求
