import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { diskStorage } from 'multer'
import { AdminAuthGuard } from './shared/admin-auth.guard'

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])

function safeImageExtension(file: { mimetype: string; originalname: string }) {
  const extension = extname(file.originalname).toLowerCase()
  if (extension && /^[a-z0-9.]+$/.test(extension)) return extension

  const extensionByType: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
  }
  return extensionByType[file.mimetype] || '.jpg'
}

function uploadRoot() {
  return process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
}

interface UploadedImageFile {
  filename: string
  originalname: string
  mimetype: string
  size: number
}

@Controller('admin/uploads')
@UseGuards(AdminAuthGuard)
export class UploadController {
  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          const imageDir = join(uploadRoot(), 'images')
          mkdirSync(imageDir, { recursive: true })
          callback(null, imageDir)
        },
        filename: (_request, file, callback) => {
          callback(null, `${Date.now()}-${randomUUID()}${safeImageExtension(file)}`)
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
      fileFilter: (_request, file, callback) => {
        if (!allowedImageTypes.has(file.mimetype)) {
          callback(new BadRequestException('只支持 JPG、PNG、WEBP、GIF、SVG 图片'), false)
          return
        }
        callback(null, true)
      },
    }),
  )
  uploadImage(@UploadedFile() file?: UploadedImageFile) {
    if (!file) {
      throw new BadRequestException('请上传图片')
    }

    return {
      url: `/api/uploads/images/${file.filename}`,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    }
  }
}
