import {
  CheckCircleOutlined,
  EditOutlined,
  ExperimentOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Image,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { loadDictionaries } from '../../utils/dictionaries'

interface DevelopmentData {
  id: string
  customerId: string
  customerName: string
  productCode: string
  productName: string
  customerNotifyDate: string
  moldType: string
  supplierId: string
  supplierName: string
  expectedDate: string
  status: string
  trackingNumber?: string
  createdAt: string
  remark: string
  images: string[]
}

interface EditFormValues {
  customerId: string
  productCode: string
  customerNotifyDate: dayjs.Dayjs
  moldType: string
  supplierId: string
  expectedDate?: dayjs.Dayjs
  remark?: string
}

interface ProcessStep {
  key: string
  title: string
  reached: boolean
  content?: ReactNode
  action?: ReactNode
}

interface OperatorTimeInfo {
  operator: string
  time: string
}

interface ShipmentInfo extends OperatorTimeInfo {
  trackingNumber: string
  images: string[]
}

interface ReceiveInfo extends OperatorTimeInfo {
  images: string[]
}

interface ProductionRecord extends OperatorTimeInfo {
  productImages: string[]
  destructiveTestImages: string[]
}

interface EvaluationInfo extends OperatorTimeInfo {
  result: '通过' | '不通过'
  isDevelopmentComplete: boolean
  reason: string
}

interface TerminationInfo extends OperatorTimeInfo {
  reason: string
}

interface ShipmentFormValues {
  trackingNumber: string
}

interface ProductionFormValues {
  operator: string
}

interface EvaluationFormValues {
  operator: string
  result: '通过' | '不通过'
  isDevelopmentComplete: boolean
  reason: string
}

interface TerminationFormValues {
  reason: string
}

const customers = [
  { id: 'CUS001', name: '长城汽车股份有限公司' },
  { id: 'CUS002', name: '比亚迪汽车工业有限公司' },
]

const products = [
  { code: 'P001', name: '英沃保险柜门板内板' },
  { code: 'P002', name: '球墨铸铁泵体' },
  { code: 'mbnb0001', name: '门板组件' },
]

const suppliers = [
  { id: 'SUP001', name: '鑫源材料有限公司' },
  { id: 'SUP002', name: '华泰金属制品厂' },
]

const operators = ['张三', '李四', '王五', '赵六']
const currentOperator = '张三'

function getNowText() {
  return dayjs().format('YYYY-MM-DD HH:mm')
}

function getUploadNames(files: UploadFile[]) {
  return files.map((file) => file.name)
}

function formatRecordCount(index: number) {
  const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (index < numerals.length) return `${numerals[index]}次`
  return `${index + 1}次`
}

function createMockImageSrc(label = '图片') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
      <rect width="640" height="640" rx="32" fill="#f3f4f6"/>
      <rect x="112" y="152" width="416" height="336" rx="24" fill="#ffffff" stroke="#d1d5db" stroke-width="8"/>
      <path d="M180 420l88-96 70 70 58-62 94 88H180z" fill="#dbeafe"/>
      <circle cx="422" cy="240" r="46" fill="#bfdbfe"/>
      <text x="320" y="548" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#6b7280">${label}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function ImagePlaceholder({ label, large = false }: { label?: string; large?: boolean }) {
  const size = large ? 180 : 72

  return (
    <Image
      src={createMockImageSrc(label)}
      width="100%"
      height={size}
      preview={{ src: createMockImageSrc(label) }}
      style={{
        minWidth: size,
        objectFit: 'cover',
        background: '#f3f4f6',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
      }}
      fallback={createMockImageSrc(label)}
    />
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 12 }}>
      <Typography.Text type="secondary">{label}：</Typography.Text>
      <Typography.Text strong>{children}</Typography.Text>
    </div>
  )
}

function FlowCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: 16,
        background: '#f9fafb',
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  )
}

