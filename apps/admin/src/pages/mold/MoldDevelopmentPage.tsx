import {
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ImageUploadField } from '../../components/ImageUploadField'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { apiRequest } from '../../services/api'
import {
  collectDepartmentNamesByKey,
  collectDepartmentNamesByName,
  loadDepartments,
} from '../../utils/departments'
import { loadDictionaries } from '../../utils/dictionaries'
import {
  MASTER_DATA_EVENT,
  fetchCustomersFromApi,
  fetchProductsFromApi,
  fetchSuppliersFromApi,
  loadCustomers,
  loadProducts,
  loadSuppliers,
} from '../../utils/masterData'
import {
  getCurrentAdminUser,
  getCurrentColumnPermissions,
  getCurrentDataScopes,
  getEffectiveRoles,
  hasPermission,
} from '../../utils/roles'
import { USER_STORAGE_EVENT, fetchInternalEmployeesFromApi, loadInternalEmployees, loadUsers } from '../../utils/users'

type MoldStatus =
  | '待确认'
  | '待发货'
  | '待收货'
  | '待试产'
  | '试产中'
  | '已完成'
  | '已中止'

interface MoldDevelopmentRecord {
  id: string
  customerId: string
  customerName: string
  productCode: string
  productName: string
  moldName: string
  customerNotifyDate: string
  moldType: string
  supplierId: string
  supplierName: string
  follower: string
  expectedDate?: string
  status: MoldStatus
  isArchived: boolean
  archivedMoldCode?: string
  shippedAt?: string
  trackingNumber?: string
  attachments: string[]
  remark?: string
  createdAt: string
}

interface MoldDevelopmentFormValues {
  customerId: string
  productCode: string
  moldName: string
  customerNotifyDate: dayjs.Dayjs
  moldType: string
  supplierId: string
  follower: string
  expectedDate?: dayjs.Dayjs
  remark?: string
}

const initialDevelopments: MoldDevelopmentRecord[] = [
  {
    id: 'MD001',
    customerId: 'CUS001',
    customerName: '长城汽车股份有限公司',
    productCode: 'P001',
    productName: '英沃保险柜门板内板',
    moldName: '英沃保险柜门板内板模具',
    customerNotifyDate: '2026-04-17',
    moldType: '压铸模',
    supplierId: 'SUP001',
    supplierName: '鑫源材料有限公司',
    follower: '王五',
    expectedDate: '2026-05-31',
    status: '待收货',
    isArchived: false,
    shippedAt: '2026-04-28 16:00',
    trackingNumber: 'SF1234567890',
    attachments: ['模具设计图.jpg', '产品图纸.jpg', '3D效果图.jpg'],
    remark: '急件，优先处理',
    createdAt: '2026-04-15',
  },
  {
    id: 'MD002',
    customerId: 'CUS002',
    customerName: '比亚迪汽车工业有限公司',
    productCode: 'P002',
    productName: '球墨铸铁泵体',
    moldName: '球墨铸铁泵体模具',
    customerNotifyDate: '2026-05-18',
    moldType: '砂型模',
    supplierId: 'SUP002',
    supplierName: '华泰金属制品厂',
    follower: '赵六',
    expectedDate: '2026-06-20',
    status: '待确认',
    isArchived: false,
    attachments: ['泵体图纸.pdf'],
    remark: '供应商将在小程序端收到确认任务',
    createdAt: '2026-05-19',
  },
]

const statusOptions: Array<{ label: string; value: MoldStatus | 'all' }> = [
  { label: '全部状态', value: 'all' },
  { label: '待确认', value: '待确认' },
  { label: '待发货', value: '待发货' },
  { label: '待收货', value: '待收货' },
  { label: '待试产', value: '待试产' },
  { label: '试产中', value: '试产中' },
]

const archiveTabs: Array<{ label: string; key: 'active' | 'completed' | 'cancelled' }> = [
  { label: '进行中', key: 'active' },
  { label: '已完成', key: 'completed' },
  { label: '已中止', key: 'cancelled' },
]

