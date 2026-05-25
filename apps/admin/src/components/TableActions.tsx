import { DownOutlined } from '@ant-design/icons'
import { Button, Dropdown, Space } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'

export interface TableActionItem {
  key: string
  label: ReactNode
  shortLabel?: ReactNode
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
}

interface TableActionsProps {
  actions: TableActionItem[]
  visibleCount?: number
}

export function TableActions({ actions, visibleCount = 3 }: TableActionsProps) {
  const visibleActions = actions.slice(0, visibleCount)
  const moreActions = actions.slice(visibleCount)

  const menuItems: MenuProps['items'] = moreActions.map((action) => ({
    key: action.key,
    label: action.label,
    icon: action.icon,
    danger: action.danger,
    onClick: action.onClick,
  }))

  return (
    <Space size={0} wrap={false} style={{ whiteSpace: 'nowrap' }}>
      {visibleActions.map((action) => (
        <Button
          key={action.key}
          danger={action.danger}
          type="link"
          icon={action.icon}
          size="small"
          style={{ paddingInline: 4 }}
          onClick={action.onClick}
        >
          {action.shortLabel ?? action.label}
        </Button>
      ))}
      {moreActions.length > 0 && (
        <Dropdown menu={{ items: menuItems }} trigger={['click']}>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 4 }}
            onClick={(event) => event.preventDefault()}
          >
            更多 <DownOutlined />
          </Button>
        </Dropdown>
      )}
    </Space>
  )
}
