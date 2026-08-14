import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResourceParserService } from './resource-parser.service'

test('converts supported office files through a MarkItDown command', async () => {
  const command = await createFakeMarkitdownCommand('# 转换结果\\n\\n来自 MarkItDown')
  const previousCommand = process.env.MARKITDOWN_BIN
  process.env.MARKITDOWN_BIN = command

  try {
    const result = await new ResourceParserService().parseFile({
      originalName: '产品介绍.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: Buffer.from('pptx bytes'),
    })

    assert.equal(result.fileName, '产品介绍.md')
    assert.equal(result.sourceName, '产品介绍.pptx')
    assert.equal(result.sourceType, 'pptx')
    assert.match(result.markdown, /来自 MarkItDown/)
  } finally {
    if (previousCommand === undefined) {
      delete process.env.MARKITDOWN_BIN
    } else {
      process.env.MARKITDOWN_BIN = previousCommand
    }
  }
})

test('rejects unsupported upload extensions before calling MarkItDown', async () => {
  await assert.rejects(
    () =>
      new ResourceParserService().parseFile({
        originalName: '脚本.sh',
        mimeType: 'text/x-shellscript',
        buffer: Buffer.from('echo nope'),
      }),
    /仅支持上传/,
  )
})

test('deletes stored upload files after conversion', async () => {
  const command = await createFakeMarkitdownCommand('临时文件清理')
  const previousCommand = process.env.MARKITDOWN_BIN
  process.env.MARKITDOWN_BIN = command
  const dir = await mkdtemp(join(tmpdir(), 'stored-upload-'))
  const filePath = join(dir, 'upload.pdf')
  await writeFile(filePath, Buffer.from('pdf bytes'))

  try {
    const result = await new ResourceParserService().parseStoredFile({
      originalName: 'upload.pdf',
      mimeType: 'application/pdf',
      path: filePath,
    })

    assert.match(result.markdown, /临时文件清理/)
    await assert.rejects(() => access(filePath))
  } finally {
    if (previousCommand === undefined) {
      delete process.env.MARKITDOWN_BIN
    } else {
      process.env.MARKITDOWN_BIN = previousCommand
    }
  }
})

async function createFakeMarkitdownCommand(markdown: string) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-markitdown-'))
  const commandPath = join(dir, 'markitdown.mjs')
  await writeFile(
    commandPath,
    [
      '#!/usr/bin/env node',
      'import { writeFileSync } from "node:fs"',
      'const outputIndex = process.argv.indexOf("-o")',
      'if (outputIndex < 0 || !process.argv[outputIndex + 1]) process.exit(2)',
      `writeFileSync(process.argv[outputIndex + 1], ${JSON.stringify(markdown)})`,
    ].join('\n'),
    { mode: 0o755 },
  )
  return commandPath
}
