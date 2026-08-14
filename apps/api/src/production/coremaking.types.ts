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
