import { BadRequestException } from '@nestjs/common'
import type { NormalizedRoutingEdge, NormalizedRoutingNode, RoutingEdgeBody, RoutingNodeBody } from './process-routing.types'

const routeTypes = new Set(['MELT_BRANCH', 'CORE_BRANCH', 'MOLD_MAIN', 'MERGE_POINT', 'AFTER_MERGE'])

function numeric(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function compareNodes(a: NormalizedRoutingNode, b: NormalizedRoutingNode) {
  return a.positionX - b.positionX || a.positionY - b.positionY || a.id.localeCompare(b.id)
}

export function validateAndOrderGraph(
  rawNodes: RoutingNodeBody[] | undefined,
  rawEdges: RoutingEdgeBody[] | undefined,
  publishing: boolean,
) {
  const nodes: NormalizedRoutingNode[] = (Array.isArray(rawNodes) ? rawNodes : []).map((node, index) => {
    const id = String(node.id || `node-${index + 1}`).trim()
    const operationCode = String(node.operationCode || '').trim()
    const routeType = String(node.routeType || '').trim()
    if (!id || !operationCode) throw new BadRequestException('路线节点缺少工序')
    if (!routeTypes.has(routeType)) throw new BadRequestException(`节点 ${operationCode} 的路线属性无效`)
    const standardCycleSeconds = node.standardCycleSeconds === undefined || node.standardCycleSeconds === null
      ? undefined
      : Number(node.standardCycleSeconds)
    if (standardCycleSeconds !== undefined && (!Number.isInteger(standardCycleSeconds) || standardCycleSeconds < 0)) {
      throw new BadRequestException(`节点 ${operationCode} 的标准节拍必须是非负整数`)
    }
    return {
      ...node,
      id,
      operationCode,
      routeType,
      equipmentCodes: Array.from(new Set((node.equipmentCodes || []).map((code) => String(code).trim()).filter(Boolean))),
      seqNo: 0,
      positionX: numeric(node.positionX),
      positionY: numeric(node.positionY),
      standardCycleSeconds,
    }
  })
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new BadRequestException('路线节点标识重复')
  if (publishing && !nodes.length) throw new BadRequestException('发布路线前至少添加一个工序节点')

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: NormalizedRoutingEdge[] = (Array.isArray(rawEdges) ? rawEdges : []).map((edge) => ({
    sourceNodeId: String(edge.sourceNodeId || '').trim(),
    targetNodeId: String(edge.targetNodeId || '').trim(),
  }))
  const edgeKeys = new Set<string>()
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, 0]))
  const targets = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    if (!nodeById.has(edge.sourceNodeId) || !nodeById.has(edge.targetNodeId)) throw new BadRequestException('路线连线引用了不存在的节点')
    if (edge.sourceNodeId === edge.targetNodeId) throw new BadRequestException('工序节点不能连接自身')
    const key = `${edge.sourceNodeId}->${edge.targetNodeId}`
    if (edgeKeys.has(key)) throw new BadRequestException('路线中存在重复连线')
    edgeKeys.add(key)
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) || 0) + 1)
    outgoing.set(edge.sourceNodeId, (outgoing.get(edge.sourceNodeId) || 0) + 1)
    targets.get(edge.sourceNodeId)?.push(edge.targetNodeId)
  }

  const remainingIncoming = new Map(incoming)
  const queue = nodes.filter((node) => remainingIncoming.get(node.id) === 0).sort(compareNodes)
  const ordered: NormalizedRoutingNode[] = []
  while (queue.length) {
    const current = queue.shift()!
    ordered.push(current)
    for (const targetId of targets.get(current.id) || []) {
      const next = (remainingIncoming.get(targetId) || 0) - 1
      remainingIncoming.set(targetId, next)
      if (next === 0) {
        queue.push(nodeById.get(targetId)!)
        queue.sort(compareNodes)
      }
    }
  }
  if (ordered.length !== nodes.length) throw new BadRequestException('工艺路线不能形成循环依赖')

  if (publishing) {
    if (nodes.length > 1 && nodes.some((node) => incoming.get(node.id) === 0 && outgoing.get(node.id) === 0)) {
      throw new BadRequestException('发布路线前请连接所有工序节点')
    }
    const terminalNodes = nodes.filter((node) => outgoing.get(node.id) === 0)
    if (terminalNodes.length !== 1) throw new BadRequestException('已生效路线必须且只能有一个结束工序')
    const invalidMerge = nodes.find((node) => node.routeType === 'MERGE_POINT' && (incoming.get(node.id) || 0) < 2)
    if (invalidMerge) throw new BadRequestException(`关键汇合工序 ${invalidMerge.operationCode} 至少需要两个前置工序`)
  }

  ordered.forEach((node, index) => { node.seqNo = (index + 1) * 10 })
  return { nodes: ordered, edges }
}
