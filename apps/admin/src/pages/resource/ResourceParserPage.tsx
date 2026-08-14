import { Button, Card, Space, Typography, Upload, message } from 'antd'
import { Download, FileArchive, FileText, Loader2, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ResourceParseResult } from '../../services/api'
import { convertResourceFile } from '../../services/api'

const supportedExtensions = '.ppt,.pptx,.doc,.docx,.pdf,.xls,.xlsx'

export function ResourceParserPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [parsing, setParsing] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [result, setResult] = useState<ResourceParseResult | null>(null)

  const canDownload = Boolean(result?.markdown)
  const fileMeta = useMemo(() => {
    if (!selectedFile) return '等待上传'
    const sizeInMb = selectedFile.size / 1024 / 1024
    return `${selectedFile.name} · ${sizeInMb.toFixed(2)} MB`
  }, [selectedFile])

  const parseFile = async (file: File) => {
    setSelectedFile(file)
    setParsing(true)
    setResult(null)
    try {
      const parsed = await convertResourceFile(file)
      setResult(parsed)
      messageApi.success('解析完成')
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '解析失败')
    } finally {
      setParsing(false)
    }
  }

  const downloadMarkdown = () => {
    if (!result) return
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {contextHolder}
      <div className="page-header">
        <div>
          <h1 className="page-title">资源解析</h1>
          <p className="page-description">上传办公资料，生成可入库的 Markdown 文档。</p>
        </div>
        <Space>
          <Button icon={<RotateCcw size={16} />} disabled={parsing && !result} onClick={() => setResult(null)}>
            清空结果
          </Button>
          <Button type="primary" icon={<Download size={16} />} disabled={!canDownload} onClick={downloadMarkdown}>
            下载 MD
          </Button>
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(420px, 1.35fr)',
          gap: 16,
          alignItems: 'stretch',
        }}
      >
        <Card
          title={
            <Space>
              <FileArchive size={18} />
              <span>原始文件</span>
            </Space>
          }
          styles={{ body: { minHeight: 520 } }}
        >
          <Upload.Dragger
            accept={supportedExtensions}
            maxCount={1}
            showUploadList={false}
            disabled={parsing}
            customRequest={(options) => {
              const file = options.file as File
              void parseFile(file)
                .then(() => options.onSuccess?.({}))
                .catch((error: Error) => options.onError?.(error))
            }}
            style={{
              display: 'flex',
              minHeight: 300,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'grid', gap: 16, justifyItems: 'center', padding: '40px 24px' }}>
              <div
                style={{
                  display: 'grid',
                  width: 68,
                  height: 68,
                  placeItems: 'center',
                  color: '#1677ff',
                  background: '#edf5ff',
                  borderRadius: 8,
                }}
              >
                {parsing ? <Loader2 className="resource-parser-spin" size={32} /> : <FileText size={32} />}
              </div>
              <div style={{ textAlign: 'center' }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {parsing ? '正在解析文件' : '拖拽或点击上传'}
                </Typography.Title>
                <Typography.Text type="secondary">支持 Word、PPT、PDF、Excel</Typography.Text>
              </div>
            </div>
          </Upload.Dragger>

          <div
            style={{
              marginTop: 18,
              padding: 16,
              color: '#4b5563',
              background: '#f8fafc',
              border: '1px solid #eef2f7',
              borderRadius: 8,
            }}
          >
            <Typography.Text strong>当前文件</Typography.Text>
            <div style={{ marginTop: 8, wordBreak: 'break-all' }}>{fileMeta}</div>
          </div>
        </Card>

        <Card
          title={
            <Space>
              <FileText size={18} />
              <span>Markdown 结果</span>
            </Space>
          }
          styles={{ body: { minHeight: 520, padding: 0 } }}
        >
          <pre
            style={{
              minHeight: 520,
              maxHeight: 'calc(100vh - 210px)',
              margin: 0,
              padding: 20,
              overflow: 'auto',
              color: result ? '#111827' : '#9ca3af',
              background: '#fbfcfe',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {result?.markdown || '解析完成后，Markdown 内容会显示在这里。'}
          </pre>
        </Card>
      </div>
    </div>
  )
}
