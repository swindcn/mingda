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
python3
markitdown
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
UPLOAD_DIR=/opt/mingda-casting/uploads
MARKITDOWN_BIN=/opt/markitdown-venv/bin/markitdown
```

上传图片通过 `/api/uploads/...` 访问。测试服需要保证 `UPLOAD_DIR` 指向持久目录，并允许运行 API 的用户读写该目录。

资源解析功能依赖 Microsoft MarkItDown。建议在服务器上使用独立 Python venv：

```bash
python3 -m venv /opt/markitdown-venv
/opt/markitdown-venv/bin/pip install 'markitdown[pdf,docx,pptx,xlsx]'
```

## 构建

```bash
npm --prefix apps/api install
npm --prefix apps/admin install
npm run build:api
npm run build:admin
```

## 数据升级命令

部署包含落砂清理功能的版本时，在启动新 API 前必须执行：

```bash
npm --prefix apps/api run seed:shake-clean-equipment-types
npm --prefix apps/api run backfill:shake-batches
```

`seed:shake-clean-equipment-types` 是一次性显式初始化：新库写入完整默认类型，已有字典只补齐“落砂、清理、抛丸、打磨、切割”。正常字典读写不会强制恢复这些值，用户后续可以删除或替换。

部署包含成品终检的版本时，在 Prisma 结构同步完成、启动新 API 前执行：

```bash
npm --prefix apps/api run seed:final-inspection-warehouses
npm --prefix apps/api run backfill:inspection-batches
```

`seed:final-inspection-warehouses` 幂等创建系统毛坯库和回炉料仓；若保留编码被非系统仓库占用会明确失败，不能静默覆盖。`backfill:inspection-batches` 将历史有效 `BlankOutputBatch` 按工单锁定路线解析为待检批次，重复运行不会重复生成。两条命令失败时禁止启动新版本 API，应修复数据后重跑。

`backfill:shake-batches` 解析历史浇注报工是否需要进入待落砂队列。命令每页使用独立事务并持续运行到完成，重复执行不会生成重复批次。失败时退出码非 `0`，修复原因后直接重跑即可；已经提交的分页不会回滚。

浇注报工通过 `shakeQueueResolution` 保存解析结果：`PENDING` 表示尚未解析，成功创建或已存在待落砂批次时写入 `CREATED`，报工已撤销、合格数不大于零或锁定路线没有可达落砂节点时写入 `NOT_APPLICABLE`。补建命令只扫描 `PENDING`；后续路线调整不会让 `NOT_APPLICABLE` 报工重新入队。

可选参数：

```bash
BACKFILL_SHAKE_BATCH_SIZE=100 npm --prefix apps/api run backfill:shake-batches
BACKFILL_SHAKE_MOLDING_TASK_IDS=id1,id2 npm --prefix apps/api run backfill:shake-batches
```

正常管理端和小程序列表只读，不会在查询时自动补建。若跳过升级命令，详情或报工会提示先执行历史补建。

`seed:shake-clean-equipment-types` 在新库没有 `equipmentTypes` 记录时写入完整默认类型：熔炼炉、浇注包、球化包、烘干设备、落砂、清理、抛丸、打磨、切割、其他设备。已有记录只追加落砂、清理、抛丸、打磨、切割，不恢复用户已删除的其他默认类型，也不删除自定义类型。

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
