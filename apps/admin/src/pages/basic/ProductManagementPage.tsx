import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Cascader,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Tree,
  Typography,
  Upload,
  message,
} from 'antd'
import type { TableColumnsType, UploadProps } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { loadDictionaries } from '../../utils/dictionaries'
import type { ProductTypeNode } from '../../utils/dictionaries'
import { fetchModelingOptions } from '../../utils/modeling'
import type { ModelingOptions } from '../../utils/modeling'
import {
  createProductOnApi,
  deleteProductOnApi,
  fetchProductsFromApi,
  loadProducts,
  saveProducts,
  updateProductOnApi,
} from '../../utils/masterData'
import type { ProductRecord, ProductSource } from '../../utils/masterData'
import { hasPermission } from '../../utils/roles'

type ProductFormValues = Omit<ProductRecord, 'id' | 'createdAt' | 'workshop'> & {
  workshop?: string
}

function formatMoney(value: number) {
  return `¥${value.toFixed(2)}`
}

function productTypePath(type?: string) {
  return String(type || '')
}

function flattenTypePaths(nodes: ProductTypeNode[], prefix = ''): string[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name
    return [path, ...flattenTypePaths(node.children || [], path)]
  })
}

function toCascaderOptions(nodes: ProductTypeNode[]): Array<{ label: string; value: string; children?: Array<{ label: string; value: string }> }> {
  return nodes.map((node) => ({
    label: node.name,
    value: node.name,
    children: node.children?.length ? toCascaderOptions(node.children) : undefined,
  }))
}

function toTreeData(nodes: ProductTypeNode[]): DataNode[] {
  return [
    {
      key: 'all',
      title: '全部',
      children: nodes.map((node) => toTypeTreeNode(node)),
    },
  ]
}

function toTypeTreeNode(node: ProductTypeNode, prefix = ''): DataNode {
  const path = prefix ? `${prefix}/${node.name}` : node.name
  return {
    key: path,
    title: node.name,
    children: node.children?.map((child) => toTypeTreeNode(child, path)),
  }
}

