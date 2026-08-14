# 闽大铸件项目开发交接说明

更新时间：2026-08-12

本文是后续开发人员接管项目的第一入口。它描述当前真实代码状态、系统边界、开发规范、部署方式、关键数据关系、已知问题和后续优先级。功能细节再按文末索引阅读对应文档。

## 1. 接管前先做的事

### 1.1 不要清理当前工作区

当前仓库状态不是一个干净的已提交版本：

- 当前分支：`codex/process-routing-management`
- 当前 `HEAD` 与本地 `main` 都在 `2ff887f`
- 当前提交领先 `origin/main` 7 个提交
- 工作区约有 66 个变更项，其中约 25 个是未跟踪文件
- 配方、铸造 BOM、工序、工艺路线、文件上传、资源解析等近期实现主要还在工作区

接管人第一步应先保全现场：

```bash
cd /Users/swindcn/Documents/摩尔元数/闽大铸件
git branch --show-current
git status --short
git diff --stat
git log --oneline --decorate -12
```

禁止直接执行：

```bash
git reset --hard
git clean -fd
git checkout -- .
```

应先把当前工作区按模块审查、构建和测试，再拆分提交。不要把 `.playwright-cli/`、`output/`、`.workbuddy/` 等本地运行产物提交到仓库。

### 1.2 当前代码不是线上正式基线

线上服务器仍可能运行较早版本。继续开发前应分别确认：

1. 本地 Git 工作区内容。
2. 本地 Docker 环境实际运行内容。
3. 腾讯云 `/opt/mingda-casting` 和 `/var/www/mingda/admin` 的部署内容。
4. GitHub `origin/main` 的提交内容。

不能仅凭 GitHub 或线上页面判断本地功能是否存在。

## 2. 项目定位与架构

闽大铸件是面向铸造企业的业务管理和生产协同系统，当前包括：

```text
apps/admin         管理端 Web
apps/api           后端 API
apps/miniprogram   微信原生小程序
packages           共享包预留
docs               产品、设计、部署和测试文档
scripts            本地环境和自动化脚本
```

技术栈：

- 管理端：React 19、TypeScript、Vite、Ant Design、React Router、XYFlow。
- 后端：NestJS 11、Prisma 6、PostgreSQL 16。
- 小程序：微信原生小程序、TypeScript。
- 本地环境：Docker Desktop、Nginx、PostgreSQL、Node.js。
- 线上环境：OpenCloudOS 9、Nginx、systemd、PostgreSQL、Node.js。

数据流：

```text
管理端 / 小程序
      -> /api
      -> NestJS Guard / Controller
      -> Prisma
      -> PostgreSQL

图片上传
      -> /api/admin/uploads/images
      -> UPLOAD_DIR 持久目录
      -> /api/uploads/* 静态访问
```

接口响应统一为：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": "ISO 时间"
}
```

## 3. 本地开发环境

### 3.1 Docker 方式

推荐使用 Docker，数据库、上传文件和线上环境隔离：

```bash
npm run docker:up
npm run docker:ps
npm run docker:logs -- api
npm run docker:down
```

默认地址：

```text
管理端：http://127.0.0.1:8080
API：http://127.0.0.1:3000/api
PostgreSQL：127.0.0.1:5433
```

如果 `8080` 被占用，可使用：

```bash
ADMIN_PORT=8081 npm run docker:up
```

当前本机曾使用 `8081`。实际端口以 `docker compose ps` 为准。

项目路径包含中文，`scripts/docker-local.mjs` 会先将代码同步到 `/tmp/mingda-casting-docker` 再构建。因此源文件修改后不会自动热更新到现有容器，需重新执行 `npm run docker:up`，或完成构建后更新容器静态文件。

本地 PostgreSQL 和图片分别保存在 Docker volumes：

```text
mingda-postgres-data
mingda-api-uploads
```

清空本地测试数据：

```bash
npm run docker:down -- -v
npm run docker:up
```

### 3.2 非 Docker 方式

```bash
npm run dev:api
npm run dev:admin
```

Vite 将 `/api` 代理到 `http://localhost:3000`。API 需要正确的 `apps/api/.env` 和可访问的 PostgreSQL。

