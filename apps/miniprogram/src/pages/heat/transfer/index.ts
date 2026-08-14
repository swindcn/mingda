import { getHeatExecutionOptions, transferHeatProduction } from '../../../services/api'
import { HeatExecutionOptions } from '../../../types/business'

function scannedCode(raw: string) {
  const text = raw.trim()
  const queryCode = text.match(/[?&]code=([^&]+)/)?.[1]
  if (queryCode) return decodeURIComponent(queryCode)
  return text.split('/').filter(Boolean).pop() || text
}

Page({
  data: {
    id: '', versionNo: 0, options: null as HeatExecutionOptions | null,
    deviceIndex: -1, transferDeviceCode: '', weightKg: '', remark: '', loading: false, submitting: false,
  },
  onLoad(query: Record<string, string>) {
    this.setData({ id: query.id || '', versionNo: Number(query.versionNo || 0) })
    void this.loadOptions()
  },
  async loadOptions() {
    this.setData({ loading: true })
    try { this.setData({ options: await getHeatExecutionOptions(this.data.id) }) }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '设备加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  selectDevice(event: WechatMiniprogram.PickerChange) {
    const deviceIndex = Number(event.detail.value)
    const transferDeviceCode = this.data.options?.transferDevices[deviceIndex]?.code || ''
    this.setData({ deviceIndex, transferDeviceCode })
  },
  scanDevice() {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (result) => {
        const code = scannedCode(result.result)
        const deviceIndex = this.data.options?.transferDevices.findIndex((item) => item.code === code) ?? -1
        if (deviceIndex < 0) { wx.showToast({ title: '该包号不在可用设备中', icon: 'none' }); return }
        this.setData({ deviceIndex, transferDeviceCode: code })
      },
    })
  },
  inputWeight(event: WechatMiniprogram.Input) { this.setData({ weightKg: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  async submit() {
    if (this.data.submitting) return
    const weightKg = Number(this.data.weightKg)
    if (!this.data.transferDeviceCode) { wx.showToast({ title: '请选择转运包设备', icon: 'none' }); return }
    if (!Number.isFinite(weightKg) || weightKg <= 0) { wx.showToast({ title: '请输入有效的转运重量', icon: 'none' }); return }
    if (weightKg > (this.data.options?.remainingTransferWeightKg || 0)) { wx.showToast({ title: '不能超过可转运数量', icon: 'none' }); return }
    this.setData({ submitting: true })
    try {
      await transferHeatProduction(this.data.id, { versionNo: this.data.versionNo, transferDeviceCode: this.data.transferDeviceCode, weightKg, remark: this.data.remark.trim() })
      wx.showToast({ title: '转运已记录', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' }) } finally { this.setData({ submitting: false }) }
  },
})
