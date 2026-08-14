import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { Response } from 'express'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR
    const payload = exception instanceof HttpException ? exception.getResponse() : null
    const message =
      typeof payload === 'object' && payload && 'message' in payload
        ? payload.message
        : exception instanceof Error
          ? exception.message
          : 'Internal server error'
    const data = typeof payload === 'object' && payload && 'data' in payload ? payload.data : null
    const conflictCode = typeof payload === 'object' && payload && 'conflictCode' in payload ? payload.conflictCode : undefined

    response.status(status).json({
      code: status,
      message,
      data,
      ...(conflictCode ? { conflictCode } : {}),
      timestamp: new Date().toISOString(),
    })
  }
}