### 3.3 默认管理员

本地首次启动会初始化：

```text
账号：admin
密码：13665068911
```

这是测试默认值。转为正式环境前必须：

- 修改管理员密码。
- 设置强随机 `ADMIN_TOKEN_SECRET` 或 `JWT_SECRET`。
- 不再依赖代码中的默认 secret。
- 检查 `ensureAdminAccount()`，它目前仍会确保默认管理员存在。

## 4. 构建和测试

基础验证命令：

```bash
npm run build:admin
npm run build:api
npm run build:miniprogram
npm run typecheck:miniprogram
npm run lint:admin
```

接口自动化：

```bash
npm run test:permissions
npm --prefix apps/api run test:material-grades
npm --prefix apps/api run test:recipes
npm --prefix apps/api run test:casting-boms
npm --prefix apps/api run test:process-routings
npm --prefix apps/miniprogram run test
```

这些脚本会操作测试数据。执行前确认指向本地环境，不要直接对正式数据库运行写入型测试。

管理端尚未建立完整的组件测试套件；复杂交互主要使用 Playwright CLI 做浏览器回归。工艺路线拖放、连接、返回页签状态、固定操作列等必须做真实浏览器验证，不能只以 TypeScript 构建通过作为验收。

## 5. 当前功能状态

### 5.1 已实现并接入 PostgreSQL

- 登录、两小时 token、`/auth/me` 刷新权限。
- 部门、用户、角色、客户、供应商、物料、字典。
- 菜单、按钮和数据行权限基础框架。
- 模具开发下达、确认、发货、收货、试模、量产、评判、中止、删除。
- 模具开发到模具/芯盒建档。
- 车间与产线、班组、设备、工厂日历、班次、动态排班、缺陷代码。
- 材质牌号及独立化学成分、力学性能、工艺要求明细。
- 熔炼配方、版本状态、克隆、材质和原材料关系。
- 铸造 BOM、版本、克隆、物理用料、模具和芯盒关系。
- 标准工序主档。
- 工艺路线版本、适用产品、节点、设备、多前置汇合和有向边。
- 图片磁盘上传和 `/api/uploads/*` 静态访问。
- 小程序登录、待办、模具开发列表和流程操作。
- 生产工单、同材质合炉排产、按整数件拆单、设备占用排程、炉次撤销与排程调整。
- 管理端和小程序按执行班组选择实际熔炉、执行多次转运、绑定浇注包/球化包并完成熔炼任务。
- 炉次过程使用 `versionNo` 乐观锁，工单关联信息同步展示炉次状态、实际设备、转运累计、最终重量、操作人和时间。

### 5.2 只完成基础能力或仍需加强

- 第三方部门/用户同步有配置入口和同步接口框架，但接手人必须逐个平台验证真实钉钉、企业微信、飞书 OpenAPI，不应视为生产可用集成。
- 数据权限已覆盖主要资源，但新增模块必须继续接入 `BusinessDataOwnership` 和后端范围过滤；不能只隐藏前端数据。
- 资源解析依赖 MarkItDown，服务器必须额外安装 Python venv 和解析依赖。
- Prisma 目前只有近期工艺路线迁移文件，历史 schema 很多阶段使用 `prisma db push` 建立。正式化前必须补齐基线迁移策略。
- 管理端仍保留部分 `localStorage` 工具作为兼容或缓存；部分页面同时加载 API 和本地缓存。继续改造时要确认真实数据源，防止本地假成功重新出现。
- 小程序源码仍保留 `src/data/mock.ts`，正常业务应走 API；不要在新页面重新引用 mock 数据。
- 模具开发控制器中仍存在少量历史 mock 兼容和旧数据兜底，例如 mock token/图片/操作人展示，需要在正式上线前清除。

