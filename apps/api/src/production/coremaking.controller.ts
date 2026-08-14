import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { CoremakingService } from './coremaking.service'
import type { CancelCoreTaskBody, CreateCoreTasksBody, DispatchCoreTaskBody, CoreTaskPreviewBody } from './coremaking.types'
import { ProductionPermissionGuard } from './production-permission.guard'

@Controller('admin/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class CoremakingController {
  constructor(private readonly coremaking: CoremakingService) {}

  @Post('work-orders/:id/core-tasks/preview')
  preview(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CoreTaskPreviewBody) {
    return this.coremaking.previewTasks(request, id, body)
  }

  @Post('work-orders/:id/core-tasks')
  create(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CreateCoreTasksBody) {
    return this.coremaking.createTasks(request, id, body)
  }

  @Get('core-tasks')
  list(
    @Req() request: RequestWithAdmin,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string,
  ) {
    return this.coremaking.listTasks(request, { keyword: keyword?.trim(), status, workOrderId })
  }

  @Get('core-tasks/:id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.getTask(request, id)
  }

  @Put('core-tasks/:id/dispatch')
  dispatch(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: DispatchCoreTaskBody) {
    return this.coremaking.dispatchTask(request, id, body)
  }

  @Post('core-tasks/:id/cancel')
  cancel(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CancelCoreTaskBody) {
    return this.coremaking.cancelTask(request, id, body)
  }
}
