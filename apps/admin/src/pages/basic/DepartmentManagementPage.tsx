import {
  ApartmentOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import {
  createDepartmentOnApi,
  deleteDepartmentOnApi,
  fetchDepartmentsFromApi,
  getDepartmentOptions,
  syncDepartmentsOnApi,
  updateDepartmentOnApi,
} from '../../utils/departments'
import type { DepartmentRecord } from '../../utils/departments'
import { hasPermission } from '../../utils/roles'

type SyncProvider = 'dingtalk' | 'wechat-work' | 'lark'

interface DepartmentFormValues {
  name: string
  code: string
  parentKey?: string
  createdAt: dayjs.Dayjs
}

interface SyncFormValues {
  provider: SyncProvider
  appId?: string
  appSecret?: string
  corpId?: string
  agentId?: string
  appKey?: string
  syncMode: 'merge' | 'overwrite'
}

const providerLabelMap: Record<SyncProvider, string> = {
  dingtalk: '钉钉',
  'wechat-work': '企业微信',
  lark: '飞书',
}

const syncedDepartments: Record<SyncProvider, DepartmentRecord[]> = {
  dingtalk: [
    {
      key: 'dt-200',
      name: '钉钉同步-生产中心',
      code: 'DT200',
      createdAt: '2026-05-22 09:40:00',
      source: '钉钉',
      children: [
        {
          key: 'dt-201',
          name: '钉钉同步-铸造车间',
          code: 'DT201',
          createdAt: '2026-05-22 09:40:00',
          source: '钉钉',
        },
      ],
    },
  ],
  'wechat-work': [
    {
      key: 'ww-300',
      name: '企微同步-模具协同部',
      code: 'WW300',
      createdAt: '2026-05-22 09:40:00',
      source: '企业微信',
    },
  ],
  lark: [
    {
      key: 'lark-400',
      name: '飞书同步-数字化运营部',
      code: 'LARK400',
      createdAt: '2026-05-22 09:40:00',
      source: '飞书',
    },
  ],
}

export function DepartmentManagementPage() {
  const [departmentForm] = Form.useForm<DepartmentFormValues>()
  const [syncForm] = Form.useForm<SyncFormValues>()
  const navigate = useNavigate()
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [departmentLoading, setDepartmentLoading] = useState(true)
  const [departmentModalOpen, setDepartmentModalOpen] = useState(false)
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<DepartmentRecord | null>(null)
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('dingtalk')
  const canCreateDepartment = hasPermission('basic.department.create')
  const canEditDepartment = hasPermission('basic.department.edit')
  const canDeleteDepartment = hasPermission('basic.department.delete')

  const refreshDepartments = async () => {
    setDepartmentLoading(true)
    try {
      setDepartments(await fetchDepartmentsFromApi())
    } catch (error) {
      message.error(error instanceof Error ? error.message : '部门数据加载失败')
    } finally {
      setDepartmentLoading(false)
    }
  }

  useEffect(() => {
    void refreshDepartments()
  }, [])

  const departmentOptions = useMemo(
    () =>
      getDepartmentOptions(departments).map((department) => ({
        label: department.label,
        value: department.value,
      })),
    [departments],
  )

  const openCreateModal = (parent?: DepartmentRecord) => {
    setEditingDepartment(null)
    departmentForm.resetFields()
    departmentForm.setFieldsValue({
      parentKey: parent?.key,
      createdAt: dayjs(),
    })
    setDepartmentModalOpen(true)
  }

  const openEditModal = (record: DepartmentRecord) => {
    setEditingDepartment(record)
    departmentForm.setFieldsValue({
      name: record.name,
      code: record.code,
      createdAt: dayjs(record.createdAt),
    })
    setDepartmentModalOpen(true)
  }

  const closeDepartmentModal = () => {
    setDepartmentModalOpen(false)
    setEditingDepartment(null)
    departmentForm.resetFields()
  }

  const handleSubmitDepartment = async (values: DepartmentFormValues) => {
    if (editingDepartment) {
      try {
        const nextDepartments = await updateDepartmentOnApi(editingDepartment.key, {
          name: values.name,
          code: values.code,
        })
        setDepartments(nextDepartments)
        message.success('部门已更新')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '部门更新失败')
        return
      }
    } else {
      try {
        const nextDepartments = await createDepartmentOnApi({
          name: values.name,
          code: values.code,
          parentKey: values.parentKey,
        })
        setDepartments(nextDepartments)
        message.success('部门已新增')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '部门新增失败')
        return
      }
    }
    closeDepartmentModal()
  }

  const handleDelete = async (record: DepartmentRecord) => {
    try {
      setDepartments(await deleteDepartmentOnApi(record.key))
      message.success('部门已删除，相关用户的所属部门已清空')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '部门删除失败')
    }
  }

  const confirmDelete = (record: DepartmentRecord) => {
    Modal.confirm({
      title: '删除部门',
      content: '删除部门会同时删除下级部门，并清空用户中已关联的所属部门，确定继续吗？',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record),
    })
  }

  const openSyncModal = () => {
    syncForm.setFieldsValue({
      provider: 'dingtalk',
      syncMode: 'merge',
    })
    setSyncProvider('dingtalk')
    setSyncModalOpen(true)
  }

  const handleSync = async (values: SyncFormValues) => {
    try {
      const nextDepartments = await syncDepartmentsOnApi({
        provider: values.provider,
        syncMode: values.syncMode,
        departments: syncedDepartments[values.provider],
      })
      setDepartments(nextDepartments)
      message.success(`已同步${providerLabelMap[values.provider]}部门数据`)
      setSyncModalOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '部门同步失败')
    }
  }

  const columns: TableColumnsType<DepartmentRecord> = [
    {
      title: '部门名称',
      dataIndex: 'name',
      width: 360,
      render: (value, record) => (
        <Space>
          <ApartmentOutlined />
          <Typography.Text>{value}</Typography.Text>
          <Tag>{record.source}</Tag>
        </Space>
      ),
    },
    {
      title: '部门添加时间',
      dataIndex: 'createdAt',
      width: 260,
    },
    {
      title: '部门编号',
      dataIndex: 'code',
      width: 180,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 230,
      render: (_, record) => (
        <TableActions
          actions={[
            ...(canCreateDepartment
              ? [
                  {
                    key: 'create-child',
                    label: '新增子部门',
                    shortLabel: '子部门',
                    icon: <PlusOutlined />,
                    onClick: () => openCreateModal(record),
                  },
                ]
              : []),
            ...(canEditDepartment
              ? [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: <EditOutlined />,
                    onClick: () => openEditModal(record),
                  },
                ]
              : []),
            ...(canDeleteDepartment
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
          <h1 className="page-title">部门管理</h1>
          <p className="page-description">
            按层级维护部门，并支持从钉钉、企业微信、飞书同步已有部门数据。
          </p>
        </div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={departmentLoading} onClick={refreshDepartments}>
            查询
          </Button>
          <Button icon={<QuestionCircleOutlined />} onClick={() => navigate('/dashboard/departments/help')}>
            配置帮助
          </Button>
          <Button icon={<SyncOutlined />} onClick={openSyncModal}>
            同步钉钉数据
          </Button>
          {canCreateDepartment && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateModal()}>
              新增部门
            </Button>
          )}
        </Space>
      </div>

      <Card>
        <ResizableTable
          className="fixed-action-table"
          storageKey="department-management-table-widths"
          rowKey="key"
          columns={columns}
          dataSource={departments}
          loading={departmentLoading}
          pagination={false}
          expandable={{ defaultExpandAllRows: true }}
        />
      </Card>

      <Modal
        title={editingDepartment ? '编辑部门' : '新增部门'}
        open={departmentModalOpen}
        width={560}
        okText={editingDepartment ? '保存' : '确认新增'}
        cancelText="取消"
        onCancel={closeDepartmentModal}
        onOk={() => departmentForm.submit()}
        destroyOnHidden
      >
        <Form form={departmentForm} layout="vertical" onFinish={handleSubmitDepartment}>
          {!editingDepartment && (
            <Form.Item label="上级部门" name="parentKey">
              <Select allowClear placeholder="不选择则新增为顶级部门" options={departmentOptions} />
            </Form.Item>
          )}
          <Form.Item
            label="部门名称"
            name="name"
            rules={[{ required: true, message: '请输入部门名称' }]}
          >
            <Input placeholder="请输入部门名称" />
          </Form.Item>
          <Form.Item
            label="部门编号"
            name="code"
            rules={[{ required: true, message: '请输入部门编号' }]}
          >
            <Input placeholder="请输入部门编号" disabled={Boolean(editingDepartment)} />
          </Form.Item>
          <Form.Item
            label="部门添加时间"
            name="createdAt"
            rules={[{ required: true, message: '请选择部门添加时间' }]}
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="同步第三方部门"
        open={syncModalOpen}
        width={720}
        okText="开始同步"
        cancelText="取消"
        onCancel={() => setSyncModalOpen(false)}
        onOk={() => syncForm.submit()}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前为测试同步数据落库"
          description="本版本会把测试同步结果写入后端数据库；真实接入时再由后端安全保存密钥并调用第三方通讯录接口。"
        />
        <Form form={syncForm} layout="vertical" onFinish={handleSync}>
          <Form.Item label="同步来源" name="provider" rules={[{ required: true }]}>
            <Radio.Group
              onChange={(event) => setSyncProvider(event.target.value)}
              options={[
                { label: '钉钉', value: 'dingtalk' },
                { label: '企业微信', value: 'wechat-work' },
                { label: '飞书', value: 'lark' },
              ]}
            />
          </Form.Item>

          {syncProvider === 'dingtalk' && (
            <>
              <Form.Item label="AppKey / AppID" name="appKey" rules={[{ required: true, message: '请输入钉钉 AppKey 或 AppID' }]}>
                <Input placeholder="例如 dingxxxxxxxxxxxx" />
              </Form.Item>
              <Form.Item label="AppSecret" name="appSecret" rules={[{ required: true, message: '请输入钉钉 AppSecret' }]}>
                <Input.Password placeholder="请输入 AppSecret" />
              </Form.Item>
            </>
          )}

          {syncProvider === 'wechat-work' && (
            <>
              <Form.Item label="企业ID CorpID" name="corpId" rules={[{ required: true, message: '请输入企业微信 CorpID' }]}>
                <Input placeholder="例如 wwxxxxxxxxxxxx" />
              </Form.Item>
              <Form.Item label="通讯录 Secret" name="appSecret" rules={[{ required: true, message: '请输入通讯录 Secret' }]}>
                <Input.Password placeholder="请输入通讯录 Secret" />
              </Form.Item>
              <Form.Item label="AgentID" name="agentId">
                <Input placeholder="如使用自建应用同步，可填写 AgentID" />
              </Form.Item>
            </>
          )}

          {syncProvider === 'lark' && (
            <>
              <Form.Item label="App ID" name="appId" rules={[{ required: true, message: '请输入飞书 App ID' }]}>
                <Input placeholder="例如 cli_xxxxxxxxxxxx" />
              </Form.Item>
              <Form.Item label="App Secret" name="appSecret" rules={[{ required: true, message: '请输入飞书 App Secret' }]}>
                <Input.Password placeholder="请输入 App Secret" />
              </Form.Item>
            </>
          )}

          <Form.Item label="同步方式" name="syncMode" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { label: '合并已有部门', value: 'merge' },
                { label: '覆盖本地部门', value: 'overwrite' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
