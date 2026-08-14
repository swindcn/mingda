export interface CoreTaskInput {
  coreBoxCode?: string
  expectedScrapRate?: number
  routingNodeId?: string
  equipmentCode?: string
  teamCode?: string
  plannedStartAt?: string
  remark?: string
}

export interface CoreTaskPreviewBody {
  rows?: CoreTaskInput[]
}

export interface CreateCoreTasksBody {
  rows?: CoreTaskInput[]
}

export interface DispatchCoreTaskBody {
  versionNo?: number
  equipmentCode?: string
  teamCode?: string
  plannedStartAt?: string
  remark?: string
}

export interface CancelCoreTaskBody {
  versionNo?: number
  reason?: string
}

export interface StartCoreTaskBody {
  versionNo?: number
}

export interface ReportCoreTaskBody {
  versionNo?: number
  qualifiedQuantity?: number
  scrapQuantity?: number
  shiftCode?: string
  sandBatchCode?: string
  dryingRequired?: boolean
  defectReason?: string
  remark?: string
}

export interface DryCoreBatchBody {
  versionNo?: number
  equipmentCode?: string
}

export interface LockCoreBatchBody {
  versionNo?: number
  reason?: string
}

export interface UnlockCoreBatchBody {
  versionNo?: number
}

export interface ScrapCoreBatchBody {
  versionNo?: number
  reason?: string
}
