export interface PouringDefectInput {
  defectCode: string
  quantity: number
  remark?: string
}

export interface CheckPouringBody {
  moldingTaskId: string
  heatOrderTransferId: string
  stationEquipmentCode: string
  goodQty: number
  scrapQty: number
  actualWeightKg?: number
}

export interface ReportPouringBody extends CheckPouringBody {
  requestId: string
  transferVersionNo: number
  confirmedWarningCodes?: string[]
  defects?: PouringDefectInput[]
  remark?: string
}

export interface ReversePouringReportBody {
  transferVersionNo: number
  reason: string
}
