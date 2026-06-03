import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
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
  TimePicker,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { ImageUploadField } from '../../components/ImageUploadField'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { apiRequest } from '../../services/api'
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
import type { ProductTypeNode } from '../../utils/dictionaries'

type FieldType = 'text' | 'number' | 'select' | 'multiSelect' | 'checkbox' | 'textarea' | 'json' | 'time'

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
  visibleWhen?: { field: string; value: unknown }
  computed?: boolean
  formSpan?: number
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

function flattenProductTypePaths(nodes: ProductTypeNode[], prefix = ''): string[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name
    return [path, ...flattenProductTypePaths(node.children || [], path)]
  })
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

function toTimeValue(value: unknown) {
  if (!value) return undefined
  if (dayjs.isDayjs(value)) return value
  const parsed = dayjs(String(value), 'HH:mm')
  return parsed.isValid() ? parsed : undefined
}

function fromTimeValue(value: unknown) {
  if (!value) return ''
  if (dayjs.isDayjs(value)) return value.format('HH:mm')
  return String(value)
}

const codePattern = /^[^\s\u4e00-\u9fff]+$/

function maskPhoneTail(phone?: string) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.slice(-4)
}

function employeeLabel(record: { name?: string; phone?: string; department?: string }) {
  const phoneTail = maskPhoneTail(record.phone)
  const suffixes = [
    record.department ? String(record.department) : '',
    phoneTail ? `尾号${phoneTail}` : '',
  ].filter(Boolean)
  return `${record.name || '未命名员工'}${suffixes.length ? `（${suffixes.join(' / ')}）` : ''}`
}

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
  const [viewing, setViewing] = useState(false)
  const [dictionaries, setDictionaries] = useState(() => loadDictionaries())
  const [handledArchiveSource, setHandledArchiveSource] = useState('')
  const location = useLocation()
  const watchedMoldCode = Form.useWatch('code', form)
  const watchedMoldName = Form.useWatch('name', form)
  const watchedHasCoreBox = Form.useWatch('hasCoreBox', form)
  const watchedTeamMembers = Form.useWatch('memberUserIds', form)

  const canCreate = hasPermission(`${permission}.create`)
  const canEdit = hasPermission(`${permission}.edit`)
  const canDelete = hasPermission(`${permission}.delete`)

  const refresh = async (nextKeyword = keyword) => {
    setLoading(true)
    try {
      const [nextRecords, nextOptions] = await Promise.all([
        fetchModelingRecords(resource, { keyword: nextKeyword }),
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
    setRecords([])
    setOptions(null)
    setKeyword('')
    closeModal()
    void refresh('')
  }, [resource])

  useEffect(() => {
    const sourceCode = new URLSearchParams(location.search).get('fromMoldDevelopment')
    if (resource !== 'molds' || !sourceCode || handledArchiveSource === sourceCode) return
    setHandledArchiveSource(sourceCode)
    void apiRequest<{
      code: string
      productCode: string
      productName: string
      moldName?: string
      moldType?: string
      supplierId?: string
      supplierName?: string
      flowRecords?: Array<{ key: string; images?: string[] }>
    }>(`/mobile/molds/${sourceCode}?viewer=admin`)
      .then((detail) => {
        const receiveImages = detail.flowRecords?.find((record) => record.key === 'receive')?.images || []
        setEditing(null)
        form.resetFields()
        form.setFieldsValue({
          code: `${detail.code}-MOLD`,
          name: detail.moldName || `${detail.productName}模具`,
          itemCode: detail.productCode,
          moldType: detail.moldType,
          supplierCode: detail.supplierId,
          sourceMoldDevelopmentCode: detail.code,
          images: receiveImages,
          hasCoreBox: false,
          coreBoxCode: `${detail.code}-COREBOX`,
          coreBoxName: `${detail.moldName || detail.productName}芯盒`,
          coreBoxImages: receiveImages,
          status: '启用',
        })
        setModalOpen(true)
      })
      .catch((error) => {
        message.error(error instanceof Error ? error.message : '开发单数据带入失败')
      })
  }, [form, handledArchiveSource, location.search, resource])

  useEffect(() => {
    if (resource !== 'molds' || !watchedHasCoreBox) return
    const moldCode = String(watchedMoldCode || '').trim()
    const moldName = String(watchedMoldName || '').trim()
    const nextValues: Record<string, string> = {}
    if (moldCode && !form.getFieldValue('coreBoxCode')) nextValues.coreBoxCode = `${moldCode}-COREBOX`
    if (moldName && !form.getFieldValue('coreBoxName')) nextValues.coreBoxName = `${moldName}芯盒`
    if (moldCode || moldName) nextValues.coreBoxMoldCode = `${moldName || moldCode}${moldCode ? `（${moldCode}）` : ''}`
    if (Object.keys(nextValues).length) form.setFieldsValue(nextValues)
  }, [form, resource, watchedHasCoreBox, watchedMoldCode, watchedMoldName])

  useEffect(() => {
    const refreshDictionaries = () => setDictionaries(loadDictionaries())
    window.addEventListener('mingda-dictionaries-updated', refreshDictionaries)
    return () => window.removeEventListener('mingda-dictionaries-updated', refreshDictionaries)
  }, [])

  const optionItems = (field: ModelingField) => {
    if (field.dictionaryKey === 'productTypes') {
      return flattenProductTypePaths(dictionaries.productTypes).map((value) => ({ label: value, value }))
    }
    if (field.dictionaryKey) return dictionaries[field.dictionaryKey].map((value) => ({ label: value, value }))
    if (field.options) return field.options.map((value) => ({ label: value, value }))
    if (!field.optionSource || !options) return []
    const source = options[field.optionSource] as Array<ModelingRecord | { id: string; name: string; phone: string; department: string }>
    if (resource === 'teams' && field.name === 'leaderUserId') {
      const selectedMemberIds = Array.isArray(watchedTeamMembers) ? watchedTeamMembers.map(String) : []
      return source
        .filter((record) => selectedMemberIds.includes(String('code' in record ? record.code : record.id)))
        .map((record) => ({
          label: employeeLabel(record as { name?: string; phone?: string; department?: string }),
          value: String('code' in record ? record.code : record.id),
        }))
    }
    return source.map((record) => ({
      label:
        field.optionLabel?.(record as ModelingRecord) ||
        (field.optionSource === 'employees'
          ? employeeLabel(record as { name?: string; phone?: string; department?: string })
          : `${record.name || ('code' in record ? record.code : record.phone)}（${'code' in record ? record.code : record.phone || record.id}）`),
      value: String('code' in record ? record.code : record.id),
    }))
  }

  const displayValue = (field: ModelingField, value: unknown, record: ModelingRecord) => {
    if (resource === 'teams' && (field.name === 'memberUserIds' || field.name === 'leaderUserId')) {
      const employees = (options?.employees || []) as Array<{ id: string; name: string }>
      if (Array.isArray(value)) {
        return value
          .map((id) => employees.find((employee) => employee.id === String(id))?.name || String(id))
          .join('、')
      }
      return employees.find((employee) => employee.id === String(value))?.name || formatValue(value)
    }
    if (field.name === 'supplierCode') {
      return String(record.supplierName || optionItems(field).find((item) => item.value === value)?.label || value || '')
        .replace(/（[^）]+）$/, '')
    }
    if (field.type === 'select' || field.type === 'multiSelect') {
      const items = optionItems(field)
      if (Array.isArray(value)) {
        return value
          .map((item) => items.find((option) => option.value === item)?.label || item)
          .join('、')
      }
      return items.find((item) => item.value === value)?.label || formatValue(value)
    }
    return formatValue(value)
  }

  const columns = useMemo<TableColumnsType<ModelingRecord>>(() => {
    const tableFields = fields.filter((field) => !field.hiddenInTable)
    return [
      ...tableFields.map((field) => ({
        title: field.label,
        dataIndex: field.name,
        key: field.name,
        width: field.width || 140,
        render: (value: unknown, record: ModelingRecord) => {
          if (field.name === 'status') {
            const label = formatValue(value) || '启用'
            return <Tag color={statusColors[label] || 'blue'}>{label}</Tag>
          }
          return displayValue(field, value, record)
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
              ...(resource === 'molds' || resource === 'coreboxes'
                ? [
                    {
                      key: 'view',
                      label: '查看',
                      icon: <EyeOutlined />,
                      onClick: () => openView(record),
                    },
                  ]
                : []),
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
  }, [fields, resource, canEdit, canDelete, options, dictionaries])

  const recordToFormValues = (record: ModelingRecord) => {
    const values = fields.reduce<Record<string, unknown>>((result, field) => {
        result[field.name] = record[field.name]
        return result
      }, {})
    if (resource === 'molds') {
      const coreBoxes = Array.isArray(record.coreBoxes) ? (record.coreBoxes as ModelingRecord[]) : []
      const coreBox = coreBoxes[0]
      values.hasCoreBox = Boolean(record.hasCoreBox || coreBox)
      values.coreBoxCode = coreBox?.code || record.coreBoxCode
      values.coreBoxName = coreBox?.name || record.coreBoxName
      values.coreBoxMoldCode = `${record.name || record.code}${record.code ? `（${record.code}）` : ''}`
      values.coreBoxImages = coreBox?.images || record.coreBoxImages || []
      values.coreBoxMaxLife = coreBox?.maxLife
      values.coreBoxUsedLife = coreBox?.usedLife
      values.coreBoxRemark = coreBox?.remark
    }
    if (resource === 'teams') {
      const memberUserIds = Array.isArray(record.memberUserIds) ? record.memberUserIds.map(String) : []
      const leaderUserId = String(record.leaderUserId || '')
      if (leaderUserId && !memberUserIds.includes(leaderUserId)) {
        values.leaderUserId = undefined
      }
    }
    return values
  }

  const openCreate = () => {
    setEditing(null)
    setViewing(false)
    form.resetFields()
    form.setFieldsValue({ status: '启用' })
    setModalOpen(true)
  }

  const openView = (record: ModelingRecord) => {
    setEditing(null)
    setViewing(true)
    form.setFieldsValue(recordToFormValues(record))
    setModalOpen(true)
  }

  const openEdit = (record: ModelingRecord) => {
    setEditing(record)
    setViewing(false)
    const values = recordToFormValues(record)
    form.setFieldsValue(values)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setViewing(false)
    form.resetFields()
  }

  const submit = async (values: Record<string, unknown>) => {
    if (viewing) return
    if (resource === 'teams') {
      const memberUserIds = Array.isArray(values.memberUserIds) ? values.memberUserIds.map(String) : []
      const leaderUserId = String(values.leaderUserId || '')
      if (leaderUserId && !memberUserIds.includes(leaderUserId)) {
        message.warning('班组长必须从已选择的班组成员中选择')
        return
      }
    }
      const payload = fields.reduce<Record<string, unknown>>((result, field) => {
      result[field.name] = field.type === 'json'
        ? parseJsonField(values[field.name])
        : field.type === 'time'
          ? fromTimeValue(values[field.name])
          : values[field.name]
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
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => refresh()}>
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
            onPressEnter={() => refresh()}
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
        title={viewing ? `查看${title}` : editing ? `编辑${title}` : `新增${title}`}
        open={modalOpen}
        width={resource === 'molds' ? 1060 : 840}
        okText="保存"
        cancelText={viewing ? '关闭' : '取消'}
        onCancel={closeModal}
        onOk={() => form.submit()}
        footer={viewing ? <Button onClick={closeModal}>关闭</Button> : undefined}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '0 16px' }}>
            {fields.filter((field) => {
              if (field.hiddenInForm) return false
              if (!field.visibleWhen) return true
              return getFieldValue(field.visibleWhen.field) === field.visibleWhen.value
            }).map((field) => {
              const rules = [
                ...(field.required ? [{ required: true, message: `请输入${field.label}` }] : []),
                ...(field.code
                  ? [
                      {
                        pattern: codePattern,
                        message: '编码不能包含中文或空格',
                      },
                    ]
                  : []),
              ]
              if (field.type === 'checkbox') {
                return (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    valuePropName="checked"
                    label={field.label}
                    style={{ gridColumn: `span ${field.formSpan || 6}` }}
                  >
                    <Checkbox disabled={viewing}>是</Checkbox>
                  </Form.Item>
                )
              }
              if (field.type === 'number') {
                return (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    rules={rules}
                    style={{ gridColumn: `span ${field.formSpan || 3}` }}
                  >
                    <InputNumber disabled={viewing} min={0} style={{ width: '100%' }} />
                  </Form.Item>
                )
              }
              if (field.type === 'time') {
                return (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    rules={rules}
                    getValueProps={(value) => ({ value: toTimeValue(value) })}
                    normalize={fromTimeValue}
                    style={{ gridColumn: `span ${field.formSpan || 3}` }}
                  >
                    <TimePicker
                      disabled={viewing}
                      format="HH:mm"
                      minuteStep={5}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                )
              }
              if (field.type === 'select' || field.type === 'multiSelect') {
                return (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    rules={rules}
                    style={{ gridColumn: `span ${field.formSpan || 3}` }}
                  >
                    <Select
                      allowClear
                      disabled={viewing}
                      mode={field.type === 'multiSelect' ? 'multiple' : undefined}
                      options={optionItems(field)}
                      placeholder={
                        resource === 'teams' && field.name === 'leaderUserId'
                          ? '请先选择班组成员'
                          : undefined
                      }
                      onChange={
                        resource === 'teams' && field.name === 'memberUserIds'
                          ? (value) => {
                              const selectedMemberIds = Array.isArray(value) ? value.map(String) : []
                              const leaderUserId = String(form.getFieldValue('leaderUserId') || '')
                              if (leaderUserId && !selectedMemberIds.includes(leaderUserId)) {
                                form.setFieldValue('leaderUserId', undefined)
                              }
                            }
                          : undefined
                      }
                    />
                  </Form.Item>
                )
              }
              if (field.type === 'textarea' || field.type === 'json') {
                if (field.name.toLowerCase().includes('images')) {
                  return (
                    <Form.Item
                      key={field.name}
                      name={field.name}
                      label={field.label}
                      rules={rules}
                      style={{ gridColumn: `span ${field.formSpan || 6}` }}
                    >
                      <ImageUploadField readOnly={viewing} />
                    </Form.Item>
                  )
                }
                return (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    rules={rules}
                    style={{ gridColumn: `span ${field.formSpan || 6}` }}
                  >
                    <Input.TextArea disabled={viewing} rows={field.type === 'json' ? 5 : 3} />
                  </Form.Item>
                )
              }
              return (
                <Form.Item
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  rules={rules}
                  style={{ gridColumn: `span ${field.formSpan || 3}` }}
                >
                  <Input disabled={Boolean(viewing || field.computed || (editing && field.code))} />
                </Form.Item>
              )
            })}
          </div>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
