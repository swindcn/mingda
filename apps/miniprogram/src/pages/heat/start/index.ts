import { getHeatExecutionOptions, startHeatProduction } from '../../../services/api'
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
    furnaceIndex: -1, furnaceCode: '', loading: false, submitting: false,
  },
  onLoad(query: Record<string, string>) {
    this.setData({ id: query.id || '', versionNo: Number(query.versionNo || 0) })
    void this.loadOptions()
  },
  async loadOptions() {
    this.setData({ loading: true })
    try {
      const options = await getHeatExecutionOptions(this.data.id)
      const code = options.actualFurnaceCode || options.plannedFurnaceCode
      const furnaceIndex = options.furnaces.findIndex((item) => item.code === code)
      this.setData({ options, furnaceCode: furnaceIndex >= 0 ? code : '', furnaceIndex })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '设备加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },
  selectFurnace(event: WechatMiniprogram.PickerChange) {
    const furnaceIndex = Number(event.detail.value)
    const furnaceCode = this.data.options?.furnaces[furnaceIndex]?.code || ''
    this.setData({ furnaceIndex, furnaceCode })
  },
  scanFurnace() {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (result) => {
        const code = scannedCode(result.result)
        const furnaceIndex = this.data.options?.furnaces.findIndex((item) => item.code === code) ?? -1
        if (furnaceIndex < 0) { wx.showToast({ title: '该炉号不在可用设备中', icon: 'none' }); return }
        this.setData({ furnaceIndex, furnaceCode: code })
      },
    })
  },
  async submit() {
    if (this.data.submitting || !this.data.options) return
    if (!this.data.furnaceCode) { wx.showToast({ title: '请选择实际熔炉', icon: 'none' }); return }
    const changed = this.data.furnaceCode !== this.data.options.plannedFurnaceCode
    if (changed) {
      const result = await wx.showModal({ title: '确认更换熔炉', content: '所选熔炉与计划熔炉不一致，是否更换并更新实际绑定关系？', confirmText: '确认更换' })
      if (!result.confirm) return
    }
    this.setData({ submitting: true })
    try {
      await startHeatProduction(this.data.id, { versionNo: this.data.versionNo, actualFurnaceCode: this.data.furnaceCode, confirmFurnaceChange: changed })
      wx.showToast({ title: '已开始生产', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' }) } finally { this.setData({ submitting: false }) }
  },
})
