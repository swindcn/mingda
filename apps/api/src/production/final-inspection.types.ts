export interface InspectionDefectInput {
  defectCode: string
  quantity: number
  remark?: string
}

export interface InspectionBatchVersionInput {
  id: string
  versionNo: number
}

export interface ReportFinalInspectionBody {
  workOrderId: string
  requestId: string
  goodQty: number
  reworkQty: number
  scrapQty: number
  scrapWeightKg?: number
  batchVersions: InspectionBatchVersionInput[]
  defects?: InspectionDefectInput[]
  imageUrl?: string
  remark?: string
}

export interface ReverseFinalInspectionBody {
  versionNo: number
  reason: string
}

export interface ReportCleaningReworkBody {
  taskId: string
  requestId: string
  goodQty: number
  scrapQty: number
  scrapWeightKg?: number
  equipmentCode: string
  versionNo: number
  remark?: string
}

export interface FinalInspectionListQuery {
  keyword?: string
  status?: string
  workOrderId?: string
  page?: string | number
  pageSize?: string | number
}
