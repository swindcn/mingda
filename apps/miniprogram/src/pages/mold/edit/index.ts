import {
  submitBatch,
  submitEvaluation,
  submitReceive,
  submitShipping,
  submitTrial,
  uploadImage,
} from '../../../services/api'

const titleMap: Record<string, string> = {
  shipping: '供应商发货',
  receive: '收货确认',
  trial: '试模生成',
  batch: '批量生产',
  evaluation: '模具评判',
}

Page({
  data: {
    id: '',
    type: 'shipping',
    title: '提交信息',
    trackingNumber: '',
    operator: '',
    result: '通过' as '通过' | '不通过',
    isComplete: true,
    reason: '',
    images: [] as string[],
    productImages: [] as string[],
    destructiveImages: [] as string[],
    submitting: false,
  },

  onLoad(query: Record<string, string>) {
    const type = query.type || 'shipping'
    this.setData({
      id: query.id || '',
      type,
      title: titleMap[type] || '提交信息',
      operator:
        wx.getStorageSync('mingda_display_name') ||
        wx.getStorageSync('mingda_login_account') ||
        '',
    })
  },

  onTrackingInput(event: WechatMiniprogram.Input) {
    this.setData({ trackingNumber: event.detail.value })
  },

  onOperatorInput(event: WechatMiniprogram.Input) {
    this.setData({ operator: event.detail.value })
  },

  onResultChange(event: WechatMiniprogram.RadioGroupChange) {
    this.setData({ result: event.detail.value as '通过' | '不通过' })
  },

  onCompleteChange(event: WechatMiniprogram.RadioGroupChange) {
    this.setData({ isComplete: event.detail.value === '是' })
  },

  onReasonInput(event: WechatMiniprogram.Input) {
    this.setData({ reason: event.detail.value })
  },

  appendImages(field: 'images' | 'productImages' | 'destructiveImages', sourceType: Array<'album' | 'camera'>) {
    const current = this.data[field] as string[]
    const remaining = Math.max(3 - current.length, 0)
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传3张图片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType,
      success: async (result) => {
        wx.showLoading({ title: '上传中' })
        try {
          const uploaded = await Promise.all(result.tempFiles.map((file) => uploadImage(file.tempFilePath)))
          this.setData({ [field]: [...current, ...uploaded.map((file) => file.url)] })
        } catch (error) {
          wx.showToast({
            title: error instanceof Error ? error.message : '上传失败',
            icon: 'none',
          })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  chooseImages() {
    this.appendImages('images', ['album'])
  },

  takeImages() {
    this.appendImages('images', ['camera'])
  },

  chooseProductImages() {
    this.appendImages('productImages', ['album'])
  },

  takeProductImages() {
    this.appendImages('productImages', ['camera'])
  },

  chooseDestructiveImages() {
    this.appendImages('destructiveImages', ['album'])
  },

  takeDestructiveImages() {
    this.appendImages('destructiveImages', ['camera'])
  },

  scanTrackingNumber() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (result) => {
        this.setData({ trackingNumber: result.result })
      },
      fail: () => {
        wx.showToast({ title: '未识别到快递单号', icon: 'none' })
      },
    })
  },

  async submit() {
    if (!this.data.id) {
      wx.showToast({ title: '缺少单据编号', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      if (this.data.type === 'shipping') {
        await submitShipping(this.data.id, {
          trackingNumber: this.data.trackingNumber,
          operator: this.data.operator,
          images: this.data.images,
        })
      } else if (this.data.type === 'receive') {
        await submitReceive(this.data.id, {
          operator: this.data.operator,
          images: this.data.images,
        })
      } else if (this.data.type === 'trial') {
        await submitTrial(this.data.id, {
          operator: this.data.operator,
          productImages: this.data.productImages,
          destructiveImages: this.data.destructiveImages,
          images: [...this.data.productImages, ...this.data.destructiveImages],
        })
      } else if (this.data.type === 'batch') {
        await submitBatch(this.data.id, {
          operator: this.data.operator,
          productImages: this.data.productImages,
          destructiveImages: this.data.destructiveImages,
          images: [...this.data.productImages, ...this.data.destructiveImages],
        })
      } else if (this.data.type === 'evaluation') {
        await submitEvaluation(this.data.id, {
          result: this.data.result,
          isComplete: this.data.isComplete,
          reason: this.data.reason,
        })
      }

      wx.showToast({ title: '已提交' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '提交失败',
        icon: 'none',
      })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
