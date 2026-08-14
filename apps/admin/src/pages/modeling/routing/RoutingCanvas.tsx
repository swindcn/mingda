import { DeleteOutlined } from '@ant-design/icons'
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  ViewportPortal,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useRef, useState, type Dispatch, type DragEvent, type PointerEvent, type SetStateAction } from 'react'
import type { RouteType, RoutingEdgeRecord, RoutingNodeRecord, RoutingOptions } from '../../../utils/processRoutings'
import { constrainCanvasPosition, defaultRouteType } from './routingLayout'

type RoutingNodeData = {
  record: RoutingNodeRecord
  editable: boolean
  connectingFromId?: string
  onDelete: (id: string) => void
  onConnectionStart: (id: string, point: { x: number; y: number }) => void
  onConnectionEnd: (id: string) => void
}
type RoutingFlowNode = Node<RoutingNodeData, 'routingOperation'>

const routeLabels: Record<RouteType, string> = {
  MELT_BRANCH: '熔炼副线',
  CORE_BRANCH: '制芯副线',
  MOLD_MAIN: '造型主线',
  MERGE_POINT: '关键汇合',
  AFTER_MERGE: '汇合后主线',
}

function RoutingOperationNode({ data, selected }: NodeProps<RoutingFlowNode>) {
  const { record, editable, connectingFromId, onDelete, onConnectionStart, onConnectionEnd } = data
  const stopPointer = (event: PointerEvent) => event.stopPropagation()
  return <div className={`routing-node routing-node-${record.routeType.toLowerCase()} ${selected ? 'is-selected' : ''} ${connectingFromId === record.id ? 'is-connection-source' : ''}`}>
    <Handle
      type="target"
      position={Position.Left}
      isConnectable={editable}
      data-routing-target-id={record.id}
      title="连接到此工序"
      onPointerDown={stopPointer}
      onPointerUp={(event) => { event.stopPropagation(); onConnectionEnd(record.id) }}
      onClick={(event) => { event.stopPropagation(); onConnectionEnd(record.id) }}
    />
    <div className="routing-node-topline"><span>{record.seqNo || '--'}</span><strong>{record.operationName}</strong></div>
    <div className="routing-node-meta"><span>{record.operationCode}</span><span>{routeLabels[record.routeType]}</span></div>
    {record.equipmentCodes.length > 0 && <div className="routing-node-equipment">设备 {record.equipmentCodes.length}</div>}
    {editable && <button type="button" className="routing-node-delete nodrag" title="移除工序" onClick={(event) => { event.stopPropagation(); onDelete(record.id) }}><DeleteOutlined /></button>}
    <Handle
      type="source"
      position={Position.Right}
      isConnectable={editable}
      title="从此工序开始连接"
      onPointerDown={(event) => {
        event.stopPropagation()
        onConnectionStart(record.id, { x: event.clientX, y: event.clientY })
      }}
      onClick={(event) => event.stopPropagation()}
    />
  </div>
}

const nodeTypes = { routingOperation: RoutingOperationNode }

function routingEdgePath(source: { x: number; y: number }, target: { x: number; y: number }) {
  const bend = Math.max(50, Math.abs(target.x - source.x) / 2)
  return `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`
}

function RoutingEdgeLayer(props: {
  nodes: RoutingNodeRecord[]
  edges: RoutingEdgeRecord[]
  connectingFromId?: string
  draftTarget?: { x: number; y: number }
  editable: boolean
  onRemove: (sourceNodeId: string, targetNodeId: string) => void
}) {
  const nodeMap = new Map(props.nodes.map((node) => [node.id, node]))
  const paths = props.edges.flatMap((edge) => {
    const source = nodeMap.get(edge.sourceNodeId)
    const target = nodeMap.get(edge.targetNodeId)
    if (!source || !target) return []
    return [{ edge, path: routingEdgePath(
      { x: source.positionX + 190, y: source.positionY + 41 },
      { x: target.positionX, y: target.positionY + 41 },
    ) }]
  })
  const draftSource = props.connectingFromId ? nodeMap.get(props.connectingFromId) : undefined

  return <ViewportPortal>
    <svg className="routing-edge-layer" width="2400" height="540" viewBox="0 0 2400 540">
      <defs>
        <marker id="routing-edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#71839d" />
        </marker>
      </defs>
      {paths.map(({ edge, path }) => <g key={edge.id || `${edge.sourceNodeId}-${edge.targetNodeId}`} className="routing-edge">
        <path className="routing-edge-hit" d={path} onDoubleClick={() => props.editable && props.onRemove(edge.sourceNodeId, edge.targetNodeId)}>
          <title>{props.editable ? '双击删除连接' : '工序连接'}</title>
        </path>
        <path className="routing-edge-line" d={path} markerEnd="url(#routing-edge-arrow)" />
      </g>)}
      {draftSource && props.draftTarget && <path
        className="routing-edge-draft"
        d={routingEdgePath({ x: draftSource.positionX + 190, y: draftSource.positionY + 41 }, props.draftTarget)}
      />}
    </svg>
  </ViewportPortal>
}

interface RoutingCanvasProps {
  nodes: RoutingNodeRecord[]
  edges: RoutingEdgeRecord[]
  operations: RoutingOptions['operations']
  editable: boolean
  onNodesChange: (nodes: RoutingNodeRecord[]) => void
  onEdgesChange: Dispatch<SetStateAction<RoutingEdgeRecord[]>>
  onSelectNode: (id?: string) => void
}

