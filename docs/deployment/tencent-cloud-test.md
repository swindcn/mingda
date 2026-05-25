# 腾讯云测试环境部署说明

## 目标结构

- Nginx 对外提供 HTTP 访问。
- 管理端静态文件放到 `/var/www/mingda/admin`。
- API 服务运行在 `127.0.0.1:3000`。
- Nginx 将 `/api` 反向代理到 API。

## 服务器依赖

当前测试服务器：

```text
公网 IP：124.223.2.193
系统：OpenCloudOS 9
项目目录：/opt/mingda-casting
管理端静态目录：/var/www/mingda/admin
API systemd 服务：mingda-api.service
```

基础依赖：

```bash
nginx
postgresql
node v22
```

当前已使用 PostgreSQL 持久化基础数据和模具开发数据。

## API 环境变量

在服务器项目目录创建：

```bash
cp apps/api/.env.test.example apps/api/.env
```

修改：

```text
PORT=3000
CORS_ORIGIN=http://服务器公网IP
```

## 构建

```bash
npm --prefix apps/api install
npm --prefix apps/admin install
npm run build:api
npm run build:admin
```

## 启动 API

```bash
systemctl restart mingda-api.service
```

验证：

```bash
curl http://127.0.0.1:3000/api/health
```

查看日志：

```bash
journalctl -u mingda-api.service -f
```

当前 API 不再使用 PM2 托管。PM2 中旧的 `mingda-api` 已删除，避免和 systemd 同时抢占 `3000` 端口。

## 部署管理端

```bash
sudo mkdir -p /var/www/mingda/admin
sudo rsync -a --delete apps/admin/dist/ /var/www/mingda/admin/
```

Nginx 配置示例：

```nginx
server {
  listen 80;
  server_name _;

  root /var/www/mingda/admin;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

启用后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 小程序测试地址

模拟器测试可以继续使用本地接口。真机预览需要把 `apps/miniprogram/src/app.ts` 的 `apiBaseUrl` 改为：

```ts
apiBaseUrl: 'http://服务器公网IP/api'
```

正式小程序必须使用 HTTPS 域名。
