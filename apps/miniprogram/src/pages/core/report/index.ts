import { getCoreExecutionOptions, getCoreTaskDetail, reportCoreTask } from '../../../services/api'
import { CoreExecutionOptions, MobileCoreTaskDetail } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'
import { isConflict } from '../../../utils/request'

interface ReportPageRequestState {
  latestRequest?: LatestRequestGate
  unloaded?: boolean
}

interface DefectRow {
  defectCode: string
  defectName: string
  quantity: number
  remark: string
  selectedIndex: number
}

function requestState(page: unknown) {
  return page as ReportPageRequestState
}

function isRequestCurrent(state: ReportPageRequestState, gate: LatestRequestGate, requestId: number) {
  return !state.unloaded && state.latestRequest === gate && gate.isCurrent(requestId)
}

Page({
  data: {
    id: '', versionNo: 0, task: null as MobileCoreTaskDetail | null, options: null as CoreExecutionOptions | null,
    operatorName: '', qualifiedQuantity: '', scrapQuantity: '0', defectReason: '', defectRows: [] as DefectRow[], remark: '',
    teamIndex: -1, teamCode: '', shiftIndex: -1, shiftCode: '', dryingRequired: true, loading: false, submitting: false,
  },
  onLoad(query: Record<string, string>) {
    const state = requestState(this)
    state.latestRequest = createLatestRequestGate()
    state.unloaded = false
    this.setData({
      id: query.id || '',
      versionNo: Number(query.versionNo || 0),
      operatorName: wx.getStorageSync('mingda_display_name') || '-',
    })
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
    if (state.unloaded || !gate || !this.data.id) return
    const requestId = gate.next()
    this.setData({ loading: true })
    try {
      const [task, options] = await Promise.all([getCoreTaskDetail(this.data.id), getCoreExecutionOptions(this.data.id)])
      if (!isRequestCurrent(state, gate, requestId)) return
      const teamIndex = options.teams.findIndex((item) => item.code === task.teamCode)
      const shiftIndex = options.shifts.findIndex((item) => item.code === this.data.shiftCode)
      this.setData({
        task,
        options,
        versionNo: task.versionNo,
        teamIndex,
        teamCode: teamIndex >= 0 ? options.teams[teamIndex].code : '',
        shiftIndex,
        shiftCode: shiftIndex >= 0 ? this.data.shiftCode : '',
      })
    } catch (error) {
      if (!isRequestCurrent(state, gate, requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '报工数据加载失败', icon: 'none' })
    } finally {
      if (isRequestCurrent(state, gate, requestId)) this.setData({ loading: false })
    }
  },
  inputQualified(event: WechatMiniprogram.Input) { this.setData({ qualifiedQuantity: event.detail.value }) },
  inputScrap(event: WechatMiniprogram.Input) {
    const scrapQuantity = event.detail.value
    this.setData({ scrapQuantity, ...(Number(scrapQuantity || 0) <= 0 ? { defectRows: [] } : {}) })
  },
  inputDefectReason(event: WechatMiniprogram.Input) { this.setData({ defectReason: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  addDefect() {
    this.setData({ defectRows: [...this.data.defectRows, { defectCode: '', defectName: '', quantity: 1, remark: '', selectedIndex: -1 }] })
  },
  removeDefect(event: WechatMiniprogram.TouchEvent) {
    const rows = [...this.data.defectRows]
    rows.splice(Number(event.currentTarget.dataset.index), 1)
    this.setData({ defectRows: rows })
  },
  chooseDefect(event: WechatMiniprogram.PickerChange) {
    const rowIndex = Number(event.currentTarget.dataset.index)
    const selectedIndex = Number(event.detail.value)
    const option = this.data.options?.defects[selectedIndex]
    if (!option) return
    const rows = [...this.data.defectRows]
    rows[rowIndex] = { ...rows[rowIndex], selectedIndex, defectCode: option.code, defectName: option.name }
    this.setData({ defectRows: rows })
  },
  inputDefectQty(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index)
    const quantity = Math.max(1, Number(event.detail.value || 1))
    const rows = [...this.data.defectRows]
    rows[index] = { ...rows[index], quantity }
    this.setData({ defectRows: rows })
  },
  inputDefectRemark(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index)
    const rows = [...this.data.defectRows]
    rows[index] = { ...rows[index], remark: event.detail.value }
    this.setData({ defectRows: rows })
  },
  selectTeam(event: WechatMiniprogram.PickerChange) {
    const teamIndex = Number(event.detail.value)
    this.setData({ teamIndex, teamCode: this.data.options?.teams[teamIndex]?.code || '' })
  },
  selectShift(event: WechatMiniprogram.PickerChange) {
    const shiftIndex = Number(event.detail.value)
    this.setData({ shiftIndex, shiftCode: this.data.options?.shifts[shiftIndex]?.code || '' })
  },
  toggleDrying(event: WechatMiniprogram.SwitchChange) { this.setData({ dryingRequired: event.detail.value }) },
  async submit() {
    const state = requestState(this)
    if (state.unloaded || this.data.submitting) return
    const qualifiedQuantity = Number(this.data.qualifiedQuantity)
    const scrapQuantity = Number(this.data.scrapQuantity)
    if (!Number.isInteger(qualifiedQuantity) || qualifiedQuantity < 1) { wx.showToast({ title: '合格数须为正整数', icon: 'none' }); return }
    if (!Number.isInteger(scrapQuantity) || scrapQuantity < 0) { wx.showToast({ title: '废品数须为非负整数', icon: 'none' }); return }
    const defectTotal = this.data.defectRows.reduce((sum, item) => sum + item.quantity, 0)
    if (scrapQuantity > 0 && (!this.data.defectRows.length || this.data.defectRows.some((item) => !item.defectCode))) { wx.showToast({ title: '请选择废品缺陷', icon: 'none' }); return }
    if (defectTotal !== scrapQuantity) { wx.showToast({ title: '缺陷数量合计需等于废品数', icon: 'none' }); return }
    if (!this.data.teamCode) { wx.showToast({ title: '请选择班组', icon: 'none' }); return }
    if (!this.data.shiftCode) { wx.showToast({ title: '请选择班次', icon: 'none' }); return }
    this.setData({ submitting: true })
    try {
      await reportCoreTask(this.data.id, {
        versionNo: this.data.versionNo, qualifiedQuantity, scrapQuantity, teamCode: this.data.teamCode, shiftCode: this.data.shiftCode,
        dryingRequired: this.data.dryingRequired,
        defects: this.data.defectRows.map((item) => ({ defectCode: item.defectCode, quantity: item.quantity, remark: item.remark.trim() || undefined })),
        defectReason: this.data.defectReason.trim(), remark: this.data.remark.trim(),
      })
      if (state.unloaded) return
      wx.showToast({ title: '报工成功', icon: 'success' })
      setTimeout(() => { if (!state.unloaded) wx.navigateBack() }, 600)
    } catch (error) {
      if (state.unloaded) return
      if (isConflict(error)) {
        await this.loadData()
        if (state.unloaded) return
      }
      wx.showToast({ title: error instanceof Error ? error.message : '报工失败，请刷新重试', icon: 'none' })
    } finally {
      if (!state.unloaded) this.setData({ submitting: false })
    }
  },
})
