import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('mold archive uses the multi-corebox editor', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  const pagePath = path.join(root, 'src/pages/modeling/MoldArchivePage.tsx')
  const editorPath = path.join(root, 'src/pages/modeling/MoldCoreBoxEditor.tsx')

  assert.equal(fs.existsSync(pagePath), true)
  assert.equal(fs.existsSync(editorPath), true)
  const page = fs.readFileSync(pagePath, 'utf8')
  const editor = fs.readFileSync(editorPath, 'utf8')
  assert.match(app, /<MoldArchivePage\s*\/>/)
  assert.match(page, /coreBoxes/)
  assert.match(editor, /Form\.List name="coreBoxes"/)
  assert.match(editor, /新增芯盒/)
  assert.doesNotMatch(page, /coreBoxes\[0\]/)
})
