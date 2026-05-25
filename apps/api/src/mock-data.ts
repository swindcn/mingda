export type MoldStatus = '待确认' | '待发货' | '待收货' | '待试产' | '试产中' | '已完成' | '已中止'
export type RecordType = 'trial' | 'batch' | 'evaluation'

export interface TodoItem {
  id: string
  title: string
  priority: '高' | '中' | '低'
  priorityTone: 'high' | 'middle' | 'low'
  moduleName: string
  stateText: string
  dueText: string
  moldId?: string
}

export interface FlowRecord {
  key: 'issue' | 'confirm' | 'shipping' | 'receive'
  title: string
  done: boolean
  operator?: string
  time?: string
  trackingNumber?: string
  images?: string[]
}

export interface ProductionRecord {
  id: string
  type: RecordType
  title: string
  operator?: string
  time: string
  images?: string[]
  result?: '通过' | '不通过'
  isComplete?: boolean
  reason?: string
}

export interface MoldDevelopmentItem {
  id: string
  code: string
  customerName: string
  productCode: string
  productName: string
  moldType: string
  status: MoldStatus
  statusTone: 'pending' | 'active' | 'done'
  supplierName: string
  followerName: string
  notifiedDate: string
  expectedDate: string
  issuedDate: string
  remark: string
  images: string[]
  flowRecords: FlowRecord[]
  productionRecords: ProductionRecord[]
}

export const todos: TodoItem[] = [
  {
    id: 'todo-1',
    title: '模具设计审核',
    priority: '高',
    priorityTone: 'high',
    moduleName: '模具开发',
    stateText: '待处理',
    dueText: '今天',
    moldId: 'MD001',
  },
  {
    id: 'todo-2',
    title: '生产进度跟进',
    priority: '中',
    priorityTone: 'middle',
    moduleName: '生产管理',
    stateText: '进行中',
    dueText: '明天',
    moldId: 'MD002',
  },
  {
    id: 'todo-3',
    title: '质量检测报告',
    priority: '低',
    priorityTone: 'low',
    moduleName: '质量控制',
    stateText: '待处理',
    dueText: '本周',
  },
]

export const molds: MoldDevelopmentItem[] = [
  {
    id: 'MD001',
    code: 'MD001',
    customerName: '长城汽车股份有限公司',
    productCode: 'P001',
    productName: '英沃保险柜门板内板',
    moldType: '压铸模',
    status: '待收货',
    statusTone: 'active',
    supplierName: '鑫源材料有限公司',
    followerName: '王五',
    notifiedDate: '2026-04-17',
    expectedDate: '2026-05-31',
    issuedDate: '2026-04-15',
    remark: '急件，优先处理',
    images: [
      '/assets/mock/mold-drawing.svg',
      '/assets/mock/product-drawing.svg',
      '/assets/mock/effect-drawing.svg',
    ],
    flowRecords: [
      {
        key: 'issue',
        title: '开发下达',
        done: true,
        operator: '张三',
        time: '2026-04-15 14:30',
        images: ['/assets/mock/mold-drawing.svg', '/assets/mock/product-drawing.svg'],
      },
      {
        key: 'confirm',
        title: '供应商确认',
        done: true,
        operator: '李四',
        time: '2026-04-16 09:20',
      },
      {
        key: 'shipping',
        title: '供应商发货',
        done: true,
        operator: '李四',
        time: '2026-04-20 15:10',
        trackingNumber: 'SF1234567890',
        images: ['/assets/mock/express.svg'],
      },
      {
        key: 'receive',
        title: '收货确认',
        done: false,
      },
    ],
    productionRecords: [],
  },
  {
    id: 'MD002',
    code: 'MD002',
    customerName: '比亚迪汽车工业有限公司',
    productCode: 'P002',
    productName: '球墨铸铁泵体',
    moldType: '砂型模',
    status: '待确认',
    statusTone: 'pending',
    supplierName: '华泰金属制品厂',
    followerName: '赵六',
    notifiedDate: '2026-05-18',
    expectedDate: '2026-06-20',
    issuedDate: '2026-05-18',
    remark: '按图纸要求开发',
    images: ['/assets/mock/mold-drawing.svg', '/assets/mock/product-drawing.svg'],
    flowRecords: [
      {
        key: 'issue',
        title: '开发下达',
        done: true,
        operator: '张三',
        time: '2026-05-18 10:00',
        images: ['/assets/mock/mold-drawing.svg'],
      },
      {
        key: 'confirm',
        title: '供应商确认',
        done: false,
      },
      {
        key: 'shipping',
        title: '供应商发货',
        done: false,
      },
      {
        key: 'receive',
        title: '收货确认',
        done: false,
      },
    ],
    productionRecords: [],
  },
]
