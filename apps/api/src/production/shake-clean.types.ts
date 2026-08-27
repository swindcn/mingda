export interface ShakeCleanDefectInput {
  defectCode: string
  quantity: number
  remark?: string
}

export interface ShakeCleanBatchVersionInput {
  id: string
  versionNo: number
}

export interface CheckShakeBody {
  moldingTaskId: string
  quantity: number
  checkedAt?: string
}

export interface ReportShakeBody {
  moldingTaskId: string
  requestId: string
  stationEquipmentCode: string
  goodQty: number
  scrapQty: number
  batchVersions: ShakeCleanBatchVersionInput[]
  confirmedEarlyShake?: boolean
  defects?: ShakeCleanDefectInput[]
  remark?: string
}

export interface ReportCleaningBody {
  moldingTaskId: string
  requestId: string
  stationEquipmentCode: string
  goodQty: number
  scrapQty: number
  riseringScrapWeightKg?: number
  batchVersions: ShakeCleanBatchVersionInput[]
  defects?: ShakeCleanDefectInput[]
  remark?: string
}

export interface ReverseShakeCleanReportBody {
  versionNo: number
  reason: string
}

export interface ShakeCleanListQuery {
  keyword?: string
  status?: string
  workOrderId?: string
  page?: string | number
  pageSize?: string | number
  cursor?: string
}

export interface ShakeCleanListResponse<T = unknown> {
  records: T[]
  total: number
  page: number
  pageSize: number
  nextCursor?: string | null
}
