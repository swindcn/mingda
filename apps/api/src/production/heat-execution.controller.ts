import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { ProductionPermissionGuard } from './production-permission.guard'
import { ProductionService } from './production.service'
import type { CompleteHeatOrderBody, StartHeatOrderBody, TransferHeatOrderBody } from './production.types'

@Controller('admin/production/heat-orders')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class HeatExecutionController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  list(@Req() request: RequestWithAdmin, @Query('status') status?: string) {
    return this.production.listHeatOrders(request, status, false)
  }

  @Get(':id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.production.getHeatOrder(request, id, false)
  }

  @Get(':id/execution-options')
  executionOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.production.heatExecutionOptions(request, id, false)
  }

  @Post(':id/start')
  start(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: StartHeatOrderBody) {
    return this.production.startHeatOrder(request, id, body, false)
  }

  @Post(':id/transfer')
  transfer(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: TransferHeatOrderBody) {
    return this.production.transferHeatOrder(request, id, body, false)
  }

  @Post(':id/complete')
  complete(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CompleteHeatOrderBody) {
    return this.production.completeHeatOrder(request, id, body, false)
  }
}

@Controller('mini/production/heat-orders')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MobileHeatExecutionController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  list(@Req() request: RequestWithAdmin, @Query('status') status?: string) {
    return this.production.listHeatOrders(request, status, true)
  }

  @Get(':id')
  detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.production.getHeatOrder(request, id, true)
  }

  @Get(':id/execution-options')
  executionOptions(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.production.heatExecutionOptions(request, id, true)
  }

  @Post(':id/start')
  start(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: StartHeatOrderBody) {
    return this.production.startHeatOrder(request, id, body, true)
  }

  @Post(':id/transfer')
  transfer(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: TransferHeatOrderBody) {
    return this.production.transferHeatOrder(request, id, body, true)
  }

  @Post(':id/complete')
  complete(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: CompleteHeatOrderBody) {
    return this.production.completeHeatOrder(request, id, body, true)
  }
}
