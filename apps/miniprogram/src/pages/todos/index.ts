import { getTodos } from '../../services/api'
import { TodoItem } from '../../types/business'

Page({
  data: {
    todos: [] as TodoItem[],
  },

  onShow() {
    void this.loadTodos()
  },

  async loadTodos() {
    try {
      this.setData({ todos: await getTodos() })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '待办加载失败',
        icon: 'none',
      })
    }
  },

  openTodo(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/mold/detail/index?id=${id}` })
    }
  },
})
