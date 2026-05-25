import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Card, Checkbox, Form, Input, Typography, message } from 'antd'
import { Factory } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { apiRequest } from '../services/api'

interface LoginFormValues {
  username: string
  password: string
  remember: boolean
}

interface LoginResponse {
  token: string
  user: {
    id: string
    name: string
    userType: string
    username?: string
    permissions?: string[]
    dataScope?: string
    columnPermissions?: string[]
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const handleLogin = async (values: LoginFormValues) => {
    setLoading(true)
    try {
      const result = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      })

      window.localStorage.setItem('mingda-admin-token', result.token)
      window.localStorage.setItem(
        'mingda-admin-user',
        JSON.stringify({ ...result.user, username: result.user.username || values.username }),
      )
      navigate('/dashboard')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        display: 'grid',
        minHeight: '100vh',
        placeItems: 'center',
        padding: 24,
        background:
          'linear-gradient(135deg, #f7f9fc 0%, #edf2f7 48%, #e6edf6 100%)',
      }}
    >
      <section style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-grid',
              width: 64,
              height: 64,
              marginBottom: 16,
              placeItems: 'center',
              color: '#fff',
              background: 'linear-gradient(135deg, #1677ff, #0958d9)',
              borderRadius: 16,
              boxShadow: '0 14px 30px rgba(22, 119, 255, 0.28)',
            }}
          >
            <Factory size={38} />
          </div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            闽大铸件管理系统
          </Typography.Title>
          <Typography.Text type="secondary">
            Casting Business Management System
          </Typography.Text>
        </div>

        <Card styles={{ body: { padding: 32 } }}>
          <Form
            layout="vertical"
            size="large"
            onFinish={handleLogin}
            initialValues={{ remember: true }}
          >
            <Form.Item
              label="账号"
              name="username"
              rules={[{ required: true, message: '请输入账号' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="请输入账号" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" />
            </Form.Item>
            <Form.Item>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Checkbox>记住密码</Checkbox>
                </Form.Item>
                <Button type="link" style={{ paddingInline: 0 }}>
                  忘记密码?
                </Button>
              </div>
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录系统
            </Button>
          </Form>
        </Card>
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 24, textAlign: 'center' }}
        >
          © 2026 闽大铸件 v0.1.0
        </Typography.Paragraph>
      </section>
    </main>
  )
}
