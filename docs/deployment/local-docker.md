# 本机 Docker 开发/测试环境

这套环境用于本机开发和测试，不连接线上 PostgreSQL，也不复用线上 API。

## 服务

- 管理端：admin nginx，访问 `http://localhost:8080`
- API：NestJS，访问 `http://localhost:3000/api`
- PostgreSQL：容器内 `postgres:5432`，本机映射 `localhost:5433`

## 启动

```bash
npm run docker:up
```

首次启动时，API 容器会执行：

```bash
npx prisma db push
```

这会把 `apps/api/prisma/schema.prisma` 同步到本机 Docker PostgreSQL。

## 查看状态

```bash
npm run docker:ps
curl http://localhost:3000/api/health
```

## 登录账号

本地 Docker 数据库首次启动后会由 API 自动初始化管理员：

```text
账号：admin
密码：13665068911
```

## 查看日志

```bash
npm run docker:logs -- api
npm run docker:logs -- admin
npm run docker:logs -- postgres
```

## 停止

```bash
npm run docker:down
```

## 重置本机测试数据库

会删除 Docker volume 中的测试数据：

```bash
npm run docker:down -- -v
npm run docker:up
```

## 注意

- 线上环境继续使用 `http://124.223.2.193`。
- 本机 Docker 环境使用独立数据库，不会影响线上数据。
- 当前项目还没有 Prisma migrations 目录，因此本机开发环境先使用 `prisma db push`。
- 后续 schema 稳定后，建议补正式 migrations，再把 Docker 启动命令改成 `prisma migrate deploy`。
- 当前项目路径包含中文，Docker Desktop 在部分版本中会构建失败。`npm run docker:*` 会先把项目同步到 `/tmp/mingda-casting-docker` 再执行 compose，用于规避该问题。
