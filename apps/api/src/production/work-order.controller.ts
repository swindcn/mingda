import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { ProductionPermissionGuard } from './production-permission.guard'
import { ProductionService } from './production.service'
import { WorkOrderRoutingExecutionService } from './work-order-routing-execution.service'
import type { WorkOrderBody } from './production.types'

@Controller('admin/production/work-orders')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class WorkOrderController {
  constructor(
    private readonly production: ProductionService,
    private readonly routingExecution: WorkOrderRoutingExecutionService,
  ) {}

  @Get('options')
  options() {
    return this.production.workOrderOptions()
  }

  @Get('product-preview/:productCode')
  preview(
    @Param('productCode') productCode: string,
    @Query('bomVersionId') bomVersionId?: string,
    @Query('routingVersionId') routingVersionId?: string,
  ) {
    return this.production.productPreview(productCode, bomVersionId, routingVersionId)
  }

  @Get()
  list(@Req() request: RequestWithAdmin, @Query('keyword') keyword?: string, @Query('status') status?: string) {
    return this.production.listWorkOrders(request, keyword?.trim(), status)
  }

  @Get(':id/routing-execution')
  routingExecutionSummary(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.routingExecution.getSummary(request, id)
  }

  @Post(':id/melt-release')
  releaseMelt(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: { routingNodeId?: string }) {
    return this.routingExecution.releaseMelt(request, id, body?.routingNodeId)
  }

  @Get(':id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.production.getWorkOrder(request, id)
  }

  @Post()
  create(@Req() request: RequestWithAdmin, @Body() body: WorkOrderBody) {
    return this.production.createWorkOrder(request, body)
  }

  @Put(':id')
  update(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: WorkOrderBody) {
    return this.production.updateWorkOrder(request, id, body)
  }

  @Post(':id/close')
  close(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: { versionNo?: number; reason?: string }) {
    return this.production.closeWorkOrder(request, id, Number(body.versionNo), String(body.reason || ''))
  }
}
