import type { DataNode } from 'antd/es/tree'
import { apiRequest } from '../services/api'
import { loadUsers } from './users'

export const ROLE_STORAGE_KEY = 'mingda-roles'
export const ROLE_STORAGE_EVENT = 'mingda-roles-updated'

export type DataScope = 'self' | 'department' | 'department_tree' | 'organization' | 'custom_departments'

export interface RoleRecord {
  id: string
  name: string
  organization: string
  app: string
  description?: string
  createdBy: string
  createdAt: string
  permissions: string[]
  dataScope: DataScope
  dataScopes?: DataScope[]
  customDepartments: Array<{ departmentId: string; includeChildren: boolean }>
  columnPermissions: string[]
  userIds: string[]
}

export interface AdminUser {
  id: string
  name: string
  userType: string
  username?: string
  permissions?: string[]
  dataScope?: DataScope
  dataScopes?: DataScope[]
  columnPermissions?: string[]
}

export const publicSyncPermissionKeys = ['basic.product.view_synced_public', 'production.work_order.view_synced_public'] as const

export const productionPermissionKeys = [
  'production',
  'production.work_order.view',
  'production.work_order.create',
  'production.work_order.edit',
  'production.work_order.close',
  'production.work_order.view_synced_public',
  'production.core_task.view',
  'production.core_task.create',
  'production.core_task.dispatch',
  'production.core_task.edit',
  'production.core_task.cancel',
  'production.core_task.start',
  'production.core_task.report',
  'production.core_task.dry',
  'production.core_inventory.view',
  'production.core_inventory.dry',
  'production.core_inventory.lock',
  'production.core_inventory.scrap',
  'production.molding.view',
  'production.molding.create',
  'production.molding.dispatch',
  'production.molding.start',
  'production.molding.report',
  'production.molding.cancel',
  'production.molding.reverse',
  'production.pouring.view',
  'production.pouring.report',
  'production.pouring.reverse',
  'production.shake_clean.view',
  'production.shake_clean.shake_report',
  'production.shake_clean.clean_report',
  'production.shake_clean.reverse',
  'production.inspection.view',
  'production.inspection.report',
  'production.inspection.reverse',
  'production.cleaning_rework.view',
  'production.cleaning_rework.report',
  'production.schedule.view',
  'production.schedule.release',
  'production.schedule.create',
  'production.schedule.adjust',
  'production.schedule.cancel',
  'production.heat.view',
  'production.heat.start',
  'production.heat.transfer',
  'production.heat.complete',
] as const

export const miniProgramPermissionKeys = [
  'mini',
  'mini.mold',
  'mini.mold.development.view',
  'mini.production',
  'mini.production.heat.view',
  'mini.production.heat.start',
  'mini.production.heat.transfer',
  'mini.production.heat.complete',
  'mini.production.core.view',
  'mini.production.core.start',
  'mini.production.core.report',
  'mini.production.core.dry',
  'mini.production.molding.view',
  'mini.production.molding.start',
  'mini.production.molding.report',
  'mini.production.pouring.view',
  'mini.production.pouring.report',
  'mini.production.shake_clean.view',
  'mini.production.shake_clean.shake_report',
  'mini.production.shake_clean.clean_report',
  'mini.production.inspection.view',
  'mini.production.inspection.report',
  'mini.production.cleaning_rework.view',
  'mini.production.cleaning_rework.report',
] as const

