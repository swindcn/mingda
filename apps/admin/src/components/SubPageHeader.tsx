import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Space, Typography } from 'antd'
import type { ReactNode } from 'react'

interface SubPageHeaderProps {
  title: ReactNode
  description?: ReactNode
  extra?: ReactNode
  onBack: () => void
}

export function SubPageHeader({ title, description, extra, onBack }: SubPageHeaderProps) {
  return (
    <div className="page-header">
      <Space align="start" size={16}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginTop: 2 }} />
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {description && (
            <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }}>
              {description}
            </Typography.Paragraph>
          )}
        </div>
      </Space>
      {extra}
    </div>
  )
}
