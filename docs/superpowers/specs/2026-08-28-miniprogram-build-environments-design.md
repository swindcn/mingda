# 小程序多环境构建设计

## 目标

小程序源码不再硬编码本地或正式 API 地址。开发包和正式包通过明确的构建命令生成，正式构建必须自动验证产物中不存在本地地址，降低误上传风险。

## 构建命令

- `npm --prefix apps/miniprogram run build:dev`
  - API：`http://127.0.0.1:3000/api`
  - 用于本机微信开发者工具联调。
- `npm --prefix apps/miniprogram run build:prod`
  - API：`https://www.mindajixie.cn/mes/api`
  - 用于体验版、审核版和正式版上传。
- `npm --prefix apps/miniprogram run build`
  - 等同于 `build:dev`，兼容现有本地开发习惯。
- `npm --prefix apps/miniprogram test`
  - 明确先执行开发构建，再运行现有测试，不能依赖上一次遗留的 `dist`。

## 实现方式

新增 Node 构建入口，负责以下步骤：

1. 校验构建模式仅允许 `dev` 或 `prod`。
2. 清空 `dist`。
3. 执行 TypeScript 编译。
4. 复制 WXML、WXSS、JSON 和图片等静态文件。
5. 将源码中的唯一 API 占位符替换为当前模式对应地址。
6. 校验替换次数和最终产物，任何占位符残留或环境地址串包都使构建失败。

构建脚本使用 Node 文件 API 和子进程 API，不依赖 `sed`、`rm` 等平台命令，保证 macOS、Linux 和 CI 行为一致。

## 源码约束

- `src/app.ts` 只保存不可运行的 API 占位符，不保存本地或正式 URL。
- 正式 API 地址只在构建配置中维护。
- `dist` 继续作为生成目录，不提交 Git。
- 微信开发者工具继续以项目根目录导入，并通过 `miniprogramRoot: "dist/"` 加载产物。

## 测试与验收

自动化测试必须真实执行两种构建：

1. 开发构建产物包含 `http://127.0.0.1:3000/api`，且不包含正式地址和占位符。
2. 正式构建产物包含 `https://www.mindajixie.cn/mes/api`，且不包含 `127.0.0.1`、`localhost` 和占位符。
3. 未知模式构建失败并返回非零退出码。
4. 全量小程序测试通过后，再执行一次正式构建，最终留在 `dist` 中的是可上传正式包。

## 发布操作

每次上传体验版或审核版前执行：

```bash
npm --prefix apps/miniprogram run build:prod
```

随后检查 `apps/miniprogram/dist/app.js` 中的 `apiBaseUrl`，再使用微信开发者工具上传。服务器合法域名统一配置为 `https://www.mindajixie.cn`。
