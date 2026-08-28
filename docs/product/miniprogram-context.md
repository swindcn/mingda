# 微信小程序端上下文压缩说明

> 历史上下文提示：本文保留小程序早期 mock 阶段的设计记录。当前小程序已接入后端接口，接手时先阅读 `docs/product/project-handoff.md`，不要重新以 `src/data/mock.ts` 作为正式数据源。

本文专门记录 `apps/miniprogram` 的工程、功能、约定和后续任务。小程序相关开发前优先阅读本文。

## 工程定位

小程序端面向外部协同人员，优先服务模具供应商和内部移动审批/跟单场景。

核心场景：

- 供应商接收模具开发任务
- 供应商确认图纸
- 供应商发货并上传发货图片、快递单号
- 内部或相关人员收货确认
- 提交试模生成记录
- 提交批量生产记录
- 提交模具评判

## 工程路径

```text
apps/miniprogram
```

源码路径：

```text
apps/miniprogram/src
```

微信开发者工具读取路径：

```text
apps/miniprogram/dist
```

## 技术选择

当前选择：

- 微信原生小程序
- TypeScript
- 原生 WXML / WXSS
- mock 数据先行

暂不使用：

- Taro
- uni-app
- Vant Weapp

原因：

- 当前优先明确微信小程序端业务闭环
- 工程轻量，和后端 API 对接直接
- 后续多端诉求明确后再评估跨端框架

## Figma 来源

Figma Make 链接：

```text
https://www.figma.com/make/zo9WgXvpNGadzIcIy9ImOm/%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F%E7%99%BB%E5%BD%95%E9%A1%B5
```

已通过 Figma MCP 读取，返回的是 Figma Make 源码资源，不是普通 design node。

已读取到的关键源码模块：

```text
src/app/App.tsx
src/app/components/HomePage.tsx
src/app/components/TodoListPage.tsx
src/app/components/MoldDevelopmentList.tsx
src/app/components/MoldDevelopmentDetail.tsx
src/app/components/MoldDevelopmentEdit.tsx
src/app/components/ConfirmDrawingModal.tsx
src/app/components/ShippingModal.tsx
src/app/components/ReceiveModal.tsx
src/app/components/ProductionModal.tsx
src/app/components/EvaluationModal.tsx
```

实现时不要直接照搬 React/Tailwind 代码，要转成微信原生小程序页面。

## 当前文件结构

```text
apps/miniprogram
  package.json
  project.config.json
  tsconfig.json
  scripts/copy-static.mjs
  src/app.json
  src/app.ts
  src/app.wxss
  src/sitemap.json
  src/types/global.d.ts
  src/utils/request.ts
  src/data/mock.ts
  src/pages/login/index.*
  src/pages/home/index.*
  src/pages/todos/index.*
  src/pages/mold/list/index.*
  src/pages/mold/detail/index.*
  src/pages/mold/edit/index.*
```

## 构建环境与正式上传

安装依赖：

```bash
npm --prefix apps/miniprogram install
```

类型检查：

```bash
npm --prefix apps/miniprogram run typecheck
```

本地开发构建：

```bash
npm --prefix apps/miniprogram run build:dev
```

体验版、审核版和正式版构建：

```bash
npm --prefix apps/miniprogram run build:prod
```

默认 `build` 仍然使用开发构建，不能把默认构建命令作为正式上传命令。正式上传前必须以 `build:prod` 作为最后一条构建命令。

生产 API 地址：

```text
https://www.mindajixie.cn/mes/api
```

微信合法域名填写：

```text
https://www.mindajixie.cn
```

合法域名不包含 `/mes/api` 路径。上传前检查 `apps/miniprogram/dist/app.js`，确认其中没有 `127.0.0.1`、`localhost` 或 `__MINGDA_API_BASE_URL__`，并确认 `apiBaseUrl` 为生产 API 地址。

打开微信开发者工具：

```text
/Users/swindcn/Documents/摩尔元数/闽大铸件/apps/miniprogram
```

重要注意：

