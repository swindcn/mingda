import { getCoreTaskDetail } from '../../../services/api'
import { CoreBatchStatus, CoreInventoryBatch, MobileCoreTaskDetail } from '../../../types/business'
import { createLatestRequestGate } from '../../../utils/latest-request'
import { createQrMatrix } from '../../../utils/qr-code'

const latestRequest = createLatestRequestGate()

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
    this.setData({ taskId: query.taskId || '', batchId: query.batchId || '' })
    void this.loadData()
  },
  onUnload() { latestRequest.invalidate() },
  onPullDownRefresh() { void this.loadData().finally(() => wx.stopPullDownRefresh()) },
  async loadData() {
    if (!this.data.taskId || !this.data.batchId) return
    const requestId = latestRequest.next()
    this.setData({ loading: true })
    try {
      const task = await getCoreTaskDetail(this.data.taskId)
      if (!latestRequest.isCurrent(requestId)) return
      const batch = task.batches.find((item) => item.id === this.data.batchId)
      if (!batch) throw new Error('批次标签不存在')
      if (!batch.qrContent) throw new Error('批次二维码内容为空')
      this.setData({ label: decorate(task, batch) })
      wx.nextTick(() => {
        if (latestRequest.isCurrent(requestId)) this.drawQr(batch.qrContent)
      })
    } catch (error) {
      if (!latestRequest.isCurrent(requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '批次标签加载失败', icon: 'none' })
    } finally {
      if (latestRequest.isCurrent(requestId)) this.setData({ loading: false })
    }
  },
  drawQr(qrContent: string) {
    const modules = createQrMatrix(qrContent)
    wx.createSelectorQuery().in(this).select('#labelQr').fields({ node: true, size: true }).exec((results) => {
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