export const modelingPermissionKeys = [
  'model',
  'model.workshop-line.view',
  'model.workshop-line.create',
  'model.workshop-line.edit',
  'model.workshop-line.delete',
  'model.team.view',
  'model.team.create',
  'model.team.edit',
  'model.team.delete',
  'model.equipment.view',
  'model.equipment.create',
  'model.equipment.edit',
  'model.equipment.delete',
  'process',
  'model.material.view',
  'model.material.create',
  'model.material.edit',
  'model.material.delete',
  'model.recipe.view',
  'model.recipe.create',
  'model.recipe.edit',
  'model.recipe.delete',
  'model.recipe.clone',
  'model.recipe.activate',
  'model.recipe.disable',
  'model.bom.view',
  'model.bom.create',
  'model.bom.edit',
  'model.bom.delete',
  'model.bom.clone',
  'model.bom.activate',
  'model.bom.disable',
  'model.bom.new_version',
  'model.operation.view',
  'model.operation.create',
  'model.operation.edit',
  'model.operation.disable',
  'model.routing.view',
  'model.routing.create',
  'model.routing.edit',
  'model.routing.delete',
  'model.routing.version',
  'model.routing.clone',
  'model.routing.activate',
  'model.routing.disable',
  'model.routing.default',
  'model.routing.recycle',
  'model.calendar.view',
  'model.calendar.create',
  'model.calendar.edit',
  'model.calendar.delete',
  'model.schedule.view',
  'model.schedule.create',
  'model.schedule.edit',
  'model.schedule.delete',
  'model.schedule.batch',
  'model.defect.view',
  'model.defect.create',
  'model.defect.edit',
  'model.defect.delete',
  'mold.model.view',
  'mold.model.create',
  'mold.model.edit',
  'mold.model.delete',
  'mold.corebox.view',
  'mold.corebox.create',
  'mold.corebox.edit',
  'mold.corebox.delete',
] as const

