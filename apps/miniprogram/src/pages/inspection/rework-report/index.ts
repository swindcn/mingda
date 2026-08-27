import { getCleaningReworkTask, reportCleaningRework } from '../../../services/api'
import { CleaningReworkTask } from '../../../types/business'
import { isConflict } from '../../../utils/request'

const makeRequestId = () => `rework-${Date.now()}-${Math.random().toString(36).slice(2)}`
const integer = (value: number | string) => Math.max(0, Math.floor(Number(value) || 0))

Page({
  data: { id: '', task: null as CleaningReworkTask | null, equipmentIndex: -1, equipmentText: '', goodQty: 0, scrapQty: 0, scrapWeightKg: '' as number | string, remark: '', requestId: '', submitting: false },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || '', requestId: makeRequestId() }); void this.loadTask() },
  async loadTask() { try { const task = await getCleaningReworkTask(this.data.id); this.setData({ task, goodQty: task.remainingQuantity, scrapQty: 0, scrapWeightKg: '', equipmentIndex: -1, equipmentText: '' }) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '返修任务加载失败', icon: 'none' }) } },
  chooseEquipment(event: WechatMiniprogram.PickerChange) { const index = Number(event.detail.value); const equipment = this.data.task?.equipment?.[index]; this.setData({ equipmentIndex: index, equipmentText: equipment ? `${equipment.name}（${equipment.code}）` : '' }) },
  adjustQty(event: WechatMiniprogram.TouchEvent) { const field = String(event.currentTarget.dataset.field) as 'goodQty' | 'scrapQty'; this.setData({ [field]: integer(Number(this.data[field]) + Number(event.currentTarget.dataset.delta || 0)) }) },
  inputQty(event: WechatMiniprogram.Input) { this.setData({ [String(event.currentTarget.dataset.field)]: integer(event.detail.value) }) },
  inputWeight(event: WechatMiniprogram.Input) { this.setData({ scrapWeightKg: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  async submit() {
    const task = this.data.task; if (!task || this.data.submitting) return
    if (!task.allowedActions?.report) return wx.showToast({ title: '当前账号无返修报工权限', icon: 'none' })
    const goodQty = integer(this.data.goodQty); const scrapQty = integer(this.data.scrapQty); const total = goodQty + scrapQty
    if (total <= 0 || total > task.remainingQuantity) return wx.showToast({ title: `本次总数须大于0且不超过${task.remainingQuantity}`, icon: 'none' })
    const equipment = task.equipment?.[this.data.equipmentIndex]; if (!equipment) return wx.showToast({ title: '请选择清理设备', icon: 'none' })
    const weight = this.data.scrapWeightKg === '' ? undefined : Number(this.data.scrapWeightKg); if (weight !== undefined && (!Number.isFinite(weight) || weight < 0)) return wx.showToast({ title: '回炉重量必须是非负数字', icon: 'none' })
    this.setData({ submitting: true })
    try { await reportCleaningRework({ taskId: task.id, requestId: this.data.requestId, goodQty, scrapQty, ...(weight === undefined ? {} : { scrapWeightKg: weight }), equipmentCode: equipment.code, versionNo: task.versionNo, remark: this.data.remark.trim() || undefined }); wx.showToast({ title: '返修报工成功', icon: 'success' }); setTimeout(() => wx.navigateBack(), 600) }
    catch (error) { if (isConflict(error)) { wx.showToast({ title: '返修任务已更新，请重新提交', icon: 'none' }); this.setData({ requestId: makeRequestId() }); await this.loadTask() } else wx.showToast({ title: error instanceof Error ? error.message : '返修报工失败', icon: 'none' }) }
    finally { this.setData({ submitting: false }) }
  },
})