export function ProductManagementPage() {
  const [form] = Form.useForm<ProductFormValues>()
  const [products, setProducts] = useState<ProductRecord[]>(() => loadProducts())
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null)
  const [dictionaries, setDictionaries] = useState(() => loadDictionaries())
  const [modelingOptions, setModelingOptions] = useState<ModelingOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')
  const canCreate = hasPermission('basic.product.create')
  const canEdit = hasPermission('basic.product.edit')
  const canDelete = hasPermission('basic.product.delete')

  useEffect(() => {
    const refresh = () => setDictionaries(loadDictionaries())
    window.addEventListener('mingda-dictionaries-updated', refresh)
    return () => window.removeEventListener('mingda-dictionaries-updated', refresh)
  }, [])

  useEffect(() => {
    saveProducts(products)
  }, [products])

  useEffect(() => {
    void fetchModelingOptions()
      .then(setModelingOptions)
      .catch(() => setModelingOptions(null))
  }, [])

  const refreshProducts = async () => {
    setLoading(true)
    try {
      setProducts(await fetchProductsFromApi())
    } catch (error) {
      message.error(error instanceof Error ? error.message : '物料数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshProducts()
  }, [])

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = keyword.trim()
    const typeMatchedProducts = typeFilter === 'all'
      ? products
      : products.filter((product) => productTypePath(product.type) === typeFilter || productTypePath(product.type).startsWith(`${typeFilter}/`))

    if (!normalizedKeyword) {
      return typeMatchedProducts
    }

    return typeMatchedProducts.filter((product) =>
      [
        product.id,
        product.name,
        product.code,
        product.spec,
        product.unit,
        product.type,
        product.source,
        product.workshop,
      ].some((value) => value.includes(normalizedKeyword)),
    )
  }, [keyword, products, typeFilter])

  const productTypeOptions = useMemo(() => toCascaderOptions(dictionaries.productTypes), [dictionaries.productTypes])
  const productTypeTree = useMemo(() => toTreeData(dictionaries.productTypes), [dictionaries.productTypes])
  const expandedTypeKeys = useMemo(() => ['all', ...flattenTypePaths(dictionaries.productTypes)], [dictionaries.productTypes])
  const workshopOptions = useMemo(
    () => (modelingOptions?.workshops || []).map((record) => ({
      label: record.name || record.code || record.id,
      value: record.name || record.code || record.id,
    })),
    [modelingOptions],
  )
  const source = Form.useWatch('source', form)

  useEffect(() => {
    if (source !== '自制件') {
      form.setFieldValue('workshop', undefined)
    }
  }, [form, source])

  const openCreateModal = () => {
    setEditingProduct(null)
    form.resetFields()
    form.setFieldsValue({
      unit: dictionaries.productUnits[0],
      type: flattenTypePaths(dictionaries.productTypes)[0],
      source: '自制件',
      purchaseUnit: '',
      salesUnit: '',
      inventoryUnit: '',
      unitConversions: [],
      salePrice: 0,
      costPrice: 0,
      stockMax: 0,
      stockMin: 0,
      minPurchase: 0,
      dailyCapacity: 0,
    })
    setModalOpen(true)
  }

  const openEditModal = (record: ProductRecord) => {
    setEditingProduct(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingProduct(null)
    form.resetFields()
  }

  const handleSubmit = async (values: ProductFormValues) => {
    if (editingProduct) {
      try {
        setProducts(await updateProductOnApi(editingProduct.id, values))
      } catch (error) {
        message.error(error instanceof Error ? error.message : '物料更新失败')
        return
      }
      message.success('物料已更新')
    } else {
      try {
        setProducts(await createProductOnApi(values))
      } catch (error) {
        message.error(error instanceof Error ? error.message : '物料新增失败')
        return
      }
      message.success('物料已新增')
    }

    closeModal()
  }

  const handleDelete = async (id: string) => {
    try {
      setProducts(await deleteProductOnApi(id))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '物料删除失败')
      return
    }
    message.success('物料已删除')
  }

  const confirmDelete = (record: ProductRecord) => {
    Modal.confirm({
      title: '删除物料',
      content: `确定删除「${record.name}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record.id),
    })
  }

  const handleExportTemplate = () => {
    message.info('物料导入模板下载功能待后端文件服务接入')
  }

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (file) => {
      message.success(`已选择文件：${file.name}。后续接入 xlsx 解析或后端导入接口。`)
      return Upload.LIST_IGNORE
    },
  }

  const columns: TableColumnsType<ProductRecord> = [
    {
      title: '物料ID',
      dataIndex: 'id',
      width: 100,
    },
    {
      title: '物料名称',
      dataIndex: 'name',
      width: 180,
      fixed: 'left',
    },
    {
      title: '物料编码',
      dataIndex: 'code',
      width: 130,
    },
    {
      title: '规格',
      dataIndex: 'spec',
      width: 130,
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 80,
    },
    {
      title: '物料类型',
      dataIndex: 'type',
      width: 160,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 110,
      render: (value: ProductSource) => (
        <Tag color={value === '自制件' ? 'blue' : 'gold'}>{value}</Tag>
      ),
    },
    {
      title: '生产车间',
      dataIndex: 'workshop',
      width: 180,
      ellipsis: true,
    },
    {
      title: '售价',
      dataIndex: 'salePrice',
      width: 110,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: '成本',
      dataIndex: 'costPrice',
      width: 110,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: '库存范围',
      key: 'stockRange',
      width: 130,
      render: (_, record) => `${record.stockMin} - ${record.stockMax}`,
    },
    {
      title: '日产能',
      dataIndex: 'dailyCapacity',
      width: 100,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 120,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 150,
      render: (_, record) => (
        <TableActions
          actions={[
            ...(canEdit
              ? [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: <EditOutlined />,
                    onClick: () => openEditModal(record),
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">物料管理</h1>
          <p className="page-description">维护物料编码、规格、来源、价格、库存和产能信息。</p>
        </div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={refreshProducts}>
            查询
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExportTemplate}>
            下载模板
          </Button>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />}>Excel导入</Button>
          </Upload>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新增物料
            </Button>
          )}
        </Space>
      </div>

      <Card>
        <div className="material-management-layout">
          <aside className="material-type-panel">
            <div className="material-type-header">
              <Typography.Text strong>物料类型</Typography.Text>
            </div>
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined />}
              placeholder="查找类型"
              style={{ marginBottom: 12 }}
            />
            <Tree
              selectedKeys={[typeFilter]}
              expandedKeys={expandedTypeKeys}
              onSelect={(keys) => setTypeFilter(String(keys[0] || 'all'))}
              treeData={productTypeTree}
            />
          </aside>
          <Space style={{ minWidth: 0, width: '100%' }} direction="vertical" size={16}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索物料名称、编码、ID、规格、来源或车间"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              style={{ maxWidth: 420 }}
            />
            <ResizableTable
              className="fixed-action-table"
              storageKey="product-management-table-widths"
              rowKey="id"
              columns={columns}
              dataSource={filteredProducts}
              loading={loading}
              pagination={{
                pageSize: 10,
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 条`,
              }}
            />
          </Space>
        </div>
      </Card>

      <Modal
        title={editingProduct ? '编辑物料' : '新增物料'}
        open={modalOpen}
        width={860}
        okText={editingProduct ? '保存' : '确认添加'}
        cancelText="取消"
        onCancel={closeModal}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            unit: '片',
            type: '自制件',
            source: '自制件',
            purchaseUnit: '',
            salesUnit: '',
            inventoryUnit: '',
            unitConversions: [],
            salePrice: 0,
            costPrice: 0,
            stockMax: 0,
            stockMin: 0,
            minPurchase: 0,
            dailyCapacity: 0,
          }}
        >
          <Typography.Title level={5}>物料基本信息</Typography.Title>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item
              label="物料名称"
              name="name"
              rules={[{ required: true, message: '请输入物料名称' }]}
            >
              <Input placeholder="请输入物料名称" />
            </Form.Item>
            <Form.Item
              label="物料编码"
              name="code"
              rules={[{ required: true, message: '请输入物料编码' }]}
            >
              <Input placeholder="请输入物料编码" disabled={Boolean(editingProduct)} />
            </Form.Item>
            <Form.Item
              label="物料规格"
              name="spec"
              rules={[{ required: true, message: '请输入物料规格' }]}
            >
              <Input placeholder="例如：600x400x360" />
            </Form.Item>
            <Form.Item
              label="物料单位"
              name="unit"
              rules={[{ required: true, message: '请选择物料单位' }]}
            >
              <Select
                options={dictionaries.productUnits.map((unit) => ({
                  label: unit,
                  value: unit,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="物料类型"
              name="type"
              rules={[{ required: true, message: '请选择物料类型' }]}
              getValueFromEvent={(value: string[]) => value.join('/')}
              getValueProps={(value?: string) => ({
                value: productTypePath(value).split('/').filter(Boolean),
              })}
            >
              <Cascader
                options={productTypeOptions}
                changeOnSelect
                placeholder="请选择物料类型"
                displayRender={(labels) => labels.join('/')}
              />
            </Form.Item>
            <Form.Item
              label="物料来源"
              name="source"
              rules={[{ required: true, message: '请选择物料来源' }]}
            >
              <Radio.Group
                options={[
                  { label: '自制件', value: '自制件' },
                  { label: '外购件', value: '外购件' },
                ]}
              />
            </Form.Item>
            {source === '自制件' ? (
              <Form.Item
                label="生产车间"
                name="workshop"
                rules={[{ required: true, message: '请选择生产车间' }]}
                style={{ gridColumn: '1 / span 2' }}
              >
                <Select
                  allowClear
                  showSearch
                  options={workshopOptions}
                  placeholder="请选择生产车间"
                  optionFilterProp="label"
                />
              </Form.Item>
            ) : null}
          </div>

          <Typography.Title level={5} style={{ marginTop: 8 }}>
            物料辅助信息
          </Typography.Title>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item label="物料售价(元)" name="salePrice">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="物料成本价(元)" name="costPrice">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="库存上限" name="stockMax">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="库存下限" name="stockMin">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="最小采购量" name="minPurchase">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="日产能" name="dailyCapacity">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="采购单位" name="purchaseUnit">
              <Select
                allowClear
                options={dictionaries.productUnits.map((unit) => ({ label: unit, value: unit }))}
                placeholder="用于后续采购"
              />
            </Form.Item>
            <Form.Item label="销售单位" name="salesUnit">
              <Select
                allowClear
                options={dictionaries.productUnits.map((unit) => ({ label: unit, value: unit }))}
                placeholder="用于后续销售"
              />
            </Form.Item>
            <Form.Item label="库存单位" name="inventoryUnit">
              <Select
                allowClear
                options={dictionaries.productUnits.map((unit) => ({ label: unit, value: unit }))}
                placeholder="用于后续库存"
              />
            </Form.Item>
            <Form.Item label="单位换算规则" style={{ gridColumn: '1 / span 2' }}>
              <Form.List name="unitConversions">
                {(fields, { add, remove }) => (
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    {fields.map((field, index) => (
                      <Space key={field.key} align="baseline" wrap style={{ width: '100%' }}>
                        <span style={{ minWidth: 24, color: '#1677ff' }}>{index + 1}</span>
                        <Form.Item
                          {...field}
                          name={[field.name, 'sourceQuantity']}
                          style={{ marginBottom: 0, width: 120 }}
                          initialValue={1}
                        >
                          <InputNumber min={0} precision={3} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, 'sourceUnit']}
                          style={{ marginBottom: 0, width: 110 }}
                        >
                          <Select
                            allowClear
                            placeholder="单位"
                            options={dictionaries.productUnits.map((unit) => ({ label: unit, value: unit }))}
                          />
                        </Form.Item>
                        <span style={{ color: '#999' }}>≈</span>
                        <Form.Item
                          {...field}
                          name={[field.name, 'targetQuantity']}
                          style={{ marginBottom: 0, width: 120 }}
                          initialValue={1}
                        >
                          <InputNumber min={0} precision={3} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, 'targetUnit']}
                          style={{ marginBottom: 0, width: 110 }}
                        >
                          <Select
                            allowClear
                            placeholder="单位"
                            options={dictionaries.productUnits.map((unit) => ({ label: unit, value: unit }))}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, 'floating']}
                          valuePropName="checked"
                          style={{ marginBottom: 0 }}
                        >
                          <Checkbox>浮动换算</Checkbox>
                        </Form.Item>
                        <Button type="link" danger onClick={() => remove(field.name)}>
                          清空
                        </Button>
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add({ sourceQuantity: 1, targetQuantity: 1 })}>
                      新增换算规则
                    </Button>
                  </Space>
                )}
              </Form.List>
            </Form.Item>
            <Form.Item label="备注" name="remark" style={{ gridColumn: '1 / span 2' }}>
              <Input.TextArea rows={3} placeholder="请输入备注信息" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  )
}