export const adminPermissionTree: DataNode[] = [
  {
    title: '管理端',
    key: 'admin',
    children: [
      {
        title: '基础资料',
        key: 'basic',
        children: [
          {
            title: '部门管理',
            key: 'group.basic.department',
            children: [
              { title: '部门管理-数据列表', key: 'basic.department' },
              { title: '部门管理-新增', key: 'basic.department.create' },
              { title: '部门管理-编辑', key: 'basic.department.edit' },
              { title: '部门管理-删除', key: 'basic.department.delete' },
              { title: '部门管理-同步', key: 'basic.department.sync' },
            ],
          },
          {
            title: '用户管理',
            key: 'group.basic.user',
            children: [
              { title: '用户管理-数据列表', key: 'basic.user' },
              { title: '用户管理-新增', key: 'basic.user.create' },
              { title: '用户管理-编辑', key: 'basic.user.edit' },
              { title: '用户管理-删除', key: 'basic.user.delete' },
              { title: '用户管理-同步', key: 'basic.user.sync' },
            ],
          },
          {
            title: '角色权限',
            key: 'group.basic.role',
            children: [
              { title: '角色权限-数据列表', key: 'basic.role' },
              { title: '角色权限-新增', key: 'basic.role.create' },
              { title: '角色权限-编辑', key: 'basic.role.edit' },
              { title: '角色权限-删除', key: 'basic.role.delete' },
              { title: '角色权限-配置权限', key: 'basic.role.config' },
              { title: '角色权限-配置用户', key: 'basic.role.users' },
              { title: '角色权限-复制', key: 'basic.role.copy' },
            ],
          },
          {
            title: '客户管理',
            key: 'group.basic.customer',
            children: [
              { title: '客户管理-数据列表', key: 'basic.customer' },
              { title: '客户管理-新增', key: 'basic.customer.create' },
              { title: '客户管理-编辑', key: 'basic.customer.edit' },
              { title: '客户管理-删除', key: 'basic.customer.delete' },
            ],
          },
          {
            title: '供应商管理',
            key: 'group.basic.supplier',
            children: [
              { title: '供应商管理-数据列表', key: 'basic.supplier' },
              { title: '供应商管理-新增', key: 'basic.supplier.create' },
              { title: '供应商管理-编辑', key: 'basic.supplier.edit' },
              { title: '供应商管理-删除', key: 'basic.supplier.delete' },
            ],
          },
          {
            title: '物料管理',
            key: 'group.basic.product',
            children: [
              { title: '物料管理-数据列表', key: 'basic.product' },
              { title: '物料管理-新增', key: 'basic.product.create' },
              { title: '物料管理-编辑', key: 'basic.product.edit' },
              { title: '物料管理-删除', key: 'basic.product.delete' },
            ],
          },
          {
            title: '字典设置',
            key: 'group.basic.dictionary',
            children: [
              { title: '字典设置-数据列表', key: 'basic.dictionary' },
              { title: '字典设置-编辑', key: 'basic.dictionary.edit' },
            ],
          },
        ],
      },
      {
        title: '模具业务',
        key: 'mold',
        children: [
          {
            title: '模具开发',
            key: 'group.mold.development',
            children: [
              { title: '模具开发-数据列表', key: 'mold.development.view' },
              { title: '模具开发-下达', key: 'mold.development.create' },
              { title: '模具开发-编辑', key: 'mold.development.edit' },
              { title: '模具开发-删除', key: 'mold.development.delete' },
            ],
          },
          {
            title: '模具档案',
            key: 'group.mold.model',
            children: [
              { title: '模具档案-数据列表', key: 'mold.model.view' },
              { title: '模具档案-新增', key: 'mold.model.create' },
              { title: '模具档案-编辑', key: 'mold.model.edit' },
              { title: '模具档案-删除', key: 'mold.model.delete' },
            ],
          },
          {
            title: '芯盒档案',
            key: 'group.mold.corebox',
            children: [
              { title: '芯盒档案-数据列表', key: 'mold.corebox.view' },
              { title: '芯盒档案-新增', key: 'mold.corebox.create' },
              { title: '芯盒档案-编辑', key: 'mold.corebox.edit' },
              { title: '芯盒档案-删除', key: 'mold.corebox.delete' },
            ],
          },
        ],
      },
      {
        title: '生产建模',
        key: 'model',
        children: [
          {
            title: '车间与产线',
            key: 'group.model.workshop-line',
            children: [
              { title: '车间与产线-数据列表', key: 'model.workshop-line.view' },
              { title: '车间与产线-新增', key: 'model.workshop-line.create' },
              { title: '车间与产线-编辑', key: 'model.workshop-line.edit' },
              { title: '车间与产线-删除', key: 'model.workshop-line.delete' },
            ],
          },
          {
            title: '班组配置',
            key: 'group.model.team',
            children: [
              { title: '班组配置-数据列表', key: 'model.team.view' },
              { title: '班组配置-新增', key: 'model.team.create' },
              { title: '班组配置-编辑', key: 'model.team.edit' },
              { title: '班组配置-删除', key: 'model.team.delete' },
            ],
          },
          {
            title: '设备配置',
            key: 'group.model.equipment',
            children: [
              { title: '设备配置-数据列表', key: 'model.equipment.view' },
              { title: '设备配置-新增', key: 'model.equipment.create' },
              { title: '设备配置-编辑', key: 'model.equipment.edit' },
              { title: '设备配置-删除', key: 'model.equipment.delete' },
            ],
          },
          {
            title: '工厂日历',
            key: 'group.model.calendar',
            children: [
              { title: '工厂日历-数据列表', key: 'model.calendar.view' },
              { title: '工厂日历-新增', key: 'model.calendar.create' },
              { title: '工厂日历-编辑', key: 'model.calendar.edit' },
              { title: '工厂日历-删除', key: 'model.calendar.delete' },
            ],
          },
          {
            title: '动态排班表',
            key: 'group.model.schedule',
            children: [
              { title: '动态排班表-数据列表', key: 'model.schedule.view' },
              { title: '动态排班表-新增', key: 'model.schedule.create' },
              { title: '动态排班表-编辑', key: 'model.schedule.edit' },
              { title: '动态排班表-删除', key: 'model.schedule.delete' },
              { title: '动态排班表-一键生成', key: 'model.schedule.batch' },
            ],
          },
        ],
      },
      {
        title: '生产管理',
        key: 'production',
        children: [
          {
            title: '生产工单',
            key: 'group.production.work_order',
            children: [
              { title: '生产工单-数据列表', key: 'production.work_order.view' },
              { title: '生产工单-新增并提交', key: 'production.work_order.create' },
              { title: '生产工单-编辑', key: 'production.work_order.edit' },
              { title: '生产工单-强制关闭', key: 'production.work_order.close' },
              { title: '生产工单-查看第三方同步数据', key: 'production.work_order.view_synced_public' },
            ],
          },
          {
            title: '制芯任务',
            key: 'group.production.core_task',
            children: [
              { title: '制芯任务-数据列表', key: 'production.core_task.view' },
              { title: '制芯任务-生成', key: 'production.core_task.create' },
              { title: '制芯任务-派工', key: 'production.core_task.dispatch' },
              { title: '制芯任务-编辑', key: 'production.core_task.edit' },
              { title: '制芯任务-取消', key: 'production.core_task.cancel' },
              { title: '制芯任务-开始', key: 'production.core_task.start' },
              { title: '制芯任务-报工', key: 'production.core_task.report' },
              { title: '制芯任务-烘干', key: 'production.core_task.dry' },
            ],
          },
          {
            title: '砂芯库存',
            key: 'group.production.core_inventory',
            children: [
              { title: '砂芯库存-数据列表', key: 'production.core_inventory.view' },
              { title: '砂芯库存-烘干', key: 'production.core_inventory.dry' },
              { title: '砂芯库存-锁定/解锁', key: 'production.core_inventory.lock' },
              { title: '砂芯库存-报废', key: 'production.core_inventory.scrap' },
            ],
          },
          {
            title: '造型下芯',
            key: 'group.production.molding',
            children: [
              { title: '造型下芯-数据列表', key: 'production.molding.view' },
              { title: '造型下芯-生成任务', key: 'production.molding.create' },
              { title: '造型下芯-派工', key: 'production.molding.dispatch' },
              { title: '造型下芯-开始生产', key: 'production.molding.start' },
              { title: '造型下芯-报工', key: 'production.molding.report' },
              { title: '造型下芯-取消', key: 'production.molding.cancel' },
              { title: '造型下芯-撤销报工', key: 'production.molding.reverse' },
            ],
          },
          {
            title: '合型浇注',
            key: 'group.production.pouring',
            children: [
              { title: '合型浇注-数据列表', key: 'production.pouring.view' },
              { title: '合型浇注-报工', key: 'production.pouring.report' },
              { title: '合型浇注-撤销报工', key: 'production.pouring.reverse' },
            ],
          },
          {
            title: '落砂清理',
            key: 'group.production.shake_clean',
            children: [
              { title: '落砂清理-数据列表', key: 'production.shake_clean.view' },
              { title: '落砂清理-落砂报工', key: 'production.shake_clean.shake_report' },
              { title: '落砂清理-清理报工', key: 'production.shake_clean.clean_report' },
              { title: '落砂清理-撤销报工', key: 'production.shake_clean.reverse' },
            ],
          },
          {
            title: '成品终检',
            key: 'group.production.inspection',
            children: [
              { title: '成品终检-数据列表', key: 'production.inspection.view' },
              { title: '成品终检-质检报工', key: 'production.inspection.report' },
              { title: '成品终检-撤销报工', key: 'production.inspection.reverse' },
            ],
          },
          {
            title: '清理返修',
            key: 'group.production.cleaning_rework',
            children: [
              { title: '清理返修-数据列表', key: 'production.cleaning_rework.view' },
              { title: '清理返修-报工', key: 'production.cleaning_rework.report' },
            ],
          },
          {
            title: '合炉排产',
            key: 'group.production.schedule',
            children: [
              { title: '合炉排产-数据列表', key: 'production.schedule.view' },
              { title: '生产工单-下达熔炼排产', key: 'production.schedule.release' },
              { title: '合炉排产-生成熔炼任务', key: 'production.schedule.create' },
              { title: '合炉排产-调整排程', key: 'production.schedule.adjust' },
              { title: '合炉排产-撤销熔炼任务', key: 'production.schedule.cancel' },
            ],
          },
          {
            title: '熔炼执行',
            key: 'group.production.heat',
            children: [
              { title: '熔炼执行-数据列表', key: 'production.heat.view' },
              { title: '熔炼执行-开始生产', key: 'production.heat.start' },
              { title: '熔炼执行-转运出炉', key: 'production.heat.transfer' },
              { title: '熔炼执行-完成生产', key: 'production.heat.complete' },
            ],
          },
        ],
      },
      {
        title: '工艺管理',
        key: 'process',
        children: [
          {
            title: '材质牌号',
            key: 'group.model.material',
            children: [
              { title: '材质牌号-数据列表', key: 'model.material.view' },
              { title: '材质牌号-新增', key: 'model.material.create' },
              { title: '材质牌号-编辑', key: 'model.material.edit' },
              { title: '材质牌号-删除', key: 'model.material.delete' },
            ],
          },
          {
            title: '熔炼配方',
            key: 'group.model.recipe',
            children: [
              { title: '熔炼配方-数据列表', key: 'model.recipe.view' },
              { title: '熔炼配方-新增', key: 'model.recipe.create' },
              { title: '熔炼配方-编辑', key: 'model.recipe.edit' },
              { title: '熔炼配方-删除', key: 'model.recipe.delete' },
              { title: '熔炼配方-复制', key: 'model.recipe.clone' },
              { title: '熔炼配方-提交生效', key: 'model.recipe.activate' },
              { title: '熔炼配方-停用', key: 'model.recipe.disable' },
            ],
          },
          {
            title: '铸造 BOM',
            key: 'group.model.bom',
            children: [
              { title: '铸造 BOM-数据列表', key: 'model.bom.view' },
              { title: '铸造 BOM-新增', key: 'model.bom.create' },
              { title: '铸造 BOM-编辑', key: 'model.bom.edit' },
              { title: '铸造 BOM-删除', key: 'model.bom.delete' },
              { title: '铸造 BOM-克隆', key: 'model.bom.clone' },
              { title: '铸造 BOM-提交生效', key: 'model.bom.activate' },
              { title: '铸造 BOM-停用', key: 'model.bom.disable' },
              { title: '铸造 BOM-创建新版本', key: 'model.bom.new_version' },
            ],
          },
          {
            title: '工序管理',
            key: 'group.model.operation',
            children: [
              { title: '工序管理-数据列表', key: 'model.operation.view' },
              { title: '工序管理-新增', key: 'model.operation.create' },
              { title: '工序管理-编辑', key: 'model.operation.edit' },
              { title: '工序管理-启用/禁用', key: 'model.operation.disable' },
            ],
          },
          {
            title: '工艺路线',
            key: 'group.model.routing',
            children: [
              { title: '工艺路线-数据列表', key: 'model.routing.view' },
              { title: '工艺路线-新增', key: 'model.routing.create' },
              { title: '工艺路线-编辑', key: 'model.routing.edit' },
              { title: '工艺路线-删除', key: 'model.routing.delete' },
              { title: '工艺路线-创建新版本', key: 'model.routing.version' },
              { title: '工艺路线-克隆', key: 'model.routing.clone' },
              { title: '工艺路线-发布', key: 'model.routing.activate' },
              { title: '工艺路线-停用', key: 'model.routing.disable' },
              { title: '工艺路线-设置默认', key: 'model.routing.default' },
              { title: '工艺路线-回收与恢复', key: 'model.routing.recycle' },
            ],
          },
          {
            title: '缺陷代码库',
            key: 'group.model.defect',
            children: [
              { title: '缺陷代码库-数据列表', key: 'model.defect.view' },
              { title: '缺陷代码库-新增', key: 'model.defect.create' },
              { title: '缺陷代码库-编辑', key: 'model.defect.edit' },
              { title: '缺陷代码库-删除', key: 'model.defect.delete' },
            ],
          },
        ],
      },
    ],
  },
]

