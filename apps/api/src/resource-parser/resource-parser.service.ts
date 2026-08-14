import { BadRequestException, Injectable } from '@nestjs/common'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const allowedExtensions = new Set(['ppt', 'pptx', 'doc', 'docx', 'pdf', 'xls', 'xlsx'])

export interface ResourceFileInput {
  originalName: string
  mimeType: string
  buffer: Buffer
}

export interface StoredResourceFileInput {
  originalName: string
  mimeType: string
  path: string
}

export interface ResourceParseResult {
  fileName: string
  markdown: string
  sourceName: string
  sourceType: string
}

@Injectable()
export class ResourceParserService {
  async parseFile(file: ResourceFileInput): Promise<ResourceParseResult> {
    const workingDir = await mkdtemp(join(tmpdir(), 'mingda-resource-parser-'))
    const inputPath = join(workingDir, basename(file.originalName))

    try {
      await writeFile(inputPath, file.buffer)
      return await this.parseMarkitdownFile({
        originalName: file.originalName,
        mimeType: file.mimeType,
        path: inputPath,
        cleanupDir: workingDir,
      })
    } catch (error) {
      await rm(workingDir, { recursive: true, force: true })
      throw error
    }
  }

  async parseStoredFile(file: StoredResourceFileInput): Promise<ResourceParseResult> {
    return this.parseMarkitdownFile({
      ...file,
      cleanupDir: dirname(file.path),
    })
  }

  private async parseMarkitdownFile(file: StoredResourceFileInput & { cleanupDir: string }): Promise<ResourceParseResult> {
    const extension = getFileExtension(file.originalName)
    if (!allowedExtensions.has(extension)) {
      throw new BadRequestException('仅支持上传 .ppt、.pptx、.doc、.docx、.pdf、.xls、.xlsx 文件')
    }

    const title = stripExtension(file.originalName) || '解析结果'
    const outputPath = join(file.cleanupDir, `${title}.md`)

    try {
      await execFileAsync(process.env.MARKITDOWN_BIN || 'markitdown', [file.path, '-o', outputPath], {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      })
      const markdown = normalizeMarkdown(await readFile(outputPath, 'utf8'))
      if (!markdown) {
        throw new BadRequestException('MarkItDown 未解析出可用 Markdown 内容')
      }

      return {
        fileName: `${title}.md`,
        markdown,
        sourceName: file.originalName,
        sourceType: extension,
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new BadRequestException('服务器未配置 MarkItDown，请先安装并配置 MARKITDOWN_BIN')
      }
      throw new BadRequestException('MarkItDown 解析失败，请检查文件格式或文件内容')
    } finally {
      await rm(file.cleanupDir, { recursive: true, force: true })
    }
  }
}

function getFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex + 1) : ''
}

function stripExtension(fileName: string) {
  const baseName = basename(fileName).trim()
  const dotIndex = baseName.lastIndexOf('.')
  return dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName
}

function normalizeMarkdown(markdown: string) {
  return markdown.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
