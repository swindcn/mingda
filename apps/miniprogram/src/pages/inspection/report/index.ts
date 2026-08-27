import { getInspectionDefects, getInspectionOptions, reportFinalInspection, uploadImage } from '../../../services/api'
import { InspectionDefectOption, InspectionOptions } from '../../../types/business'
import { isConflict } from '../../../utils/request'

interface DefectRow { defectCode: string; defectName: string; quantity: number; remark: string; selectedIndex: number }
const makeRequestId = () => `inspection-${Date.now()}-${Math.random().toString(36).slice(2)}`
const integer = (value: number | string) => Math.max(0, Math.floor(Number(value) || 0))

Page({
  data: { id: '', options: null as InspectionOptions | null, defects: [] as InspectionDefectOption[], defectRows: [] as DefectRow[], goodQty: 0, reworkQty: 0, scrapQty: 0, scrapWeightKg: '' as number | string, defaultScrapWeightKg: 0, imageUrl: '', remark: '', requestId: '', submitting: false },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || '', requestId: makeRequestId() }); void this.loadOptions() },
  async loadOptions() { try { const [options, defects] = await Promise.all([getInspectionOptions(this.data.id), getInspectionDefects(this.data.id)]); this.setData({ options, defects, goodQty: options.remainingQuantity, reworkQty: 0, scrapQty: 0, scrapWeightKg: '', defaultScrapWeightKg: 0, defectRows: [] }) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '终检信息加载失败', icon: 'none' }) } },
  updateQty(field: 'goodQty' | 'reworkQty' | 'scrapQty', value: number | string) { const next = integer(value); const patch: Record<string, number | DefectRow[]> = { [field]: next }; if (field === 'scrapQty') { patch.defaultScrapWeightKg = Number((next * Number(this.data.options?.unitNetWeightKg || 0)).toFixed(4)); if (!next && !this.data.reworkQty) patch.defectRows = [] } this.setData(patch) },
  adjustQty(event: WechatMiniprogram.TouchEvent) { const field = String(event.currentTarget.dataset.field) as 'goodQty' | 'reworkQty' | 'scrapQty'; this.updateQty(field, Number(this.data[field]) + Number(event.currentTarget.dataset.delta || 0)) },
  inputQty(event: WechatMiniprogram.Input) { this.updateQty(String(event.currentTarget.dataset.field) as 'goodQty' | 'reworkQty' | 'scrapQty', event.detail.value) },
  fillAll() { this.setData({ goodQty: this.data.options?.remainingQuantity || 0, reworkQty: 0, scrapQty: 0, scrapWeightKg: '', defaultScrapWeightKg: 0, defectRows: [] }) },
  inputWeight(event: WechatMiniprogram.Input) { this.setData({ scrapWeightKg: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  addDefect() { this.setData({ defectRows: [...this.data.defectRows, { defectCode: '', defectName: '', quantity: 1, remark: '', selectedIndex: -1 }] }) },
  removeDefect(event: WechatMiniprogram.TouchEvent) { const rows = [...this.data.defectRows]; rows.splice(Number(event.currentTarget.dataset.index), 1); this.setData({ defectRows: rows }) },
  chooseDefect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); const selectedIndex = Number(event.detail.value); const defect = this.data.defects[selectedIndex]; const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], selectedIndex, defectCode: defect.code, defectName: defect.name }; this.setData({ defectRows: rows }) },
  inputDefectQty(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], quantity: integer(event.detail.value) }; this.setData({ defectRows: rows }) },
  inputDefectRemark(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], remark: event.detail.value }; this.setData({ defectRows: rows }) },
  chooseImage() { wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: async (result) => { wx.showLoading({ title: '上传中' }); try { const uploaded = await uploadImage(result.tempFiles[0].tempFilePath); this.setData({ imageUrl: uploaded.url }) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' }) } finally { wx.hideLoading() } } }) },
  removeImage() { this.setData({ imageUrl: '' }) },
  previewImage() { if (this.data.imageUrl) wx.previewImage({ current: this.data.imageUrl, urls: [this.data.imageUrl] }) },
  async submit() {
    const options = this.data.options; if (!options || this.data.submitting) return
    if (!options.allowedActions.report) return wx.showToast({ title: '当前账号无终检报工权限', icon: 'none' })
    const goodQty = integer(this.data.goodQty); const reworkQty = integer(this.data.reworkQty); const scrapQty = integer(this.data.scrapQty); const total = goodQty + reworkQty + scrapQty
    if (total <= 0 || total > options.remainingQuantity) return wx.showToast({ title: `本次总数须大于0且不超过${options.remainingQuantity}`, icon: 'none' })
    if (this.data.defectRows.some((item) => !item.defectCode || item.quantity <= 0)) return wx.showToast({ title: '请完整填写缺陷信息', icon: 'none' })
    if (this.data.defectRows.reduce((sum, item) => sum + item.quantity, 0) > reworkQty + scrapQty) return wx.showToast({ title: '缺陷数量不能超过返修与报废数', icon: 'none' })
    const weight = this.data.scrapWeightKg === '' ? undefined : Number(this.data.scrapWeightKg)
    if (weight !== undefined && (!Number.isFinite(weight) || weight < 0)) return wx.showToast({ title: '回炉重量必须是非负数字', icon: 'none' })
    this.setData({ submitting: true })
    try {
      await reportFinalInspection({ workOrderId: this.data.id, requestId: this.data.requestId, goodQty, reworkQty, scrapQty, ...(weight === undefined ? {} : { scrapWeightKg: weight }), batchVersions: options.batchVersions.map(({ id, versionNo }) => ({ id, versionNo })), defects: this.data.defectRows.map((item) => ({ defectCode: item.defectCode, quantity: item.quantity, remark: item.remark.trim() || undefined })), imageUrl: this.data.imageUrl || undefined, remark: this.data.remark.trim() || undefined })
      wx.showToast({ title: '终检报工成功', icon: 'success' }); setTimeout(() => wx.navigateBack(), 600)
    } catch (error) { if (isConflict(error)) { wx.showToast({ title: '待检数据已更新，请重新提交', icon: 'none' }); this.setData({ requestId: makeRequestId() }); await this.loadOptions() } else wx.showToast({ title: error instanceof Error ? error.message : '终检报工失败', icon: 'none' }) }
    finally { this.setData({ submitting: false }) }
  },
})
