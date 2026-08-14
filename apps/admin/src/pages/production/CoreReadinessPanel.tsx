import { Alert, Card, Empty, Progress, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { fetchCoreReadiness, type CoreReadiness } from '../../utils/coremaking'

const readinessLabels = { READY: '齐套', PARTIAL: '部分齐套', SHORTAGE: '缺料' }
const readinessColors = { READY: 'success', PARTIAL: 'warning', SHORTAGE: 'error' }

export function CoreReadinessPanel({ workOrderId }: { workOrderId: string }) {
  const [record, setRecord] = useState<CoreReadiness | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      setRecord(await fetchCoreReadiness(workOrderId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '砂芯齐套信息加载失败')
    } finally {
      setLoading(false)
    }
  }

  // Refresh when the parent work order changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [workOrderId])

  return (
    <Card title="砂芯齐套" className="production-section-card" loading={loading} extra={record ? <Typography.Text type="secondary">总齐套率 {record.readinessRate.toFixed(2)}%</Typography.Text> : null}>
      {error && <Alert className="coremaking-load-error" type="error" showIcon message={error} action={<a onClick={() => void refresh()}>重试</a>} />}
      {!loading && !error && record && <>
        <div className="core-readiness-summary">
          <Progress percent={record.readinessRate} status={record.totalShortageQuantity > 0 ? 'exception' : 'success'} />
          <Typography.Text type="secondary">需求 {record.totalRequiredQuantity}，可用 {record.totalAvailableQuantity}，待烘干 {record.totalUndriedQuantity}，缺口 {record.totalShortageQuantity}</Typography.Text>
        </div>
        {record.rows.length ? <Table rowKey="coreBoxCode" size="small" pagination={false} dataSource={record.rows} columns={[
          { title: '芯盒编码', dataIndex: 'coreBoxCode', width: 150 },
          { title: '芯盒名称', dataIndex: 'coreBoxName' },
          { title: '单件用芯', dataIndex: 'quantityPerProduct', width: 100 },
          { title: '需求量', dataIndex: 'requiredQuantity', width: 100 },
          { title: '可用量', dataIndex: 'availableQuantity', width: 100 },
          { title: '待烘干', dataIndex: 'undriedQuantity', width: 100 },
          { title: '缺口', dataIndex: 'shortageQuantity', width: 90 },
          { title: '最短剩余', dataIndex: 'minRemainingHours', width: 120, render: (value: number | null) => value === null ? '-' : `${value} 小时` },
          { title: '状态', dataIndex: 'readinessStatus', width: 110, render: (value: keyof typeof readinessLabels) => <Tag color={readinessColors[value]}>{readinessLabels[value]}</Tag> },
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 BOM 未配置芯盒" />}
      </>}
    </Card>
  )
}