export const miniProgramPermissionTree: DataNode[] = [
  {
    title: '小程序端',
    key: 'mini',
    children: [
      {
        title: '模具业务',
        key: 'mini.mold',
        children: [
          {
            title: '模具开发',
            key: 'group.mini.mold.development',
            children: [
              { title: '模具开发-数据列表', key: 'mini.mold.development.view' },
            ],
          },
        ],
      },
      {
        title: '生产执行',
        key: 'mini.production',
        children: [
          {
            title: '熔炼任务',
            key: 'group.mini.production.heat',
            children: [
              { title: '熔炼任务-数据列表', key: 'mini.production.heat.view' },
              { title: '熔炼任务-开始生产', key: 'mini.production.heat.start' },
              { title: '熔炼任务-转运出炉', key: 'mini.production.heat.transfer' },
              { title: '熔炼任务-完成生产', key: 'mini.production.heat.complete' },
            ],
          },
          {
            title: '制芯任务',
            key: 'group.mini.production.core',
            children: [
              { title: '制芯任务-数据列表', key: 'mini.production.core.view' },
              { title: '制芯任务-开始生产', key: 'mini.production.core.start' },
              { title: '制芯任务-报工', key: 'mini.production.core.report' },
              { title: '制芯任务-烘干', key: 'mini.production.core.dry' },
            ],
          },
          {
            title: '造型下芯',
            key: 'group.mini.production.molding',
            children: [
              { title: '造型下芯-数据列表', key: 'mini.production.molding.view' },
              { title: '造型下芯-开始生产', key: 'mini.production.molding.start' },
              { title: '造型下芯-报工', key: 'mini.production.molding.report' },
            ],
          },
          {
            title: '合型浇注',
            key: 'group.mini.production.pouring',
            children: [
              { title: '合型浇注-数据列表', key: 'mini.production.pouring.view' },
              { title: '合型浇注-报工', key: 'mini.production.pouring.report' },
            ],
          },
          {
            title: '落砂清理',
            key: 'group.mini.production.shake_clean',
            children: [
              { title: '落砂清理-数据列表', key: 'mini.production.shake_clean.view' },
              { title: '落砂清理-落砂报工', key: 'mini.production.shake_clean.shake_report' },
              { title: '落砂清理-清理报工', key: 'mini.production.shake_clean.clean_report' },
            ],
          },
          {
            title: '成品终检',
            key: 'group.mini.production.inspection',
            children: [
              { title: '成品终检-数据列表', key: 'mini.production.inspection.view' },
              { title: '成品终检-质检报工', key: 'mini.production.inspection.report' },
            ],
          },
          {
            title: '清理返修',
            key: 'group.mini.production.cleaning_rework',
            children: [
              { title: '清理返修-数据列表', key: 'mini.production.cleaning_rework.view' },
              { title: '清理返修-报工', key: 'mini.production.cleaning_rework.report' },
            ],
          },
        ],
      },
    ],
  },
]

