import { CheckCircleOutlined } from '@ant-design/icons'
import { Card, Space, Steps, Tabs, Typography } from 'antd'
import { useNavigate } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'

function ScreenshotMock({ title, fields }: { title: string; fields: string[] }) {
  return (
    <div
      style={{
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div
        style={{
          height: 38,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          color: '#fff',
          background: '#1f2937',
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 16, background: '#f5f7fb' }}>
        <div
          style={{
            padding: 16,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
          }}
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {fields.map((field) => (
              <div
                key={field}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <Typography.Text type="secondary">{field}</Typography.Text>
                <div style={{ height: 34, background: '#f3f4f6', borderRadius: 6 }} />
              </div>
            ))}
          </Space>
        </div>
      </div>
    </div>
  )
}

export function DepartmentConfigHelpPage() {
  const navigate = useNavigate()

  return (
    <>
      <SubPageHeader
        title="部门同步配置帮助"
        description="说明钉钉、企业微信、飞书同步部门所需配置项。"
        onBack={() => navigate('/dashboard/departments')}
      />

      <Tabs
        items={[
          {
            key: 'dingtalk',
            label: '钉钉',
            children: (
              <Card>
                <Steps
                  direction="vertical"
                  items={[
                    { title: '进入钉钉开放平台', description: '创建企业内部应用，开启通讯录相关权限。' },
                    { title: '复制 AppKey / AppID 和 AppSecret', description: '在应用基础信息页面复制配置。' },
                    { title: '授权通讯录读取范围', description: '确保应用有部门读取权限。' },
                  ]}
                />
                <ScreenshotMock title="钉钉开放平台 - 应用基础信息截图示意" fields={['AppKey / AppID', 'AppSecret', '通讯录权限']} />
              </Card>
            ),
          },
          {
            key: 'wechat',
            label: '企业微信',
            children: (
              <Card>
                <Steps
                  direction="vertical"
                  items={[
                    { title: '进入企业微信管理后台', description: '打开应用管理或通讯录同步设置。' },
                    { title: '复制 CorpID 和通讯录 Secret', description: 'CorpID 在企业信息中，Secret 在通讯录 API 权限中。' },
                    { title: '确认通讯录权限', description: '允许读取部门列表和成员基础信息。' },
                  ]}
                />
                <ScreenshotMock title="企业微信后台 - 通讯录同步截图示意" fields={['CorpID', '通讯录 Secret', 'AgentID（可选）']} />
              </Card>
            ),
          },
          {
            key: 'lark',
            label: '飞书',
            children: (
              <Card>
                <Steps
                  direction="vertical"
                  items={[
                    { title: '进入飞书开放平台', description: '创建企业自建应用。' },
                    { title: '复制 App ID 和 App Secret', description: '在凭证与基础信息页面复制。' },
                    { title: '申请通讯录权限', description: '申请读取部门组织架构权限，并发布应用。' },
                  ]}
                />
                <ScreenshotMock title="飞书开放平台 - 凭证与权限截图示意" fields={['App ID', 'App Secret', '通讯录权限']} />
              </Card>
            ),
          },
        ]}
      />

      <Card style={{ marginTop: 16 }}>
        <Space direction="vertical">
          <Typography.Title level={5}>安全建议</Typography.Title>
          <Typography.Text>
            <CheckCircleOutlined style={{ color: '#10b981', marginRight: 8 }} />
            AppSecret、通讯录 Secret 等密钥不应保存在前端代码中，应由后端加密保存。
          </Typography.Text>
          <Typography.Text>
            <CheckCircleOutlined style={{ color: '#10b981', marginRight: 8 }} />
            同步任务建议由后端定时执行，并记录每次同步结果和失败原因。
          </Typography.Text>
        </Space>
      </Card>
    </>
  )
}
