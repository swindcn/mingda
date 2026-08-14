import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('casting BOM manages coreboxes with quantity-per-product rows', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/CastingBomManagementPage.tsx'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'src/utils/castingBoms.ts'), 'utf8')

  assert.match(page, /Form\.List name="coreBoxes"/)
  assert.match(page, /芯件比/)
  assert.match(page, /quantityPerProduct/)
  assert.match(page, /保质期（小时）/)
  assert.match(page, /shelfLifeHours/)
  assert.match(page, /自动带入已选模具的全部启用芯盒/)
  assert.doesNotMatch(page, /Form\.Item name="coreBoxCodes"/)
  assert.match(api, /shelfLifeHours\?: number \| null/)
})