### 5.3 尚未实现

- 销售订单和制令单；生产工单与熔炼执行已完成一期闭环。
- 工单工序执行实例和报工记录。
- 炉批、铁水包、砂芯批次的运行期扫码校验。
- 工单完成判定和异常返工闭环。
- 排产、领料、质量检验和完整追溯。
- 正式对象存储、CDN、图片生命周期管理。
- HTTPS 域名和正式微信小程序发布配置。
- 完整 CI/CD、数据库备份恢复演练和监控告警。

## 6. 核心业务关系

```text
部门 -> 用户 -> 角色
角色 -> 菜单/列表/按钮权限 + 数据范围 + 字段权限
用户/部门 -> BusinessDataOwnership -> 业务数据可见范围

客户 + 供应商 + 物料 + 内部跟单人
  -> 模具开发单
  -> 供应商确认/发货
  -> 跟单人收货/试模/量产/评判
  -> 完成后模具建档
  -> 可同步创建芯盒档案

物料 -> 材质牌号
物料 -> 铸造 BOM 版本
铸造 BOM -> 物理用料 + 模具档案 + 芯盒档案
材质牌号 -> 熔炼配方版本 -> 熔炼设备 + 原材料配比

标准工序 -> 工艺路线节点
工艺路线版本 -> 多个产品/半成品
工艺路线节点 -> 多个设备
工艺路线边 -> 前置节点 sourceNodeId -> 后置节点 targetNodeId
产品 -> 唯一默认工艺路线版本
```

物料是系统统一主档。旧规划中的 `MesItem`/“物料主档”概念已并回物料管理，新增关联应优先引用 `Product` 主键或编码，不要再建立第二套物料表。

## 7. 工艺路线的重要约束

工艺路线不是按画布位置执行，也不是简单按 `seqNo` 串行执行。真实依赖关系由 `ProcessRoutingEdge` 表示：

```text
sourceNodeId -> targetNodeId
```

当前后端发布校验位于：

```text
apps/api/src/process-routing/process-routing.graph.ts
```

发布时已校验：

- 节点和边引用有效。
- 不允许自连接和重复边。
- 不允许循环依赖。
- 所有节点必须连接。
- `MERGE_POINT` 至少有两个前置节点。
- 已生效路线必须且只能有一个结束节点。
- 拓扑排序后生成 `seqNo=10/20/30...`，但执行仍以边依赖为准。

当前画布已经取消泳道，所有节点可自由拖动。`routeType` 暂时保留用于兼容历史数据和汇合规则，不再限制节点位置。

本地现有测试路线：

```text
GY-ZT-001 / 铸铁工艺 / V1.0 / ACTIVE

造型下芯 ─┐
电炉熔炼 ─┼─> 合型浇注 -> 落砂清理 -> 成品终检
射芯制芯 ─┘
```

后续工单模块必须在下达时保存 `routingVersionId` 和节点/边快照。运行规则应为：节点所有前置实例完成后才可执行；唯一终点报工完成且质量/数量条件满足后，工单才能完成。当前尚无工单和报工数据表，不能把路线终点识别误认为工单执行功能已经完成。

## 8. 权限和安全规则

### 8.1 权限拆分

每个业务资源至少拆分：

```text
xxx.view     数据列表和详情
xxx.create   新增
xxx.edit     编辑
xxx.delete   删除
```

发布、停用、克隆、升版、一键生成等动作使用独立权限。页面顶部按钮、表格行按钮、详情页按钮都必须检查权限。列表查看权限不等于操作权限。

前端权限只改善体验；后端 Guard 才是安全边界。新增管理端 API 必须使用 `AdminAuthGuard`，建模资源还应接入 `ModelingPermissionGuard` 或等价 Guard。

管理端和小程序权限必须隔离：管理端熔炼执行使用 `production.heat.*`，小程序熔炼执行使用 `mini.production.heat.*`。小程序生产任务还必须校验班组、跟单人等任务关系，不能仅凭角色权限查看或操作其他人的任务。

