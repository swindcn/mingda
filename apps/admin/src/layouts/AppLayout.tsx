import { LogoutOutlined } from '@ant-design/icons'
import { Button, Layout, Menu, Space, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FlaskConical,
  Factory,
  Handshake,
  Network,
  LayoutDashboard,
  ListTree,
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

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [permissionVersion, setPermissionVersion] = useState(0)
  const currentUser = getCurrentAdminUser()
  const displayName = currentUser?.name || currentUser?.username || '未登录用户'
  const menuItems = useMemo(() => filterMenuItems(allMenuItems), [permissionVersion])

  useEffect(() => {
    const refresh = () => setPermissionVersion((current) => current + 1)
    window.addEventListener(ROLE_STORAGE_EVENT, refresh)
    return () => window.removeEventListener(ROLE_STORAGE_EVENT, refresh)
  }, [])

  return (
    <Layout style={{ height: '100vh', minHeight: 0 }}>
      <Sider width={248} theme="light" style={{ height: '100vh', overflow: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 64,
            padding: '0 20px',
            borderBottom: '1px solid #eef0f4',
          }}
        >
          <div
            style={{
              display: 'grid',
              width: 36,
              height: 36,
              placeItems: 'center',
              color: '#fff',
              background: '#1677ff',
              borderRadius: 8,
            }}
          >
            <Factory size={22} />
          </div>
          <div>
            <Typography.Text strong>闽大铸件</Typography.Text>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>管理端</div>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['/dashboard/mold', '/dashboard/model', '/dashboard/process', '/dashboard/basic']}
          items={menuItems}
          style={{ borderInlineEnd: 0, paddingTop: 12 }}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout style={{ minWidth: 0, minHeight: 0 }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 64,
            padding: '0 24px',
            background: '#fff',
            borderBottom: '1px solid #eef0f4',
          }}
        >
          <Typography.Text strong>铸件行业业务管理系统</Typography.Text>
          <Space>
            <Typography.Text type="secondary">{displayName}</Typography.Text>
            <Button
              icon={<LogoutOutlined />}
              onClick={() => {
                window.localStorage.removeItem('mingda-admin-token')
                window.localStorage.removeItem('mingda-admin-user')
                navigate('/')
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ minHeight: 0, overflow: 'auto', padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