export const permissionTree: DataNode[] = [...adminPermissionTree, ...miniProgramPermissionTree]

export function permissionTreeForApp(app?: string) {
  return app === '小程序端' || app === 'mini' ? miniProgramPermissionTree : adminPermissionTree
}

export const dataScopeLabels: Record<DataScope, string> = {
  self: '本人数据',
  department: '本部门数据',
  department_tree: '本部门及下级部门',
  organization: '全组织数据',
  custom_departments: '自定义部门',
}

export const dataScopeOptions = Object.entries(dataScopeLabels).map(([value, label]) => ({ value, label }))

export const initialRoles: RoleRecord[] = [
  {
    id: 'R000',
    name: '系统管理员',
    organization: '摩尔元数（福建）科技有限公司',
    app: '管理端',
    description: '系统内置管理员角色，拥有全部管理端权限。',
    createdBy: '系统',
    createdAt: '2026-05-25 00:00:00',
    permissions: [
      'admin',
      'basic',
      'basic.department',
      'basic.department.create',
      'basic.department.edit',
      'basic.department.delete',
      'basic.department.sync',
      'basic.user',
      'basic.user.create',
      'basic.user.edit',
      'basic.user.delete',
      'basic.user.sync',
      'basic.role',
      'basic.role.create',
      'basic.role.edit',
      'basic.role.delete',
      'basic.role.config',
      'basic.role.users',
      'basic.role.copy',
      'basic.customer',
      'basic.customer.create',
      'basic.customer.edit',
      'basic.customer.delete',
      'basic.supplier',
      'basic.supplier.create',
      'basic.supplier.edit',
      'basic.supplier.delete',
      'basic.product',
      'basic.product.create',
      'basic.product.edit',
      'basic.product.delete',
      ...publicSyncPermissionKeys,
      'basic.dictionary',
      'basic.dictionary.edit',
      'mold',
      'mold.development.view',
      'mold.development.create',
      'mold.development.edit',
      'mold.development.delete',
      ...modelingPermissionKeys,
      ...productionPermissionKeys,
      ...miniProgramPermissionKeys,
    ],
    dataScope: 'organization',
    dataScopes: ['organization'],
    customDepartments: [],
    columnPermissions: [],
    userIds: [],
  },
]

