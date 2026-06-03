import { ModelingMasterPage } from './ModelingMasterPage'
import type { ModelingField, ModelingMasterPageProps } from './ModelingMasterPage'

const statusField: ModelingField = {
  name: 'status',
  label: '状态',
  type: 'select',
  options: ['启用', '停用'],
  width: 100,
}

const codeNameFields: ModelingField[] = [
  { name: 'code', label: '编码', required: true, width: 140, code: true },
  { name: 'name', label: '名称', required: true, width: 180 },
]

const workshopSelect: ModelingField = {
  name: 'workshopCode',
  label: '所属车间',
  type: 'select',
  required: true,
  optionSource: 'workshops',
  width: 160,
}

const itemSelect: ModelingField = {
  name: 'itemCode',
  label: '关联物料',
  type: 'select',
  required: true,
  optionSource: 'items',
  width: 170,
  formSpan: 3,
}

const supplierSelect: ModelingField = {
  name: 'supplierCode',
  label: '模具供应商',
  type: 'select',
  optionSource: 'suppliers',
  width: 170,
  formSpan: 3,
}

export const modelingPages: ModelingMasterPageProps[] = [
  {
    title: '车间与产线',
    description: '维护生产车间和产线基础资料，支撑后续工艺路线、设备和排班。',
    resource: 'workshops',
    permission: 'model.workshop-line',
    fields: [
      ...codeNameFields,
      { name: 'type', label: '车间类型', type: 'select', dictionaryKey: 'workshopTypes', width: 120 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '产线配置',
    description: '维护产线与瓶颈工序标识，归属于车间与产能模型。',
    resource: 'lines',
    permission: 'model.workshop-line',
    fields: [
      ...codeNameFields,
      workshopSelect,
      { name: 'isBottleneck', label: '瓶颈工序', type: 'checkbox', width: 100, hiddenInTable: true, hiddenInForm: true },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '班组配置',
    description: '维护车间班组、组长与成员，用于动态排班和报工归属。',
    resource: 'teams',
    permission: 'model.team',
    fields: [
      ...codeNameFields,
      workshopSelect,
      { name: 'memberUserIds', label: '班组成员', type: 'multiSelect', optionSource: 'employees', width: 180 },
      { name: 'leaderUserId', label: '班组长', type: 'select', optionSource: 'employees', width: 140 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '设备配置',
    description: '维护熔炼炉等关键设备及允许熔炼材质。',
    resource: 'equipment',
    permission: 'model.equipment',
    fields: [
      ...codeNameFields,
      { ...workshopSelect, required: false },
      { name: 'capacity', label: '容量', type: 'number', width: 100 },
      { name: 'allowedMaterialCodes', label: '允许材质', type: 'multiSelect', optionSource: 'materials', width: 180 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '物料管理',
    description: '维护需要生产的产品或半成品物料，用于生产建模引用。',
    resource: 'items',
    permission: 'basic.product',
    fields: [
      ...codeNameFields,
      { name: 'type', label: '物料类型', type: 'select', required: true, dictionaryKey: 'productTypes', width: 140 },
      { name: 'spec', label: '规格型号', width: 160 },
      { name: 'unit', label: '单位', width: 100 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '材质牌号',
    description: '维护材质牌号与元素红线，供熔炼配方和设备能力引用。',
    resource: 'materials',
    permission: 'model.material',
    fields: [
      ...codeNameFields,
      { name: 'standard', label: '执行标准', width: 140 },
      { name: 'elementLimits', label: '元素红线 JSON', type: 'json', hiddenInTable: true },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '熔炼配方',
    description: '维护目标材质和配料明细，明细以 JSON 记录物料编码与比例。',
    resource: 'recipes',
    permission: 'model.recipe',
    fields: [
      ...codeNameFields,
      { name: 'materialGradeCode', label: '目标材质', type: 'select', required: true, optionSource: 'materials', width: 160 },
      { name: 'version', label: '版本', width: 100 },
      { name: 'items', label: '配料明细 JSON', type: 'json', hiddenInTable: true },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '模具档案',
    description: '维护模具主档、型腔数与寿命数据，需手工建档并关联物料管理中的产品或半成品。',
    resource: 'molds',
    permission: 'mold.model',
    fields: [
      ...codeNameFields,
      itemSelect,
      supplierSelect,
      { name: 'moldType', label: '模具类型', type: 'select', dictionaryKey: 'moldTypes', width: 120, formSpan: 2 },
      { name: 'specModel', label: '规格型号', width: 140, formSpan: 2 },
      { name: 'sourceMoldDevelopmentCode', label: '关联开发单号', type: 'select', optionSource: 'moldDevelopments', width: 130, formSpan: 2 },
      { name: 'cavityCount', label: '型腔数', type: 'number', width: 100, formSpan: 2 },
      { name: 'maxLife', label: '使用寿命', type: 'number', width: 110, formSpan: 2 },
      { name: 'usedLife', label: '已用次数', type: 'number', width: 110, formSpan: 2 },
      { name: 'images', label: '模具图片', type: 'json', hiddenInTable: true, formSpan: 6 },
      { name: 'hasCoreBox', label: '是否有芯盒', type: 'checkbox', width: 110, formSpan: 6 },
      { name: 'coreBoxCode', label: '芯盒编码', width: 140, hiddenInTable: true, visibleWhen: { field: 'hasCoreBox', value: true } },
      { name: 'coreBoxName', label: '芯盒名称', width: 160, hiddenInTable: true, visibleWhen: { field: 'hasCoreBox', value: true } },
      { name: 'coreBoxMoldCode', label: '关联模具', width: 160, hiddenInTable: true, computed: true, visibleWhen: { field: 'hasCoreBox', value: true } },
      { name: 'coreBoxMaxLife', label: '芯盒使用寿命', type: 'number', width: 110, formSpan: 3, hiddenInTable: true, visibleWhen: { field: 'hasCoreBox', value: true } },
      { name: 'coreBoxUsedLife', label: '芯盒已用次数', type: 'number', width: 110, formSpan: 3, hiddenInTable: true, visibleWhen: { field: 'hasCoreBox', value: true } },
      { name: 'coreBoxImages', label: '芯盒图片', type: 'json', hiddenInTable: true, visibleWhen: { field: 'hasCoreBox', value: true } },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '芯盒档案',
    description: '维护芯盒与主模关系，后续用于砂芯齐套校验。',
    resource: 'coreboxes',
    permission: 'mold.corebox',
    fields: [
      ...codeNameFields,
      { name: 'moldCode', label: '关联模具', type: 'select', required: true, optionSource: 'molds', width: 160 },
      { name: 'images', label: '芯盒图片', type: 'json', hiddenInTable: true },
      { name: 'maxLife', label: '使用寿命', type: 'number', width: 110 },
      { name: 'usedLife', label: '已用次数', type: 'number', width: 110 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '班次主档',
    description: '维护班次编码和上下班时间，供工厂日历与动态排班引用。',
    resource: 'shifts',
    permission: 'model.calendar',
    fields: [
      ...codeNameFields,
      { name: 'startTime', label: '开始时间', type: 'time', required: true, width: 120 },
      { name: 'endTime', label: '结束时间', type: 'time', required: true, width: 120 },
      { name: 'crossDay', label: '跨日', type: 'checkbox', width: 90 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '工厂日历',
    description: '维护工作日、休息日、节假日和启用班次。',
    resource: 'calendars',
    permission: 'model.calendar',
    fields: [
      { name: 'date', label: '日期', required: true, width: 130 },
      { name: 'dayType', label: '日期类型', type: 'select', options: ['工作日', '休息日', '节假日'], width: 120 },
      { name: 'shiftCodes', label: '启用班次', type: 'multiSelect', optionSource: 'shifts', width: 180 },
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '工艺路线',
    description: '维护物料工艺路线和工序步骤，工序步骤以 JSON 明细维护。',
    resource: 'routings',
    permission: 'model.routing',
    fields: [
      ...codeNameFields,
      itemSelect,
      { name: 'version', label: '版本', width: 100 },
      { name: 'steps', label: '工序步骤 JSON', type: 'json', hiddenInTable: true },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    title: '缺陷代码库',
    description: '维护缺陷编码、分类与易发工序，供后续质检模块引用。',
    resource: 'defects',
    permission: 'model.defect',
    fields: [
      ...codeNameFields,
      { name: 'category', label: '缺陷分类', required: true, width: 130 },
      { name: 'sourceOperation', label: '易发工序', width: 140 },
      statusField,
      { name: 'remark', label: '备注', type: 'textarea' },
    ],
  },
]

export function createModelingPage(config: ModelingMasterPageProps) {
  return <ModelingMasterPage {...config} />
}
