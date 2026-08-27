import { checkPouring, getPouringDefects, getPouringOptions, reportPouring } from '../../../services/api'
import { MobilePouringOptions, PouringDefectOption } from '../../../types/business'

interface DefectRow { defectCode: string; defectName: string; quantity: number; remark: string; selectedIndex: number }
function makeRequestId() { return `pouring-${Date.now()}-${Math.random().toString(36).slice(2)}` }

Page({
  data: {
    id: '', options: null as MobilePouringOptions | null, defects: [] as PouringDefectOption[], defectRows: [] as DefectRow[],
    transferIndex: -1, stationIndex: -1, selectedTransferText: '', selectedStationText: '', goodQty: 0, scrapQty: 0,
    actualWeightKg: '' as number | string, remark: '', requestId: '', submitting: false,
  },
  async onLoad(options: Record<string, string>) {
    const id = options.id || ''
    this.setData({ id, requestId: makeRequestId() })
    try {
      const [executionOptions, defects] = await Promise.all([getPouringOptions(id), getPouringDefects(id)])
      this.setData({ options: executionOptions, defects, goodQty: executionOptions.remainingQuantity })
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '报工信息加载失败', icon: 'none' }) }
  },
  chooseTransfer(event: WechatMiniprogram.PickerChange) {
    const transferIndex = Number(event.detail.value); const item = this.data.options?.transfers[transferIndex]
    this.setData({ transferIndex, selectedTransferText: item ? `${item.heatOrderCode} · ${item.transferDeviceName} · 余额${item.balanceKg}kg` : '' })
  },
  chooseStation(event: WechatMiniprogram.PickerChange) {
    const stationIndex = Number(event.detail.value); const item = this.data.options?.stations[stationIndex]
    this.setData({ stationIndex, selectedStationText: item ? `${item.name}（${item.code}）` : '' })
  },
  scanTransfer() {
    wx.scanCode({ onlyFromCamera: false, success: (result) => {
      const value = result.result.trim(); const transfers = this.data.options?.transfers || []
      const matches = transfers.map((item, index) => ({ item, index })).filter(({ item }) => item.id === value || item.transferDeviceCode === value || item.heatOrderCode === value)
      if (matches.length === 1) this.setData({ transferIndex: matches[0].index, selectedTransferText: `${matches[0].item.heatOrderCode} · ${matches[0].item.transferDeviceName} · 余额${matches[0].item.balanceKg}kg` })
      else wx.showToast({ title: matches.length ? '同一包设备存在多个包次，请从列表确认' : '未匹配到可用铁水包次', icon: 'none' })
    } })
  },
  adjustGood(event: WechatMiniprogram.TouchEvent) { this.setData({ goodQty: Math.max(0, this.data.goodQty + Number(event.currentTarget.dataset.delta || 0)) }) },
  adjustScrap(event: WechatMiniprogram.TouchEvent) { this.setData({ scrapQty: Math.max(0, this.data.scrapQty + Number(event.currentTarget.dataset.delta || 0)) }) },
  inputGood(event: WechatMiniprogram.Input) { this.setData({ goodQty: Math.max(0, Number(event.detail.value || 0)) }) },
  inputScrap(event: WechatMiniprogram.Input) { this.setData({ scrapQty: Math.max(0, Number(event.detail.value || 0)) }) },
  fillRemaining() { this.setData({ goodQty: this.data.options?.remainingQuantity || 0, scrapQty: 0 }) },
  inputWeight(event: WechatMiniprogram.Input) { this.setData({ actualWeightKg: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  addDefect() { this.setData({ defectRows: [...this.data.defectRows, { defectCode: '', defectName: '', quantity: 1, remark: '', selectedIndex: -1 }] }) },
  removeDefect(event: WechatMiniprogram.TouchEvent) { const rows = [...this.data.defectRows]; rows.splice(Number(event.currentTarget.dataset.index), 1); this.setData({ defectRows: rows }) },
  chooseDefect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); const selectedIndex = Number(event.detail.value); const option = this.data.defects[selectedIndex]; const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], selectedIndex, defectCode: option.code, defectName: option.name }; this.setData({ defectRows: rows }) },
  inputDefectQty(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], quantity: Math.max(1, Number(event.detail.value || 1)) }; this.setData({ defectRows: rows }) },
  inputDefectRemark(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], remark: event.detail.value }; this.setData({ defectRows: rows }) },
  async submit() {
    const options = this.data.options
    if (!options || this.data.submitting) return
    if (this.data.transferIndex < 0) return wx.showToast({ title: '请选择铁水包次', icon: 'none' })
    if (this.data.stationIndex < 0) return wx.showToast({ title: '请选择浇注工位', icon: 'none' })
    if (this.data.goodQty + this.data.scrapQty <= 0) return wx.showToast({ title: '浇注箱数必须大于0', icon: 'none' })
    const defectTotal = this.data.defectRows.reduce((sum, item) => sum + item.quantity, 0)
    if (this.data.scrapQty > 0 && (!this.data.defectRows.length || this.data.defectRows.some((item) => !item.defectCode))) return wx.showToast({ title: '请选择浇注废品缺陷', icon: 'none' })
    if (defectTotal !== this.data.scrapQty) return wx.showToast({ title: '缺陷数量合计需等于废品数', icon: 'none' })
    const transfer = options.transfers[this.data.transferIndex]; const station = options.stations[this.data.stationIndex]
    const input = { moldingTaskId: this.data.id, heatOrderTransferId: transfer.id, stationEquipmentCode: station.code, goodQty: this.data.goodQty, scrapQty: this.data.scrapQty, ...(this.data.actualWeightKg === '' ? {} : { actualWeightKg: Number(this.data.actualWeightKg) }) }
    this.setData({ submitting: true })
    try {
      const checked = await checkPouring(input)
      this.setData({ actualWeightKg: checked.actualWeightKg })
      const warnings = [...(checked.warningCodes.includes('CRITICAL_HOLD') ? [`合型已停留${checked.holdMinutes}分钟，存在吸潮风险`] : []), ...(checked.warningCodes.includes('TRANSFER_OVERDRAW') ? [`铁水超用${checked.overdrawWeightKg}kg，提交后余额${checked.transferBalanceAfterKg}kg`] : [])]
      const confirmation = await new Promise<boolean>((resolve) => wx.showModal({ title: warnings.length ? '确认浇注警告' : '确认浇注报工', content: warnings.length ? warnings.join('；') : `合格${this.data.goodQty}箱，废品${this.data.scrapQty}箱，实际重量${checked.actualWeightKg}kg`, confirmText: '确认提交', success: (result) => resolve(result.confirm), fail: () => resolve(false) }))
      if (!confirmation) return
      await reportPouring({ ...input, actualWeightKg: checked.actualWeightKg, requestId: this.data.requestId, transferVersionNo: checked.transferVersionNo, confirmedWarningCodes: checked.warningCodes, defects: this.data.defectRows.map((item) => ({ defectCode: item.defectCode, quantity: item.quantity, remark: item.remark.trim() || undefined })), remark: this.data.remark.trim() || undefined })
      wx.showToast({ title: '浇注报工成功', icon: 'success' }); setTimeout(() => wx.navigateBack(), 600)
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '浇注报工失败，请刷新重试', icon: 'none' }) }
    finally { this.setData({ submitting: false }) }
  },
})
