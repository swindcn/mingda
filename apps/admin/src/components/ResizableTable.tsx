import { Table } from 'antd'
import type { TableProps } from 'antd'
import type { AnyObject } from 'antd/es/_util/type'
import type { ColumnsType } from 'antd/es/table'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

type ResizableColumnsType<RecordType extends AnyObject> = ColumnsType<RecordType>

interface ResizableTitleProps extends HTMLAttributes<HTMLTableCellElement> {
  width?: number
  columnKey?: string
  onResizeColumn?: (columnKey: string, width: number) => void
  children?: ReactNode
}

interface ResizableTableProps<RecordType extends AnyObject> extends TableProps<RecordType> {
  storageKey: string
  columns: ResizableColumnsType<RecordType>
}

/** 布局内容区滚动容器（AppLayout Content），用于冻结表头定位 */
const SCROLL_CONTAINER_SELECTOR = '.app-content-scroll'

function resolveScrollContainer(): HTMLElement | Window {
  if (typeof document === 'undefined') return window
  return document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR) ?? window
}

function getColumnKey(column: { key?: React.Key; dataIndex?: unknown }, index: number) {
  if (column.key) return String(column.key)
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join('.')
  if (column.dataIndex) return String(column.dataIndex)
  return `column-${index}`
}

function ResizableTitle({
  width,
  columnKey,
  onResizeColumn,
  children,
  style,
  ...restProps
}: ResizableTitleProps) {
  if (!width || !columnKey || !onResizeColumn) {
    return (
      <th {...restProps} style={style}>
        {children}
      </th>
    )
  }

  const cellStyle = style as CSSProperties | undefined

  const handleMouseDown = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = width

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(80, startWidth + moveEvent.clientX - startX)
      onResizeColumn(columnKey, nextWidth)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <th {...restProps} style={{ ...cellStyle, position: cellStyle?.position ?? 'relative' }}>
      {children}
      <span className="column-resize-handle" onMouseDown={handleMouseDown} />
    </th>
  )
}

export function ResizableTable<RecordType extends AnyObject>({
  storageKey,
  columns,
  scroll,
  components,
  pagination,
  sticky,
  className,
  ...tableProps
}: ResizableTableProps<RecordType>) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

  useEffect(() => {
    const storedValue = window.localStorage.getItem(storageKey)
    if (!storedValue) return

    try {
      setColumnWidths(JSON.parse(storedValue))
    } catch {
      setColumnWidths({})
    }
  }, [storageKey])

  const mergedColumns = useMemo(
    () =>
      columns.map((column, index) => {
        const columnKey = getColumnKey(column, index)
        const width = columnWidths[columnKey] ?? Number(column.width || 120)

        return {
          ...column,
          width,
          onHeaderCell: () => ({
            width,
            columnKey,
            onResizeColumn: (nextColumnKey: string, nextWidth: number) => {
              setColumnWidths((current) => {
                const next = {
                  ...current,
                  [nextColumnKey]: nextWidth,
                }
                window.localStorage.setItem(storageKey, JSON.stringify(next))
                return next
              })
            },
          }),
        }
      }),
    [columnWidths, columns, storageKey],
  )

  const mergedScrollX = mergedColumns.reduce((total, column) => total + Number(column.width || 0), 0)

  const mergedPagination = useMemo(() => {
    if (pagination === false) return false
    return {
      showSizeChanger: true,
      showQuickJumper: true,
      pageSizeOptions: [10, 20, 50],
      showTotal: (total: number) => `共 ${total} 条`,
      ...(typeof pagination === 'object' ? pagination : {}),
    }
  }, [pagination])

  const mergedSticky = useMemo(() => {
    if (sticky === false) return false
    return {
      offsetHeader: 0,
      getContainer: resolveScrollContainer,
      ...(typeof sticky === 'object' ? sticky : {}),
    }
  }, [sticky])

  return (
    <Table<RecordType>
      size="middle"
      {...tableProps}
      className={className ? `fixed-action-table ${className}` : 'fixed-action-table'}
      columns={mergedColumns}
      components={{
        ...components,
        header: {
          ...components?.header,
          cell: ResizableTitle,
        },
      }}
      pagination={mergedPagination}
      sticky={mergedSticky}
      scroll={{
        ...scroll,
        x: scroll?.x ?? mergedScrollX,
      }}
      tableLayout="fixed"
    />
  )
}