- `project.config.json` 的 `miniprogramRoot` 是 `dist/`
- 微信开发者工具导入小程序项目根目录 `apps/miniprogram`，实际读取 `dist/`
- 微信开发者工具不会直接读取 `src/*.ts`
- 每次修改 `src` 后本地开发或体验评审先运行对应的 `build:dev` 或 `build:prod`
- 测试在隔离临时目录中构建，不会修改共享的 `dist` 包
- 如果提示 `app.json 未找到 pages/login/index.js`，说明没有构建或 `dist` 缺文件

## 已初始化页面

### 登录页

路径：

```text
pages/login/index
```

当前能力：

- 账号输入
- 密码输入
- 显示/隐藏密码
- 记住密码
- 模拟登录
- 登录后进入首页 tab

### 首页

路径：

```text
pages/home/index
```

当前能力：

- 展示待办数量
- 展示模具开发数量
- 快捷入口：待办、模具开发
- 退出登录

### 待办页

路径：

```text
pages/todos/index
```

当前能力：

- 展示 mock 待办
- 待办点击进入模具详情

待办类型：

- 图纸确认
- 发货
- 收货
- 模具评判

### 模具开发列表

路径：

```text
pages/mold/list/index
```

当前能力：

- 展示 mock 模具开发列表
- 搜索编号、客户、产品
- 点击进入详情

### 模具开发详情

路径：

```text
pages/mold/detail/index
```

当前能力：

- 展示模具开发基础信息
- 操作入口：
  - 图纸确认
  - 发货
  - 收货
  - 试模生成
  - 批量生产
  - 模具评判

当前仍是静态入口，没有完整状态机。

### 模具协同提交页

路径：

```text
pages/mold/edit/index
```

通过 `type` 参数区分提交类型：

```text
shipping
receive
trial
batch
evaluation
```

当前能力：

- 发货：填写快递单号、上传发货图片
- 收货：上传收货图片
- 试模生成：填写人、上传产品和检测图片
- 批量生产：填写人、上传产品和检测图片
- 模具评判：评判结果、是否开发完成、评判理由

## Mock 数据

mock 数据文件：

```text
apps/miniprogram/src/data/mock.ts
```

包含：

- `mockTodos`
- `mockMolds`

后续接后端时应替换为 `utils/request.ts` 调用。

## 请求封装

路径：

```text
apps/miniprogram/src/utils/request.ts
```

当前能力：

- 读取 `getApp().globalData.apiBaseUrl`
- 自动带 `Authorization`
- 支持 `mockData`
- 兼容后端统一响应格式：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": ""
}
```

生产 API 地址：

```text
https://www.mindajixie.cn/mes/api
```

## 与管理端一致的业务规则

小程序端应与管理端模具开发规则一致：

- 图纸确认后，管理端显示确认人和确认时间。
- 发货需要填写快递单号并上传发货图片，最多 3 张且至少 1 张。
- 收货需要上传收货图片，最多 3 张且至少 1 张。
- 试模生成和批量生产可多次提交。
- 管理端按提交次数显示：`试模记录（一次）`、`试模记录（二次）`、`量产记录（一次）`。
- 模具评判需要填写评判人、评判结果、是否开发完成、评判理由。
- 模具评判选择“是否开发完成 = 是”后，单据可完成。
- 中止后不能再提交试模、量产、评判，也不能继续推进收发货。

## 后续优先任务

优先级高：

- 根据 Figma Make 进一步细化小程序 UI，还原登录页、首页、待办和模具详情视觉。
- 建立小程序状态机，按当前模具状态显示可执行动作。
- 接入后端 Auth 登录。
- 接入待办列表 API。
- 接入模具开发列表/详情 API。
- 接入发货、收货、试模生成、批量生产、模具评判提交 API。
- 处理图片上传到后端或对象存储。

中期：

- 微信授权登录或手机号绑定。
- 供应商账号与管理端用户体系打通。
- 消息订阅和待办提醒。
- 快递单 OCR 或快递 API 自动识别。

## 当前注意事项

- 不要手动编辑 `dist`，只改 `src`。
- 不要删除 `scripts/copy-static.mjs`，它负责把 WXML/WXSS/JSON 复制到 `dist`。
- `project.config.json` 已经把 `miniprogramRoot` 指向 `dist/`。
- 微信开发者工具报页面 `.js` 不存在时，先运行 `npm --prefix apps/miniprogram run build:dev`。
- 当前 `appid` 可在 `project.config.json` 替换为真实 AppID。
