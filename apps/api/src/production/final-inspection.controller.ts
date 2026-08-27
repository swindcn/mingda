import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { ProductionPermissionGuard } from './production-permission.guard'
import { FinalInspectionService } from './final-inspection.service'
import type { FinalInspectionListQuery, ReportCleaningReworkBody, ReportFinalInspectionBody, ReverseFinalInspectionBody } from './final-inspection.types'

@Controller('admin/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class FinalInspectionController {
  constructor(private readonly service: FinalInspectionService) {}

  @Get('inspection-tasks')
  list(@Req() request: RequestWithAdmin, @Query() query: FinalInspectionListQuery) { return this.service.listQueue(request, query) }

  @Get('inspection-tasks/:id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.getTask(request, id) }

  @Get('inspection-tasks/:id/options')
  options(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.options(request, id) }

  @Get('inspection-tasks/:id/defect-options')
  defects(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.defectOptions(request, id) }

  @Get('inspection-tasks/:id/trace')
  trace(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.trace(request, id) }

  @Post('inspection/reports')
  report(@Req() request: RequestWithAdmin, @Body() body: ReportFinalInspectionBody) { return this.service.report(request, body) }

  @Post('inspection-reports/:id/reverse')
  reverse(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReverseFinalInspectionBody) { return this.service.reverse(request, id, body) }

  @Get('cleaning-rework-tasks')
  reworks(@Req() request: RequestWithAdmin, @Query() query: FinalInspectionListQuery) { return this.service.listReworkTasks(request, query) }

  @Get('cleaning-rework-tasks/:id')
  rework(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.getReworkTask(request, id) }

  @Post('cleaning-rework/reports')
  reportRework(@Req() request: RequestWithAdmin, @Body() body: ReportCleaningReworkBody) { return this.service.reportRework(request, body) }
}

@Controller('mini/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MobileFinalInspectionController {
  constructor(private readonly service: FinalInspectionService) {}

  @Get('inspection-tasks')
  list(@Req() request: RequestWithAdmin, @Query() query: FinalInspectionListQuery) { return this.service.listQueue(request, query, true) }

  @Get('inspection-tasks/:id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.getTask(request, id, true) }

  @Get('inspection-tasks/:id/options')
  options(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.options(request, id, true) }

  @Get('inspection-tasks/:id/defect-options')
  defects(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.defectOptions(request, id, true) }

  @Post('inspection/reports')
  report(@Req() request: RequestWithAdmin, @Body() body: ReportFinalInspectionBody) { return this.service.report(request, body, true) }

  @Get('cleaning-rework-tasks')
  reworks(@Req() request: RequestWithAdmin, @Query() query: FinalInspectionListQuery) { return this.service.listReworkTasks(request, query, true) }

  @Get('cleaning-rework-tasks/:id')
  rework(@Req() request: RequestWithAdmin, @Param('id') id: string) { return this.service.getReworkTask(request, id, true) }

  @Post('cleaning-rework/reports')
  reportRework(@Req() request: RequestWithAdmin, @Body() body: ReportCleaningReworkBody) { return this.service.reportRework(request, body, true) }
}
