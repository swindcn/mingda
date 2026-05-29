import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import {
  createModelingRecord,
  deleteModelingRecord,
  fetchModelingOptions,
  fetchModelingRecords,
  updateModelingRecord,
} from '../../utils/modeling'
import type { ModelingOptions, ModelingRecord, ModelingResource } from '../../utils/modeling'
import { hasPermission } from '../../utils/roles'
import { loadDictionaries } from '../../utils/dictionaries'

type FieldType = 'text' | 'number' | 'select' | 'multiSelect' | 'checkbox' | 'textarea' | 'json'

export interface ModelingField {
  name: string
  label: string
  type?: FieldType
  required?: boolean
  width?: number
  options?: string[]
  optionSource?: keyof ModelingOptions
  dictionaryKey?: keyof ReturnType<typeof loadDictionaries>
  optionLabel?: (record: ModelingRecord) => string
  hiddenInTable?: boolean
  hiddenInForm?: boolean
  code?: boolean
}

export interface ModelingMasterPageProps {
  title: string
  description: string
  resource: ModelingResource
  permission: string
  fields: ModelingField[]
  expandable?: {
    expandedRowRender: (record: ModelingRecord) => ReactNode
    rowExpandable?: (record: ModelingRecord) => boolean
  }
}

const statusColors: Record<string, string> = {
  启用: 'green',
  停用: 'default',
  维修: 'orange',
  报废: 'red',
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join('、')
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (value === null || value === undefined) return ''
  return String(value)
}

function parseJsonField(value: unknown) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const codePattern = /^[A-Za-z0-9_-]+$/

