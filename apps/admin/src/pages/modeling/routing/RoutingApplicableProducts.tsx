import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Popconfirm, Select, Space, Tag, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { ResizableTable } from '../../../components/ResizableTable'
import type { RoutingOptions } from '../../../utils/processRoutings'

type RoutingProduct = RoutingOptions['products'][number]

interface RoutingApplicableProductsProps {
  products: RoutingProduct[]
  selectedCodes: string[]
  currentRoutingCode?: string
  defaultProductCodes: string[]
  editable: boolean
  saved: boolean
  onChange: (productCodes: string[]) => Promise<void> | void
  onRefresh: () => Promise<void> | void
}

export function RoutingApplicableProducts({
  products,
  selectedCodes,
  currentRoutingCode,
  defaultProductCodes,
  editable,
  saved,
  onChange,
  onRefresh,
}: RoutingApplicableProductsProps) {
  const [keyword, setKeyword] = useState('')
  const [open, setOpen] = useState(false)
  const [addingCodes, setAddingCodes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes])
  const defaultSet = useMemo(() => new Set(defaultProductCodes), [defaultProductCodes])
  const selectedProducts = useMemo(() => {
    const key = keyword.trim().toLowerCase()
    return products.filter((product) => selectedSet.has(product.code) && (!key || `${product.code}${product.name}${product.type}${product.materialGradeName}`.toLowerCase().includes(key)))
  }, [keyword, products, selectedSet])
  const candidates = useMemo(() => products.filter((product) => (
    !selectedSet.has(product.code)
    && (!product.assignedRoutingCode || product.assignedRoutingCode === currentRoutingCode)
  )), [currentRoutingCode, products, selectedSet])

  const persist = async (nextCodes: string[], successMessage: string) => {
    try {
      setSaving(true)
      await onChange(nextCodes)
      message.success(successMessage)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '适用产品保存失败')
    } finally {
      setSaving(false)
    }
  }

  const addProducts = async () => {
    if (!addingCodes.length) {
      message.warning('请选择需要添加的产品或半成品')
      return
    }
    await persist(Array.from(new Set([...selectedCodes, ...addingCodes])), saved ? '适用产品已添加' : '适用产品已选择')
    setAddingCodes([])
    setOpen(false)
  }

  const columns: ColumnsType<RoutingProduct> = [
    { title: '产品编码', dataIndex: 'code', width: 190 },
    { title: '产品名称', dataIndex: 'name', width: 220 },
    { title: '物料类型', dataIndex: 'type', width: 130 },
    { title: '材质牌号', dataIndex: 'materialGradeName', width: 180, render: (value: string, product) => value ? `${value}（${product.materialGradeCode}）` : '-' },
    { title: '默认路线', key: 'default', width: 110, render: (_, product) => defaultSet.has(product.code) ? <Tag color="blue">是</Tag> : '否' },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 90,
      render: (_, product) => editable ? <Popconfirm
        title="确认移除该适用产品？"
        description={defaultSet.has(product.code) ? '该产品的默认路线关系也会同步取消。' : undefined}
        onConfirm={() => void persist(selectedCodes.filter((code) => code !== product.code), '适用产品已移除')}
      >
        <Tooltip title="移除"><Button type="link" danger size="small" icon={<DeleteOutlined />} disabled={saving} /></Tooltip>
      </Popconfirm> : '-',
    },
  ]

  return <div className="routing-products-panel">
    <div className="routing-products-toolbar">
      <Input allowClear prefix={<SearchOutlined />} placeholder="搜索产品编码、名称、类型或材质" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      <Space>
        <Button type="primary" icon={<SearchOutlined />} onClick={() => void onRefresh()}>查询</Button>
        {editable && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>添加产品</Button>}
      </Space>
    </div>
    <ResizableTable<RoutingProduct>
      storageKey="routing-applicable-product-widths"
      rowKey="code"
      columns={columns}
      dataSource={selectedProducts}
      pagination={{ pageSize: 10 }}
      scroll={{ x: 920 }}
    />
    <Modal
      title="添加适用产品/半成品"
      open={open}
      onCancel={() => { setOpen(false); setAddingCodes([]) }}
      onOk={() => void addProducts()}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Select
        mode="multiple"
        showSearch
        optionFilterProp="label"
        maxTagCount="responsive"
        placeholder="请选择产品或半成品"
        value={addingCodes}
        options={candidates.map((product) => ({ label: `${product.name}（${product.code}） · ${product.type}`, value: product.code }))}
        onChange={setAddingCodes}
        style={{ width: '100%' }}
      />
    </Modal>
  </div>
}
