# 小程序多环境构建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供可重复的开发和正式构建命令，并保证正式小程序产物不会包含本地 API 地址。

**Architecture:** `src/app.ts` 使用唯一不可运行占位符；Node 构建入口编译并复制静态资源后，根据 `dev` 或 `prod` 模式替换 `dist/app.js` 中的占位符，再执行环境串包校验。测试直接执行真实构建并检查最终产物，而不是只检查脚本字符串。

**Tech Stack:** Node.js ESM、TypeScript、微信原生小程序、Node test runner。

---

## File Structure

- Create `apps/miniprogram/scripts/build.mjs`: 统一负责清理、编译、复制、地址注入和产物校验。
- Create `apps/miniprogram/tests/build-environments.test.cjs`: 对开发、正式和非法模式执行产物级测试。
- Modify `apps/miniprogram/src/app.ts`: 将本地 API 地址替换为唯一构建占位符。
- Modify `apps/miniprogram/package.json`: 暴露 `build:dev`、`build:prod` 并调整默认构建和测试命令。
- Modify `docs/product/miniprogram-context.md`: 记录本地联调和正式上传命令。

### Task 1: 构建模式与产物防串包

**Files:**
- Create: `apps/miniprogram/tests/build-environments.test.cjs`
- Create: `apps/miniprogram/scripts/build.mjs`
- Modify: `apps/miniprogram/src/app.ts`
- Modify: `apps/miniprogram/package.json`

- [ ] **Step 1: Write the failing tests**

测试使用 `spawnSync` 分别执行 `node scripts/build.mjs dev`、`prod` 和非法模式，并读取 `dist/app.js`：

```js
test('dev build injects only the local API URL', () => {
  runBuild('dev')
  const output = readFileSync(distAppPath, 'utf8')
  assert.match(output, /http:\/\/127\.0\.0\.1:3000\/api/)
  assert.doesNotMatch(output, /https:\/\/www\.mindajixie\.cn\/mes\/api|__MINGDA_API_BASE_URL__/)
})

test('prod build injects only the HTTPS production API URL', () => {
  runBuild('prod')
  const output = readFileSync(distAppPath, 'utf8')
  assert.match(output, /https:\/\/www\.mindajixie\.cn\/mes\/api/)
  assert.doesNotMatch(output, /127\.0\.0\.1|localhost|__MINGDA_API_BASE_URL__/)
})

test('unknown build mode fails', () => {
  const result = spawnSync(process.execPath, [buildScriptPath, 'staging'], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /Unsupported miniprogram build mode: staging/)
})
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test apps/miniprogram/tests/build-environments.test.cjs
```

Expected: FAIL because `scripts/build.mjs` does not exist and the two environment builds cannot run.

- [ ] **Step 3: Add the placeholder and build orchestrator**

Change `src/app.ts` to:

```ts
apiBaseUrl: '__MINGDA_API_BASE_URL__',
```

Implement `scripts/build.mjs` with the fixed environment map:

```js
const environments = {
  dev: 'http://127.0.0.1:3000/api',
  prod: 'https://www.mindajixie.cn/mes/api',
}
```

The script must use `rm(distRoot, { recursive: true, force: true })`, run `tsc -p tsconfig.json`, run `scripts/copy-static.mjs`, require exactly one `__MINGDA_API_BASE_URL__` occurrence in `dist/app.js`, replace it, and reject placeholder residue or the opposite environment URL.

- [ ] **Step 4: Add package commands**

Set scripts to:

```json
{
  "build": "npm run build:dev",
  "build:dev": "node scripts/build.mjs dev",
  "build:prod": "node scripts/build.mjs prod",
  "test": "npm run build:dev && node --test tests/*.test.cjs",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}
```

- [ ] **Step 5: Run the focused test to verify GREEN**

Run:

```bash
node --test apps/miniprogram/tests/build-environments.test.cjs
```

Expected: 3 tests pass; the final test leaves `dist/app.js` from the production build.

- [ ] **Step 6: Commit the build implementation**

```bash
git add apps/miniprogram/package.json apps/miniprogram/src/app.ts apps/miniprogram/scripts/build.mjs apps/miniprogram/tests/build-environments.test.cjs
git commit -m "feat(miniprogram): add environment-specific builds"
```

### Task 2: 发布说明与完整验证

**Files:**
- Modify: `docs/product/miniprogram-context.md`

- [ ] **Step 1: Document the commands and upload invariant**

Add a “构建环境” section containing:

```markdown
- 本地联调：`npm --prefix apps/miniprogram run build:dev`
- 体验版、审核版和正式版：`npm --prefix apps/miniprogram run build:prod`
- 微信开发者工具上传前必须检查 `dist/app.js` 不包含 `127.0.0.1` 或 `localhost`。
- 正式 API：`https://www.mindajixie.cn/mes/api`
- 微信后台合法域名填写域名 `https://www.mindajixie.cn`，不能附带 `/mes/api` 路径。
```

- [ ] **Step 2: Run type checking and the complete test suite**

Run:

```bash
npm --prefix apps/miniprogram run typecheck
npm --prefix apps/miniprogram test
```

Expected: TypeScript exits 0 and all small-program tests pass.

- [ ] **Step 3: Produce and inspect the final upload artifact**

Run:

```bash
npm --prefix apps/miniprogram run build:prod
rg -n "apiBaseUrl|127\\.0\\.0\\.1|localhost|__MINGDA_API_BASE_URL__" apps/miniprogram/dist/app.js
```

Expected: only `apiBaseUrl: 'https://www.mindajixie.cn/mes/api'` matches; no local address or placeholder appears.

- [ ] **Step 4: Verify the production endpoint**

Run:

```bash
curl -fsS https://www.mindajixie.cn/mes/api/health
```

Expected: HTTP 200 with `code: 0` and service status `ok`.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/product/miniprogram-context.md
git commit -m "docs(miniprogram): document release builds"
```
