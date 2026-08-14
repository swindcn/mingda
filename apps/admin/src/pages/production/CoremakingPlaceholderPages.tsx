import { Typography } from 'antd'

function CoremakingPlaceholder({ title }: { title: string }) {
  return <Typography.Title level={3}>{title}</Typography.Title>
}

export function CoreTaskListPlaceholderPage() {
  return <CoremakingPlaceholder title="制芯任务" />
}

export function CoreTaskDetailPlaceholderPage() {
  return <CoremakingPlaceholder title="制芯任务详情" />
}

export function CoreInventoryPlaceholderPage() {
  return <CoremakingPlaceholder title="砂芯库存" />
}
