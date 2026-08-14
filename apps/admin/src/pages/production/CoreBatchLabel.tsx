import { Button, Modal, QRCode, Space, Typography } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import type { CoreBatchRecord } from '../../utils/coremaking'
import { hasPermission } from '../../utils/roles'

function dryingStatus(batch: CoreBatchRecord) {
  if (!batch.dryingRequired) return '无需烘干'
  return batch.driedAt ? '已烘干' : '待烘干'
}

export function CoreBatchLabelContent({ batch }: { batch: CoreBatchRecord }) {
  return <div className="core-batch-label">
    <div className="core-batch-label-title">砂芯批次标签</div>
    <div className="core-batch-label-body">
      <QRCode value={batch.qrContent || batch.code} size={156} bordered={false} />
      <div className="core-batch-label-fields">
        <Typography.Text type="secondary">批次编号</Typography.Text><strong>{batch.code}</strong>
        <Typography.Text type="secondary">芯盒</Typography.Text><span>{batch.coreBoxName}（{batch.coreBoxCode}）</span>
        <Typography.Text type="secondary">产品</Typography.Text><span>{batch.productName}（{batch.productCode}）</span>
        <Typography.Text type="secondary">生产工单</Typography.Text><span>{batch.workOrderCode}</span>
        <Typography.Text type="secondary">批次数量</Typography.Text><span>{batch.initialQuantity}</span>
        <Typography.Text type="secondary">生产时间</Typography.Text><span>{new Date(batch.reportedAt || batch.createdAt).toLocaleString()}</span>
        <Typography.Text type="secondary">烘干状态</Typography.Text><span>{dryingStatus(batch)}</span>
        <Typography.Text type="secondary">失效时间</Typography.Text><span>{batch.expiresAt ? new Date(batch.expiresAt).toLocaleString() : '长期有效'}</span>
      </div>
    </div>
  </div>
}

export function CoreBatchLabel({ batch, open, onClose }: { batch: CoreBatchRecord | null; open: boolean; onClose: () => void }) {
  const canView = hasPermission('production.core_inventory.view')
  return <Modal open={open} title="砂芯批次标签" width={560} footer={<Space><Button onClick={onClose}>关闭</Button>{canView && <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印</Button>}</Space>} onCancel={onClose} destroyOnHidden>
    {batch && <CoreBatchLabelContent batch={batch} />}
  </Modal>
}
