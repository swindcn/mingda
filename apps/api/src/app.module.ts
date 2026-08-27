import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { BasicDataController } from './basic-data.controller'
import { CastingBomController } from './casting-bom.controller'
import { ModelingController } from './modeling.controller'
import { MoldDevelopmentController } from './mold-development.controller'
import { OperationController } from './operation.controller'
import { ProcessRoutingController } from './process-routing/process-routing.controller'
import { PrismaModule } from './prisma/prisma.module'
import { ResourceParserController } from './resource-parser/resource-parser.controller'
import { ResourceParserService } from './resource-parser/resource-parser.service'
import { UploadController } from './upload.controller'
import { EquipmentScheduleController, HeatSchedulingController, MeltSchedulingController } from './production/melt-scheduling.controller'
import { HeatExecutionController, MobileHeatExecutionController } from './production/heat-execution.controller'
import { ProductionPermissionGuard } from './production/production-permission.guard'
import { ProductionService } from './production/production.service'
import { WorkOrderController } from './production/work-order.controller'
import { WorkOrderRoutingExecutionService } from './production/work-order-routing-execution.service'
import { CoremakingController, MobileCoremakingController } from './production/coremaking.controller'
import { CoremakingService } from './production/coremaking.service'
import { CoreInventoryScheduler } from './production/core-inventory.scheduler'
import { MobileMoldingController, MoldingController } from './production/molding.controller'
import { MoldingService } from './production/molding.service'
import { MobilePouringController, PouringController } from './production/pouring.controller'
import { PouringService } from './production/pouring.service'
import { MobileShakeCleanController, ShakeCleanController } from './production/shake-clean.controller'
import { ShakeCleanService } from './production/shake-clean.service'
import { FinalInspectionController, MobileFinalInspectionController } from './production/final-inspection.controller'
import { FinalInspectionService } from './production/final-inspection.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
  ],
  controllers: [
    AppController,
    MoldDevelopmentController,
    BasicDataController,
    CastingBomController,
    OperationController,
    ProcessRoutingController,
    ModelingController,
    ResourceParserController,
    UploadController,
    WorkOrderController,
    MeltSchedulingController,
    HeatSchedulingController,
    EquipmentScheduleController,
    HeatExecutionController,
    MobileHeatExecutionController,
    CoremakingController,
    MobileCoremakingController,
    MoldingController,
    MobileMoldingController,
    PouringController,
    MobilePouringController,
    ShakeCleanController,
    MobileShakeCleanController,
    FinalInspectionController,
    MobileFinalInspectionController,
  ],
  providers: [ResourceParserService, ProductionService, WorkOrderRoutingExecutionService, CoremakingService, MoldingService, PouringService, ShakeCleanService, FinalInspectionService, CoreInventoryScheduler, ProductionPermissionGuard],
})
export class AppModule {}