export function ModelingMasterPage({
  title,
  description,
  resource,
  permission,
  fields,
  expandable,
}: ModelingMasterPageProps) {
  const [form] = Form.useForm()
  const [records, setRecords] = useState<ModelingRecord[]>([])
  const [options, setOptions] = useState<ModelingOptions | null>(null)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ModelingRecord | null>(null)
  const [dictionaries, setDictionaries] = useState(() => loadDictionaries())

  const canCreate = hasPermission(`${permission}.create`)
  const canEdit = hasPermission(`${permission}.edit`)
  const canDelete = hasPermission(`${permission}.delete`)

  const refresh = async () => {
    setLoading(true)
    try {
      const [nextRecords, nextOptions] = await Promise.all([
        fetchModelingRecords(resource, { keyword }),
        fetchModelingOptions(),
      ])
      setRecords(nextRecords)
      setOptions(nextOptions)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    const refreshDictionaries = () => setDictionaries(loadDictionaries())
    window.addEventListener('mingda-dictionaries-updated', refreshDictionaries)
    return () => window.removeEventListener('mingda-dictionaries-updated', refreshDictionaries)
  }, [])

  const columns = useMemo<TableColumnsType<ModelingRecord>>(() => {
    const tableFields = fields.filter((field) => !field.hiddenInTable)
    return [
      ...tableFields.map((field) => ({
        title: field.label,
        dataIndex: field.name,
        key: field.name,
        width: field.width || 140,
        render: (value: unknown) => {
          if (field.name === 'status') {
            const label = formatValue(value) || '启用'
            return <Tag color={statusColors[label] || 'blue'}>{label}</Tag>
          }
          return formatValue(value)
        },
      })),
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 160,
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 170,
        render: (_, record) => (
          <TableActions
            actions={[
              ...(canEdit
                ? [
                    {
                      key: 'edit',
                      label: '编辑',
                      icon: <EditOutlined />,
                      onClick: () => openEdit(record),
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      key: 'delete',
                      label: '删除',
                      icon: <DeleteOutlined />,
                      danger: true,
                      onClick: () => confirmDelete(record),
                    },
                  ]
                : []),
            ]}
          />
        ),
      },
    ]
  }, [fields, canEdit, canDelete])

  const optionItems = (field: ModelingField) => {
    if (field.dictionaryKey) return dictionaries[field.dictionaryKey].map((value) => ({ label: value, value }))
    if (field.options) return field.options.map((value) => ({ label: value, value }))
    if (!field.optionSource || !options) return []
    const source = options[field.optionSource] as Array<ModelingRecord | { id: string; name: string; phone: string; department: string }>
    return source.map((record) => ({
      label:
        field.optionLabel?.(record as ModelingRecord) ||
        `${record.name || ('code' in record ? record.code : record.phone)}（${'code' in record ? record.code : record.phone || record.id}）`,
      value: String('code' in record ? record.code : record.id),
    }))
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: '启用' })
    setModalOpen(true)
  }

  const openEdit = (record: ModelingRecord) => {
    setEditing(record)
    form.setFieldsValue(
      fields.reduce<Record<string, unknown>>((result, field) => {
        result[field.name] = field.type === 'json' ? JSON.stringify(record[field.name] || [], null, 2) : record[field.name]
        return result
      }, {}),
    )
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    form.resetFields()
  }

  const submit = async (values: Record<string, unknown>) => {
    const payload = fields.reduce<Record<string, unknown>>((result, field) => {
      result[field.name] = field.type === 'json' ? parseJsonField(values[field.name]) : values[field.name]
      return result
    }, {})
    try {
      if (editing) {
        await updateModelingRecord(resource, editing.id, payload)
        message.success('数据已更新')
      } else {
        await createModelingRecord(resource, payload)
        message.success('数据已新增')
      }
      closeModal()
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  const confirmDelete = (record: ModelingRecord) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定删除 ${record.name || record.code || record.id} 吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteModelingRecord(resource, record.id)
          message.success('删除成功')
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败')
        }
      },
    })
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={refresh}>
            查询
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增
            </Button>
          )}
        </Space>
      </div>

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={`搜索${title}编码、名称或状态`}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={refresh}
            style={{ maxWidth: 420 }}
          />
          <ResizableTable
            className="fixed-action-table"
            storageKey={`modeling-${resource}-widths`}
            rowKey="id"
            columns={columns}
            dataSource={records}
            expandable={expandable}
            loading={loading}
            pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
          />
        </Space>
      </Card>

      <Modal
        title={editing ? `编辑${title}` : `新增${title}`}
        open={modalOpen}
        width={840}
        okText="保存"
        cancelText="取消"
        onCancel={closeModal}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 16px' }}>
            {fields.filter((field) => !field.hiddenInForm).map((field) => {
              const rules = [
                ...(field.required ? [{ required: true, message: `请输入${field.label}` }] : []),
                ...(field.code
                  ? [
                      {
                        pattern: codePattern,
                        message: '编码只能使用英文字母、数字、短横线或下划线',
                      },
                    ]
                  : []),
              ]
              if (field.type === 'checkbox') {
                return (
                  <Form.Item key={field.name} name={field.name} valuePropName="checked" label={field.label}>
                    <Checkbox>{field.label}</Checkbox>
                  </Form.Item>
                )
              }
              if (field.type === 'number') {
                return (
                  <Form.Item key={field.name} name={field.name} label={field.label} rules={rules}>
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                )
              }
              if (field.type === 'select' || field.type === 'multiSelect') {
                return (
                  <Form.Item key={field.name} name={field.name} label={field.label} rules={rules}>
                    <Select
                      allowClear
                      mode={field.type === 'multiSelect' ? 'multiple' : undefined}
                      options={optionItems(field)}
                    />
                  </Form.Item>
                )
              }
              if (field.type === 'textarea' || field.type === 'json') {
                return (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    rules={rules}
                    style={{ gridColumn: '1 / -1' }}
                  >
                    <Input.TextArea rows={field.type === 'json' ? 5 : 3} />
                  </Form.Item>
                )
              }
              return (
                <Form.Item key={field.name} name={field.name} label={field.label} rules={rules}>
                  <Input disabled={Boolean(editing && field.code)} />
                </Form.Item>
              )
            })}
          </div>
        </Form>
      </Modal>
    </>
  )
}
