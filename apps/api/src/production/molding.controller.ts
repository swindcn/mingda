import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { MoldingService } from './molding.service'
import type {
  CancelMoldingTaskBody,
  CreateMoldingTaskBody,
  DispatchMoldingTaskBody,
  MoldingTaskPreviewBody,
  ReportMoldingTaskBody,
  ReverseMoldingReportBody,
  StartMoldingTaskBody,
} from './molding.types'
import { ProductionPermissionGuard } from './production-permission.guard'

@Controller('admin/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MoldingController {
  constructor(private readonly molding: MoldingService) {}

  @Post('work-orders/:id/molding-task/preview')
  preview(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: MoldingTaskPreviewBody) {
    return this.molding.previewTask(request, id, body)
  }

  @Post('work-orders/:id/molding-task')
  create(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CreateMoldingTaskBody) {
    return this.molding.createTask(request, id, body)
  }

  @Get('molding-tasks')
  list(@Req() request: RequestWithAdmin, @Query('keyword') keyword?: string, @Query('status') status?: string, @Query('workOrderId') workOrderId?: string) {
    return this.molding.listTasks(request, { keyword, status, workOrderId })
  }

  @Get('molding-tasks/:id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.molding.getTask(request, id)
  }

  @Get('molding-tasks/:id/defect-options')
  defectOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.molding.defectOptions(request, id)
  }

  @Put('molding-tasks/:id/dispatch')
  dispatch(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: DispatchMoldingTaskBody) {
    return this.molding.dispatchTask(request, id, body)
  }

  @Post('molding-tasks/:id/start')
  start(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: StartMoldingTaskBody) {
    return this.molding.startTask(request, id, body)
  }

  @Post('molding-tasks/:id/report')
  report(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReportMoldingTaskBody) {
    return this.molding.reportTask(request, id, body)
  }

  @Post('molding-reports/:id/reverse')
  reverse(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReverseMoldingReportBody) {
    return this.molding.reverseReport(request, id, body)
  }

  @Post('molding-tasks/:id/cancel')
  cancel(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CancelMoldingTaskBody) {
    return this.molding.cancelTask(request, id, body)
  }
}

@Controller('mini/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MobileMoldingController {
  constructor(private readonly molding: MoldingService) {}

  @Get('molding-tasks')
  list(@Req() request: RequestWithAdmin, @Query('status') status?: string) {
    return this.molding.listTasks(request, { status }, true)
  }

  @Get('molding-tasks/by-code/:code')
  byCode(@Req() request: RequestWithAdmin, @Param('code') code: string) {
    return this.molding.getTaskByCode(request, code)
  }

  @Get('molding-tasks/:id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.molding.getTask(request, id, true)
  }

  @Get('molding-tasks/:id/defect-options')
  defectOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.molding.defectOptions(request, id, true)
  }

  @Post('molding-tasks/:id/start')
  start(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: StartMoldingTaskBody) {
    return this.molding.startTask(request, id, body, true)
  }

  @Post('molding-tasks/:id/report')
  report(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReportMoldingTaskBody) {
    return this.molding.reportTask(request, id, body, true)
  }
}
