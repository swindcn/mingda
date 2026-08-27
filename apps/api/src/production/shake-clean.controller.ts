import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { ProductionPermissionGuard } from './production-permission.guard'
import { ShakeCleanService } from './shake-clean.service'
import type { CheckShakeBody, ReportCleaningBody, ReportShakeBody, ReverseShakeCleanReportBody, ShakeCleanListQuery } from './shake-clean.types'

@Controller('admin/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class ShakeCleanController {
  constructor(private readonly service: ShakeCleanService) {}

  @Get('shake-clean-tasks')
  list(@Req() request: RequestWithAdmin, @Query() query: ShakeCleanListQuery) {
    return this.service.list(request, query)
  }

  @Get('shake-clean-tasks/:id/options')
  options(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.options(request, id) }

  @Get('shake-clean-tasks/:id/reports')
  reports(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.reports(request, id) }

  @Get('shake-clean-tasks/:id/trace')
  trace(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.trace(request, id) }

  @Get('shake-clean-tasks/:id/defect-options')
  defects(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.defectOptions(request, id) }

  @Post('shake-clean/shake/check')
  check(@Req() request: RequestWithAdmin, @Body() body: CheckShakeBody) { return this.service.checkShake(request, body) }

  @Post('shake-clean/shake/reports')
  shake(@Req() request: RequestWithAdmin, @Body() body: ReportShakeBody) { return this.service.reportShake(request, body) }

  @Post('shake-clean/cleaning/reports')
  cleaning(@Req() request: RequestWithAdmin, @Body() body: ReportCleaningBody) { return this.service.reportCleaning(request, body) }

  @Post('shake-clean/shake-reports/:id/reverse')
  reverseShake(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReverseShakeCleanReportBody) {
    return this.service.reverseShake(request, id, body)
  }

  @Post('shake-clean/cleaning-reports/:id/reverse')
  reverseCleaning(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReverseShakeCleanReportBody) {
    return this.service.reverseCleaning(request, id, body)
  }
}

@Controller('mini/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MobileShakeCleanController {
  constructor(private readonly service: ShakeCleanService) {}

  @Get('shake-clean-tasks')
  list(@Req() request: RequestWithAdmin, @Query() query: ShakeCleanListQuery) {
    return this.service.list(request, query, true)
  }

  @Get('shake-clean-tasks/:id/options')
  options(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.options(request, id, true) }

  @Get('shake-clean-tasks/:id/reports')
  reports(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.reports(request, id, true) }

  @Get('shake-clean-tasks/:id/trace')
  trace(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.trace(request, id, true) }

  @Get('shake-clean-tasks/:id/defect-options')
  defects(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.defectOptions(request, id, true) }

  @Post('shake-clean/shake/check')
  check(@Req() request: RequestWithAdmin, @Body() body: CheckShakeBody) { return this.service.checkShake(request, body, true) }

  @Post('shake-clean/shake/reports')
  shake(@Req() request: RequestWithAdmin, @Body() body: ReportShakeBody) { return this.service.reportShake(request, body, true) }

  @Post('shake-clean/cleaning/reports')
  cleaning(@Req() request: RequestWithAdmin, @Body() body: ReportCleaningBody) { return this.service.reportCleaning(request, body, true) }
}
