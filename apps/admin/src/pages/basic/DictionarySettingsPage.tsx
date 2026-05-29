import { PlusOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Space, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import {
  defaultDictionaries,
  fetchDictionariesFromApi,
  loadDictionaries,
  updateDictionariesOnApi,
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
  {
    key: 'workshopTypes',
    title: '车间类型配置',
    description: '用于生产建模中车间与产线的车间类型字段。',
  },
]

export function DictionarySettingsPage() {
  const [form] = Form.useForm<Record<string, string>>()
  const [dictionaries, setDictionaries] = useState<DictionaryState>(() => loadDictionaries())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetchDictionariesFromApi()
      .then(setDictionaries)
      .catch((error) => {
        message.error(error instanceof Error ? error.message : '字典数据加载失败')
      })
  }, [])

  const persistDictionaries = async (next: DictionaryState, successMessage: string) => {
    setSaving(true)
    try {
      const saved = await updateDictionariesOnApi(next)
      setDictionaries(saved)
      message.success(successMessage)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '字典保存失败')
    } finally {
      setSaving(false)
    }
  }

  const addItem = async (key: keyof DictionaryState) => {
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
    await persistDictionaries(next, '字典项已新增')
    form.setFieldValue(key, '')
  }

  const removeItem = async (key: keyof DictionaryState, value: string) => {
    const nextValues = dictionaries[key].filter((item) => item !== value)
    if (!nextValues.length) {
      message.warning('至少保留一个字典项')
      return
    }
    const next = { ...dictionaries, [key]: nextValues }
    await persistDictionaries(next, '字典项已删除')
  }

  const resetDefault = async () => {
    await persistDictionaries(defaultDictionaries, '已恢复默认字典')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">字典设置</h1>
          <p className="page-description">维护业务表单中的可选项，变更后会立即应用到本浏览器管理端。</p>
        </div>
        <Button loading={saving} onClick={resetDefault}>恢复默认</Button>
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
                <Button loading={saving} type="primary" icon={<PlusOutlined />} onClick={() => addItem(meta.key)}>
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
