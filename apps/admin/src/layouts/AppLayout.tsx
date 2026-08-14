import { LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Dropdown, Layout, Menu, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Flame,
  FlaskConical,
  Factory,
  Handshake,
  Network,
  LayoutDashboard,
  ListTree,
  ListChecks,
  Package,
  PackageSearch,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { ROLE_STORAGE_EVENT, getCurrentAdminUser, hasPermission } from '../utils/roles'

const { Header, Content, Sider } = Layout

interface AppMenuItem {
  key: string
  icon?: ReactNode
  label: ReactNode
  permission?: string
  children?: AppMenuItem[]
}

const allMenuItems: AppMenuItem[] = [
  {
    key: '/dashboard/mold',
    icon: <Factory size={18} />,
    label: '模具业务',
    children: [
      {
        key: '/dashboard/mold/development',
        icon: <LayoutDashboard size={18} />,
        label: '模具开发',
        permission: 'mold.development.view',
      },
      {
        key: '/dashboard/mold/model',
        icon: <Wrench size={18} />,
        label: '模具档案',
        permission: 'mold.model.view',
      },
      {
        key: '/dashboard/mold/corebox',
        icon: <Package size={18} />,
        label: '芯盒档案',
        permission: 'mold.corebox.view',
      },
    ],
  },
  {
    key: '/dashboard/model',
    icon: <Factory size={18} />,
    label: '生产建模',
    children: [
      {
        key: '/dashboard/model/workshop-line',
        icon: <Factory size={18} />,
        label: '车间与产线',
        permission: 'model.workshop-line.view',
      },
      {
        key: '/dashboard/model/team',
        icon: <Users size={18} />,
        label: '班组配置',
        permission: 'model.team.view',
      },
      {
        key: '/dashboard/model/equipment',
        icon: <Wrench size={18} />,
        label: '设备配置',
        permission: 'model.equipment.view',
      },
      {
        key: '/dashboard/model/calendar',
        icon: <CalendarDays size={18} />,
        label: '工厂日历',
        permission: 'model.calendar.view',
      },
      {
        key: '/dashboard/model/shift',
        icon: <CalendarRange size={18} />,
        label: '班次主档',
        permission: 'model.calendar.view',
      },
      {
        key: '/dashboard/model/schedule',
        icon: <CalendarRange size={18} />,
        label: '动态排班表',
        permission: 'model.schedule.view',
      },
    ],
  },
  {
    key: '/dashboard/production',
    icon: <ListChecks size={18} />,
    label: '生产管理',
    children: [
      {
        key: '/dashboard/production/work-orders',
        icon: <ClipboardList size={18} />,
        label: '生产工单',
        permission: 'production.work_order.view',
      },
      {
        key: '/dashboard/production/core-tasks',
        icon: <ClipboardList size={18} />,
        label: '制芯任务',
        permission: 'production.core_task.view',
      },
      {
        key: '/dashboard/production/core-inventory',
        icon: <PackageSearch size={18} />,
        label: '砂芯库存',
        permission: 'production.core_inventory.view',
      },
      {
        key: '/dashboard/production/melt-scheduling',
        icon: <Factory size={18} />,
        label: '合炉排产',
        permission: 'production.schedule.view',
      },
      {
        key: '/dashboard/production/heat-orders',
        icon: <Flame size={18} />,
        label: '熔炼执行',
        permission: 'production.heat.view',
      },
    ],
  },
  {
    key: '/dashboard/process',
    icon: <ClipboardList size={18} />,
    label: '工艺管理',
    children: [
      {
        key: '/dashboard/model/material',
        icon: <FlaskConical size={18} />,
        label: '材质牌号',
        permission: 'model.material.view',
      },
      {
        key: '/dashboard/model/recipe',
        icon: <ClipboardList size={18} />,
        label: '熔炼配方',
        permission: 'model.recipe.view',
      },
      {
        key: '/dashboard/model/bom',
        icon: <Boxes size={18} />,
        label: '铸造 BOM',
        permission: 'model.bom.view',
      },
      {
        key: '/dashboard/model/operation',
        icon: <ClipboardList size={18} />,
        label: '工序管理',
        permission: 'model.operation.view',
      },
      {
        key: '/dashboard/model/routing',
        icon: <ListTree size={18} />,
        label: '工艺路线',
        permission: 'model.routing.view',
      },
      {
        key: '/dashboard/model/defect',
        icon: <TriangleAlert size={18} />,
        label: '缺陷代码库',
        permission: 'model.defect.view',
      },
    ],
  },
  {
    key: '/dashboard/basic',
    icon: <Boxes size={18} />,
    label: '基础资料',
    children: [
      {
        key: '/dashboard/departments',
        icon: <Network size={18} />,
        label: '部门管理',
        permission: 'basic.department',
      },
      {
        key: '/dashboard/roles',
        icon: <ShieldCheck size={18} />,
        label: '角色权限',
        permission: 'basic.role',
      },
      {
        key: '/dashboard/users',
        icon: <Users size={18} />,
        label: '用户管理',
        permission: 'basic.user',
      },
      {
        key: '/dashboard/customers',
        icon: <Handshake size={18} />,
        label: '客户管理',
        permission: 'basic.customer',
      },
      {
        key: '/dashboard/suppliers',
        icon: <Factory size={18} />,
        label: '供应商管理',
        permission: 'basic.supplier',
      },
      {
        key: '/dashboard/products',
        icon: <PackageSearch size={18} />,
        label: '物料管理',
        permission: 'basic.product',
      },
      {
        key: '/dashboard/dictionaries',
        icon: <ListTree size={18} />,
        label: '字典设置',
        permission: 'basic.dictionary',
      },
    ],
  },
  {
    key: '/dashboard/resources',
    icon: <FileText size={18} />,
    label: '知识资源',
    children: [
      {
        key: '/dashboard/resources/parser',
        icon: <FileText size={18} />,
        label: '资源解析',
      },
    ],
  },
]

function filterMenuItems(items: AppMenuItem[]): MenuProps['items'] {
  return items
    .map((item) => {
      const children = (item.children ? filterMenuItems(item.children) : []) || []
      if (item.children?.length && children.length === 0) return null
      const permitted = !item.permission || hasPermission(item.permission)
      if (!permitted && children.length === 0) return null
      return {
        key: item.key,
        icon: item.icon,
        label: item.label,
        children: children.length ? children : undefined,
      }
    })
    .filter(Boolean) as MenuProps['items']
}

function findMenuLabel(items: AppMenuItem[], pathname: string): { group?: string; label?: string } {
  for (const item of items) {
    if (item.children) {
      const matched = findMenuLabel(item.children, pathname)
      if (matched.label) {
        return {
          group: typeof item.label === 'string' ? item.label : undefined,
          label: matched.label,
        }
      }
    }
    if (item.key === pathname || pathname.startsWith(`${item.key}/`)) {
      return { label: typeof item.label === 'string' ? item.label : undefined }
    }
  }
  return {}
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [permissionVersion, setPermissionVersion] = useState(0)
  const currentUser = getCurrentAdminUser()
  const displayName = currentUser?.name || currentUser?.username || '未登录用户'
  const menuItems = useMemo(() => filterMenuItems(allMenuItems), [permissionVersion])
  const currentMenu = useMemo(() => findMenuLabel(allMenuItems, location.pathname), [location.pathname])

  useEffect(() => {
    const refresh = () => setPermissionVersion((current) => current + 1)
    window.addEventListener(ROLE_STORAGE_EVENT, refresh)
    return () => window.removeEventListener(ROLE_STORAGE_EVENT, refresh)
  }, [])

  const handleLogout = () => {
    window.localStorage.removeItem('mingda-admin-token')
    window.localStorage.removeItem('mingda-admin-user')
    navigate('/')
  }

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'user-info',
      disabled: true,
      label: (
        <div style={{ padding: '2px 0' }}>
          <div style={{ fontWeight: 600 }}>{displayName}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {currentUser?.userType || '系统用户'}
          </Typography.Text>
        </div>
      ),
    },
    { type: 'divider' },
    {
      key: 'logout',
      danger: true,
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  return (
    <Layout style={{ height: '100vh', minHeight: 0 }}>
      <Sider
        width={232}
        collapsedWidth={72}
        collapsed={collapsed}
        theme="light"
        trigger={null}
        style={{
          height: '100vh',
          overflow: 'auto',
          borderRight: '1px solid #eef0f4',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 60,
            padding: collapsed ? '0 18px' : '0 20px',
            borderBottom: '1px solid #eef0f4',
          }}
        >
          <div
            style={{
              display: 'grid',
              flex: '0 0 auto',
              width: 36,
              height: 36,
              placeItems: 'center',
              color: '#fff',
              background: 'linear-gradient(135deg, #1677ff, #0958d9)',
              borderRadius: 10,
              boxShadow: '0 4px 10px rgb(22 119 255 / 24%)',
            }}
          >
            <Factory size={20} />
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
                闽大铸件
              </Typography.Text>
              <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.3 }}>管理端</div>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={[
            '/dashboard/mold',
            '/dashboard/model',
            '/dashboard/production',
            '/dashboard/process',
            '/dashboard/resources',
            '/dashboard/basic',
          ]}
          items={menuItems}
          style={{ borderInlineEnd: 0, paddingTop: 10, paddingBottom: 16 }}
          inlineCollapsed={collapsed}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout style={{ minWidth: 0, minHeight: 0 }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderBottom: '1px solid #eef0f4',
          }}
        >
          <Space size={12} style={{ minWidth: 0 }}>
            <Tooltip title={collapsed ? '展开菜单' : '收起菜单'}>
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed((current) => !current)}
              />
            </Tooltip>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <Typography.Text strong style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
                {currentMenu.label || '铸件行业业务管理系统'}
              </Typography.Text>
              {currentMenu.group && (
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {currentMenu.group}
                </Typography.Text>
              )}
            </div>
          </Space>
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
            <Space size={8} style={{ cursor: 'pointer', padding: '4px 6px', borderRadius: 8 }}>
              <Avatar
                size={30}
                style={{ background: 'linear-gradient(135deg, #1677ff, #0958d9)', fontSize: 13 }}
                icon={<UserOutlined />}
              >
                {displayName.slice(0, 1)}
              </Avatar>
              <Typography.Text style={{ fontSize: 13 }}>{displayName}</Typography.Text>
            </Space>
          </Dropdown>
        </Header>
        <Content className="app-content-scroll" style={{ minHeight: 0, overflow: 'auto', padding: '20px 24px 24px' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
