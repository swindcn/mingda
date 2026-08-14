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
  dataScopeOptions,
  createRoleOnApi,
  deleteRoleOnApi,
  fetchRolesFromApi,
  hasPermission,
  loadRoles,
  permissionTreeForApp,
  publicSyncPermissionKeys,
  updateRoleOnApi,
} from '../../utils/roles'
import type { DataScope, RoleRecord } from '../../utils/roles'
import { USER_STORAGE_EVENT, fetchUsersFromApi, loadUsers } from '../../utils/users'

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

const permissionDependencies: Record<string, string> = {
  'basic.department.create': 'basic.department',
  'basic.department.edit': 'basic.department',
  'basic.department.delete': 'basic.department',
  'basic.department.sync': 'basic.department',
  'basic.user.create': 'basic.user',
  'basic.user.edit': 'basic.user',
  'basic.user.delete': 'basic.user',
  'basic.user.sync': 'basic.user',
  'basic.role.create': 'basic.role',
  'basic.role.edit': 'basic.role',
  'basic.role.delete': 'basic.role',
  'basic.role.config': 'basic.role',
  'basic.role.users': 'basic.role',
  'basic.role.copy': 'basic.role',
  'basic.customer.create': 'basic.customer',
  'basic.customer.edit': 'basic.customer',
  'basic.customer.delete': 'basic.customer',
  'basic.supplier.create': 'basic.supplier',
  'basic.supplier.edit': 'basic.supplier',
  'basic.supplier.delete': 'basic.supplier',
  'basic.product.create': 'basic.product',
  'basic.product.edit': 'basic.product',
  'basic.product.delete': 'basic.product',
  'basic.dictionary.edit': 'basic.dictionary',
  'mold.development.create': 'mold.development.view',
  'mold.development.edit': 'mold.development.view',
  'mold.development.delete': 'mold.development.view',
  'mold.model.create': 'mold.model.view',
  'mold.model.edit': 'mold.model.view',
  'mold.model.delete': 'mold.model.view',
  'mold.corebox.create': 'mold.corebox.view',
  'mold.corebox.edit': 'mold.corebox.view',
  'mold.corebox.delete': 'mold.corebox.view',
  'model.workshop-line.create': 'model.workshop-line.view',
  'model.workshop-line.edit': 'model.workshop-line.view',
  'model.workshop-line.delete': 'model.workshop-line.view',
  'model.team.create': 'model.team.view',
  'model.team.edit': 'model.team.view',
  'model.team.delete': 'model.team.view',
  'model.equipment.create': 'model.equipment.view',
  'model.equipment.edit': 'model.equipment.view',
  'model.equipment.delete': 'model.equipment.view',
  'model.material.create': 'model.material.view',
  'model.material.edit': 'model.material.view',
  'model.material.delete': 'model.material.view',
  'model.recipe.create': 'model.recipe.view',
  'model.recipe.edit': 'model.recipe.view',
  'model.recipe.delete': 'model.recipe.view',
  'model.recipe.clone': 'model.recipe.view',
  'model.recipe.activate': 'model.recipe.view',
  'model.recipe.disable': 'model.recipe.view',
  'model.bom.create': 'model.bom.view',
  'model.bom.edit': 'model.bom.view',
  'model.bom.delete': 'model.bom.view',
  'model.bom.clone': 'model.bom.view',
  'model.bom.activate': 'model.bom.view',
  'model.bom.disable': 'model.bom.view',
  'model.bom.new_version': 'model.bom.view',
  'model.routing.create': 'model.routing.view',
  'model.routing.edit': 'model.routing.view',
  'model.routing.delete': 'model.routing.view',
  'model.calendar.create': 'model.calendar.view',
  'model.calendar.edit': 'model.calendar.view',
  'model.calendar.delete': 'model.calendar.view',
  'model.schedule.create': 'model.schedule.view',
  'model.schedule.edit': 'model.schedule.view',
  'model.schedule.delete': 'model.schedule.view',
  'model.schedule.batch': 'model.schedule.view',
  'model.defect.create': 'model.defect.view',
  'model.defect.edit': 'model.defect.view',
  'model.defect.delete': 'model.defect.view',
  'mini.production.heat.start': 'mini.production.heat.view',
  'mini.production.heat.complete': 'mini.production.heat.view',
}

