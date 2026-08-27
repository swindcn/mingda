# 造型零数量报工与砂芯负库存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许造型任务通过零数量报工补充关闭，并在砂芯不足时保留可追溯的负库存消费和净库存齐套结果。

**Architecture:** 扩展纯计算模块生成“正库存分配 + 透支差额”计划，`MoldingService` 在可串行化事务内选择同工单来源批次并执行该计划。齐套改为汇总同工单、同芯盒全部批次正负余额；小程序仅调整零数量关闭校验和提示，最终规则由后端校验。

**Tech Stack:** NestJS、Prisma、PostgreSQL、TypeScript、微信原生小程序、Node test scripts。

---

### Task 1: 负库存分配纯函数

**Files:**
- Modify: `apps/api/src/production/molding.calculations.ts`
- Modify: `apps/api/scripts/test-molding-calculations.mjs`

- [x] **Step 1: 写失败测试**

增加测试，要求库存 `4 + 3`、需求 `10` 时返回两个正常分配和一个数量 `3` 的透支分配；没有任何来源批次时抛出“未找到可追溯的砂芯来源批次”。

```js
assert.deepEqual(
  allocateCoreBatchesWithOverdraft(10, [
    { id: 'first', quantity: 4, status: 'AVAILABLE', producedAt: '2026-08-18T08:00:00Z' },
    { id: 'last', quantity: 3, status: 'AVAILABLE', producedAt: '2026-08-18T09:00:00Z' },
  ]),
  [
    { batchId: 'first', quantity: 4 },
    { batchId: 'last', quantity: 6 },
  ],
)
assert.throws(() => allocateCoreBatchesWithOverdraft(1, []), /未找到可追溯的砂芯来源批次/)
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm --prefix apps/api run build && node apps/api/scripts/test-molding-calculations.mjs`

Expected: FAIL，缺少 `allocateCoreBatchesWithOverdraft`。

- [x] **Step 3: 实现最小分配函数**

函数必须保留现有 FIFO 排序，先分配正数，再把差额合并到本次最后一个正批次；若没有正批次，则选择同一候选集合中最近产生的可追溯批次。候选允许 `CONSUMED` 和非正余额，但只有 `AVAILABLE/WARNING` 的正余额可正常分配。同一批次最终只返回一条分配，满足消费明细唯一约束。

- [x] **Step 4: 运行纯函数测试**

Run: `npm --prefix apps/api run build && node apps/api/scripts/test-molding-calculations.mjs`

Expected: PASS。

### Task 2: 后端零数量报工和事务透支

**Files:**
- Modify: `apps/api/src/production/molding.service.ts`
- Modify: `apps/api/scripts/test-molding-execution.mjs`

- [x] **Step 1: 写失败的接口回归**

覆盖以下断言：

```js
assert.equal(zeroContinue.status, 400)
assert.match(zeroContinue.body.message, /零数量报工仅用于结束任务/)
assert.equal(zeroFinishWithoutReason.status, 400)
assert.match(zeroFinishWithoutReason.body.message, /结束原因/)
assert.equal(zeroFinish.status, 201)
assert.equal(zeroFinish.body.data.status, 'COMPLETED')
```

增加库存不足场景，断言报工成功、消费数量等于需求、来源批次余额小于 `0`，撤销后恢复原余额。

- [x] **Step 2: 运行接口测试并确认失败**

Run: `DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3000/api' npm --prefix apps/api run test:molding-execution`

Expected: FAIL，现有解析拒绝零数量或库存分配抛出库存不足。

- [x] **Step 3: 实现后端校验**

`parsedReport` 改为：

```ts
const totalQty = goodQty + scrapQty
if (totalQty === 0 && !body.finishTask) throw new BadRequestException('零数量报工仅用于结束任务')
if (totalQty === 0 && !earlyCompletionReason) throw new BadRequestException('零数量结束任务必须填写结束原因')
```

零数量结束不生成消费明细。非零报工查询同工单、同芯盒全部来源批次作为追溯候选，并调用透支分配函数；逐段加锁后允许 `quantityAfter < 0`，状态设为 `CONSUMED`，照常写消费明细与流水。

- [x] **Step 4: 改造齐套净额**

同工单、同芯盒批次查询不再排除 `CONSUMED` 和负余额。每种芯盒使用 `Math.max(0, sum(currentQuantity))` 作为 `available`；开工最大箱数继续基于净可用量计算。

- [x] **Step 5: 验证接口测试**

Run: `DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3000/api' npm --prefix apps/api run test:molding-execution`

Expected: PASS，测试清理恢复原数据。

### Task 3: 小程序零数量关闭交互

**Files:**
- Modify: `apps/miniprogram/src/pages/molding/report/index.ts`
- Modify: `apps/miniprogram/src/pages/molding/report/index.wxml`
- Modify: `apps/miniprogram/tests/molding-pages.test.cjs`

- [x] **Step 1: 写失败的页面测试**

断言构建产物包含：

```js
assert.match(source, /零数量报工仅用于结束任务/)
assert.match(source, /零数量结束任务必须填写结束原因/)
assert.match(markup, /补充关闭任务/)
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm --prefix apps/miniprogram test`

Expected: FAIL，缺少零数量关闭交互。

- [x] **Step 3: 实现页面校验和提示**

提交时若总数量为 `0`，要求 `finishTask = true` 且结束原因非空。页面在零数量时显示“本次报工不产生数量，仅用于补充关闭任务”，并自动切换到“本任务已结束”；用户重新选择继续生产时提交仍由前端和后端拦截。

- [x] **Step 4: 运行小程序测试与构建**

Run: `npm --prefix apps/miniprogram test`

Expected: 全部 PASS，`dist` 已更新。

### Task 4: 文档、完整验证和本地部署

**Files:**
- Modify: `docs/product/context-summary.md`

- [x] **Step 1: 落实长期规则**

记录零数量关闭、来源批次透支、净库存齐套、无来源批次禁止透支、撤销精确返还等规则，并链接设计文档。

- [x] **Step 2: 执行完整验证**

Run:

```bash
npm --prefix apps/api run build
node apps/api/scripts/test-molding-calculations.mjs
DATABASE_URL='postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public' API_BASE_URL='http://127.0.0.1:3000/api' npm --prefix apps/api run test:molding-execution
npm --prefix apps/miniprogram test
npm --prefix apps/admin run build
git diff --check
```

Expected: 所有命令退出码为 `0`。

- [x] **Step 3: 重建本地 Docker 服务**

Run: `npm run docker:up && npm run docker:ps && curl -fsS http://127.0.0.1:3000/api/health`

Expected: PostgreSQL healthy，API 和管理端 running，健康接口返回 `status: ok`。
