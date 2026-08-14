import { getCoreExecutionOptions, getCoreTaskDetail, reportCoreTask } from '../../../services/api'
import { CoreExecutionOptions, MobileCoreTaskDetail } from '../../../types/business'
import { createLatestRequestGate } from '../../../utils/latest-request'
import { isConflict } from '../../../utils/request'
import { extractScannedCode } from '../../../utils/scan-code'

const latestRequest = createLatestRequestGate()

Page({
  data: {
    id: '', versionNo: 0, task: null as MobileCoreTaskDetail | null, options: null as CoreExecutionOptions | null,
    operatorName: '', qualifiedQuantity: '', scrapQuantity: '0', defectReason: '', remark: '',
    shiftIndex: -1, shiftCode: '', sandBatchCode: '', dryingRequired: true, loading: false, submitting: false,
  },
  onLoad(query: Record<string, string>) {
    this.setData({
      id: query.id || '',
      versionNo: Number(query.versionNo || 0),
      operatorName: wx.getStorageSync('mingda_display_name') || '-',
    })
    void this.loadData()
  },
  onUnload() { latestRequest.invalidate() },
  onPullDownRefresh() { void this.loadData().finally(() => wx.stopPullDownRefresh()) },
  async loadData() {
    if (!this.data.id) return
    const requestId = latestRequest.next()
    this.setData({ loading: true })
    try {
      const [task, options] = await Promise.all([getCoreTaskDetail(this.data.id), getCoreExecutionOptions(this.data.id)])
      if (!latestRequest.isCurrent(requestId)) return
      const shiftIndex = options.shifts.findIndex((item) => item.code === this.data.shiftCode)
      this.setData({ task, options, versionNo: task.versionNo, shiftIndex, shiftCode: shiftIndex >= 0 ? this.data.shiftCode : '' })
    } catch (error) {
      if (!latestRequest.isCurrent(requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '报工数据加载失败', icon: 'none' })
    } finally {
      if (latestRequest.isCurrent(requestId)) this.setData({ loading: false })
    }
  },
  inputQualified(event: WechatMiniprogram.Input) { this.setData({ qualifiedQuantity: event.detail.value }) },
  inputScrap(event: WechatMiniprogram.Input) { this.setData({ scrapQuantity: event.detail.value }) },
  inputDefectReason(event: WechatMiniprogram.Input) { this.setData({ defectReason: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  inputSandBatch(event: WechatMiniprogram.Input) { this.setData({ sandBatchCode: event.detail.value }) },
  selectShift(event: WechatMiniprogram.PickerChange) {
    const shiftIndex = Number(event.detail.value)
    this.setData({ shiftIndex, shiftCode: this.data.options?.shifts[shiftIndex]?.code || '' })
  },
  scanSandBatch() {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (result) => this.setData({ sandBatchCode: extractScannedCode(result.result) }),
      fail: (error) => { if (!error.errMsg.includes('cancel')) wx.showToast({ title: '扫码失败，请手工输入', icon: 'none' }) },
    })
  },
  toggleDrying(event: WechatMiniprogram.SwitchChange) { this.setData({ dryingRequired: event.detail.value }) },
  async submit() {
    if (this.data.submitting) return
    const qualifiedQuantity = Number(this.data.qualifiedQuantity)
    const scrapQuantity = Number(this.data.scrapQuantity)
    if (!Number.isInteger(qualifiedQuantity) || qualifiedQuantity < 1) { wx.showToast({ title: '合格数须为正整数', icon: 'none' }); return }
    if (!Number.isInteger(scrapQuantity) || scrapQuantity < 0) { wx.showToast({ title: '废品数须为非负整数', icon: 'none' }); return }
    if (scrapQuantity > 0 && !this.data.defectReason.trim()) { wx.showToast({ title: '请填写废品原因', icon: 'none' }); return }
    if (!this.data.shiftCode) { wx.showToast({ title: '请选择班次', icon: 'none' }); return }
    this.setData({ submitting: true })
    try {
      await reportCoreTask(this.data.id, {
        versionNo: this.data.versionNo, qualifiedQuantity, scrapQuantity, shiftCode: this.data.shiftCode,
        sandBatchCode: this.data.sandBatchCode.trim(), dryingRequired: this.data.dryingRequired,
        defectReason: this.data.defectReason.trim(), remark: this.data.remark.trim(),
      })
      wx.showToast({ title: '报工成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) {
      if (isConflict(error)) await this.loadData()
      wx.showToast({ title: error instanceof Error ? error.message : '报工失败，请刷新重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