function normalizePermissions(keys: string[]) {
  const normalized = new Set(keys.filter((key) => !key.startsWith('group.')))
  keys.forEach((key) => {
    const dependency = permissionDependencies[key]
    if (dependency) normalized.add(dependency)
  })
  return Array.from(normalized)
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

function permissionKeysInTree(nodes: DataNode[]): Set<string> {
  const keys = new Set<string>()
  const visit = (items: DataNode[]) => items.forEach((item) => {
    keys.add(String(item.key))
    if (item.children) visit(item.children)
  })
  visit(nodes)
  return keys
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
  const [includeSyncedPublicData, setIncludeSyncedPublicData] = useState(false)
  const [dataScopes, setDataScopes] = useState<DataScope[]>(['self'])
  const [customDepartments, setCustomDepartments] = useState<RoleRecord['customDepartments']>([])
  const [columnPermissions, setColumnPermissions] = useState<string[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [users, setUsers] = useState(() => loadUsers())
  const [departments, setDepartments] = useState<DepartmentRecord[]>(() => loadDepartments())
  const canCreate = hasPermission('basic.role.create')
  const canEdit = hasPermission('basic.role.edit')
  const canDelete = hasPermission('basic.role.delete')
  const canConfig = hasPermission('basic.role.config')
  const canAssignUsers = hasPermission('basic.role.users')
  const canCopy = hasPermission('basic.role.copy')
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
  const activePermissionTree = useMemo(() => permissionTreeForApp(activeRole?.app), [activeRole?.app])
  const activePermissionKeys = useMemo(() => permissionKeysInTree(activePermissionTree), [activePermissionTree])
  const assignedPermissionTree = useMemo(
    () => filterPermissionTreeByKeys(activePermissionTree, checkedPermissions),
    [activePermissionTree, checkedPermissions],
  )

  const refreshRolePage = async () => {
    const [nextRoles, nextDepartments, nextUsers] = await Promise.all([
      fetchRolesFromApi(),
      fetchDepartmentsFromApi(),
      fetchUsersFromApi(),
    ])
    setRoles(nextRoles)
    setDepartments(nextDepartments)
    setUsers(nextUsers)
  }

  useEffect(() => {
    void refreshRolePage()
      .catch((error) => {
        message.error(error instanceof Error ? error.message : '角色权限数据加载失败')
      })
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
      try {
        await updateRoleOnApi(editingRole.id, {
          ...values,
          ...(editingRole.app !== values.app ? { permissions: [] } : {}),
        })
        setRoles(await fetchRolesFromApi())
        message.success('角色已更新')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '角色更新失败')
        return
      }
    } else {
      try {
        await createRoleOnApi({
          ...values,
          permissions: [],
          dataScope: 'self',
          dataScopes: ['self'],
          customDepartments: [],
          columnPermissions: [],
          userIds: [],
        })
        setRoles(await fetchRolesFromApi())
        message.success('角色已新增')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '角色新增失败')
        return
      }
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
      onOk: async () => {
        try {
          await deleteRoleOnApi(role.id)
          setRoles(await fetchRolesFromApi())
          if (activeRole?.id === role.id) setActiveRole(null)
          message.success('角色已删除')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '角色删除失败')
          throw error
        }
      },
    })
  }

  const handleCopyRole = async (role: RoleRecord) => {
    try {
      await createRoleOnApi({
        name: `${role.name} 副本`,
        organization: role.organization,
        app: role.app,
        description: role.description,
        permissions: role.permissions,
        dataScope: role.dataScope,
        dataScopes: role.dataScopes?.length ? role.dataScopes : [role.dataScope],
        customDepartments: role.customDepartments,
        columnPermissions: role.columnPermissions,
        userIds: role.userIds,
      })
      setRoles(await fetchRolesFromApi())
      message.success('角色已复制')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '角色复制失败')
    }
  }

  const openPermissionModal = (role: RoleRecord) => {
    setActiveRole(role)
    const rolePermissionKeys = permissionKeysInTree(permissionTreeForApp(role.app))
    setCheckedPermissions(role.permissions.filter((permission) => rolePermissionKeys.has(permission)))
    setIncludeSyncedPublicData(role.permissions.some((permission) => publicSyncPermissionKeys.includes(permission as (typeof publicSyncPermissionKeys)[number])))
    setDataScopes(role.dataScopes?.length ? role.dataScopes : [role.dataScope])
    setCustomDepartments(role.customDepartments)
    setColumnPermissions(role.columnPermissions)
    setPermissionModalOpen(true)
  }

  const openUserModal = (role: RoleRecord) => {
    setActiveRole(role)
    setSelectedUsers(role.userIds)
    setUserModalOpen(true)
  }

  const savePermissions = async () => {
    if (!activeRole) return
    const nextPermissions = normalizePermissions([
      ...checkedPermissions.filter((permission) =>
        activePermissionKeys.has(permission) && !publicSyncPermissionKeys.includes(permission as (typeof publicSyncPermissionKeys)[number]),
      ),
      ...(activeRole.app !== '小程序端' && includeSyncedPublicData ? publicSyncPermissionKeys : []),
    ])
    try {
      await updateRoleOnApi(activeRole.id, {
        permissions: nextPermissions,
        dataScope: dataScopes.includes('organization') ? 'organization' : dataScopes[0] || 'self',
        dataScopes,
        customDepartments,
        columnPermissions,
      })
      setRoles(await fetchRolesFromApi())
      message.success('权限配置已保存')
      setPermissionModalOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '权限配置保存失败')
    }
  }

  const saveUsers = async () => {
    if (!activeRole) return
    try {
      await updateRoleOnApi(activeRole.id, {
        userIds: selectedUsers,
      })
      setRoles(await fetchRolesFromApi())
      message.success('授权用户已保存')
      setUserModalOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '授权用户保存失败')
    }
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
      render: (value: DataScope, record) => {
        const scopes = record.dataScopes?.length ? record.dataScopes : [value]
        return (
          <Space size={4} wrap>
            {scopes.map((scope) => (
              <Tag key={scope} color="blue">
                {dataScopeLabels[scope]}
              </Tag>
            ))}
          </Space>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 190,
      render: (_, record) => (
        <TableActions
          actions={[
            ...(canConfig
              ? [{
                  key: 'permission',
                  label: '配置权限',
                  shortLabel: '权限',
                  icon: <SettingOutlined />,
                  onClick: () => openPermissionModal(record),
                }]
              : []),
            ...(canAssignUsers
              ? [{
                  key: 'users',
                  label: '配置用户',
                  shortLabel: '用户',
                  icon: <UserAddOutlined />,
                  onClick: () => openUserModal(record),
                }]
              : []),
            ...(canEdit
              ? [{
                  key: 'edit',
                  label: '修改',
                  icon: <EditOutlined />,
                  onClick: () => openEditRole(record),
                }]
              : []),
            ...(canCopy
              ? [{
                  key: 'copy',
                  label: '复制',
                  icon: <CopyOutlined />,
                  onClick: () => handleCopyRole(record),
                }]
              : []),
            ...(canDelete
              ? [{
                  key: 'delete',
                  label: '删除',
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: () => handleDeleteRole(record),
                }]
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
          <h1 className="page-title">角色权限</h1>
          <p className="page-description">
            配置角色、菜单功能权限、数据行权限、字段列权限和授权用户。
          </p>
        </div>
        <Space>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={() =>
              void refreshRolePage().catch((error) => {
                message.error(error instanceof Error ? error.message : '角色权限数据加载失败')
              })
            }
          >
            查询
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRole}>
              新增角色
            </Button>
          )}
        </Space>
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
                      onCheck={(checked) => {
                        const keys = Array.isArray(checked) ? checked.map(String) : checked.checked.map(String)
                        setCheckedPermissions(normalizePermissions(keys))
                      }}
                      treeData={activePermissionTree}
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
                  <Checkbox.Group
                    value={dataScopes}
                    onChange={(values) => {
                      const nextValues = values.map(String) as DataScope[]
                      setDataScopes(nextValues.includes('organization') ? ['organization'] : nextValues)
                    }}
                    options={dataScopeOptions.map((option) => ({
                      ...option,
                      disabled: dataScopes.includes('organization') && option.value !== 'organization',
                    }))}
                  />
                  {activeRole?.app !== '小程序端' && (
                    <Checkbox
                      checked={includeSyncedPublicData}
                      onChange={(event) => setIncludeSyncedPublicData(event.target.checked)}
                    >
                      包含第三方同步公共数据
                    </Checkbox>
                  )}
                  {dataScopes.includes('custom_departments') && (
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
