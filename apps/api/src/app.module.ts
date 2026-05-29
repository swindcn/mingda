import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { BasicDataController } from './basic-data.controller'
import { ModelingController } from './modeling.controller'
import { MoldDevelopmentController } from './mold-development.controller'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    PrismaModule,
  ],
  controllers: [AppController, MoldDevelopmentController, BasicDataController, ModelingController],
})
export class AppModule {}
