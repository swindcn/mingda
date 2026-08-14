import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { CoremakingService } from './coremaking.service'
import type {
  CancelCoreTaskBody,
  CreateCoreTasksBody,
  DispatchCoreTaskBody,
  DryCoreBatchBody,
  LockCoreBatchBody,
  ReportCoreTaskBody,
  ScrapCoreBatchBody,
  StartCoreTaskBody,
  CoreTaskPreviewBody,
  UnlockCoreBatchBody,
} from './coremaking.types'
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

  @Post('core-tasks/:id/start')
  start(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: StartCoreTaskBody) {
    return this.coremaking.startTask(request, id, body)
  }

  @Post('core-tasks/:id/report')
  report(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReportCoreTaskBody) {
    return this.coremaking.reportTask(request, id, body)
  }

  @Get('core-inventory')
  inventory(@Req() request: RequestWithAdmin) {
    return this.coremaking.listInventory(request)
  }

  @Post('core-batches/:id/dry')
  dry(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: DryCoreBatchBody) {
    return this.coremaking.dryBatch(request, id, body)
  }

  @Post('core-batches/:id/lock')
  lock(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: LockCoreBatchBody) {
    return this.coremaking.lockBatch(request, id, body)
  }

  @Post('core-batches/:id/unlock')
  unlock(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: UnlockCoreBatchBody) {
    return this.coremaking.unlockBatch(request, id, body)
  }

  @Post('core-batches/:id/scrap')
  scrap(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ScrapCoreBatchBody) {
    return this.coremaking.scrapBatch(request, id, body)
  }
}