### 8.2 数据范围

角色数据范围允许复选：

- 本人。
- 本部门。
- 本部门及下级。
- 自定义部门。
- 全组织。
- 第三方同步公共数据补充权限。

业务数据归属默认按创建人及其部门确定。第三方同步且没有自然创建人的数据应标为同步公共数据，通过专门权限补充可见；不要把自动同步任务归到某个普通员工名下。

### 8.3 登录安全

- token 格式：`db-token-v2.*`。
- 有效期：2 小时。
- `/dashboard/*` 必须位于 `RequireAuth` 下。
- `RequireAuth` 必须调用 `/api/auth/me`，不能只信 localStorage。
- 用户禁用、删除或 token 过期时必须清理本地登录状态。
- 正式环境必须替换默认 token secret、默认管理员密码，并启用 HTTPS。

## 9. 管理端开发标准

### 9.1 列表

- 查询、新增等主要按钮放在页面标题右上角。
- 每个列表提供“查询”按钮，用于重新拉取服务端数据。
- 使用 `ResizableTable`，列宽可拖动并保存到 localStorage。
- 数据列可横向滚动，操作列固定右侧。
- 操作按钮先按权限过滤，再交给 `TableActions`。
- 实际可见操作不超过 3 个时直接显示；超过 3 个才进入“更多”。
- 操作文案尽量短，优先图标和简短动词。

### 9.2 二级页面和状态保持

- 二级页使用 `SubPageHeader`。
- 返回使用图标按钮，不使用长文字按钮。
- 页签和筛选写入 URL 查询参数。
- 进入详情时保存来源地址，返回后恢复原页签和筛选。

### 9.3 编码

- 允许英文字母、数字以及 `. @ # - _` 等符号。
- 禁止中文和空格。
- 编码创建后原则上不可修改，避免破坏外键和同步关系。

### 9.4 图片

- 使用 `ImageUploadField`。
- 方形缩略图、横向展示、点击预览、逐张删除。
- 不显示浏览器原生“选择文件/未选择任何文件”。
- 新图片上传到真实 `/api/admin/uploads/images`，不要保存本地 blob URL。
- API 单文件限制 10MB；管理端上传前会压缩常规图片。
- 本地 Docker 和服务器 `UPLOAD_DIR` 必须是持久目录。

## 10. 小程序注意事项

小程序导入目录：

```text
/Users/swindcn/Documents/摩尔元数/闽大铸件/apps/miniprogram
```

源码目录是 `src`，每次修改后必须构建 `dist`：

```bash
npm run build:miniprogram
```

微信开发者工具必须确认实际编译目录与 `project.config.json` 一致，否则会出现“代码修改未生效”。

当前 `apps/miniprogram/src/app.ts` 的 `apiBaseUrl` 是硬编码局域网地址：

```text
http://190.160.9.29:3000/api
```

接手后应优先改成环境配置机制：

- 开发工具：本机局域网 IP + `3000/api`，并关闭开发阶段域名校验。
- 真机开发：手机和电脑处于同一网络，不能使用 `127.0.0.1`。
- 正式环境：已备案 HTTPS 域名，并配置微信小程序 request/uploadFile 合法域名。

小程序业务数据应走 `apps/miniprogram/src/services/api.ts` 和 `utils/request.ts`。`src/data/mock.ts` 仅为历史样例，不能作为正式数据源。

## 11. 数据库与迁移

核心 schema：

```text
apps/api/prisma/schema.prisma
```

本地 Docker 当前启动会执行 `prisma db push`，适合开发但不适合正式生产迁移。近期已经出现：

```text
apps/api/prisma/migrations/20260812090000_process_routing_v2/migration.sql
```

但迁移目录当前仍未提交，且不能代表完整历史基线。正式化建议：

1. 备份线上 PostgreSQL。
2. 对比线上实际 schema 与当前 Prisma schema。
3. 建立经过审核的 baseline migration。
4. 后续只使用 `prisma migrate deploy` 部署迁移。
5. 禁止在正式库直接运行 `prisma db push` 或破坏性 reset。

