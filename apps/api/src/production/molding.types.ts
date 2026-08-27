export interface MoldingTaskPreviewBody {
  moldCode?: string
  routingNodeId?: string
}

export interface CreateMoldingTaskBody {
  moldCode: string
  routingNodeId?: string
  productionLineCode: string
  teamCode?: string
  plannedStartAt?: string
  remark?: string
}

export interface DispatchMoldingTaskBody {
  versionNo: number
  productionLineCode: string
  teamCode?: string
  plannedStartAt?: string
}

export interface StartMoldingTaskBody {
  versionNo: number
}

export interface MoldingDefectInput {
  defectCode: string
  quantity: number
  remark?: string
}

export interface ReportMoldingTaskBody {
  versionNo: number
  requestId: string
  goodQty: number
  scrapQty: number
  finishTask: boolean
  earlyCompletionReason?: string
  defects?: MoldingDefectInput[]
  remark?: string
}

export interface ReverseMoldingReportBody {
  versionNo: number
  reason: string
}

export interface CancelMoldingTaskBody {
  versionNo: number
  reason: string
}
