import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RestOutlined,
  SearchOutlined,
  SyncOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { DEPARTMENT_STORAGE_EVENT, getDepartmentOptions, loadDepartments } from '../../utils/departments'
import { loadDictionaries } from '../../utils/dictionaries'
import { ROLE_STORAGE_EVENT, loadRoles } from '../../utils/roles'
import {
  createUserOnApi,
  deleteUserOnApi,
  fetchUsersFromApi,
  loadUsers,
  saveUsers,
  updateUserOnApi,
} from '../../utils/users'
import type { LockStatus, UserRecord, UserStatus, UserType } from '../../utils/users'

type SyncProvider = 'dingtalk' | 'wechat-work' | 'lark'

interface UserFormValues {
  name: string
  phone: string
  password?: string
  userType: UserType
  organization: string
  department: string
  position: string
  role: string
  status: UserStatus
  lockStatus: LockStatus
  belongsTo?: string
}

interface SyncFormValues {
  provider: SyncProvider
  appId?: string
  appSecret?: string
  corpId?: string
  agentId?: string
  appKey?: string
}

const suppliers = ['鑫源材料', '华泰金属', '东方铸造']
const customers = ['长城汽车', '比亚迪集团', '上汽集团']
const organizations = ['摩尔元数（福建）科技有限公司', '厦门子公司', '培训学员组织']

const providerLabelMap: Record<SyncProvider, '钉钉' | '企业微信' | '飞书'> = {
  dingtalk: '钉钉',
  'wechat-work': '企业微信',
  lark: '飞书',
}

const syncedUsers: Record<SyncProvider, UserRecord[]> = {
  dingtalk: [
    {
      id: 'DT001',
      name: '张三-钉钉覆盖',
      phone: '13800138001',
      userType: '员工',
      organization: '摩尔元数（福建）科技有限公司',
      department: '总经办',
      position: '运营负责人',
      role: '普通用户',
      status: '启用',
      lockStatus: '正常',
      source: '钉钉',
      createdBy: '钉钉同步',
      createdAt: '2026-05-22 10:00:00',
      updatedBy: '钉钉同步',
      updatedAt: '2026-05-22 10:00:00',
    },
    {
      id: 'DT002',
      name: '离职员工',
      phone: '13900001111',
      userType: '员工',
      organization: '摩尔元数（福建）科技有限公司',
      department: '产品一部',
      position: '产品经理',
      role: '普通用户',
      status: '禁用',
      lockStatus: '正常',
      source: '钉钉',
      createdBy: '钉钉同步',
      createdAt: '2026-05-22 10:00:00',
      updatedBy: '钉钉同步',
      updatedAt: '2026-05-22 10:00:00',
    },
  ],
  'wechat-work': [
    {
      id: 'WW001',
      name: '企微员工',
      phone: '13900002222',
      userType: '员工',
      organization: '厦门子公司',
      department: '财务部',
      position: '会计',
      role: '普通用户',
      status: '启用',
      lockStatus: '正常',
      source: '企业微信',
      createdBy: '企业微信同步',
      createdAt: '2026-05-22 10:00:00',
      updatedBy: '企业微信同步',
      updatedAt: '2026-05-22 10:00:00',
    },
  ],
  lark: [
    {
      id: 'LK001',
      name: '飞书员工',
      phone: '13900003333',
      userType: '员工',
      organization: '培训学员组织',
      department: '培训学员组织',
      position: '项目成员',
      role: '普通用户',
      status: '启用',
      lockStatus: '正常',
      source: '飞书',
      createdBy: '飞书同步',
      createdAt: '2026-05-22 10:00:00',
      updatedBy: '飞书同步',
      updatedAt: '2026-05-22 10:00:00',
    },
  ],
}

const userTypeColorMap: Record<UserType, string> = {
  员工: 'blue',
  供应商: 'green',
  客户: 'purple',
}

function createNextId(users: UserRecord[]) {
  return `U${String(users.length + 1).padStart(3, '0')}`
}

