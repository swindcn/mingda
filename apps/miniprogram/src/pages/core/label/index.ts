import { getCoreTaskDetail } from '../../../services/api'
import { CoreBatchStatus, CoreInventoryBatch, MobileCoreTaskDetail } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'
import { createQrMatrix } from '../../../utils/qr-code'

interface LabelPageRequestState {
  latestRequest?: LatestRequestGate
  unloaded?: boolean
}

function requestState(page: unknown) {
  return page as LabelPageRequestState
}

function isRequestCurrent(state: LabelPageRequestState, gate: LatestRequestGate, requestId: number) {
  return !state.unloaded && state.latestRequest === gate && gate.isCurrent(requestId)
}

const batchLabels: Record<CoreBatchStatus, string> = {
  UNDRIED: '待烘干', AVAILABLE: '可用', WARNING: '临期', EXPIRED: '已失效', LOCKED: '已锁定', SCRAPPED: '已报废', CONSUMED: '已用完',
}

function dateText(value: string) {
  return value ? new Date(value).toLocaleString() : '-'
}

function decorate(task: MobileCoreTaskDetail, batch: CoreInventoryBatch) {
  const dryingText = !batch.dryingRequired ? '免烘干' : batch.driedAt ? `已烘干 · ${batchLabels[batch.status]}` : '待烘干'
  return {
    ...batch,
    taskCode: batch.taskCode || task.code,
    coreBoxCode: batch.coreBoxCode || task.coreBoxCode,
    coreBoxName: batch.coreBoxName || task.coreBoxName,
    productCode: batch.productCode || task.productCode,
    productName: batch.productName || task.productName,
    quantityText: `${batch.currentQuantity} / ${batch.initialQuantity}`,
    reportedAtText: dateText(batch.reportedAt),
    dryingText,
    expiresAtText: dateText(batch.expiresAt),
  }
}

Page({
  data: {
    taskId: '', batchId: '', label: null as ReturnType<typeof decorate> | null, loading: false,
  },
  onLoad(query: Record<string, string>) {
    const state = requestState(this)
    state.latestRequest = createLatestRequestGate()
    state.unloaded = false
    this.setData({ taskId: query.taskId || '', batchId: query.batchId || '' })
    void this.loadData()
  },
  onUnload() {
    const state = requestState(this)
    state.unloaded = true
    state.latestRequest?.invalidate()
  },
  onPullDownRefresh() {
    const state = requestState(this)
    void this.loadData().finally(() => { if (!state.unloaded) wx.stopPullDownRefresh() })
  },
  async loadData() {
    const state = requestState(this)
    const gate = state.latestRequest
    if (state.unloaded || !gate || !this.data.taskId || !this.data.batchId) return
    const requestId = gate.next()
    this.setData({ loading: true })
    try {
      const task = await getCoreTaskDetail(this.data.taskId)
      if (!isRequestCurrent(state, gate, requestId)) return
      const batch = task.batches.find((item) => item.id === this.data.batchId)
      if (!batch) throw new Error('批次标签不存在')
      if (!batch.qrContent) throw new Error('批次二维码内容为空')
      this.setData({ label: decorate(task, batch) })
      wx.nextTick(() => {
        if (isRequestCurrent(state, gate, requestId)) this.drawQr(batch.qrContent)
      })
    } catch (error) {
      if (!isRequestCurrent(state, gate, requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '批次标签加载失败', icon: 'none' })
    } finally {
      if (isRequestCurrent(state, gate, requestId)) this.setData({ loading: false })
    }
  },
  drawQr(qrContent: string) {
    const state = requestState(this)
    if (state.unloaded) return
    const modules = createQrMatrix(qrContent)
    wx.createSelectorQuery().in(this).select('#labelQr').fields({ node: true, size: true }).exec((results) => {
      if (state.unloaded) return
      const result = results[0] as {
        node: WechatMiniprogram.Canvas
        width: number
        height: number
      } | undefined
      if (!result?.node || !result.width) return
      const canvas = result.node
      const context = canvas.getContext('2d')
      const pixelRatio = wx.getWindowInfo().pixelRatio
      canvas.width = result.width * pixelRatio
      canvas.height = result.height * pixelRatio
      context.scale(pixelRatio, pixelRatio)
      const canvasSize = Math.min(result.width, result.height)
      const quietZone = 4
      const moduleSize = Math.max(1, Math.floor(canvasSize / (modules.length + quietZone * 2)))
      const qrSize = (modules.length + quietZone * 2) * moduleSize
      const offset = Math.floor((canvasSize - qrSize) / 2) + quietZone * moduleSize
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, result.width, result.height)
      context.fillStyle = '#111827'
      modules.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) context.fillRect(offset + x * moduleSize, offset + y * moduleSize, moduleSize, moduleSize)
      }))
    })
  },
})
