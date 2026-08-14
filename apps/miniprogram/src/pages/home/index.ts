import { getCurrentUser, getMobileHome } from '../../services/api'
import { TodoItem } from '../../types/business'

Page({
  data: {
    username: '1',
    todos: [] as TodoItem[],
    todoCount: 0,
    moldCount: 0,
    canViewHeats: false,
    canViewCoreTasks: false,
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
      username: wx.getStorageSync('mingda_display_name') || wx.getStorageSync('mingda_login_account') || '1',
      canViewHeats: (wx.getStorageSync('mingda_permissions') || []).includes('mini.production.heat.view'),
      canViewCoreTasks: (wx.getStorageSync('mingda_permissions') || []).includes('mini.production.core.view'),
    })
    void this.loadHome()
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => wx.stopPullDownRefresh())
  },

  async loadHome() {
    this.setData({ loading: true })
    try {
      const [result, user] = await Promise.all([getMobileHome(), getCurrentUser()])
      const permissions = user.permissions || []
      wx.setStorageSync('mingda_permissions', permissions)
      getApp<IAppOption>().globalData.permissions = permissions
      this.setData({
        todos: result.todos,
        todoCount: result.todoCount,
        moldCount: result.moldCount,
        canViewHeats: user.userType === 'SUPER_ADMIN' || user.username === 'admin' || permissions.includes('mini.production.heat.view'),
        canViewCoreTasks: user.userType === 'SUPER_ADMIN' || user.username === 'admin' || permissions.includes('mini.production.core.view'),
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

  goHeats() {
    wx.navigateTo({ url: '/pages/heat/list/index' })
  },

  goCoreTasks() {
    wx.navigateTo({ url: '/pages/core/list/index' })
  },

  logout() {
    wx.removeStorageSync('mingda_token')
    wx.removeStorageSync('mingda_permissions')
    wx.redirectTo({ url: '/pages/login/index' })
  },
})