const statusColorMap: Record<MoldStatus, string> = {
  待确认: 'orange',
  待发货: 'purple',
  待收货: 'geekblue',
  待试产: 'gold',
  试产中: 'gold',
  已完成: 'success',
  已中止: 'default',
}

interface MobileMoldRecord {
  id: string
  code: string
  customerName: string
  productCode: string
  productName: string
  moldName: string
  moldType: string
  isArchived?: boolean
  archivedMoldCode?: string
  status: MoldStatus
  supplierName: string
  followerName: string
  notifiedDate: string
  expectedDate: string
  trackingNumber?: string
  issuedDate: string
  remark: string
  images: string[]
}

interface DeleteMoldResponse {
  id: string
}

function mapApiRecord(record: MobileMoldRecord): MoldDevelopmentRecord {
  return {
    id: record.code,
    customerId: '',
    customerName: record.customerName,
    productCode: record.productCode,
    productName: record.productName,
    moldName: record.moldName,
    customerNotifyDate: record.notifiedDate,
    moldType: record.moldType,
    isArchived: Boolean(record.isArchived),
    archivedMoldCode: record.archivedMoldCode,
    supplierId: '',
    supplierName: record.supplierName,
    follower: record.followerName,
    expectedDate: record.expectedDate,
    status: record.status,
    trackingNumber: record.trackingNumber,
    attachments: record.images,
    remark: record.remark,
    createdAt: record.issuedDate,
  }
}

