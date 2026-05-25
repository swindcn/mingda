import { PlusOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Space, Tag, Typography, message } from 'antd'
import { useState } from 'react'
import {
  defaultDictionaries,
  loadDictionaries,
  saveDictionaries,
} from '../../utils/dictionaries'
import type { DictionaryState } from '../../utils/dictionaries'

const dictionaryMeta: Array<{
  key: keyof DictionaryState
  title: string
  description: string
}> = [
  {
    key: 'moldTypes',
    title: '模具类型配置',
    description: '用于模具开发下达页面的模具类型字段。',
  },
  {
    key: 'productUnits',
    title: '产品单位配置',
    description: '用于产品基本信息里的产品单位字段。',
  },
  {
    key: 'productTypes',
    title: '产品类型配置',
    description: '用于产品基本信息里的产品类型字段。',
  },
  {
    key: 'positions',
    title: '岗位信息配置',
    description: '用于用户管理新增/编辑用户时的岗位字段。',
  },
]

export function DictionarySettingsPage() {
  const [form] = Form.useForm<Record<string, string>>()
  const [dictionaries, setDictionaries] = useState<DictionaryState>(() => loadDictionaries())

  const addItem = (key: keyof DictionaryState) => {
    const value = form.getFieldValue(key)?.trim()
    if (!value) {
      message.warning('请输入字典项名称')
      return
    }
    if (dictionaries[key].includes(value)) {
      message.warning('字典项已存在')
      return
    }

    const next = { ...dictionaries, [key]: [...dictionaries[key], value] }
    setDictionaries(next)
    saveDictionaries(next)
    form.setFieldValue(key, '')
    message.success('字典项已新增')
  }

  const removeItem = (key: keyof DictionaryState, value: string) => {
    const nextValues = dictionaries[key].filter((item) => item !== value)
    if (!nextValues.length) {
      message.warning('至少保留一个字典项')
      return
    }
    const next = { ...dictionaries, [key]: nextValues }
    setDictionaries(next)
    saveDictionaries(next)
  }

  const resetDefault = () => {
    setDictionaries(defaultDictionaries)
    saveDictionaries(defaultDictionaries)
    message.success('已恢复默认字典')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">字典设置</h1>
          <p className="page-description">维护业务表单中的可选项，变更后会立即应用到本浏览器管理端。</p>
        </div>
        <Button onClick={resetDefault}>恢复默认</Button>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {dictionaryMeta.map((meta) => (
          <Card key={meta.key} title={meta.title}>
            <Typography.Paragraph type="secondary">{meta.description}</Typography.Paragraph>
            <Space wrap style={{ marginBottom: 16 }}>
              {dictionaries[meta.key].map((item) => (
                <Tag key={item} closable onClose={() => removeItem(meta.key, item)}>
                  {item}
                </Tag>
              ))}
            </Space>
            <Form form={form} component={false}>
              <Space.Compact style={{ width: 420, maxWidth: '100%' }}>
                <Form.Item name={meta.key} noStyle>
                  <Input placeholder={`新增${meta.title.replace('配置', '')}`} onPressEnter={() => addItem(meta.key)} />
                </Form.Item>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => addItem(meta.key)}>
                  新增
                </Button>
              </Space.Compact>
            </Form>
          </Card>
        ))}
      </Space>
    </>
  )
}
