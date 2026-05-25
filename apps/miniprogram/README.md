# @mingda/miniprogram

闽大铸件微信小程序端工程。

## 当前范围

当前为微信原生小程序 + TypeScript 骨架，功能参考 Figma Make：

https://www.figma.com/make/zo9WgXvpNGadzIcIy9ImOm/%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F%E7%99%BB%E5%BD%95%E9%A1%B5

已初始化页面：

- 登录
- 首页
- 待办
- 模具开发列表
- 模具开发详情
- 模具协同提交页

## 开发方式

1. 运行 `npm run build:miniprogram`
2. 使用微信开发者工具打开 `apps/miniprogram`
3. AppID 可先使用测试号或在 `project.config.json` 中替换
4. 当前数据为 mock，后续接入 `apps/api`

微信开发者工具读取的是 `dist/` 目录；每次修改 `src/` 后需要重新运行构建。

## 校验

```bash
npm --prefix apps/miniprogram install
npm run typecheck:miniprogram
```
