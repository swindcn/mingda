import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CoremakingService } from './coremaking.service'

@Injectable()
export class CoreInventoryScheduler {
  constructor(private readonly coremaking: CoremakingService) {}

  @Cron('0 */10 * * * *')
  refreshStatuses() {
    return this.coremaking.refreshInventoryStatuses()
  }
}
