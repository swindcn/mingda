import { getMobileHome } from '../../services/api'
import { TodoItem } from '../../types/business'

Page({
  data: {
    username: '1',
    todos: [] as TodoItem[],
    todoCount: 0,
    moldCount: 0,
    loading: false,
  },

  onShow() {
    const token = wx.getStorageSync('mingda_token')
    if (!token) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }

    getApp<IAppOption>().globalData.token = token
    this.setData({
      username: wx.getStorageSync('mingda_username') || '1',
    })
    void this.loadHome()
  },

  async loadHome() {
    this.setData({ loading: true })
    try {
      const result = await getMobileHome()
      this.setData({
        todos: result.todos,
        todoCount: result.todoCount,
        moldCount: result.moldCount,
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '首页数据加载失败',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  openTodo(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/mold/detail/index?id=${id}` })
    }
  },

  goTodos() {
    wx.navigateTo({ url: '/pages/todos/index' })
  },

  goMolds() {
    wx.navigateTo({ url: '/pages/mold/list/index' })
  },

  logout() {
    wx.removeStorageSync('mingda_token')
    wx.redirectTo({ url: '/pages/login/index' })
  },
})
