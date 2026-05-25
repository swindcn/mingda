# 闽大铸件

闽大铸件是面向铸件行业的业务管理系统。当前阶段优先建设管理端 Web 应用，后续预留微信小程序端和后端服务。

## 项目结构

```text
apps/
  admin/          管理端 Web 应用
  miniprogram/    微信小程序端应用，后续建设
  api/            后端服务，按需要建设
packages/
  shared/         共享类型、常量、工具函数
  ui/             管理端通用 UI 组件
  api-client/     接口请求 SDK
docs/
  product/        产品规划、业务流程
  design/         设计稿说明、页面清单
  api/            接口文档
scripts/          项目脚本
```

## 当前阶段

一期先完成管理端基础能力：

- 登录和后台布局
- 用户管理
- 客户管理
- 供应商管理
- 产品管理
- 模具开发管理
- 模具开发详情

## 设计来源

管理端初版设计来源于 Figma Make 项目：

https://www.figma.com/make/jpJmeqDvLNQVsB98m0ejqo/%E7%99%BB%E5%BD%95%E9%A1%B5%E9%9D%A2%E8%AE%BE%E8%AE%A1

