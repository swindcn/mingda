import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
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
  ],
  providers: [ResourceParserService, ProductionService, ProductionPermissionGuard],
})
export class AppModule {}