export function UserManagementPage() {
  const [form] = Form.useForm<UserFormValues>()
  const [syncForm] = Form.useForm<SyncFormValues>()
  const [users, setUsers] = useState<UserRecord[]>(() => loadUsers())
  const [recycledUsers, setRecycledUsers] = useState<UserRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [activeTab, setActiveTab] = useState('active')
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('dingtalk')
  const [dictionaries, setDictionaries] = useState(() => loadDictionaries())
  const [roles, setRoles] = useState(() => loadRoles())
  const [departmentOptions, setDepartmentOptions] = useState(() => getDepartmentOptions(loadDepartments()))
  const selectedUserType = Form.useWatch('userType', form)

  useEffect(() => {
    saveUsers(users)
  }, [users])

  useEffect(() => {
    void fetchUsersFromApi()
      .then(setUsers)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const refresh = () => setDictionaries(loadDictionaries())
    window.addEventListener('mingda-dictionaries-updated', refresh)
    return () => window.removeEventListener('mingda-dictionaries-updated', refresh)
  }, [])

  useEffect(() => {
    const refresh = () => setRoles(loadRoles())
    window.addEventListener(ROLE_STORAGE_EVENT, refresh)
    return () => window.removeEventListener(ROLE_STORAGE_EVENT, refresh)
  }, [])

  useEffect(() => {
    const refresh = () => setDepartmentOptions(getDepartmentOptions(loadDepartments()))
    window.addEventListener(DEPARTMENT_STORAGE_EVENT, refresh)
    return () => window.removeEventListener(DEPARTMENT_STORAGE_EVENT, refresh)
  }, [])

  const filteredUsers = useMemo(() => {
    const source = activeTab === 'active' ? users : recycledUsers
    const normalizedKeyword = keyword.trim()

    if (!normalizedKeyword) {
      return source
    }

    return source.filter((user) =>
      [user.id, user.name, user.phone, user.organization, user.department, user.position, user.role]
        .filter(Boolean)
        .some((value) => String(value).includes(normalizedKeyword)),
    )
  }, [activeTab, keyword, recycledUsers, users])

  const openCreateModal = () => {
    setEditingUser(null)
    form.resetFields()
    form.setFieldsValue({
      userType: '员工',
      role: roles.find((role) => role.name !== '系统管理员')?.name || roles[0]?.name,
      organization: organizations[0],
      department: departmentOptions[0]?.name || '',
      status: '启用',
      lockStatus: '正常',
    })
    setModalOpen(true)
  }

  const openEditModal = (record: UserRecord) => {
    setEditingUser(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingUser(null)
    form.resetFields()
  }

  const handleSubmit = async (values: UserFormValues) => {
    const normalizedValues = {
      ...values,
      belongsTo: values.userType === '员工' ? undefined : values.belongsTo,
    }
    const now = '2026-05-22 10:00:00'

    if (editingUser) {
      void updateUserOnApi(editingUser.id, normalizedValues)
        .then(() => fetchUsersFromApi().then(setUsers))
        .catch(() => undefined)
      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.id === editingUser.id
            ? {
                ...user,
                ...normalizedValues,
                updatedBy: '管理员',
                updatedAt: now,
              }
            : user,
        ),
      )
      message.success('用户已更新')
    } else {
      void createUserOnApi(normalizedValues)
        .then(() => fetchUsersFromApi().then(setUsers))
        .catch(() => undefined)
      setUsers((currentUsers) => [
        ...currentUsers,
        {
          id: createNextId(currentUsers),
          ...normalizedValues,
          source: '本地',
          createdBy: '管理员',
          createdAt: now,
          updatedBy: '管理员',
          updatedAt: now,
        },
      ])
      message.success('用户已新增')
    }

    closeModal()
  }

  const handleMoveToRecycleBin = (record: UserRecord) => {
    void deleteUserOnApi(record.id)
      .then(() => fetchUsersFromApi().then(setUsers))
      .catch(() => undefined)
    setUsers((currentUsers) => currentUsers.filter((user) => user.id !== record.id))
    setRecycledUsers((currentUsers) => [...currentUsers, { ...record, status: '禁用' }])
    message.success('用户已移入回收站')
  }

  const handleRestore = (record: UserRecord) => {
    setRecycledUsers((currentUsers) => currentUsers.filter((user) => user.id !== record.id))
    setUsers((currentUsers) => [...currentUsers, { ...record, status: '启用' }])
    message.success('用户已恢复')
  }

  const handlePermanentDelete = (record: UserRecord) => {
    setRecycledUsers((currentUsers) => currentUsers.filter((user) => user.id !== record.id))
    message.success('用户已永久删除')
  }

  const confirmMoveToRecycleBin = (record: UserRecord) => {
    Modal.confirm({
      title: '删除用户',
      content: '删除后用户将进入回收站，账号自动禁用。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleMoveToRecycleBin(record),
    })
  }

  const confirmPermanentDelete = (record: UserRecord) => {
    Modal.confirm({
      title: '永久删除用户',
      content: '永久删除后不可恢复，确定继续吗？',
      okText: '永久删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handlePermanentDelete(record),
    })
  }

  const openSyncModal = () => {
    syncForm.setFieldsValue({ provider: 'dingtalk' })
    setSyncProvider('dingtalk')
    setSyncModalOpen(true)
  }

  const handleSync = (values: SyncFormValues) => {
    const providerUsers = syncedUsers[values.provider]
    setUsers((currentUsers) => {
      const nextUsers = [...currentUsers]
      providerUsers.forEach((syncedUser) => {
        const existingIndex = nextUsers.findIndex((user) => user.phone === syncedUser.phone)
        if (existingIndex >= 0) {
          nextUsers[existingIndex] = {
            ...nextUsers[existingIndex],
            ...syncedUser,
            id: nextUsers[existingIndex].id,
            createdAt: nextUsers[existingIndex].createdAt,
            createdBy: nextUsers[existingIndex].createdBy,
          }
        } else {
          nextUsers.push({
            ...syncedUser,
            id: createNextId(nextUsers),
          })
        }
      })
      return nextUsers
    })
    message.success(`已同步${providerLabelMap[values.provider]}用户，手机号相同的账号已覆盖`)
    setSyncModalOpen(false)
  }

  const handleUserTypeChange = (userType: UserType) => {
    form.setFieldsValue({ userType, belongsTo: undefined })
  }

  const columns: TableColumnsType<UserRecord> = [
    { title: '员工姓名', dataIndex: 'name', width: 120 },
    { title: '手机号', dataIndex: 'phone', width: 140 },
    {
      title: '用户类型',
      dataIndex: 'userType',
      width: 110,
      render: (value: UserType) => <Tag color={userTypeColorMap[value]}>{value}</Tag>,
    },
    { title: '组织机构', dataIndex: 'organization', width: 220, ellipsis: true },
    { title: '所属部门', dataIndex: 'department', width: 150 },
    { title: '岗位', dataIndex: 'position', width: 130 },
    { title: '角色', dataIndex: 'role', width: 110 },
    {
      title: '启用状态',
      dataIndex: 'status',
      width: 100,
      render: (value: UserStatus) => <Tag color={value === '启用' ? 'success' : 'default'}>{value}</Tag>,
    },
    { title: '锁定状态', dataIndex: 'lockStatus', width: 100 },
    { title: '来源', dataIndex: 'source', width: 100 },
    { title: '创建人', dataIndex: 'createdBy', width: 110 },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    { title: '修改人', dataIndex: 'updatedBy', width: 110 },
    { title: '修改时间', dataIndex: 'updatedAt', width: 170 },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: activeTab === 'active' ? 150 : 160,
      render: (_, record) =>
        activeTab === 'active' ? (
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
                onClick: () => confirmMoveToRecycleBin(record),
              },
            ]}
          />
        ) : (
          <TableActions
            actions={[
              {
                key: 'restore',
                label: '恢复',
                icon: <UndoOutlined />,
                onClick: () => handleRestore(record),
              },
              {
                key: 'delete',
                label: '删除',
                icon: <DeleteOutlined />,
                danger: true,
                onClick: () => confirmPermanentDelete(record),
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
          <h1 className="page-title">用户管理</h1>
          <p className="page-description">管理账号、组织机构、所属部门，并支持第三方通讯录同步。</p>
        </div>
        <Space>
          <Button icon={<SyncOutlined />} onClick={openSyncModal}>
            同步用户
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新增用户
          </Button>
        </Space>
      </div>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'active', label: '用户列表' },
            { key: 'recycle', label: `回收站 (${recycledUsers.length})`, icon: <RestOutlined /> },
          ]}
        />
        <Space style={{ width: '100%', marginBottom: 16 }} direction="vertical" size={16}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索员工姓名、手机号、组织机构、所属部门或角色"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ maxWidth: 520 }}
          />
          <ResizableTable
            className="fixed-action-table"
            storageKey="user-management-table-widths"
            rowKey="id"
            columns={columns}
            dataSource={filteredUsers}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </Space>
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        open={modalOpen}
        width={760}
        okText={editingUser ? '保存' : '确认添加'}
        cancelText="取消"
        onCancel={closeModal}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 16px' }}>
            <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input placeholder="请输入姓名" />
            </Form.Item>
            <Form.Item
              label="手机号"
              name="phone"
              rules={[
                { required: true, message: '请输入手机号' },
                { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
              ]}
            >
              <Input placeholder="手机号作为第三方同步唯一标识" maxLength={11} />
            </Form.Item>
            <Form.Item label="组织机构" name="organization" rules={[{ required: true, message: '请选择组织机构' }]}>
              <Select options={organizations.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            <Form.Item label="所属部门" name="department" rules={[{ required: true, message: '请选择所属部门' }]}>
              <Select
                placeholder="请选择所属部门"
                options={departmentOptions.map((department) => ({
                  label: department.label,
                  value: department.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="初始密码"
              name="password"
              rules={editingUser ? [] : [{ required: true, message: '请输入初始密码' }, { min: 6, message: '初始密码至少 6 位' }]}
              extra={editingUser ? '编辑用户时留空则不修改密码' : undefined}
            >
              <Input.Password placeholder="请输入初始密码" />
            </Form.Item>
            <Form.Item label="用户类型" name="userType" rules={[{ required: true, message: '请选择用户类型' }]}>
              <Select
                options={[
                  { label: '员工', value: '员工' },
                  { label: '供应商', value: '供应商' },
                  { label: '客户', value: '客户' },
                ]}
                onChange={handleUserTypeChange}
              />
            </Form.Item>
            <Form.Item label="岗位" name="position" rules={[{ required: true, message: '请选择岗位' }]}>
              <Select
                placeholder="请选择岗位"
                options={dictionaries.positions.map((position) => ({ label: position, value: position }))}
              />
            </Form.Item>
            <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}>
              <Select
                placeholder="请选择角色"
                options={roles.map((role) => ({ label: role.name, value: role.name }))}
              />
            </Form.Item>
            <Form.Item label="启用状态" name="status" rules={[{ required: true, message: '请选择状态' }]}>
              <Select options={['启用', '禁用'].map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            <Form.Item label="锁定状态" name="lockStatus" rules={[{ required: true, message: '请选择锁定状态' }]}>
              <Select options={['正常', '锁定'].map((item) => ({ label: item, value: item }))} />
            </Form.Item>

            {selectedUserType === '供应商' && (
              <Form.Item label="归属供应商" name="belongsTo" rules={[{ required: true, message: '请选择归属供应商' }]}>
                <Select options={suppliers.map((supplier) => ({ label: supplier, value: supplier }))} />
              </Form.Item>
            )}

            {selectedUserType === '客户' && (
              <Form.Item label="归属客户" name="belongsTo" rules={[{ required: true, message: '请选择归属客户' }]}>
                <Select options={customers.map((customer) => ({ label: customer, value: customer }))} />
              </Form.Item>
            )}
          </div>
        </Form>
      </Modal>

      <Modal
        title="同步第三方用户"
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
          message="同步规则"
          description="手机号作为唯一标识：手机号相同则覆盖用户信息；手机号不存在则新增。钉钉同步发现离职员工时，账号设置为禁用，不会删除。"
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
                <Input placeholder="可选" />
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
        </Form>
      </Modal>
    </>
  )
}