function RoutingCanvasInner(props: RoutingCanvasProps) {
  const { screenToFlowPosition } = useReactFlow()
  const [connectingFromId, setConnectingFromId] = useState<string>()
  const [draftTarget, setDraftTarget] = useState<{ x: number; y: number }>()
  const connectingFromRef = useRef<string | undefined>(undefined)
  const connectionStartPointRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const removeNode = (id: string) => {
    props.onNodesChange(props.nodes.filter((node) => node.id !== id))
    props.onEdgesChange((current) => current.filter((edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id))
    props.onSelectNode(undefined)
  }
  const addConnection = (sourceNodeId: string, targetNodeId: string) => {
    if (sourceNodeId === targetNodeId) return
    props.onEdgesChange((current) => current.some((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId)
      ? current
      : [...current, { sourceNodeId, targetNodeId }])
  }
  const clearConnection = () => {
    connectingFromRef.current = undefined
    connectionStartPointRef.current = undefined
    setConnectingFromId(undefined)
    setDraftTarget(undefined)
  }
  const startConnection = (id: string, point: { x: number; y: number }) => {
    connectingFromRef.current = id
    connectionStartPointRef.current = point
    setConnectingFromId(id)
  }
  const finishConnection = (targetNodeId: string) => {
    const sourceNodeId = connectingFromRef.current
    if (!sourceNodeId) return
    addConnection(sourceNodeId, targetNodeId)
    clearConnection()
  }
  const flowNodes: RoutingFlowNode[] = props.nodes.map((record) => ({
    id: record.id,
    type: 'routingOperation',
    position: { x: record.positionX, y: record.positionY },
    data: {
      record,
      editable: props.editable,
      connectingFromId,
      onDelete: removeNode,
      onConnectionStart: startConnection,
      onConnectionEnd: finishConnection,
    },
    initialWidth: 190,
    initialHeight: 82,
    zIndex: 10,
    draggable: props.editable,
    connectable: props.editable,
  }))
  const updateNodes = (changes: NodeChange<RoutingFlowNode>[]) => {
    const changed = applyNodeChanges(changes, flowNodes)
    props.onNodesChange(changed.map((node) => ({ ...node.data.record, positionX: node.position.x, positionY: node.position.y })))
  }
  const finishPointerConnection = (event: PointerEvent<HTMLDivElement>) => {
    const sourceNodeId = connectingFromRef.current
    const startPoint = connectionStartPointRef.current
    if (!sourceNodeId || !startPoint) return
    const distance = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y)
    if (distance <= 4) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-routing-target-id]')
    const targetNodeId = target?.dataset.routingTargetId
    if (targetNodeId) addConnection(sourceNodeId, targetNodeId)
    clearConnection()
  }
  const movePointerConnection = (event: PointerEvent<HTMLDivElement>) => {
    if (!connectingFromRef.current) return
    setDraftTarget(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!props.editable) return
    const operationCode = event.dataTransfer.getData('application/mingda-operation') || event.dataTransfer.getData('text/plain')
    const operation = props.operations.find((item) => item.code === operationCode)
    if (!operation) return
    const type = defaultRouteType(operation.section, operation.pouringMergePoint)
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const position = constrainCanvasPosition({
      x: point.x - 95,
      y: point.y - 41,
    })
    const id = `tmp-${crypto.randomUUID()}`
    props.onNodesChange([...props.nodes, {
      id,
      operationCode: operation.code,
      operationName: operation.name,
      section: operation.section,
      reportMode: operation.reportMode,
      pouringMergePoint: operation.pouringMergePoint,
      routeType: type,
      reportEnabled: true,
      qualityControlEnabled: operation.qualityControlPoint,
      requireFurnaceBatch: operation.pouringMergePoint,
      requireLadle: operation.pouringMergePoint,
      requireCoreBatch: operation.pouringMergePoint,
      equipmentCodes: [],
      positionX: position.x,
      positionY: position.y,
    }])
  }

  const allowDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  return <div className="routing-canvas" onPointerMoveCapture={movePointerConnection} onPointerUpCapture={finishPointerConnection}>
    <ReactFlow
      nodes={flowNodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={updateNodes}
      onDragOver={allowDrop}
      onDrop={drop}
      onNodeClick={(event, node) => {
        if ((event.target as Element).closest('.react-flow__handle')) return
        props.onSelectNode(node.id)
      }}
      onPaneClick={() => { clearConnection(); props.onSelectNode(undefined) }}
      onNodeDragStop={(_, node) => {
        const position = constrainCanvasPosition(node.position)
        props.onNodesChange(props.nodes.map((item) => item.id === node.id ? { ...item, positionX: position.x, positionY: position.y } : item))
      }}
      nodesDraggable={props.editable}
      nodesConnectable={false}
      edgesReconnectable={false}
      elementsSelectable
      deleteKeyCode={props.editable ? ['Backspace', 'Delete'] : null}
      minZoom={0.7}
      maxZoom={1.25}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
    >
      <Background gap={20} size={1} color="#dce3ec" />
      <RoutingEdgeLayer
        nodes={props.nodes}
        edges={props.edges}
        connectingFromId={connectingFromId}
        draftTarget={draftTarget}
        editable={props.editable}
        onRemove={(sourceNodeId, targetNodeId) => props.onEdgesChange((current) => current.filter((edge) => edge.sourceNodeId !== sourceNodeId || edge.targetNodeId !== targetNodeId))}
      />
    </ReactFlow>
  </div>
}

export function RoutingCanvas(props: RoutingCanvasProps) {
  return <ReactFlowProvider><RoutingCanvasInner {...props} /></ReactFlowProvider>
}