export function MoldDevelopmentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form] = Form.useForm<EditFormValues>()
  const [shipmentForm] = Form.useForm<ShipmentFormValues>()
  const [productionForm] = Form.useForm<ProductionFormValues>()
  const [evaluationForm] = Form.useForm<EvaluationFormValues>()
  const [terminationForm] = Form.useForm<TerminationFormValues>()
  const [modalOpen, setModalOpen] = useState(false)
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false)
  const [receiveModalOpen, setReceiveModalOpen] = useState(false)
  const [productionModalType, setProductionModalType] = useState<'trial' | 'batch' | null>(null)
  const [evaluationModalOpen, setEvaluationModalOpen] = useState(false)
  const [terminationModalOpen, setTerminationModalOpen] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [shipmentImages, setShipmentImages] = useState<UploadFile[]>([])
  const [receiveImages, setReceiveImages] = useState<UploadFile[]>([])
  const [productImages, setProductImages] = useState<UploadFile[]>([])
  const [destructiveImages, setDestructiveImages] = useState<UploadFile[]>([])
  const [drawingConfirmation, setDrawingConfirmation] = useState<OperatorTimeInfo | null>({
    operator: '李四',
    time: '2026-04-16 09:20',
  })
  const [shipmentInfo, setShipmentInfo] = useState<ShipmentInfo | null>({
    operator: '王五',
    time: '2026-04-28 16:00',
    trackingNumber: 'SF1234567890',
    images: ['快递单照片.jpg'],
  })
  const [receiveInfo, setReceiveInfo] = useState<ReceiveInfo | null>(null)
  const [trialRecords, setTrialRecords] = useState<ProductionRecord[]>([])
  const [batchRecords, setBatchRecords] = useState<ProductionRecord[]>([])
  const [evaluationInfo, setEvaluationInfo] = useState<EvaluationInfo | null>(null)
  const [terminationInfo, setTerminationInfo] = useState<TerminationInfo | null>(null)
  const [developmentData, setDevelopmentData] = useState<DevelopmentData>({
    id: id || 'MD001',
    customerId: 'CUS001',
    customerName: '长城汽车股份有限公司',
    productCode: 'P001',
    productName: '英沃保险柜门板内板',
    customerNotifyDate: '2026-04-17',
    moldType: '压铸模',
    supplierId: 'SUP001',
    supplierName: '鑫源材料有限公司',
    expectedDate: '2026-05-31',
    status: '待收货',
    trackingNumber: 'SF1234567890',
    createdAt: '2026-04-15',
    remark: '急件，优先处理',
    images: ['模具设计图.jpg', '产品图纸.jpg', '3D效果图.jpg'],
  })

  const isTerminated = developmentData.status === '已中止'
  const isCompleted = Boolean(evaluationInfo?.isDevelopmentComplete && !isTerminated)
  const canOperate = !isTerminated && !isCompleted
  const canShowFinalActions = Boolean(receiveInfo && canOperate)
  const dictionaries = useMemo(() => loadDictionaries(), [])

  const confirmDrawing = () => {
    Modal.confirm({
      title: '图纸确认',
      content: '是否确认图纸',
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        const next = { operator: currentOperator, time: getNowText() }
        setDrawingConfirmation(next)
        setDevelopmentData((current) => ({
          ...current,
          status: current.status === '已中止' ? current.status : '待发货',
        }))
        message.success('图纸已确认')
      },
    })
  }

  const openShipmentModal = () => {
    shipmentForm.resetFields()
    setShipmentImages([])
    setShipmentModalOpen(true)
  }

  const submitShipment = (values: ShipmentFormValues) => {
    if (shipmentImages.length === 0) {
      message.warning('请至少上传一张发货图片')
      return
    }

    const next = {
      operator: currentOperator,
      time: getNowText(),
      trackingNumber: values.trackingNumber,
      images: getUploadNames(shipmentImages),
    }
    setShipmentInfo(next)
    setDevelopmentData((current) => ({
      ...current,
      status: current.status === '已中止' ? current.status : '待收货',
      trackingNumber: values.trackingNumber,
    }))
    setShipmentModalOpen(false)
    message.success('发货信息已记录')
  }

  const submitReceive = () => {
    if (receiveImages.length === 0) {
      message.warning('请至少上传一张收货图片')
      return
    }

    const next = {
      operator: currentOperator,
      time: getNowText(),
      images: getUploadNames(receiveImages),
    }
    setReceiveInfo(next)
    setDevelopmentData((current) => ({
      ...current,
      status: current.status === '已中止' ? current.status : '待试产',
    }))
    setReceiveModalOpen(false)
    message.success('收货信息已记录')
  }

  const openProductionModal = (type: 'trial' | 'batch') => {
    productionForm.resetFields()
    setProductImages([])
    setDestructiveImages([])
    setProductionModalType(type)
  }

  const submitProduction = (values: ProductionFormValues) => {
    if (!productionModalType) return
    if (productImages.length === 0) {
      message.warning('请至少上传一张产品图片')
      return
    }
    if (destructiveImages.length === 0) {
      message.warning('请至少上传一张破坏性检测图片')
      return
    }

    const next = {
      operator: values.operator,
      time: getNowText(),
      productImages: getUploadNames(productImages),
      destructiveTestImages: getUploadNames(destructiveImages),
    }

    if (productionModalType === 'trial') {
      setTrialRecords((current) => [...current, next])
      setDevelopmentData((current) => ({
        ...current,
        status: current.status === '已中止' ? current.status : '试产中',
      }))
      message.success('试模记录已保存')
    } else {
      setBatchRecords((current) => [...current, next])
      setDevelopmentData((current) => ({
        ...current,
        status: current.status === '已中止' ? current.status : '试产中',
      }))
      message.success('量产记录已保存')
    }

    setProductionModalType(null)
  }

  const submitEvaluation = (values: EvaluationFormValues) => {
    setEvaluationInfo({
      operator: values.operator,
      result: values.result,
      isDevelopmentComplete: values.isDevelopmentComplete,
      reason: values.reason,
      time: getNowText(),
    })
    setDevelopmentData((current) => ({
      ...current,
      status:
        current.status === '已中止'
          ? current.status
          : values.isDevelopmentComplete
            ? '已完成'
            : '试产中',
    }))
    setEvaluationModalOpen(false)
    message.success(values.isDevelopmentComplete ? '模具评判已保存' : '模具评判已保存，本单暂未完成')
  }

  const submitTermination = (values: TerminationFormValues) => {
    setTerminationInfo({
      operator: currentOperator,
      time: getNowText(),
      reason: values.reason,
    })
    setDevelopmentData((current) => ({ ...current, status: '已中止' }))
    setTerminationModalOpen(false)
    terminationForm.resetFields()
    message.success('开发已中止，已保留当前执行过程数据')
  }

  const renderImagePlaceholders = (images: string[]) =>
    images.length > 0 ? (
      <Space size={12} wrap>
        {images.map((image) => (
          <ImagePlaceholder key={image} label={image} />
        ))}
      </Space>
    ) : (
      <Typography.Text type="secondary">暂无图片</Typography.Text>
    )

  const renderProductionRecord = (record: ProductionRecord) => (
    <FlowCard>
      <Space direction="vertical" size={10}>
        <Space wrap size={24}>
          <Typography.Text type="secondary">填写人：{record.operator}</Typography.Text>
          <Typography.Text type="secondary">提交时间：{record.time}</Typography.Text>
        </Space>
        <Typography.Text type="secondary">产品图片：</Typography.Text>
        {renderImagePlaceholders(record.productImages)}
        <Typography.Text type="secondary">破坏性检测图片：</Typography.Text>
        {renderImagePlaceholders(record.destructiveTestImages)}
      </Space>
    </FlowCard>
  )

  const processSteps: ProcessStep[] = useMemo(
    () => [
      {
        key: 'issued',
        title: '开发下达',
        reached: true,
        content: (
          <FlowCard>
            <Space direction="vertical" size={10}>
              <Space wrap size={24}>
                <Typography.Text type="secondary">下达时间：2026-04-15 14:30</Typography.Text>
                <Typography.Text type="secondary">下达人：张三</Typography.Text>
              </Space>
              <Typography.Text type="secondary">下达图片：</Typography.Text>
              <Space size={12}>
                <ImagePlaceholder />
                <ImagePlaceholder />
              </Space>
            </Space>
          </FlowCard>
        ),
      },
      {
        key: 'confirmed',
        title: '供应商确认',
        reached: Boolean(drawingConfirmation),
        action: canOperate && !drawingConfirmation ? (
          <Button size="small" type="primary" onClick={confirmDrawing}>
            图纸确认
          </Button>
        ) : undefined,
        content: drawingConfirmation ? (
          <FlowCard>
            <Space wrap size={24}>
              <Typography.Text type="secondary">确认人：{drawingConfirmation.operator}</Typography.Text>
              <Typography.Text type="secondary">确认时间：{drawingConfirmation.time}</Typography.Text>
            </Space>
          </FlowCard>
        ) : undefined,
      },
      {
        key: 'shipped',
        title: '供应商发货',
        reached: Boolean(shipmentInfo),
        action: canOperate && drawingConfirmation && !shipmentInfo ? (
          <Button size="small" type="primary" onClick={openShipmentModal}>
            发货
          </Button>
        ) : undefined,
        content: shipmentInfo ? (
          <FlowCard>
            <Space direction="vertical" size={10}>
              <Space wrap size={24}>
                <Typography.Text type="secondary">发货时间：{shipmentInfo.time}</Typography.Text>
                <Typography.Text type="secondary">发货人：{shipmentInfo.operator}</Typography.Text>
              </Space>
              <Typography.Text type="secondary">快递单号：{shipmentInfo.trackingNumber}</Typography.Text>
              <Typography.Text type="secondary">发货图片：</Typography.Text>
              {renderImagePlaceholders(shipmentInfo.images)}
            </Space>
          </FlowCard>
        ) : undefined,
      },
      {
        key: 'received',
        title: '收货确认',
        reached: Boolean(receiveInfo),
        action: canOperate && shipmentInfo && !receiveInfo ? (
          <Button size="small" type="primary" onClick={() => setReceiveModalOpen(true)}>
            收货
          </Button>
        ) : undefined,
        content: receiveInfo ? (
          <FlowCard>
            <Space direction="vertical" size={10}>
              <Space wrap size={24}>
                <Typography.Text type="secondary">收货时间：{receiveInfo.time}</Typography.Text>
                <Typography.Text type="secondary">收货人：{receiveInfo.operator}</Typography.Text>
              </Space>
              <Typography.Text type="secondary">收货图片：</Typography.Text>
              {renderImagePlaceholders(receiveInfo.images)}
            </Space>
          </FlowCard>
        ) : undefined,
      },
      ...trialRecords.map((record, index) => ({
        key: `trial-${index}`,
        title: `试模记录（${formatRecordCount(index)}）`,
        reached: true,
        content: renderProductionRecord(record),
      })),
      ...batchRecords.map((record, index) => ({
        key: `massProduction-${index}`,
        title: `量产记录（${formatRecordCount(index)}）`,
        reached: true,
        content: renderProductionRecord(record),
      })),
      ...(evaluationInfo
        ? [
            {
              key: 'evaluation',
              title: '模具评判记录',
              reached: true,
              content: (
                <FlowCard>
                  <Space direction="vertical" size={10}>
                    <Space wrap size={24}>
                      <Typography.Text type="secondary">评判人：{evaluationInfo.operator}</Typography.Text>
                      <Typography.Text type="secondary">评判时间：{evaluationInfo.time}</Typography.Text>
                      <Typography.Text type="secondary">
                        评判结果：
                        <Tag color={evaluationInfo.result === '通过' ? 'success' : 'error'}>
                          {evaluationInfo.result}
                        </Tag>
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        是否开发完成：{evaluationInfo.isDevelopmentComplete ? '是' : '否'}
                      </Typography.Text>
                    </Space>
                    <Typography.Text type="secondary">评判理由：{evaluationInfo.reason}</Typography.Text>
                  </Space>
                </FlowCard>
              ),
            },
          ]
        : []),
      ...(terminationInfo
        ? [
            {
              key: 'terminated',
              title: '开发中止记录',
              reached: true,
              content: (
                <FlowCard>
                  <Space direction="vertical" size={10}>
                    <Space wrap size={24}>
                      <Typography.Text type="secondary">中止人：{terminationInfo.operator}</Typography.Text>
                      <Typography.Text type="secondary">中止时间：{terminationInfo.time}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary">中止理由：{terminationInfo.reason}</Typography.Text>
                  </Space>
                </FlowCard>
              ),
            },
          ]
        : []),
    ],
    [
      batchRecords,
      canOperate,
      drawingConfirmation,
      evaluationInfo,
      receiveInfo,
      shipmentInfo,
      terminationInfo,
      trialRecords,
    ],
  )

  const openEditModal = () => {
    form.setFieldsValue({
      customerId: developmentData.customerId,
      productCode: developmentData.productCode,
      customerNotifyDate: dayjs(developmentData.customerNotifyDate),
      moldType: developmentData.moldType,
      supplierId: developmentData.supplierId,
      expectedDate: developmentData.expectedDate ? dayjs(developmentData.expectedDate) : undefined,
      remark: developmentData.remark,
    })
    setFileList([])
    setModalOpen(true)
  }

  const closeEditModal = () => {
    setModalOpen(false)
    setFileList([])
    form.resetFields()
  }

  const handleSubmit = (values: EditFormValues) => {
    const selectedCustomer = customers.find((customer) => customer.id === values.customerId)
    const selectedProduct = products.find((product) => product.code === values.productCode)
    const selectedSupplier = suppliers.find((supplier) => supplier.id === values.supplierId)

    setDevelopmentData((current) => ({
      ...current,
      customerId: values.customerId,
      customerName: selectedCustomer?.name || current.customerName,
      productCode: values.productCode,
      productName: selectedProduct?.name || current.productName,
      customerNotifyDate: values.customerNotifyDate.format('YYYY-MM-DD'),
      moldType: values.moldType,
      supplierId: values.supplierId,
      supplierName: selectedSupplier?.name || current.supplierName,
      expectedDate: values.expectedDate?.format('YYYY-MM-DD') || '',
      remark: values.remark || '',
      images: [...current.images, ...fileList.map((file) => file.name)],
    }))
    message.success('开发需求已更新')
    closeEditModal()
  }

  const uploadProps: UploadProps = {
    fileList,
    multiple: true,
    beforeUpload: () => false,
    onChange: ({ fileList: nextFileList }) => setFileList(nextFileList),
  }

  const shipmentUploadProps: UploadProps = {
    fileList: shipmentImages,
    multiple: true,
    maxCount: 3,
    listType: 'picture-card',
    beforeUpload: () => false,
    onChange: ({ fileList: nextFileList }) => setShipmentImages(nextFileList),
  }

  const receiveUploadProps: UploadProps = {
    fileList: receiveImages,
    multiple: true,
    maxCount: 3,
    listType: 'picture-card',
    beforeUpload: () => false,
    onChange: ({ fileList: nextFileList }) => setReceiveImages(nextFileList),
  }

  const productUploadProps: UploadProps = {
    fileList: productImages,
    multiple: true,
    listType: 'picture-card',
    beforeUpload: () => false,
    onChange: ({ fileList: nextFileList }) => setProductImages(nextFileList),
  }

  const destructiveUploadProps: UploadProps = {
    fileList: destructiveImages,
    multiple: true,
    listType: 'picture-card',
    beforeUpload: () => false,
    onChange: ({ fileList: nextFileList }) => setDestructiveImages(nextFileList),
  }

  return (
    <>
      <SubPageHeader
        title={
          <>
            开发记录详情 <Typography.Text type="secondary">#{developmentData.id}</Typography.Text>
          </>
        }
        onBack={() => navigate('/dashboard/mold/development')}
        extra={
          <Space>
            <Button danger disabled={isTerminated} onClick={() => setTerminationModalOpen(true)}>
              中止开发
            </Button>
            <Button type="primary" icon={<EditOutlined />} onClick={openEditModal}>
              编辑
            </Button>
          </Space>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(420px, 1fr) minmax(420px, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card title="开发信息">
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <InfoRow label="客户名称">{developmentData.customerName}</InfoRow>
              <InfoRow label="产品编号">{developmentData.productCode}</InfoRow>
              <InfoRow label="产品名称">{developmentData.productName}</InfoRow>
              <InfoRow label="客户告知时间">{developmentData.customerNotifyDate}</InfoRow>
              <InfoRow label="模具类型">{developmentData.moldType}</InfoRow>
              <InfoRow label="模具供应商">{developmentData.supplierName}</InfoRow>
              <InfoRow label="期望完成时间">{developmentData.expectedDate || '-'}</InfoRow>
              <InfoRow label="快递单号">{developmentData.trackingNumber || '-'}</InfoRow>
              <InfoRow label="开发状态">
                <Tag color={isTerminated ? 'error' : isCompleted ? 'success' : 'processing'}>
                  {developmentData.status}
                </Tag>
              </InfoRow>
              <InfoRow label="下达时间">{developmentData.createdAt}</InfoRow>
              <InfoRow label="备注">{developmentData.remark || '-'}</InfoRow>
            </Space>
          </Card>

          <Card title="模具图片">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 16,
              }}
            >
              {developmentData.images.map((image) => (
                <ImagePlaceholder key={image} label={image} large />
              ))}
            </div>
          </Card>
        </Space>

        <Card
          title="开发进度流程"
          extra={
            canShowFinalActions ? (
              <Space>
                <Button type="primary" icon={<ExperimentOutlined />} onClick={() => openProductionModal('trial')}>
                  试模生成
                </Button>
                <Button type="primary" icon={<ToolOutlined />} onClick={() => openProductionModal('batch')}>
                  批量生产
                </Button>
                <Button
                  type="primary"
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => setEvaluationModalOpen(true)}
                >
                  模具评判
                </Button>
              </Space>
            ) : null
          }
        >
          <Space direction="vertical" size={26} style={{ width: '100%' }}>
            {processSteps.map((step, index) => (
              <div key={step.key} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 14 }}>
                <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                  <CheckCircleOutlined
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      color: step.reached ? '#10b981' : '#d1d5db',
                      fontSize: 26,
                      background: '#fff',
                    }}
                  />
                  {index < processSteps.length - 1 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 30,
                        bottom: -30,
                        width: 2,
                        background: '#e5e7eb',
                      }}
                    />
                  )}
                </div>
                <div style={{ paddingBottom: index < processSteps.length - 1 ? 18 : 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                    }}
                  >
                    <Typography.Title level={5} style={{ margin: '2px 0 0' }}>
                      {step.title}
                    </Typography.Title>
                    {step.action}
                  </div>
                  {step.reached && step.content}
                </div>
              </div>
            ))}
          </Space>
        </Card>
      </div>

      <Modal
        title="编辑开发需求"
        open={modalOpen}
        width={760}
        okText="保存修改"
        cancelText="取消"
        onCancel={closeEditModal}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0 16px',
            }}
          >
            <Form.Item
              label="客户"
              name="customerId"
              rules={[{ required: true, message: '请选择客户' }]}
            >
              <Select
                options={customers.map((customer) => ({
                  label: customer.name,
                  value: customer.id,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="产品"
              name="productCode"
              rules={[{ required: true, message: '请选择产品' }]}
            >
              <Select
                options={products.map((product) => ({
                  label: `${product.code} - ${product.name}`,
                  value: product.code,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="客户告知时间"
              name="customerNotifyDate"
              rules={[{ required: true, message: '请选择客户告知时间' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="模具类型"
              name="moldType"
              rules={[{ required: true, message: '请选择模具类型' }]}
            >
              <Select
                options={dictionaries.moldTypes.map((type) => ({
                  label: type,
                  value: type,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="模具供应商"
              name="supplierId"
              rules={[{ required: true, message: '请选择模具供应商' }]}
            >
              <Select
                options={suppliers.map((supplier) => ({
                  label: supplier.name,
                  value: supplier.id,
                }))}
              />
            </Form.Item>
            <Form.Item label="期望完成时间" name="expectedDate">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="新增模具图片" style={{ gridColumn: '1 / span 2' }}>
              <Upload {...uploadProps}>
                <Button icon={<UploadOutlined />}>上传图片</Button>
              </Upload>
            </Form.Item>
            <Form.Item label="备注需求" name="remark" style={{ gridColumn: '1 / span 2' }}>
              <Input.TextArea rows={3} placeholder="请输入备注信息" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="供应商发货"
        open={shipmentModalOpen}
        width={640}
        okText="确认发货"
        cancelText="取消"
        onCancel={() => setShipmentModalOpen(false)}
        onOk={() => shipmentForm.submit()}
        destroyOnHidden
      >
        <Form form={shipmentForm} layout="vertical" onFinish={submitShipment}>
          <Form.Item
            label="快递单号"
            name="trackingNumber"
            rules={[{ required: true, message: '请输入快递单号' }]}
          >
            <Input placeholder="请输入快递单号" />
          </Form.Item>
          <Form.Item label="发货图片（最多3张）">
            <Upload {...shipmentUploadProps}>
              {shipmentImages.length < 3 && (
                <Button type="link" icon={<UploadOutlined />}>
                  上传图片
                </Button>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="收货确认"
        open={receiveModalOpen}
        width={640}
        okText="确认收货"
        cancelText="取消"
        onCancel={() => setReceiveModalOpen(false)}
        onOk={submitReceive}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="收货图片（最多3张）" required>
            <Upload {...receiveUploadProps}>
              {receiveImages.length < 3 && (
                <Button type="link" icon={<UploadOutlined />}>
                  上传图片
                </Button>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={productionModalType === 'trial' ? '试模生成' : '批量生产'}
        open={Boolean(productionModalType)}
        width={720}
        okText="保存记录"
        cancelText="取消"
        onCancel={() => setProductionModalType(null)}
        onOk={() => productionForm.submit()}
        destroyOnHidden
      >
        <Form form={productionForm} layout="vertical" onFinish={submitProduction}>
          <Form.Item
            label="填写人"
            name="operator"
            rules={[{ required: true, message: '请选择填写人' }]}
          >
            <Select
              placeholder="请选择填写人"
              options={operators.map((operator) => ({ label: operator, value: operator }))}
            />
          </Form.Item>
          <Form.Item label="拍摄产品图片">
            <Upload {...productUploadProps}>
              <Button type="link" icon={<UploadOutlined />}>
                上传图片
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item label="破坏性检测图片">
            <Upload {...destructiveUploadProps}>
              <Button type="link" icon={<UploadOutlined />}>
                上传图片
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="模具评判"
        open={evaluationModalOpen}
        width={640}
        okText="保存评判"
        cancelText="取消"
        onCancel={() => setEvaluationModalOpen(false)}
        onOk={() => evaluationForm.submit()}
        destroyOnHidden
      >
        <Form
          form={evaluationForm}
          layout="vertical"
          initialValues={{ result: '通过', isDevelopmentComplete: true }}
          onFinish={submitEvaluation}
        >
          <Form.Item
            label="评判人"
            name="operator"
            rules={[{ required: true, message: '请选择评判人' }]}
          >
            <Select
              placeholder="请选择评判人"
              options={operators.map((operator) => ({ label: operator, value: operator }))}
            />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="评判结果" name="result" rules={[{ required: true }]}>
              <Radio.Group
                options={[
                  { label: '通过', value: '通过' },
                  { label: '不通过', value: '不通过' },
                ]}
              />
            </Form.Item>
            <Form.Item label="是否开发完成" name="isDevelopmentComplete" rules={[{ required: true }]}>
              <Radio.Group
                options={[
                  { label: '是', value: true },
                  { label: '否', value: false },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item
            label="评判理由"
            name="reason"
            rules={[{ required: true, message: '请输入评判理由' }]}
          >
            <Input.TextArea rows={4} placeholder="请输入评判理由" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="中止开发"
        open={terminationModalOpen}
        width={560}
        okText="确认中止"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onCancel={() => setTerminationModalOpen(false)}
        onOk={() => terminationForm.submit()}
        destroyOnHidden
      >
        <Form form={terminationForm} layout="vertical" onFinish={submitTermination}>
          <Form.Item
            label="中止理由"
            name="reason"
            rules={[{ required: true, message: '请输入中止理由' }]}
          >
            <Input.TextArea rows={4} placeholder="请输入中止理由，已提交的执行过程数据会继续保留" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
