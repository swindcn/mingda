import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import type { RequestWithAdmin } from '../shared/admin-context'
import { ProductionPermissionGuard } from './production-permission.guard'
import { ProductionService } from './production.service'
import type { AdjustHeatScheduleBody, HeatConflictBody, HeatOrderBody, VersionedActionBody } from './production.types'

@Controller('admin/production/melt-pool')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class MeltSchedulingController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  list(@Req() request: RequestWithAdmin) {
    return this.production.meltPool(request)
  }

  @Get('options')
  options(@Query('materialGradeCode') materialGradeCode?: string) {
    return this.production.meltPoolOptions(String(materialGradeCode || '').trim())
  }
}

@Controller('admin/production/heat-orders')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class HeatSchedulingController {
  constructor(private readonly production: ProductionService) {}

  @Post()
  create(@Req() request: RequestWithAdmin, @Body() body: HeatOrderBody) {
    return this.production.createHeatOrder(request, body)
  }

  @Post('check-conflicts')
  checkConflicts(@Req() request: RequestWithAdmin, @Body() body: HeatConflictBody) {
    return this.production.checkHeatOrderConflicts(request, body)
  }

  @Put(':id/schedule')
  adjustSchedule(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: AdjustHeatScheduleBody) {
    return this.production.adjustHeatOrderSchedule(request, id, body)
  }

  @Post(':id/cancel')
  cancel(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: VersionedActionBody & { reason?: string }) {
    return this.production.cancelHeatOrder(request, id, { ...body, remark: body.reason || body.remark })
  }
}

@Controller('admin/production/equipment-schedule')
@UseGuards(AdminAuthGuard, ProductionPermissionGuard)
export class EquipmentScheduleController {
  constructor(private readonly production: ProductionService) {}

  @Get('workshops')
  workshops() {
    return this.production.equipmentScheduleWorkshops()
  }

  @Get()
  list(@Req() request: RequestWithAdmin, @Query('workshopCode') workshopCode?: string, @Query('date') date?: string) {
    return this.production.equipmentSchedule(request, String(workshopCode || '').trim(), String(date || '').trim())
  }
}