export function MoldDevelopmentPage() {
  const [form] = Form.useForm<MoldDevelopmentFormValues>()
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const [developments, setDevelopments] = useState<MoldDevelopmentRecord[]>(initialDevelopments)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<MoldStatus | 'all'>(
    (searchParams.get('status') as MoldStatus | 'all') || 'all',
  )
  const [archiveTab, setArchiveTab] = useState<'active' | 'completed' | 'cancelled'>(
    (searchParams.get('tab') as 'active' | 'completed' | 'cancelled') || 'active',
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [dictionaries, setDictionaries] = useState(() => loadDictionaries())
  const [internalEmployees, setInternalEmployees] = useState(() => loadInternalEmployees())
  const [customers, setCustomers] = useState(() => loadCustomers())
  const [products, setProducts] = useState(() => loadProducts())
  const [suppliers, setSuppliers] = useState(() => loadSuppliers())
  const [loading, setLoading] = useState(false)
  const canCreate = hasPermission('mold.development.create')
  const canDelete = hasPermission('mold.development.delete')
  const columnPermissions = getCurrentColumnPermissions()
  const currentUser = getCurrentAdminUser()

  const updateListState = (nextTab: typeof archiveTab, nextStatus: MoldStatus | 'all') => {
    setArchiveTab(nextTab)
    setStatusFilter(nextStatus)
    const params = new URLSearchParams(location.search)
    params.set('tab', nextTab)
    if (nextTab === 'active' && nextStatus !== 'all') {
      params.set('status', nextStatus)
    } else {
      params.delete('status')
    }
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
  }

  useEffect(() => {
    const refresh = () => setDictionaries(loadDictionaries())
    window.addEventListener('mingda-dictionaries-updated', refresh)
    return () => window.removeEventListener('mingda-dictionaries-updated', refresh)
  }, [])

  useEffect(() => {
    const refresh = () => setInternalEmployees(loadInternalEmployees())
    window.addEventListener(USER_STORAGE_EVENT, refresh)
    return () => window.removeEventListener(USER_STORAGE_EVENT, refresh)
  }, [])

  useEffect(() => {
    void fetchInternalEmployeesFromApi()
      .then(setInternalEmployees)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const refresh = () => {
      setCustomers(loadCustomers())
      setProducts(loadProducts())
      setSuppliers(loadSuppliers())
    }
    window.addEventListener(MASTER_DATA_EVENT, refresh)
    return () => window.removeEventListener(MASTER_DATA_EVENT, refresh)
  }, [])

  const loadDevelopments = async () => {
    setLoading(true)
    try {
      const records = await apiRequest<MobileMoldRecord[]>('/mobile/molds?viewer=admin')
      setDevelopments(records.map(mapApiRecord))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模具开发列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDevelopments()
  }, [])

  const filteredDevelopments = useMemo(() => {
    const normalizedKeyword = keyword.trim()
    const dataScopes = getCurrentDataScopes()
    const users = loadUsers()
    const departments = loadDepartments()
    const effectiveRoles = getEffectiveRoles()
    const currentLocalUser = users.find((user) => user.id === currentUser?.id || user.name === currentUser?.name)
    const isRecordVisible = (record: MoldDevelopmentRecord) => {
      if (dataScopes.includes('organization')) return true
      if (dataScopes.includes('self') && (record.follower === currentUser?.name || record.follower === currentLocalUser?.name)) {
        return true
      }
      if (dataScopes.includes('department') || dataScopes.includes('department_tree')) {
        const followerUser = users.find((user) => user.name === record.follower)
        const visibleDepartments = new Set<string>()
        if (dataScopes.includes('department') && currentLocalUser?.department) visibleDepartments.add(currentLocalUser.department)
        if (dataScopes.includes('department_tree') && currentLocalUser?.department) {
          collectDepartmentNamesByName(departments, currentLocalUser.department, true).forEach((department) =>
            visibleDepartments.add(department),
          )
        }
        if (followerUser?.department && visibleDepartments.has(followerUser.department)) return true
      }
      if (dataScopes.includes('custom_departments')) {
        const followerUser = users.find((user) => user.name === record.follower)
        const visibleDepartments = new Set(
          effectiveRoles.flatMap((role) =>
            role.customDepartments.flatMap((department) =>
              collectDepartmentNamesByKey(departments, department.departmentId, department.includeChildren),
            ),
          ),
        )
        if (followerUser?.department && visibleDepartments.has(followerUser.department)) return true
      }
      return false
    }

    return developments
      .filter((record) => {
        if (!isRecordVisible(record)) return false
        if (archiveTab === 'active' && (record.status === '已完成' || record.status === '已中止')) return false
        if (archiveTab === 'completed' && record.status !== '已完成') return false
        if (archiveTab === 'cancelled' && record.status !== '已中止') return false
        const matchedKeyword =
          !normalizedKeyword ||
          [
            record.id,
            record.customerName,
            record.productCode,
            record.productName,
            record.moldName,
            record.supplierName,
            record.follower,
            record.trackingNumber,
          ]
            .filter(Boolean)
            .some((value) => String(value).includes(normalizedKeyword))
        const matchedStatus = archiveTab === 'active' ? statusFilter === 'all' || record.status === statusFilter : true
        return matchedKeyword && matchedStatus
      })
      .sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf())
  }, [archiveTab, currentUser?.id, currentUser?.name, developments, keyword, statusFilter])

  const openCreateModal = async () => {
    try {
      const [nextCustomers, nextProducts, nextSuppliers, nextInternalEmployees] = await Promise.all([
        fetchCustomersFromApi(),
        fetchProductsFromApi(),
        fetchSuppliersFromApi(),
        fetchInternalEmployeesFromApi(),
      ])
      setCustomers(nextCustomers)
      setProducts(nextProducts)
      setSuppliers(nextSuppliers)
      setInternalEmployees(nextInternalEmployees)
      if (!nextInternalEmployees.length) {
        message.warning('当前没有可选的内部员工，请先在用户管理中新增或启用员工账号')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '基础档案加载失败')
      return
    }
    form.resetFields()
    setAttachments([])
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setAttachments([])
    form.resetFields()
  }

  const handleSubmit = async (values: MoldDevelopmentFormValues) => {
    const selectedCustomer = customers.find((customer) => customer.id === values.customerId)
    const selectedProduct = products.find((product) => product.id === values.productCode)
    const selectedSupplier = suppliers.find((supplier) => supplier.id === values.supplierId)

    try {
      const created = await apiRequest<MobileMoldRecord>('/admin/molds', {
        method: 'POST',
        body: JSON.stringify({
          customerId: values.customerId,
          customerName: selectedCustomer?.name || '',
          productCode: values.productCode,
          productName: selectedProduct?.name || '',
          moldName: values.moldName,
          customerNotifyDate: values.customerNotifyDate.format('YYYY-MM-DD'),
          moldType: values.moldType,
          supplierId: values.supplierId,
          supplierName: selectedSupplier?.name || '',
          followerName: values.follower,
          expectedDate: values.expectedDate?.format('YYYY-MM-DD'),
          attachments,
          remark: values.remark,
        }),
      })
      setDevelopments((currentRecords) => [mapApiRecord(created), ...currentRecords])
      message.success('开发需求已下达，供应商将在小程序端收到确认任务')
      closeModal()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '开发需求下达失败')
    }
  }

  const handleDelete = async (record: MoldDevelopmentRecord) => {
    if (record.status !== '已中止') {
      message.warning('仅已中止的开发单可以删除')
      return
    }

    try {
      await apiRequest<DeleteMoldResponse>(`/admin/molds/${record.id}`, {
        method: 'DELETE',
      })
      setDevelopments((currentRecords) => currentRecords.filter((item) => item.id !== record.id))
      message.success('开发需求已删除，小程序端将同步移除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '开发需求删除失败')
    }
  }

  const confirmDelete = (record: MoldDevelopmentRecord) => {
    Modal.confirm({
      title: '删除开发需求',
      content: `确定删除「${record.id}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record),
    })
  }

  const columns: TableColumnsType<MoldDevelopmentRecord> = [
    { title: '需求编号', dataIndex: 'id', width: 110, fixed: 'left' },
    { title: '客户', dataIndex: 'customerName', width: 180, ellipsis: true },
    {
      title: '产品',
      key: 'product',
      width: 200,
      render: (_, record) => `${record.productCode} / ${record.productName}`,
    },
    { title: '模具类型', dataIndex: 'moldType', width: 110 },
    { title: '模具名称', dataIndex: 'moldName', width: 180, ellipsis: true, render: (value) => value || '-' },
    { title: '模具供应商', dataIndex: 'supplierName', width: 170, ellipsis: true },
    {
      title: '建档状态',
      key: 'archiveStatus',
      width: 110,
      render: (_, record) => (
        <Tag color={record.isArchived ? 'success' : 'default'}>
          {record.isArchived ? '已建档' : '未建档'}
        </Tag>
      ),
    },
    { title: '跟单人', dataIndex: 'follower', width: 110 },
    {
      title: '流程状态',
      dataIndex: 'status',
      width: 140,
      render: (value: MoldStatus) => <Tag color={statusColorMap[value]}>{value}</Tag>,
    },
    { title: '客户告知', dataIndex: 'customerNotifyDate', width: 120 },
    { title: '期望完成', dataIndex: 'expectedDate', width: 120, render: (value) => value || '-' },
    {
      title: '快递单号',
      dataIndex: 'trackingNumber',
      width: 150,
      render: (value) => value || '-',
    },
    {
      title: '附件',
      dataIndex: 'attachments',
      width: 90,
      render: (value: string[]) => `${value.length} 个`,
    },
    ...(columnPermissions.includes('mold.remark')
      ? [
          {
            title: '备注',
            dataIndex: 'remark',
            width: 180,
            ellipsis: true,
            render: (value: string) => value || '-',
          },
        ]
      : []),
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 170,
      render: (_, record) => (
        <TableActions
          actions={[
            {
              key: 'view',
              label: '查看',
              icon: <EyeOutlined />,
              onClick: () =>
                navigate(`/dashboard/mold/development/${record.id}`, {
                  state: { from: `${location.pathname}${location.search}` },
                }),
            },
            ...(record.status === '已完成' && !record.isArchived
              ? [
                  {
                    key: 'archive',
                    label: '建档',
                    icon: <PlusOutlined />,
                    onClick: () => navigate(`/dashboard/mold/model?fromMoldDevelopment=${record.id}`),
                  },
                ]
              : []),
            ...(record.status === '已中止' && canDelete
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
          <h1 className="page-title">模具开发</h1>
          <p className="page-description">
            下达模具开发需求，并跟踪供应商确认、制作完成、发货、收货和试产流程。
          </p>
        </div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={loadDevelopments}>
            查询
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              下达开发需求
            </Button>
          )}
        </Space>
      </div>

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Tabs
            activeKey={archiveTab}
            items={archiveTabs}
            onChange={(key) => {
              updateListState(key as typeof archiveTab, 'all')
            }}
          />
          {archiveTab === 'active' && (
            <Space wrap>
              {statusOptions.map((option) => (
                <Button
                  key={option.value}
                  type={statusFilter === option.value ? 'primary' : 'default'}
                  onClick={() => updateListState('active', option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </Space>
          )}
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索需求编号、客户、产品、供应商或快递单号"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ maxWidth: 460 }}
          />
          <ResizableTable
            className="fixed-action-table"
            storageKey="mold-development-table-widths"
            rowKey="id"
            columns={columns}
            dataSource={filteredDevelopments}
            loading={loading}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </Space>
      </Card>

      <Modal
        title="下达模具开发需求"
        open={modalOpen}
        width={760}
        okText="下达需求"
        cancelText="取消"
        onCancel={closeModal}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item
              label="客户"
              name="customerId"
              rules={[{ required: true, message: '请选择客户' }]}
            >
              <Select
                placeholder="请选择客户"
                options={customers.map((customer) => ({
                  label: customer.name,
                  value: customer.id,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="产品"
              name="productCode"
              rules={[{ required: true, message: '请选择产品' }]}
            >
              <Select
                placeholder="请选择产品"
                options={products.map((product) => ({
                  label: `${product.id} - ${product.name}`,
                  value: product.id,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="客户告知时间"
              name="customerNotifyDate"
              rules={[{ required: true, message: '请选择客户告知时间' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="模具名称"
              name="moldName"
              rules={[{ required: true, message: '请输入模具名称' }]}
            >
              <Input placeholder="请输入模具名称" />
            </Form.Item>
            <Form.Item
              label="模具类型"
              name="moldType"
              rules={[{ required: true, message: '请选择模具类型' }]}
            >
              <Select
                placeholder="请选择模具类型"
                options={dictionaries.moldTypes.map((type) => ({
                  label: type,
                  value: type,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="模具供应商"
              name="supplierId"
              rules={[{ required: true, message: '请选择模具供应商' }]}
            >
              <Select
                placeholder="请选择供应商"
                options={suppliers.map((supplier) => ({
                  label: supplier.name,
                  value: supplier.id,
                }))}
              />
            </Form.Item>
            <Form.Item label="期望完成时间" name="expectedDate">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="跟单人"
              name="follower"
              rules={[{ required: true, message: '请选择跟单人' }]}
            >
              <Select
                placeholder="请选择跟单人"
                options={internalEmployees.map((employee) => ({
                  label: `${employee.name} / ${employee.phone} / ${employee.department}`,
                  value: employee.name,
                }))}
              />
            </Form.Item>
            <Form.Item label="图纸/图片附件" style={{ gridColumn: '1 / span 2' }}>
              <ImageUploadField value={attachments} onChange={setAttachments} />
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                上传后将以方形缩略图横向展示，点击缩略图可查看大图。
              </Typography.Text>
            </Form.Item>
            <Form.Item label="备注需求" name="remark" style={{ gridColumn: '1 / span 2' }}>
              <Input.TextArea rows={3} placeholder="请输入备注信息，例如交期、特殊结构、优先级等" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  )
}
