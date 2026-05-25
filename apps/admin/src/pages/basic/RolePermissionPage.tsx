import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import {
  DEPARTMENT_STORAGE_EVENT,
  fetchDepartmentsFromApi,
  getDepartmentOptions,
  loadDepartments,
} from '../../utils/departments'
import type { DepartmentRecord } from '../../utils/departments'
import {
  dataScopeLabels,
  createRoleOnApi,
  deleteRoleOnApi,
  fetchRolesFromApi,
  loadRoles,
  permissionTree,
  saveRoles,
  updateRoleOnApi,
} from '../../utils/roles'
import type { DataScope, RoleRecord } from '../../utils/roles'
import { USER_STORAGE_EVENT, loadUsers } from '../../utils/users'

interface RoleFormValues {
  name: string
  organization: string
  app: string
  description?: string
}

const apps = ['管理端', '小程序端']

const dataColumns = [
  { label: '客户联系人', value: 'customer.contact' },
  { label: '客户电话', value: 'customer.phone' },
  { label: '产品售价', value: 'product.salePrice' },
  { label: '产品成本价', value: 'product.costPrice' },
  { label: '供应商联系人', value: 'supplier.contact' },
  { label: '模具开发备注', value: 'mold.remark' },
]

function createNextRoleId(roles: RoleRecord[]) {
  return `R${String(roles.length + 1).padStart(3, '0')}`
}

function filterPermissionTreeByKeys(nodes: DataNode[], checkedKeys: string[]): DataNode[] {
  const checkedKeySet = new Set(checkedKeys)
  return nodes
    .map((node) => {
      const children = node.children ? filterPermissionTreeByKeys(node.children, checkedKeys) : []
      if (!checkedKeySet.has(String(node.key)) && children.length === 0) {
        return null
      }
      return {
        ...node,
        children: children.length > 0 ? children : undefined,
      }
    })
    .filter(Boolean) as DataNode[]
}

function getOrganizationOptions(departments: DepartmentRecord[]) {
  return departments.map((department) => ({
    label: department.name,
    value: department.name,
  }))
}

