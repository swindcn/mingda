import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { json, static as serveStatic, urlencoded } from 'express'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './shared/http-exception.filter'
import { ResponseInterceptor } from './shared/response.interceptor'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const configService = app.get(ConfigService)
  const port = configService.get<number>('PORT') ?? 3000

  app.use(json({ limit: '25mb' }))
  app.use(urlencoded({ limit: '25mb', extended: true }))

  app.setGlobalPrefix('api')
  const uploadRoot = configService.get<string>('UPLOAD_DIR') || join(process.cwd(), 'uploads')
  mkdirSync(uploadRoot, { recursive: true })
  app.use('/api/uploads', serveStatic(uploadRoot))
  const corsOrigin = configService.get<string>('CORS_ORIGIN')
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((origin) => origin.trim())
      : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    credentials: true,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())

  await app.listen(port)
}

void bootstrap()
