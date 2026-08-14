import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diskStorage } from 'multer'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import { ResourceParserService } from './resource-parser.service'

const uploadRoot = join(tmpdir(), 'mingda-resource-parser-uploads')
mkdirSync(uploadRoot, { recursive: true })

interface UploadedResourceFile {
  originalname: string
  mimetype: string
  path: string
}

@Controller('admin/resource-parser')
@UseGuards(AdminAuthGuard)
export class ResourceParserController {
  constructor(private readonly resourceParserService: ResourceParserService) {}

  @Post('convert')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          const uploadDir = join(uploadRoot, randomUUID())
          mkdirSync(uploadDir, { recursive: true })
          callback(null, uploadDir)
        },
        filename: (_request, file, callback) => {
          callback(null, file.originalname)
        },
      }),
      limits: {
        fileSize: 300 * 1024 * 1024,
      },
    }),
  )
  convert(@UploadedFile() file?: UploadedResourceFile) {
    if (!file) {
      throw new BadRequestException('请上传需要解析的文件')
    }

    return this.resourceParserService.parseStoredFile({
      originalName: file.originalname,
      mimeType: file.mimetype,
      path: file.path,
    })
  }
}