所有版本化主数据（配方、BOM、工艺路线）被生产单据引用时，应保存版本 ID 和下达时快照，不能始终读取主档最新版本。

## 12. 测试服与正式化

当前测试服务器：

```text
管理端：http://124.223.2.193
API：http://124.223.2.193/api
项目目录：/opt/mingda-casting
静态目录：/var/www/mingda/admin
API 服务：mingda-api.service
```

部署后检查：

```bash
systemctl restart mingda-api.service
systemctl is-active mingda-api.service
journalctl -u mingda-api.service -n 100 --no-pager
nginx -t
systemctl reload nginx
curl http://127.0.0.1:3000/api/health
```

把测试服务器转为正式环境前至少完成：

- HTTPS 和域名证书。
- PostgreSQL 自动备份和恢复演练。
- 上传目录备份。
- 默认密码和 secret 轮换。
- CORS 白名单收紧。
- 清除 mock token 和历史 mock 兜底。
- systemd 运行用户和目录权限收紧。
- 日志轮转、磁盘监控、服务告警。
- 数据库 migration 正式化。
- 小程序合法域名配置。

## 13. 当前已知风险

按优先级排列：

1. **未提交工作区风险**：近期主要功能尚未形成可恢复提交，必须先审查和拆分提交。
2. **数据库迁移风险**：历史主要依赖 `db push`，缺少完整 migration 基线。
3. **小程序环境风险**：API 地址硬编码为开发机局域网 IP。
4. **生产安全风险**：默认管理员密码和 token secret 不适合正式环境。
5. **历史 mock 风险**：小程序 mock 文件及模具控制器部分兼容代码仍存在。
6. **本地缓存风险**：部分旧工具保留 localStorage 数据，新增功能必须以 API/PostgreSQL 为准。
7. **工序执行能力缺口**：生产工单与熔炼执行已完成一期闭环，但非熔炼工序的派工、报工和整单完工判定仍待实现。
8. **上传存储风险**：目前是本地磁盘，不支持多实例、CDN 和对象存储容灾。
9. **测试覆盖风险**：接口脚本有覆盖，但管理端缺少持续运行的组件/E2E 测试套件。

## 14. 建议的接手顺序

1. 保全并提交当前工作区，排除本地运行产物。
2. 运行管理端、API、小程序构建和现有接口测试。
3. 校正 README、上下文文档中仍残留的旧 mock/旧架构描述。
4. 清理小程序硬编码 API 地址和模具控制器 mock 兼容。
5. 建立完整 Prisma baseline migration 和数据库备份流程。
6. 为权限、模具流程、配方、BOM、工艺路线建立可重复 E2E。
7. 在现有生产工单和熔炼任务快照基础上，继续实现非熔炼工序派工、移动端报工与整单完工判定。
8. 正式上线前完成 HTTPS、安全加固、对象存储和监控。

## 15. 文档索引

优先阅读：

```text
README.md
docs/product/project-handoff.md
docs/product/context-summary.md
docs/product/modeling-context.md
docs/product/miniprogram-context.md
docs/product/modeling-test-cases.md
docs/product/test-cases.md
docs/deployment/local-docker.md
docs/deployment/tencent-cloud-test.md
```

专项设计：

```text
docs/superpowers/specs/2026-08-12-melt-recipe-management-design.md
docs/superpowers/specs/2026-08-12-casting-bom-management-design.md
docs/superpowers/specs/2026-08-12-process-routing-management-design.md
docs/superpowers/plans/2026-08-12-melt-recipe-management.md
docs/superpowers/plans/2026-08-12-casting-bom-management.md
docs/superpowers/plans/2026-08-12-process-routing-management.md
```

文档是定位入口，最终行为以当前代码、数据库 schema、自动化测试和真实接口响应为准。发现文档与代码不一致时，应先验证真实行为，再同步修正文档。