export function RolePermissionPage() {
  const [roleForm] = Form.useForm<RoleFormValues>()
  const [roles, setRoles] = useState<RoleRecord[]>(() => loadRoles())
  const [keyword, setKeyword] = useState('')
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [permissionModalOpen, setPermissionModalOpen] = useState(false)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null)
  const [activeRole, setActiveRole] = useState<RoleRecord | null>(null)
  const [checkedPermissions, setCheckedPermissions] = useState<string[]>([])
  const [dataScope, setDataScope] = useState<DataScope>('self')
  const [customDepartments, setCustomDepartments] = useState<RoleRecord['customDepartments']>([])
  const [columnPermissions, setColumnPermissions] = useState<string[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [users, setUsers] = useState(() => loadUsers())
  const [departments, setDepartments] = useState<DepartmentRecord[]>(() => loadDepartments())
  const departmentOptions = useMemo(() => getDepartmentOptions(departments), [departments])
  const organizationOptions = useMemo(() => getOrganizationOptions(departments), [departments])
  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        label: `${user.name} / ${user.phone} / ${user.department}`,
        value: user.id,
      })),
    [users],
  )
  const assignedPermissionTree = useMemo(
    () => filterPermissionTreeByKeys(permissionTree, checkedPermissions),
    [checkedPermissions],
  )

  useEffect(() => {
    saveRoles(roles)
  }, [roles])

  useEffect(() => {
    void fetchRolesFromApi()
      .then(setRoles)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void fetchDepartmentsFromApi()
      .then(setDepartments)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const refreshDepartments = () => setDepartments(loadDepartments())
    const refreshUsers = () => setUsers(loadUsers())
    window.addEventListener(DEPARTMENT_STORAGE_EVENT, refreshDepartments)
    window.addEventListener(USER_STORAGE_EVENT, refreshUsers)
    return () => {
      window.removeEventListener(DEPARTMENT_STORAGE_EVENT, refreshDepartments)
      window.removeEventListener(USER_STORAGE_EVENT, refreshUsers)
    }
  }, [])

  const filteredRoles = useMemo(() => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) return roles
    return roles.filter((role) =>
      [role.name, role.organization, role.app, role.description, role.createdBy]
        .filter(Boolean)
        .some((value) => String(value).includes(normalizedKeyword)),
    )
  }, [keyword, roles])

  const openCreateRole = () => {
    setEditingRole(null)
    roleForm.resetFields()
    roleForm.setFieldsValue({ organization: organizationOptions[0]?.value, app: apps[0] })
    setRoleModalOpen(true)
  }

  const openEditRole = (role: RoleRecord) => {
    setEditingRole(role)
    roleForm.setFieldsValue(role)
    setRoleModalOpen(true)
  }

  const handleSubmitRole = async (values: RoleFormValues) => {
    if (editingRole) {
      void updateRoleOnApi(editingRole.id, values)
        .then(() => fetchRolesFromApi().then(setRoles))
        .catch(() => undefined)
      setRoles((current) =>
        current.map((role) => (role.id === editingRole.id ? { ...role, ...values } : role)),
      )
      message.success('角色已更新')
    } else {
      void createRoleOnApi({
        ...values,
        permissions: [],
        dataScope: 'self',
        customDepartments: [],
        columnPermissions: [],
        userIds: [],
      })
        .then(() => fetchRolesFromApi().then(setRoles))
        .catch(() => undefined)
      setRoles((current) => [
        ...current,
        {
          id: createNextRoleId(current),
          ...values,
          createdBy: '管理员',
          createdAt: '2026-05-22 11:20:00',
          permissions: [],
          dataScope: 'self',
          customDepartments: [],
          columnPermissions: [],
          userIds: [],
        },
      ])
      message.success('角色已新增')
    }
    setRoleModalOpen(false)
  }

  const handleDeleteRole = (role: RoleRecord) => {
    Modal.confirm({
      title: '删除角色',
      content: `确定删除「${role.name}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        void deleteRoleOnApi(role.id)
          .then(() => fetchRolesFromApi().then(setRoles))
          .catch(() => undefined)
        setRoles((current) => current.filter((item) => item.id !== role.id))
        if (activeRole?.id === role.id) setActiveRole(null)
        message.success('角色已删除')
      },
    })
  }

  const handleCopyRole = (role: RoleRecord) => {
    setRoles((current) => [
      ...current,
      {
        ...role,
        id: createNextRoleId(current),
        name: `${role.name} 副本`,
        createdBy: '管理员',
        createdAt: '2026-05-22 11:20:00',
      },
    ])
    message.success('角色已复制')
  }

  const openPermissionModal = (role: RoleRecord) => {
    setActiveRole(role)
    setCheckedPermissions(role.permissions)
    setDataScope(role.dataScope)
    setCustomDepartments(role.customDepartments)
    setColumnPermissions(role.columnPermissions)
    setPermissionModalOpen(true)
  }

  const openUserModal = (role: RoleRecord) => {
    setActiveRole(role)
    setSelectedUsers(role.userIds)
    setUserModalOpen(true)
  }

  const savePermissions = () => {
    if (!activeRole) return
    void updateRoleOnApi(activeRole.id, {
      permissions: checkedPermissions,
      dataScope,
      customDepartments,
      columnPermissions,
    })
      .then(() => fetchRolesFromApi().then(setRoles))
      .catch(() => undefined)
    setRoles((current) =>
      current.map((role) =>
        role.id === activeRole.id
          ? {
              ...role,
              permissions: checkedPermissions,
              dataScope,
              customDepartments,
              columnPermissions,
            }
          : role,
      ),
    )
    message.success('权限配置已保存')
    setPermissionModalOpen(false)
  }

  const saveUsers = () => {
    if (!activeRole) return
    void updateRoleOnApi(activeRole.id, {
      userIds: selectedUsers,
    })
      .then(() => fetchRolesFromApi().then(setRoles))
      .catch(() => undefined)
    setRoles((current) =>
      current.map((role) => (role.id === activeRole.id ? { ...role, userIds: selectedUsers } : role)),
    )
    message.success('授权用户已保存')
    setUserModalOpen(false)
  }

  const columns: TableColumnsType<RoleRecord> = [
    { title: '角色名称', dataIndex: 'name', width: 200, ellipsis: true },
    { title: '组织机构', dataIndex: 'organization', width: 240, ellipsis: true },
    { title: '应用', dataIndex: 'app', width: 110 },
    { title: '角色描述', dataIndex: 'description', ellipsis: true },
    { title: '创建人', dataIndex: 'createdBy', width: 120 },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '数据权限',
      dataIndex: 'dataScope',
      width: 150,
      render: (value: DataScope) => <Tag color="blue">{dataScopeLabels[value]}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 190,
      render: (_, record) => (
        <TableActions
          actions={[
            {
              key: 'permission',
              label: '配置权限',
              shortLabel: '权限',
              icon: <SettingOutlined />,
              onClick: () => openPermissionModal(record),
            },
            {
              key: 'users',
              label: '配置用户',
              shortLabel: '用户',
              icon: <UserAddOutlined />,
              onClick: () => openUserModal(record),
            },
            {
              key: 'edit',
              label: '修改',
              icon: <EditOutlined />,
              onClick: () => openEditRole(record),
            },
            {
              key: 'copy',
              label: '复制',
              icon: <CopyOutlined />,
              onClick: () => handleCopyRole(record),
            },
            {
              key: 'delete',
              label: '删除',
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => handleDeleteRole(record),
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
          <h1 className="page-title">角色权限</h1>
          <p className="page-description">
            配置角色、菜单功能权限、数据行权限、字段列权限和授权用户。
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRole}>
          新增角色
        </Button>
      </div>

      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="组织机构"
            style={{ width: 260 }}
            options={organizationOptions}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索角色名称、描述或创建人"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ width: 320 }}
          />
          <Select
            allowClear
            placeholder="应用"
            style={{ width: 160 }}
            options={apps.map((item) => ({ label: item, value: item }))}
          />
        </Space>
        <ResizableTable
          className="fixed-action-table"
          storageKey="role-permission-table-widths"
          rowKey="id"
          columns={columns}
          dataSource={filteredRoles}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      <Modal
        title={editingRole ? '修改角色' : '新增角色'}
        open={roleModalOpen}
        okText={editingRole ? '保存' : '确认新增'}
        cancelText="取消"
        onCancel={() => setRoleModalOpen(false)}
        onOk={() => roleForm.submit()}
        destroyOnHidden
      >
        <Form form={roleForm} layout="vertical" onFinish={handleSubmitRole}>
          <Form.Item label="角色名称" name="name" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="请输入角色名称" />
          </Form.Item>
          <Form.Item label="组织机构" name="organization" rules={[{ required: true, message: '请选择组织机构' }]}>
            <Select placeholder="请选择组织机构" options={organizationOptions} />
          </Form.Item>
          <Form.Item label="应用" name="app" rules={[{ required: true, message: '请选择应用' }]}>
            <Select options={apps.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item label="角色描述" name="description">
            <Input.TextArea rows={3} placeholder="请输入角色描述" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`配置权限${activeRole ? `【${activeRole.name}】` : ''}`}
        open={permissionModalOpen}
        width={1040}
        okText="保存配置"
        cancelText="取消"
        onCancel={() => setPermissionModalOpen(false)}
        onOk={savePermissions}
        destroyOnHidden
      >
        <Tabs
          items={[
            {
              key: 'function',
              label: '功能权限',
              children: (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <Card title="全部权限" size="small">
                    <Tree
                      checkable
                      defaultExpandAll
                      checkedKeys={checkedPermissions}
                      onCheck={(checked) =>
                        setCheckedPermissions(Array.isArray(checked) ? checked.map(String) : checked.checked.map(String))
                      }
                      treeData={permissionTree}
                    />
                  </Card>
                  <Card title="已分配权限" size="small">
                    {assignedPermissionTree.length > 0 ? (
                      <Tree
                        defaultExpandAll
                        treeData={assignedPermissionTree}
                        checkedKeys={checkedPermissions}
                        checkable
                        selectable={false}
                      />
                    ) : (
                      <Typography.Text type="secondary">暂未分配功能权限</Typography.Text>
                    )}
                  </Card>
                </div>
              ),
            },
            {
              key: 'data-row',
              label: '数据行权限',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Radio.Group
                    value={dataScope}
                    onChange={(event) => setDataScope(event.target.value)}
                    options={[
                      { label: '查看和管理自己的数据', value: 'self' },
                      { label: '查看和管理本部门的数据', value: 'department' },
                      { label: '查看和管理本部门及下级部门的数据', value: 'department_tree' },
                      { label: '查看和管理组织机构的数据', value: 'organization' },
                      { label: '自定义部门数据权限', value: 'custom_departments' },
                    ]}
                  />
                  {dataScope === 'custom_departments' && (
                    <Card
                      size="small"
                      title="授权部门"
                      extra={
                        <Button
                          onClick={() =>
                            setCustomDepartments((current) => [
                              ...current,
                              { departmentId: departmentOptions[0]?.value || '', includeChildren: false },
                            ])
                          }
                          disabled={!departmentOptions.length}
                        >
                          增加部门
                        </Button>
                      }
                    >
                      <Table
                        rowKey={(_, index) => String(index)}
                        pagination={false}
                        dataSource={customDepartments}
                        columns={[
                          {
                            title: '部门名称',
                            dataIndex: 'departmentId',
                            render: (value, _, index) => (
                              <Select
                                value={value}
                                style={{ width: 300 }}
                                options={departmentOptions}
                                onChange={(nextValue) =>
                                  setCustomDepartments((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, departmentId: nextValue } : item,
                                    ),
                                  )
                                }
                              />
                            ),
                          },
                          {
                            title: '包含子级部门',
                            dataIndex: 'includeChildren',
                            width: 180,
                            render: (value, _, index) => (
                              <Switch
                                checked={value}
                                onChange={(checked) =>
                                  setCustomDepartments((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, includeChildren: checked } : item,
                                    ),
                                  )
                                }
                              />
                            ),
                          },
                          {
                            title: '操作',
                            width: 120,
                            render: (_, __, index) => (
                              <Button
                                danger
                                type="link"
                                onClick={() =>
                                  setCustomDepartments((current) =>
                                    current.filter((_, itemIndex) => itemIndex !== index),
                                  )
                                }
                              >
                                删除
                              </Button>
                            ),
                          },
                        ]}
                      />
                    </Card>
                  )}
                  <Typography.Text type="secondary">
                    数据归属以后按数据发起人的所属部门判断，角色的数据范围用于生成查询过滤条件。
                  </Typography.Text>
                </Space>
              ),
            },
            {
              key: 'data-column',
              label: '数据列权限',
              children: (
                <Checkbox.Group
                  value={columnPermissions}
                  onChange={(values) => setColumnPermissions(values.map(String))}
                  options={dataColumns}
                />
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title={`配置用户${activeRole ? `【${activeRole.name}】` : ''}`}
        open={userModalOpen}
        width={620}
        okText="保存用户"
        cancelText="取消"
        onCancel={() => setUserModalOpen(false)}
        onOk={saveUsers}
        destroyOnHidden
      >
        <Select
          mode="multiple"
          value={selectedUsers}
          style={{ width: '100%' }}
          placeholder="请选择授权用户"
          options={userOptions}
          onChange={setSelectedUsers}
        />
      </Modal>
    </>
  )
}
