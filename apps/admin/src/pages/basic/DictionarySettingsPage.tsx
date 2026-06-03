import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Select, Space, Tag, Tree, Typography, message } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useEffect, useMemo, useState } from 'react'
import {
  defaultDictionaries,
  fetchDictionariesFromApi,
  loadDictionaries,
  updateDictionariesOnApi,
} from '../../utils/dictionaries'
import type { DictionaryState, ProductTypeNode } from '../../utils/dictionaries'
import { hasPermission } from '../../utils/roles'

type SimpleDictionaryKey = Exclude<keyof DictionaryState, 'productTypes'>

const dictionaryMeta: Array<{
  key: SimpleDictionaryKey
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
    description: '用于物料基本信息里的物料单位字段。',
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

function flattenProductTypeNames(nodes: ProductTypeNode[], prefix = ''): string[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name
    return [path, ...flattenProductTypeNames(node.children || [], path)]
  })
}

function removeTypeNode(nodes: ProductTypeNode[], path: string[]): ProductTypeNode[] {
  const [current, ...rest] = path
  return nodes
    .map((node) => {
      if (node.name !== current) return node
      if (!rest.length) return null
      const children = removeTypeNode(node.children || [], rest)
      return children.length ? { ...node, children } : { name: node.name }
    })
    .filter((node): node is ProductTypeNode => Boolean(node))
}

export function DictionarySettingsPage() {
  const [form] = Form.useForm<Record<string, string>>()
  const [typeForm] = Form.useForm<{ parentType?: string; typeName?: string }>()
  const [dictionaries, setDictionaries] = useState<DictionaryState>(() => loadDictionaries())
  const [saving, setSaving] = useState(false)
  const canEdit = hasPermission('basic.dictionary.edit')

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

  const addItem = async (key: SimpleDictionaryKey) => {
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

  const removeItem = async (key: SimpleDictionaryKey, value: string) => {
    const nextValues = dictionaries[key].filter((item) => item !== value)
    if (!nextValues.length) {
      message.warning('至少保留一个字典项')
      return
    }
    const next = { ...dictionaries, [key]: nextValues }
    await persistDictionaries(next, '字典项已删除')
  }

  const productTypePaths = useMemo(
    () => flattenProductTypeNames(dictionaries.productTypes),
    [dictionaries.productTypes],
  )

  const productTypeTreeData = useMemo<DataNode[]>(() => {
    const toTree = (nodes: ProductTypeNode[], parentPath = ''): DataNode[] =>
      nodes.map((node) => {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name
        return {
          key: path,
          title: (
            <Space size={8}>
              <span>{node.name}</span>
              {canEdit && (
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(event) => {
                    event.stopPropagation()
                    void removeProductType(path)
                  }}
                />
              )}
            </Space>
          ),
          children: node.children?.length ? toTree(node.children, path) : undefined,
        }
      })
    return toTree(dictionaries.productTypes)
  }, [dictionaries.productTypes])

  const addProductType = async () => {
    const values = typeForm.getFieldsValue()
    const name = values.typeName?.trim()
    if (!name) {
      message.warning('请输入物料类型名称')
      return
    }

    const parentPath = values.parentType
    if (!parentPath && dictionaries.productTypes.some((item) => item.name === name)) {
      message.warning('一级物料类型已存在')
      return
    }

    const appendChild = (nodes: ProductTypeNode[], path: string[]): ProductTypeNode[] =>
      nodes.map((node) => {
        if (node.name !== path[0]) return node
        if (path.length === 1) {
          const children = node.children || []
          if (children.some((child) => child.name === name)) {
            message.warning('同级物料类型已存在')
            return node
          }
          return { ...node, children: [...children, { name }] }
        }
        return { ...node, children: appendChild(node.children || [], path.slice(1)) }
      })

    const nextTypes = parentPath
      ? appendChild(dictionaries.productTypes, parentPath.split('/'))
      : [...dictionaries.productTypes, { name }]

    await persistDictionaries({ ...dictionaries, productTypes: nextTypes }, '物料类型已新增')
    typeForm.resetFields(['typeName'])
  }

  const removeProductType = async (path: string) => {
    if (dictionaries.productTypes.length <= 1 && !path.includes('/')) {
      message.warning('至少保留一个物料类型')
      return
    }
    const nextTypes = removeTypeNode(dictionaries.productTypes, path.split('/'))
    await persistDictionaries({ ...dictionaries, productTypes: nextTypes }, '物料类型已删除')
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
        {canEdit && <Button loading={saving} onClick={resetDefault}>恢复默认</Button>}
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {dictionaryMeta.map((meta) => (
          <Card key={meta.key} title={meta.title}>
            <Typography.Paragraph type="secondary">{meta.description}</Typography.Paragraph>
            <Space wrap style={{ marginBottom: 16 }}>
              {dictionaries[meta.key].map((item) => (
                <Tag key={item} closable={canEdit} onClose={() => removeItem(meta.key, item)}>
                  {item}
                </Tag>
              ))}
            </Space>
            {canEdit && (
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
            )}
          </Card>
        ))}

        <Card title="物料类型配置">
          <Typography.Paragraph type="secondary">
            用于物料管理中的物料类型字段。支持一级、二级类型；列表中按“一级类型/二级类型”展示。
          </Typography.Paragraph>
          {canEdit && (
            <Form form={typeForm} layout="inline" style={{ marginBottom: 16 }}>
              <Form.Item name="parentType" label="上级类型">
                <Select
                  allowClear
                  placeholder="作为一级类型"
                  style={{ width: 220 }}
                  options={productTypePaths.map((path: string) => ({ label: path, value: path }))}
                />
              </Form.Item>
              <Form.Item name="typeName" label="类型名称">
                <Input placeholder="请输入类型名称" onPressEnter={addProductType} />
              </Form.Item>
              <Button loading={saving} type="primary" icon={<PlusOutlined />} onClick={addProductType}>
                新增
              </Button>
            </Form>
          )}
          <Tree defaultExpandAll treeData={productTypeTreeData} />
        </Card>
      </Space>
    </>
  )
}
