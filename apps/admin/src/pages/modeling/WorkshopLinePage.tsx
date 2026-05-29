import { Table, Tabs, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { fetchModelingRecords } from '../../utils/modeling'
import type { ModelingRecord } from '../../utils/modeling'
import { ModelingMasterPage } from './ModelingMasterPage'
import { createModelingPage, modelingPages } from './modelingConfigs'

export function WorkshopLinePage() {
  const [lines, setLines] = useState<ModelingRecord[]>([])

  useEffect(() => {
    void fetchModelingRecords('lines')
      .then(setLines)
      .catch(() => setLines([]))
  }, [])

  const lineColumns: TableColumnsType<ModelingRecord> = [
    { title: '产线编码', dataIndex: 'code', width: 140 },
    { title: '产线名称', dataIndex: 'name', width: 180 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value) => <Tag color={value === '启用' ? 'green' : 'default'}>{String(value || '')}</Tag>,
    },
    { title: '备注', dataIndex: 'remark' },
  ]

  return (
    <Tabs
      defaultActiveKey="workshops"
      items={[
        {
          key: 'workshops',
          label: '车间',
          children: (
            <ModelingMasterPage
              {...modelingPages[0]}
              expandable={{
                rowExpandable: (record) => lines.some((line) => line.workshopCode === record.code),
                expandedRowRender: (record) => (
                  <Table
                    rowKey="id"
                    size="small"
                    columns={lineColumns}
                    dataSource={lines.filter((line) => line.workshopCode === record.code)}
                    pagination={false}
                  />
                ),
              }}
            />
          ),
        },
        {
          key: 'lines',
          label: '产线',
          children: createModelingPage(modelingPages[1]),
        },
      ]}
    />
  )
}
