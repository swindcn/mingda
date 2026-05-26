import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../../components/ResizableTable'
import { TableActions } from '../../../components/TableActions'

export interface PartnerRecord {
  id: string
  name: string
  address: string
  contact: string
  phone: string
  createdAt: string
}

interface PartnerFormValues {
  name: string
  address: string
  contact: string
  phone: string
}

interface PartnerDirectoryPageProps {
  title: string
  description: string
  entityName: string
  idPrefix: string
  searchPlaceholder: string
  autoIdNotice: string
  icon: ReactNode
  iconBackground: string
  iconColor: string
  loadRecords: () => PartnerRecord[]
  saveRecords: (records: PartnerRecord[]) => void
  fetchRecords: () => Promise<PartnerRecord[]>
  createRecord: (record: Partial<PartnerRecord>) => Promise<PartnerRecord[]>
  updateRecord: (id: string, record: Partial<PartnerRecord>) => Promise<PartnerRecord[]>
  deleteRecord: (id: string) => Promise<PartnerRecord[]>
}

export function PartnerDirectoryPage({
  title,
  description,
  entityName,
  idPrefix,
  searchPlaceholder,
  autoIdNotice,
  loadRecords,
  saveRecords,
  fetchRecords,
  createRecord,
  updateRecord,
  deleteRecord,
}: PartnerDirectoryPageProps) {
  const [form] = Form.useForm<PartnerFormValues>()
  const [records, setRecords] = useState<PartnerRecord[]>(() => loadRecords())
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<PartnerRecord | null>(null)

  useEffect(() => {
    saveRecords(records)
  }, [records, saveRecords])

  useEffect(() => {
    void fetchRecords()
      .then(setRecords)
      .catch((error) => message.error(error instanceof Error ? error.message : `${entityName}数据加载失败`))
  }, [entityName, fetchRecords])

  const filteredRecords = useMemo(() => {
    const normalizedKeyword = keyword.trim()

    if (!normalizedKeyword) {
      return records
    }

    return records.filter((record) =>
      [record.id, record.name, record.address, record.contact, record.phone].some((value) =>
        value.includes(normalizedKeyword),
      ),
    )
  }, [keyword, records])

  const openCreateModal = () => {
    setEditingRecord(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEditModal = (record: PartnerRecord) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingRecord(null)
    form.resetFields()
  }

  const handleSubmit = async (values: PartnerFormValues) => {
    if (editingRecord) {
      try {
        setRecords(await updateRecord(editingRecord.id, values))
      } catch (error) {
        message.error(error instanceof Error ? error.message : `${entityName}更新失败`)
        return
      }
      message.success(`${entityName}已更新`)
    } else {
      try {
        setRecords(await createRecord(values))
      } catch (error) {
        message.error(error instanceof Error ? error.message : `${entityName}新增失败`)
        return
      }
      message.success(`${entityName}已新增`)
    }

    closeModal()
  }

  const handleDelete = async (id: string) => {
    try {
      setRecords(await deleteRecord(id))
    } catch (error) {
      message.error(error instanceof Error ? error.message : `${entityName}删除失败`)
      return
    }
    message.success(`${entityName}已删除`)
  }

  const confirmDelete = (record: PartnerRecord) => {
    Modal.confirm({
      title: `删除${entityName}`,
      content: `确定删除「${record.name}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record.id),
    })
  }

  const columns: TableColumnsType<PartnerRecord> = [
    {
      title: `${entityName}编号`,
      dataIndex: 'id',
      width: 120,
      fixed: 'left',
    },
    {
      title: `${entityName}名称`,
      dataIndex: 'name',
      width: 220,
      ellipsis: true,
    },
    {
      title: '地址',
      dataIndex: 'address',
      width: 320,
      ellipsis: true,
    },
    {
      title: '联系人',
      dataIndex: 'contact',
      width: 120,
    },
    {
      title: '联系方式',
      dataIndex: 'phone',
      width: 150,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 130,
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
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增{entityName}
        </Button>
      </div>

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={searchPlaceholder}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ maxWidth: 420 }}
          />

          <ResizableTable
            className="fixed-action-table"
            storageKey={`${idPrefix.toLowerCase()}-directory-table-widths`}
            rowKey="id"
            columns={columns}
            dataSource={filteredRecords}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </Space>
      </Card>

      <Modal
        title={editingRecord ? `编辑${entityName}` : `新增${entityName}`}
        open={modalOpen}
        width={680}
        okText={editingRecord ? '保存' : '确认添加'}
        cancelText="取消"
        onCancel={closeModal}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label={`${entityName}名称`}
            name="name"
            rules={[{ required: true, message: `请输入${entityName}名称` }]}
          >
            <Input placeholder={`请输入${entityName}名称`} />
          </Form.Item>
          <Form.Item
            label="地址"
            name="address"
            rules={[{ required: true, message: '请输入详细地址' }]}
          >
            <Input placeholder="请输入详细地址" />
          </Form.Item>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item
              label="联系人"
              name="contact"
              rules={[{ required: true, message: '请输入联系人姓名' }]}
            >
              <Input placeholder="请输入联系人姓名" />
            </Form.Item>
            <Form.Item
              label="联系方式"
              name="phone"
              rules={[
                { required: true, message: '请输入联系电话' },
                {
                  pattern: /^((1[3-9]\d{9})|(\d{3,4}-?\d{7,8}))$/,
                  message: '请输入正确的联系电话',
                },
              ]}
            >
              <Input placeholder="请输入联系电话" />
            </Form.Item>
          </div>
          {!editingRecord && (
            <div
              style={{
                color: '#1677ff',
                background: '#e6f4ff',
                border: '1px solid #91caff',
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              {autoIdNotice}
            </div>
          )}
        </Form>
      </Modal>
    </>
  )
}
