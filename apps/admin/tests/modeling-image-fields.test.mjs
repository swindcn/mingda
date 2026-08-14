import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('mold and corebox image fields stay as arrays when opening view or edit', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/ModelingMasterPage.tsx'), 'utf8')

  assert.match(page, /isImageField\(field\)/)
  assert.match(page, /isImageField\(field\)\s*\?\s*normalizeImageList\(value\)/)
})

test('image upload field tolerates legacy non-array values', () => {
  const component = fs.readFileSync(path.join(root, 'src/components/ImageUploadField.tsx'), 'utf8')

  assert.match(component, /const imageList = normalizeImageList\(value\)/)
  assert.match(component, /imageList\.map/)
})
