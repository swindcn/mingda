import { getShakeCleanDefects, getShakeCleanOptions, reportCleaning } from '../../../services/api'
import { MobileShakeCleanOptions, ShakeCleanDefectOption } from '../../../types/business'
import { isConflict } from '../../../utils/request'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'
import { canExecuteAction, canSubmitReport, createShakeCleanLifecycle, normalizeNonNegativeInteger, normalizeNonNegativeWeight, validateReportQuantities } from '../../../utils/shake-clean'

interface DefectRow { defectCode: string; defectName: string; quantity: number; remark: string; selectedIndex: number }
function makeRequestId() { return `clean-${Date.now()}-${Math.random().toString(36).slice(2)}` }
interface PageState { latestRequest?: LatestRequestGate; unloaded?: boolean; lifecycle?: ReturnType<typeof createShakeCleanLifecycle> }
const stateOf = (page: unknown) => page as PageState
const current = (state: PageState, gate: LatestRequestGate, id: number) => !state.unloaded && state.latestRequest === gate && gate.isCurrent(id)

Page({
  data: { id: '', options: null as MobileShakeCleanOptions | null, defects: [] as ShakeCleanDefectOption[], defectRows: [] as DefectRow[], equipmentIndex: -1, equipmentText: '', goodQty: 0, scrapQty: 0, riseringScrapWeightKg: '' as number | string, remark: '', requestId: '', submitting: false, completed: false, hasPermission: false },
  onLoad(query: Record<string, string>) { const state = stateOf(this); state.latestRequest = createLatestRequestGate(); state.lifecycle = createShakeCleanLifecycle(); state.unloaded = false; this.setData({ id: query.id || '', requestId: makeRequestId(), completed: false }); void this.loadOptions() },
  onUnload() { const state = stateOf(this); state.unloaded = true; state.latestRequest?.invalidate(); state.lifecycle?.markUnloaded() },
  async loadOptions() { const state = stateOf(this); const gate = state.latestRequest; if (state.unloaded || !gate) return; const id = gate.next(); try { const [options, defects] = await Promise.all([getShakeCleanOptions(this.data.id), getShakeCleanDefects(this.data.id)]); if (!current(state, gate, id)) return; const hasPermission = canExecuteAction(options.allowedActions, 'cleanReport'); this.setData({ options, defects, hasPermission, goodQty: options.cleaningRemaining, equipmentIndex: -1, equipmentText: '', completed: false }) } catch (error) { if (current(state, gate, id)) wx.showToast({ title: error instanceof Error ? error.message : '报工信息加载失败', icon: 'none' }) } },
  chooseEquipment(event: WechatMiniprogram.PickerChange) { const index = Number(event.detail.value); const equipment = this.data.options?.cleaningEquipment[index]; this.setData({ equipmentIndex: index, equipmentText: equipment ? `${equipment.name}（${equipment.code}）` : '' }) },
  scanEquipment() { wx.scanCode({ onlyFromCamera: false, success: (result) => { const value = result.result.trim(); const list = this.data.options?.cleaningEquipment || []; const index = list.findIndex((equipment) => equipment.code === value); if (index < 0) return wx.showToast({ title: '扫码设备不在可用清理设备中', icon: 'none' }); const equipment = list[index]; this.setData({ equipmentIndex: index, equipmentText: `${equipment.name}（${equipment.code}）` }) } }) },
  adjustGood(event: WechatMiniprogram.TouchEvent) { const current = normalizeNonNegativeInteger(this.data.goodQty) || 0; this.setData({ goodQty: Math.max(0, current + Number(event.currentTarget.dataset.delta || 0)) }) },
  setScrapQty(value: number) { const scrapQty = Math.max(0, value); this.setData({ scrapQty, ...(scrapQty === 0 ? { defectRows: [] } : {}) }) },
  adjustScrap(event: WechatMiniprogram.TouchEvent) { this.setScrapQty(this.data.scrapQty + Number(event.currentTarget.dataset.delta || 0)) },
  inputGood(event: WechatMiniprogram.Input) { this.setData({ goodQty: event.detail.value as unknown as number }) },
  inputScrap(event: WechatMiniprogram.Input) { this.setScrapQty(Number(event.detail.value || 0)) },
  inputWeight(event: WechatMiniprogram.Input) { this.setData({ riseringScrapWeightKg: event.detail.value }) },
  fillRemaining() { this.setData({ goodQty: this.data.options?.cleaningRemaining || 0, scrapQty: 0, defectRows: [] }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  addDefect() { this.setData({ defectRows: [...this.data.defectRows, { defectCode: '', defectName: '', quantity: 1, remark: '', selectedIndex: -1 }] }) },
  removeDefect(event: WechatMiniprogram.TouchEvent) { const rows = [...this.data.defectRows]; rows.splice(Number(event.currentTarget.dataset.index), 1); this.setData({ defectRows: rows }) },
  chooseDefect(event: WechatMiniprogram.PickerChange) { const rowIndex = Number(event.currentTarget.dataset.index); const selectedIndex = Number(event.detail.value); const defect = this.data.defects[selectedIndex]; const rows = [...this.data.defectRows]; rows[rowIndex] = { ...rows[rowIndex], selectedIndex, defectCode: defect.code, defectName: defect.name }; this.setData({ defectRows: rows }) },
  inputDefectQty(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const quantity = normalizeNonNegativeInteger(event.detail.value) || 0; const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], quantity }; this.setData({ defectRows: rows }) },
  inputDefectRemark(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], remark: event.detail.value }; this.setData({ defectRows: rows }) },
  async submit() {
    const state = stateOf(this); if (state.unloaded) return
    const options = this.data.options; if (!options || !canSubmitReport(this.data.submitting, this.data.completed, this.data.hasPermission)) return
    if (!this.data.hasPermission || !canExecuteAction(options.allowedActions, 'cleanReport')) return wx.showToast({ title: '当前账号无清理报工权限', icon: 'none' })
    const quantities = validateReportQuantities(this.data.goodQty, this.data.scrapQty, options.cleaningRemaining)
    if (!quantities.ok) return wx.showToast({ title: quantities.message, icon: 'none' })
    const { good: goodQty, scrap: scrapQty, total } = quantities
    if (this.data.equipmentIndex < 0) return wx.showToast({ title: '请选择清理设备', icon: 'none' })
    if (total <= 0 || total > options.cleaningRemaining) return wx.showToast({ title: `本次数量须大于0且不超过${options.cleaningRemaining}`, icon: 'none' })
    const defectTotal = this.data.defectRows.reduce((sum, item) => sum + item.quantity, 0)
    if (this.data.scrapQty > 0 && (!this.data.defectRows.length || this.data.defectRows.some((item) => !item.defectCode))) return wx.showToast({ title: '存在废品时请选择清理缺陷', icon: 'none' })
    if (defectTotal !== this.data.scrapQty) return wx.showToast({ title: '缺陷数量合计需等于废品数', icon: 'none' })
    const weight = normalizeNonNegativeWeight(this.data.riseringScrapWeightKg)
    if (this.data.riseringScrapWeightKg !== '' && weight === null) return wx.showToast({ title: '浇冒口重量必须是非负数字', icon: 'none' })
    const equipment = options.cleaningEquipment[this.data.equipmentIndex]
    this.setData({ submitting: true })
    try {
      await reportCleaning({ moldingTaskId: this.data.id, requestId: this.data.requestId, stationEquipmentCode: equipment.code, goodQty, scrapQty, ...(weight === null ? {} : { riseringScrapWeightKg: weight }), batchVersions: options.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), defects: this.data.defectRows.map((item) => ({ defectCode: item.defectCode, quantity: item.quantity, remark: item.remark.trim() || undefined })), remark: this.data.remark.trim() || undefined })
      if (state.unloaded) return
      this.setData({ completed: true }); wx.showToast({ title: '清理报工成功', icon: 'success' }); state.lifecycle?.setTimer(() => { if (state.lifecycle?.canContinue()) wx.navigateBack() }, 600)
    } catch (error) { if (state.unloaded) return; if (isConflict(error)) { wx.showToast({ title: '批次已更新，已刷新数据', icon: 'none' }); await this.loadOptions(); if (state.unloaded) return } else wx.showToast({ title: error instanceof Error ? error.message : '清理报工失败', icon: 'none' }) }
    finally { if (!state.unloaded && !this.data.completed) this.setData({ submitting: false }) }
  },
})