export function loadRoles() {
  const raw = window.localStorage.getItem(ROLE_STORAGE_KEY)
  if (!raw) return initialRoles

  try {
    const parsed = JSON.parse(raw) as RoleRecord[]
    return Array.isArray(parsed) ? parsed : initialRoles
  } catch {
    return initialRoles
  }
}

export function saveRoles(roles: RoleRecord[]) {
  window.localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(roles))
  window.dispatchEvent(new Event(ROLE_STORAGE_EVENT))
}

export async function fetchRolesFromApi() {
  const roles = await apiRequest<RoleRecord[]>('/admin/roles')
  saveRoles(roles)
  return roles
}

export async function createRoleOnApi(role: Partial<RoleRecord>) {
  const created = await apiRequest<RoleRecord>('/admin/roles', {
    method: 'POST',
    body: JSON.stringify(role),
  })
  await fetchRolesFromApi()
  return created
}

export async function updateRoleOnApi(id: string, role: Partial<RoleRecord>) {
  const updated = await apiRequest<RoleRecord>(`/admin/roles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(role),
  })
  await fetchRolesFromApi()
  return updated
}

export async function deleteRoleOnApi(id: string) {
  const result = await apiRequest<{ id: string }>(`/admin/roles/${id}`, {
    method: 'DELETE',
  })
  await fetchRolesFromApi()
  return result
}

export function getCurrentAdminUser(): AdminUser | null {
  const raw = window.localStorage.getItem('mingda-admin-user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdminUser
  } catch {
    return null
  }
}

export function isSystemAdmin(user = getCurrentAdminUser()) {
  return user?.username === 'admin' || user?.name === '系统管理员'
}

export function getEffectiveRoles(user = getCurrentAdminUser()) {
  const roles = loadRoles()
  if (isSystemAdmin(user)) return roles.filter((role) => role.name === '系统管理员')
  if (!user) return []

  const localUser = loadUsers().find((item) => item.id === user.id || item.name === user.name)
  return roles.filter(
    (role) =>
      role.userIds.includes(user.id) ||
      (localUser ? role.userIds.includes(localUser.id) || role.name === localUser.role : false),
  )
}

export function hasPermission(permission: string) {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return true
  if (Array.isArray(user?.permissions)) return user.permissions.includes(permission)
  return getEffectiveRoles().some((role) => role.permissions.includes(permission))
}

export function getCurrentDataScope(): DataScope {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return 'organization'
  if (user?.dataScope) return user.dataScope
  return getEffectiveRoles()[0]?.dataScope || 'self'
}

export function getCurrentDataScopes(): DataScope[] {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return ['organization']
  if (Array.isArray(user?.dataScopes) && user.dataScopes.length) return user.dataScopes
  if (user?.dataScope) return [user.dataScope]
  const scopes = getEffectiveRoles().flatMap((role) => role.dataScopes?.length ? role.dataScopes : [role.dataScope])
  return Array.from(new Set(scopes.length ? scopes : ['self']))
}

export function getCurrentColumnPermissions() {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return []
  if (Array.isArray(user?.columnPermissions)) return user.columnPermissions
  return Array.from(new Set(getEffectiveRoles().flatMap((role) => role.columnPermissions)))
}
