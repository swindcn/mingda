import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { CoremakingService } from './coremaking.service'
import type {
  CancelCoreTaskBody,
  CoreInventoryQuery,
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

  @Get('work-orders/:id/core-readiness')
  readiness(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.getCoreReadiness(request, id)
  }

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

  @Get('core-tasks/:id/options')
  taskOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.getCoreTaskOptions(request, id)
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
  inventory(@Req() request: RequestWithAdmin, @Query() query: CoreInventoryQuery) {
    return this.coremaking.listInventory(request, query)
  }

  @Get('core-inventory/options')
  inventoryOptions() {
    return this.coremaking.getCoreInventoryOptions()
  }

  @Get('core-inventory/:id')
  inventoryDetail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.getInventoryBatch(request, id)
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

@Controller('mini/production')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MobileCoremakingController {
  constructor(private readonly coremaking: CoremakingService) {}

  @Get('core-tasks')
  list(@Req() request: RequestWithAdmin, @Query('status') status?: string) {
    return this.coremaking.listTasks(request, { status }, true)
  }

  @Get('core-tasks/:id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.getTask(request, id, true)
  }

  @Get('core-tasks/:id/execution-options')
  executionOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.getCoreTaskOptions(request, id, true)
  }

  @Get('core-tasks/:id/drying-batches')
  dryingBatches(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.coremaking.listDryingBatches(request, id)
  }

  @Post('core-tasks/:id/start')
  start(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: StartCoreTaskBody) {
    return this.coremaking.startTask(request, id, body, true)
  }

  @Post('core-tasks/:id/report')
  report(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: ReportCoreTaskBody) {
    return this.coremaking.reportTask(request, id, body, true)
  }

  @Post('core-batches/:id/dry')
  dry(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: DryCoreBatchBody) {
    return this.coremaking.dryBatch(request, id, body, true)
  }
}
