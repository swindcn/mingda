import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { PouringService } from './pouring.service'
import type { CheckPouringBody, ReportPouringBody, ReversePouringReportBody } from './pouring.types'
import { ProductionPermissionGuard } from './production-permission.guard'

@Controller('admin/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class PouringController {
  constructor(private readonly pouring: PouringService) {}

  @Get('pouring-tasks')
  list(@Req() request: RequestWithAdmin, @Query('keyword') keyword?: string, @Query('status') status?: string, @Query('workOrderId') workOrderId?: string) {
    return this.pouring.listQueue(request, { keyword, status, workOrderId })
  }

  @Get('pouring-tasks/:id/options')
  options(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.pouring.options(request, id)
  }

  @Get('pouring-tasks/:id/reports')
  reports(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.pouring.listReports(request, id)
  }

  @Get('pouring-tasks/:id/defect-options')
  defectOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.pouring.defectOptions(request, id)
  }

  @Post('pouring/check')
  check(@Req() request: RequestWithAdmin, @Body() body: CheckPouringBody) {
    return this.pouring.check(request, body)
  }

  @Post('pouring/reports')
  report(@Req() request: RequestWithAdmin, @Body() body: ReportPouringBody) {
    return this.pouring.report(request, body)
  }

  @Post('pouring-reports/:id/reverse')
  reverse(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReversePouringReportBody) {
    return this.pouring.reverse(request, id, body)
  }
}

@Controller('mini/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MobilePouringController {
  constructor(private readonly pouring: PouringService) {}

  @Get('pouring-tasks')
  list(@Req() request: RequestWithAdmin, @Query('status') status?: string) {
    return this.pouring.listQueue(request, { status }, true)
  }

  @Get('pouring-tasks/:id/options')
  options(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.pouring.options(request, id, true)
  }

  @Get('pouring-tasks/:id/reports')
  reports(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.pouring.listReports(request, id, true)
  }

  @Get('pouring-tasks/:id/defect-options')
  defectOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.pouring.defectOptions(request, id, true)
  }

  @Post('pouring/check')
  check(@Req() request: RequestWithAdmin, @Body() body: CheckPouringBody) {
    return this.pouring.check(request, body, true)
  }

  @Post('pouring/reports')
  report(@Req() request: RequestWithAdmin, @Body() body: ReportPouringBody) {
    return this.pouring.report(request, body, true)
  }
}
