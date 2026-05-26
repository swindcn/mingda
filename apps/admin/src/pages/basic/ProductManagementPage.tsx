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
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import type { TableColumnsType, UploadProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { loadDictionaries } from '../../utils/dictionaries'
import {
  createProductOnApi,
  deleteProductOnApi,
  fetchProductsFromApi,
  loadProducts,
  saveProducts,
  updateProductOnApi,
} from '../../utils/masterData'
import type { ProductRecord, ProductSource } from '../../utils/masterData'

type ProductFormValues = Omit<ProductRecord, 'id' | 'createdAt'>

function formatMoney(value: number) {
  return `¥${value.toFixed(2)}`
}

export function ProductManagementPage() {
  const [form] = Form.useForm<ProductFormValues>()
  const [products, setProducts] = useState<ProductRecord[]>(() => loadProducts())
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null)
  const [dictionaries, setDictionaries] = useState(() => loadDictionaries())

  useEffect(() => {
    const refresh = () => setDictionaries(loadDictionaries())
    window.addEventListener('mingda-dictionaries-updated', refresh)
    return () => window.removeEventListener('mingda-dictionaries-updated', refresh)
  }, [])

  useEffect(() => {
    saveProducts(products)
  }, [products])

  useEffect(() => {
    void fetchProductsFromApi()
      .then(setProducts)
      .catch((error) => message.error(error instanceof Error ? error.message : '产品数据加载失败'))
  }, [])

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = keyword.trim()

    if (!normalizedKeyword) {
      return products
    }

    return products.filter((product) =>
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
  }, [keyword, products])

  const openCreateModal = () => {
    setEditingProduct(null)
    form.resetFields()
    form.setFieldsValue({
      unit: dictionaries.productUnits[0],
      type: dictionaries.productTypes[0],
      source: '自制件',
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
        message.error(error instanceof Error ? error.message : '产品更新失败')
        return
      }
      message.success('产品已更新')
    } else {
      try {
        setProducts(await createProductOnApi(values))
      } catch (error) {
        message.error(error instanceof Error ? error.message : '产品新增失败')
        return
      }
      message.success('产品已新增')
    }

    closeModal()
  }

  const handleDelete = async (id: string) => {
    try {
      setProducts(await deleteProductOnApi(id))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '产品删除失败')
      return
    }
    message.success('产品已删除')
  }

  const confirmDelete = (record: ProductRecord) => {
    Modal.confirm({
      title: '删除产品',
      content: `确定删除「${record.name}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record.id),
    })
  }

  const handleExportTemplate = () => {
    message.info('产品导入模板下载功能待后端文件服务接入')
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
      title: '产品ID',
      dataIndex: 'id',
      width: 100,
    },
    {
      title: '产品名称',
      dataIndex: 'name',
      width: 180,
      fixed: 'left',
    },
    {
      title: '产品编码',
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
      title: '类型',
      dataIndex: 'type',
      width: 110,
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
            {
              key: 'edit',
              label: '编辑',
              icon: <EditOutlined />,
              onClick: () => openEditModal(record),
            },
            {
              key: 'delete',
              label: '删除',
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => confirmDelete(record),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">产品管理</h1>
          <p className="page-description">维护产品编码、规格、来源、价格、库存和产能信息。</p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleExportTemplate}>
            下载模板
          </Button>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />}>Excel导入</Button>
          </Upload>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新增产品
          </Button>
        </Space>
      </div>

      <Card>
        <Space style={{ width: '100%', marginBottom: 16 }} direction="vertical" size={16}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索产品名称、编码、ID、规格、来源或车间"
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
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </Space>
      </Card>

      <Modal
        title={editingProduct ? '编辑产品' : '新增产品'}
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
            salePrice: 0,
            costPrice: 0,
            stockMax: 0,
            stockMin: 0,
            minPurchase: 0,
            dailyCapacity: 0,
          }}
        >
          <Typography.Title level={5}>产品基本信息</Typography.Title>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item
              label="产品名称"
              name="name"
              rules={[{ required: true, message: '请输入产品名称' }]}
            >
              <Input placeholder="请输入产品名称" />
            </Form.Item>
            <Form.Item
              label="产品编码"
              name="code"
              rules={[{ required: true, message: '请输入产品编码' }]}
            >
              <Input placeholder="请输入产品编码" />
            </Form.Item>
            <Form.Item
              label="产品规格"
              name="spec"
              rules={[{ required: true, message: '请输入产品规格' }]}
            >
              <Input placeholder="例如：600x400x360" />
            </Form.Item>
            <Form.Item
              label="产品单位"
              name="unit"
              rules={[{ required: true, message: '请选择产品单位' }]}
            >
              <Select
                options={dictionaries.productUnits.map((unit) => ({
                  label: unit,
                  value: unit,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="产品类型"
              name="type"
              rules={[{ required: true, message: '请选择产品类型' }]}
            >
              <Select
                options={dictionaries.productTypes.map((type) => ({
                  label: type,
                  value: type,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="产品来源"
              name="source"
              rules={[{ required: true, message: '请选择产品来源' }]}
            >
              <Radio.Group
                options={[
                  { label: '自制件', value: '自制件' },
                  { label: '外购件', value: '外购件' },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="生产车间"
              name="workshop"
              rules={[{ required: true, message: '请输入生产车间' }]}
              style={{ gridColumn: '1 / span 2' }}
            >
              <Input placeholder="请输入生产车间" />
            </Form.Item>
          </div>

          <Typography.Title level={5} style={{ marginTop: 8 }}>
            产品辅助信息
          </Typography.Title>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item label="产品售价(元)" name="salePrice">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="产品成本价(元)" name="costPrice">
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
            <Form.Item label="备注" name="remark" style={{ gridColumn: '1 / span 2' }}>
              <Input.TextArea rows={3} placeholder="请输入备注信息" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  )
}
