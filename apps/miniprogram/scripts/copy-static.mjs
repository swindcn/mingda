import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const appRoot = fileURLToPath(new URL('../', import.meta.url))
const distRoot = process.env.MINGDA_MINIPROGRAM_DIST_DIR
  ? resolve(appRoot, process.env.MINGDA_MINIPROGRAM_DIST_DIR)
  : join(appRoot, 'dist')
const staticExtensions = new Set(['.json', '.wxml', '.wxss', '.svg', '.png', '.jpg', '.jpeg', '.webp'])

async function copyStaticFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      await copyStaticFiles(sourcePath)
      continue
    }

    if (!staticExtensions.has(extname(entry.name))) {
      continue
    }

    const targetPath = join(distRoot, relative(sourceRoot, sourcePath))
    await mkdir(dirname(targetPath), { recursive: true })
    await cp(sourcePath, targetPath)
  }
}

await copyStaticFiles(sourceRoot)
