import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAdminContext, hasAdminPermission, visibleOwnershipEntityIds, type RequestWithAdmin } from '../shared/admin-context'
import { allocateInspectionBatches, calculateDefaultScrapWeightKg, validateInspectionQuantities } from './final-inspection.calculations'
import type { FinalInspectionListQuery, InspectionDefectInput, ReportCleaningReworkBody, ReportFinalInspectionBody, ReverseFinalInspectionBody } from './final-inspection.types'

type Transaction = Prisma.TransactionClient

const CLEANING_EQUIPMENT_TYPES = ['清理', '抛丸', '打磨', '切割']

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求体格式不正确')
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string, required = false) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (required && !result) throw new BadRequestException(`请填写或选择${label}`)
  return result
}

function integer(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BadRequestException(`${label}必须为非负整数`)
  return value
}

function weight(value: unknown, label: string) {
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0) throw new BadRequestException(`${label}必须为非负数值`)
  return Number(result.toFixed(4))
}

function serializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && String(error.meta?.code || '') === '40001'))
}

function businessDate(at = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at).map((item) => [item.type, item.value]))
  return { key: `${values.year}${values.month}${values.day}`, date: new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`) }
}

@Injectable()
export class FinalInspectionService {
  constructor(private readonly prisma: PrismaService) {}

  private async serializable<T>(operation: (tx: Transaction) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (serializableConflict(error) && attempt < 2) continue
        if (serializableConflict(error)) throw new ConflictException('数据并发冲突，请刷新后重试')
        throw error
      }
    }
    throw new ConflictException('数据并发冲突，请刷新后重试')
  }

  private async lock(tx: Transaction, table: 'WorkOrder' | 'InspectionBatch' | 'InspectionReport' | 'CleaningReworkTask', id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE
    `)
    if (!rows.length) throw new NotFoundException('终检业务数据不存在')
  }

  private async visibleWorkOrderIds(request: RequestWithAdmin) {
    return visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:work-orders')
  }

  private async assertVisible(request: RequestWithAdmin, workOrderId: string) {
    const ids = await this.visibleWorkOrderIds(request)
    if (ids !== null && !ids.includes(workOrderId)) throw new NotFoundException('终检任务不存在')
  }

  private permission(request: RequestWithAdmin, mobile: boolean, action: 'view' | 'report' | 'reverse', rework = false) {
    if (action === 'reverse') return !mobile && hasAdminPermission(getAdminContext(request), 'production.inspection.reverse')
    const module = rework ? 'cleaning_rework' : 'inspection'
    return hasAdminPermission(getAdminContext(request), `${mobile ? 'mini.' : ''}production.${module}.${action}`)
  }

  private pageValue(value: unknown, fallback: number, max: number) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
  }

  private defects(value: unknown): InspectionDefectInput[] {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new BadRequestException('缺陷明细格式不正确')
    const result = value.map((item) => {
      const row = object(item)
      return { defectCode: stringValue(row.defectCode, '缺陷代码', true), quantity: integer(row.quantity, '缺陷数量'), remark: stringValue(row.remark, '缺陷备注') || undefined }
    })
    if (result.some((item) => item.quantity <= 0)) throw new BadRequestException('缺陷数量必须为正整数')
    if (new Set(result.map((item) => item.defectCode)).size !== result.length) throw new BadRequestException('缺陷代码不能重复')
    return result
  }

  private parseReport(value: ReportFinalInspectionBody | unknown) {
    const body = object(value)
    if (!Array.isArray(body.batchVersions)) throw new BadRequestException('待检批次版本格式不正确')
    return {
      workOrderId: stringValue(body.workOrderId, '生产工单', true), requestId: stringValue(body.requestId, '请求标识', true),
      goodQty: integer(body.goodQty, '合格数'), reworkQty: integer(body.reworkQty, '返修数'), scrapQty: integer(body.scrapQty, '报废数'),
      scrapWeightKg: body.scrapWeightKg === undefined || body.scrapWeightKg === null || body.scrapWeightKg === '' ? null : weight(body.scrapWeightKg, '回炉重量'),
      batchVersions: body.batchVersions.map((item) => { const row = object(item); return { id: stringValue(row.id, '待检批次', true), versionNo: integer(row.versionNo, '批次版本') } }),
      defects: this.defects(body.defects), imageUrl: stringValue(body.imageUrl, '缺陷图片') || null, remark: stringValue(body.remark, '备注') || null,
    }
  }

  private parseRework(value: ReportCleaningReworkBody | unknown) {
    const body = object(value)
    return {
      taskId: stringValue(body.taskId, '返修任务', true), requestId: stringValue(body.requestId, '请求标识', true),
      goodQty: integer(body.goodQty, '返修合格数'), scrapQty: integer(body.scrapQty, '返修报废数'),
      scrapWeightKg: body.scrapWeightKg === undefined || body.scrapWeightKg === null || body.scrapWeightKg === '' ? null : weight(body.scrapWeightKg, '回炉重量'),
      equipmentCode: stringValue(body.equipmentCode, '清理设备', true), versionNo: integer(body.versionNo, '任务版本'), remark: stringValue(body.remark, '备注') || null,
    }
  }

  private async nextCode(tx: Transaction, documentType: string, prefix: string) {
    const current = businessDate()
    const [sequence] = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "DocumentSequence" ("documentType", "businessDate", "currentValue", "updatedAt")
      VALUES (${documentType}, ${current.date}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("documentType", "businessDate") DO UPDATE
      SET "currentValue" = "DocumentSequence"."currentValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "currentValue"
    `)
    return `${prefix}-${current.key}-${String(sequence.currentValue).padStart(3, '0')}`
  }

  async listQueue(request: RequestWithAdmin, query: FinalInspectionListQuery, mobile = false) {
    const page = this.pageValue(query.page, 1, Number.MAX_SAFE_INTEGER)
    const pageSize = this.pageValue(query.pageSize, 20, 100)
    const ids = await this.visibleWorkOrderIds(request)
    if (ids?.length === 0) return { records: [], total: 0, page, pageSize }
    const keyword = query.keyword?.trim() || ''
    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        ...(ids === null ? {} : { id: { in: ids } }),
        ...(query.workOrderId ? { AND: [{ id: query.workOrderId }] } : {}),
        inspectionBatches: { some: { status: { not: 'CANCELED' } } },
        ...(keyword ? { OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { productCodeSnapshot: { contains: keyword, mode: 'insensitive' } }, { productNameSnapshot: { contains: keyword, mode: 'insensitive' } }] } : {}),
      },
      include: { inspectionBatches: { where: { status: { not: 'CANCELED' } } }, inspectionReports: { where: { status: 'ACTIVE' } }, cleaningReworkTasks: { where: { status: { not: 'CANCELED' } } } },
      orderBy: { createdAt: 'desc' },
    })
    const records = workOrders.map((row) => {
      const original = row.inspectionBatches.reduce((sum, item) => sum + item.originalQuantity, 0)
      const remaining = row.inspectionBatches.reduce((sum, item) => sum + item.remainingQuantity, 0)
      const openRework = row.cleaningReworkTasks.reduce((sum, item) => sum + item.remainingQuantity, 0)
      const good = row.inspectionReports.reduce((sum, item) => sum + item.goodQty, 0)
      const status = openRework > 0 ? 'REWORKING' : remaining > 0 ? (remaining < original ? 'INSPECTING' : 'WAITING') : 'COMPLETED'
      return { id: row.id, code: row.code, productCode: row.productCodeSnapshot, productName: row.productNameSnapshot, materialGradeName: row.materialGradeNameSnapshot, originalQuantity: original, remainingQuantity: remaining, openReworkQuantity: openRework, qualifiedQuantity: good, status, updatedAt: row.updatedAt, allowedActions: { report: remaining > 0 && this.permission(request, mobile, 'report'), reverse: this.permission(request, mobile, 'reverse') } }
    }).filter((row) => !query.status || query.status === 'ALL' || row.status === query.status)
    const total = records.length
    return { records: records.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize }
  }

  private taskInclude() {
    return {
      product: true, bomVersion: true,
      inspectionBatches: { where: { status: { not: 'CANCELED' as const } }, include: { sourceBlankOutputBatch: true, sourceReworkReport: true }, orderBy: [{ availableAt: 'asc' as const }, { id: 'asc' as const }] },
      inspectionReports: { include: { consumptions: true, defects: true, image: true, reworkTask: true, blankWarehouseReceipt: { include: { inventoryBatch: true, inventoryLedgers: true } }, scrapWriteOff: { include: { returnMeltLedgers: true } } }, orderBy: { reportedAt: 'desc' as const } },
      cleaningReworkTasks: { include: { reports: { include: { outputInspectionBatch: true, scrapWriteOff: { include: { returnMeltLedgers: true } } } } }, orderBy: { createdAt: 'desc' as const } },
    }
  }

  async getTask(request: RequestWithAdmin, workOrderId: string, mobile = false) {
    await this.assertVisible(request, workOrderId)
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: workOrderId }, include: this.taskInclude() })
    if (!workOrder || !workOrder.inspectionBatches.length) throw new NotFoundException('终检任务不存在')
    const canViewRework = this.permission(request, mobile, 'view', true)
    const cleaningReworkTasks = canViewRework
      ? workOrder.cleaningReworkTasks.map((task) => ({
          ...task,
          allowedActions: {
            report: task.remainingQuantity > 0 && this.permission(request, mobile, 'report', true),
          },
        }))
      : []
    return {
      ...workOrder,
      cleaningReworkTasks,
      unitNetWeightKg: Number(workOrder.unitNetWeightKg),
      options: await this.options(request, workOrderId, mobile),
    }
  }

  async options(request: RequestWithAdmin, workOrderId: string, mobile = false) {
    await this.assertVisible(request, workOrderId)
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: workOrderId }, include: { inspectionBatches: { where: { status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] }, cleaningReworkTasks: { where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } } } })
    if (!workOrder) throw new NotFoundException('生产工单不存在')
    const remainingQuantity = workOrder.inspectionBatches.reduce((sum, item) => sum + item.remainingQuantity, 0)
    return {
      workOrderId, workOrderCode: workOrder.code, productCode: workOrder.productCodeSnapshot, productName: workOrder.productNameSnapshot,
      remainingQuantity, openReworkQuantity: workOrder.cleaningReworkTasks.reduce((sum, item) => sum + item.remainingQuantity, 0), unitNetWeightKg: Number(workOrder.unitNetWeightKg),
      batchVersions: workOrder.inspectionBatches.map((item) => ({ id: item.id, versionNo: item.versionNo, remainingQuantity: item.remainingQuantity, availableAt: item.availableAt })),
      allowedActions: { report: remainingQuantity > 0 && this.permission(request, mobile, 'report'), reverse: this.permission(request, mobile, 'reverse') },
    }
  }

  async defectOptions(request: RequestWithAdmin, workOrderId: string, _mobile = false) {
    await this.assertVisible(request, workOrderId)
    return this.prisma.defectCode.findMany({ where: { status: '启用', operations: { some: { operationCode: 'OP-INSP' } } }, orderBy: { code: 'asc' } })
  }

  private async validDefects(tx: Transaction, inputs: InspectionDefectInput[], dispositionQty: number) {
    const total = inputs.reduce((sum, item) => sum + item.quantity, 0)
    if (total > dispositionQty) throw new BadRequestException('缺陷数量不能超过返修与报废数量')
    if (!inputs.length) return []
    const rows = await tx.defectCode.findMany({ where: { code: { in: inputs.map((item) => item.defectCode) }, status: '启用', operations: { some: { operationCode: 'OP-INSP' } } } })
    if (rows.length !== inputs.length) throw new BadRequestException('存在未启用或未绑定成品终检工序的缺陷')
    const map = new Map(inputs.map((item) => [item.defectCode, item]))
    return rows.map((row) => ({ row, input: map.get(row.code)! }))
  }

  private assertBatchVersions(allocations: Array<{ batchId: string }>, batches: Array<{ id: string; versionNo: number }>, versions: Array<{ id: string; versionNo: number }>) {
    const submitted = new Map(versions.map((item) => [item.id, item.versionNo]))
    const current = new Map(batches.map((item) => [item.id, item.versionNo]))
    for (const allocation of allocations) if (submitted.get(allocation.batchId) !== current.get(allocation.batchId)) throw new ConflictException('待检批次已更新，请刷新后重试')
  }

  private async warehouses(tx: Transaction) {
    const rows = await tx.systemWarehouse.findMany({ where: { code: { in: ['BLANK_WAREHOUSE', 'RETURN_MELT_WAREHOUSE'] }, system: true, status: 'ENABLED' } })
    const map = new Map(rows.map((item) => [item.code, item]))
    if (!map.has('BLANK_WAREHOUSE') || !map.has('RETURN_MELT_WAREHOUSE')) throw new ConflictException('系统毛坯库或回炉料仓尚未初始化')
    return { blank: map.get('BLANK_WAREHOUSE')!, returnMelt: map.get('RETURN_MELT_WAREHOUSE')! }
  }

  private async returnMeltBalance(tx: Transaction, warehouseId: string, productCode: string) {
    const result = await tx.returnMeltInventoryLedger.aggregate({ where: { warehouseId, productCode }, _sum: { weightChangeKg: true } })
    return Number(result._sum.weightChangeKg || 0)
  }

  private async createScrap(tx: Transaction, source: { inspectionReportId?: string; reworkReportId?: string }, row: { workOrderId: string; workOrderCode: string; productCode: string; productName: string }, quantity: number, weightKg: number, actor: { id: string; name: string }) {
    if ((source.inspectionReportId ? 1 : 0) + (source.reworkReportId ? 1 : 0) !== 1) throw new BadRequestException('报废来源必须且只能存在一个')
    if (quantity <= 0) return null
    const { returnMelt } = await this.warehouses(tx)
    const writeOff = await tx.scrapWriteOff.create({ data: {
      code: await this.nextCode(tx, 'SCRAP_WRITE_OFF', 'SW'), sourceInspectionReportId: source.inspectionReportId || null, sourceReworkReportId: source.reworkReportId || null,
      warehouseId: returnMelt.id, productCode: row.productCode, workOrderId: row.workOrderId, quantity, weightKg,
      warehouseCodeSnapshot: returnMelt.code, warehouseNameSnapshot: returnMelt.name, productCodeSnapshot: row.productCode, productNameSnapshot: row.productName, workOrderCodeSnapshot: row.workOrderCode,
      operatorUserId: actor.id, operatorNameSnapshot: actor.name,
    } })
    const previous = await this.returnMeltBalance(tx, returnMelt.id, row.productCode)
    await tx.returnMeltInventoryLedger.create({ data: {
      eventKey: `SCRAP:${writeOff.id}:RECEIPT`, warehouseId: returnMelt.id, warehouseCodeSnapshot: returnMelt.code, warehouseNameSnapshot: returnMelt.name,
      productCode: row.productCode, productCodeSnapshot: row.productCode, productNameSnapshot: row.productName, workOrderId: row.workOrderId, workOrderCodeSnapshot: row.workOrderCode,
      sourceWriteOffId: writeOff.id, action: 'RECEIPT', weightChangeKg: weightKg, balanceAfterKg: Number((previous + weightKg).toFixed(4)), operatorUserId: actor.id, operatorNameSnapshot: actor.name,
    } })
    return writeOff
  }

  async report(request: RequestWithAdmin, value: ReportFinalInspectionBody | unknown, _mobile = false) {
    const input = this.parseReport(value)
    await this.assertVisible(request, input.workOrderId)
    const actor = getAdminContext(request)
    const reportId = await this.serializable(async (tx) => {
      await this.lock(tx, 'WorkOrder', input.workOrderId)
      const existing = await tx.inspectionReport.findUnique({ where: { workOrderId_requestId: { workOrderId: input.workOrderId, requestId: input.requestId } } })
      if (existing) return existing.id
      const batches = await tx.inspectionBatch.findMany({ where: { workOrderId: input.workOrderId, status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, include: { inspectionRoutingNode: { include: { operation: true } }, routingVersion: { include: { routing: true } }, workOrder: { include: { product: true } } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] })
      if (!batches.length) throw new BadRequestException('当前没有待终检批次')
      const remaining = batches.reduce((sum, item) => sum + item.remainingQuantity, 0)
      let total: number
      try { total = validateInspectionQuantities(input, remaining).total } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '终检数量不正确') }
      let allocations
      try { allocations = allocateInspectionBatches(total, batches.map((item) => ({ id: item.id, remainingQuantity: item.remainingQuantity, availableAt: item.availableAt }))) } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '待检数量不足') }
      this.assertBatchVersions(allocations, batches, input.batchVersions)
      const nodeId = batches[0].inspectionRoutingNodeId
      if (batches.some((item) => item.inspectionRoutingNodeId !== nodeId || item.routingVersionId !== batches[0].routingVersionId)) throw new BadRequestException('当前工单存在多个终检节点，请拆分处理')
      if (batches[0].inspectionRoutingNode.operationCode !== 'OP-INSP') throw new BadRequestException('当前批次不是成品终检工序')
      const defects = await this.validDefects(tx, input.defects, input.reworkQty + input.scrapQty)
      const first = batches[0]
      const defaultScrapWeight = calculateDefaultScrapWeightKg(input.scrapQty, Number(first.workOrder.unitNetWeightKg))
      const scrapWeightKg = input.scrapWeightKg ?? defaultScrapWeight
      const report = await tx.inspectionReport.create({ data: {
        code: await this.nextCode(tx, 'INSPECTION_REPORT', 'IR'), workOrderId: input.workOrderId, productCode: first.productCode, routingVersionId: first.routingVersionId, inspectionRoutingNodeId: nodeId, requestId: input.requestId,
        workOrderCodeSnapshot: first.workOrder.code, productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot,
        routingCodeSnapshot: first.routingCodeSnapshot, routingNameSnapshot: first.routingNameSnapshot, routingVersionSnapshot: first.routingVersionSnapshot,
        inspectionRoutingNodeCodeSnapshot: first.operationCodeSnapshot, inspectionRoutingNodeNameSnapshot: first.operationNameSnapshot,
        operationCodeSnapshot: first.operationCodeSnapshot, operationNameSnapshot: first.operationNameSnapshot,
        goodQty: input.goodQty, reworkQty: input.reworkQty, scrapQty: input.scrapQty, scrapWeightKg, operatorUserId: actor.id, operatorNameSnapshot: actor.name, remark: input.remark,
        defects: { create: defects.map(({ row, input: item }) => ({ defectCodeId: row.id, defectCodeSnapshot: row.code, defectNameSnapshot: row.name, quantity: item.quantity, remark: item.remark || null })) },
        ...(input.imageUrl ? { image: { create: { imageUrl: input.imageUrl } } } : {}),
      } })
      const byId = new Map(batches.map((item) => [item.id, item]))
      for (const allocation of allocations) {
        const batch = byId.get(allocation.batchId)!
        const after = batch.remainingQuantity - allocation.quantity
        await tx.inspectionBatch.update({ where: { id: batch.id }, data: { remainingQuantity: after, status: after === 0 ? 'CONSUMED' : 'PARTIAL', versionNo: { increment: 1 } } })
        await tx.inspectionBatchConsumption.create({ data: { inspectionReportId: report.id, inspectionBatchId: batch.id, quantity: allocation.quantity, quantityBefore: batch.remainingQuantity, quantityAfter: after } })
      }
      if (input.goodQty > 0) {
        const { blank } = await this.warehouses(tx)
        const receipt = await tx.blankWarehouseReceipt.create({ data: {
          code: await this.nextCode(tx, 'BLANK_RECEIPT', 'BR'), sourceInspectionReportId: report.id, warehouseId: blank.id, productCode: first.productCode, workOrderId: input.workOrderId, quantity: input.goodQty,
          warehouseCodeSnapshot: blank.code, warehouseNameSnapshot: blank.name, productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot, workOrderCodeSnapshot: first.workOrderCodeSnapshot,
          createdByUserId: actor.id, createdByNameSnapshot: actor.name,
        } })
        const inventory = await tx.blankInventoryBatch.create({ data: {
          code: `${receipt.code}-BATCH`, receiptId: receipt.id, warehouseId: blank.id, productCode: first.productCode, workOrderId: input.workOrderId,
          initialQuantity: input.goodQty, currentQuantity: input.goodQty, warehouseCodeSnapshot: blank.code, productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot, workOrderCodeSnapshot: first.workOrderCodeSnapshot,
        } })
        await tx.blankInventoryLedger.create({ data: {
          eventKey: `INSPECTION:${report.id}:RECEIPT`, inventoryBatchId: inventory.id, receiptId: receipt.id, warehouseId: blank.id, warehouseCodeSnapshot: blank.code, warehouseNameSnapshot: blank.name,
          productCode: first.productCode, productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot, workOrderId: input.workOrderId, workOrderCodeSnapshot: first.workOrderCodeSnapshot,
          action: 'RECEIPT', quantityChange: input.goodQty, balanceAfter: input.goodQty, operatorUserId: actor.id, operatorNameSnapshot: actor.name,
        } })
      }
      if (input.reworkQty > 0) {
        const cleaningNode = await tx.processRoutingNode.findFirst({ where: { routingVersionId: first.routingVersionId, operationCode: 'OP-SHAKE', seqNo: { lt: first.inspectionRoutingNode.seqNo } }, include: { operation: true }, orderBy: { seqNo: 'desc' } })
        if (!cleaningNode) throw new BadRequestException('工单锁定路线中未找到可执行清理返修的落砂清理节点')
        await tx.cleaningReworkTask.create({ data: {
          code: await this.nextCode(tx, 'CLEANING_REWORK_TASK', 'RW'), sourceInspectionReportId: report.id, workOrderId: input.workOrderId, productCode: first.productCode, routingVersionId: first.routingVersionId, cleaningRoutingNodeId: cleaningNode.id,
          workOrderCodeSnapshot: first.workOrderCodeSnapshot, productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot,
          routingCodeSnapshot: first.routingCodeSnapshot, routingNameSnapshot: first.routingNameSnapshot, routingVersionSnapshot: first.routingVersionSnapshot,
          operationCodeSnapshot: cleaningNode.operationCode, operationNameSnapshot: cleaningNode.operation.name, originalQuantity: input.reworkQty, remainingQuantity: input.reworkQty,
        } })
      }
      await this.createScrap(tx, { inspectionReportId: report.id }, { workOrderId: input.workOrderId, workOrderCode: first.workOrderCodeSnapshot, productCode: first.productCode, productName: first.productNameSnapshot }, input.scrapQty, scrapWeightKg, actor)
      await this.refreshWorkOrderStatus(tx, input.workOrderId)
      return report.id
    })
    return this.inspectionReport(request, reportId)
  }

  private async inspectionReport(request: RequestWithAdmin, id: string) {
    const report = await this.prisma.inspectionReport.findUnique({ where: { id }, include: { consumptions: true, defects: true, image: true, reworkTask: true, blankWarehouseReceipt: { include: { inventoryBatch: true, inventoryLedgers: true } }, scrapWriteOff: { include: { returnMeltLedgers: true } } } })
    if (!report) throw new NotFoundException('终检报告不存在')
    await this.assertVisible(request, report.workOrderId)
    return { ...report, scrapWeightKg: Number(report.scrapWeightKg) }
  }

  async trace(request: RequestWithAdmin, workOrderId: string, _mobile = false) {
    return this.getTask(request, workOrderId)
  }

  async reverse(request: RequestWithAdmin, id: string, value: ReverseFinalInspectionBody | unknown) {
    const body = object(value)
    const versionNo = integer(body.versionNo, '报告版本')
    const reason = stringValue(body.reason, '撤销原因', true)
    const ref = await this.prisma.inspectionReport.findUnique({ where: { id }, select: { workOrderId: true } })
    if (!ref) throw new NotFoundException('终检报告不存在')
    await this.assertVisible(request, ref.workOrderId)
    const actor = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'WorkOrder', ref.workOrderId)
      await this.lock(tx, 'InspectionReport', id)
      const report = await tx.inspectionReport.findUnique({ where: { id }, include: { consumptions: true, reworkTask: { include: { reports: true } }, blankWarehouseReceipt: { include: { inventoryBatch: { include: { ledgers: true } } } }, scrapWriteOff: { include: { returnMeltLedgers: true } } } })
      if (!report) throw new NotFoundException('终检报告不存在')
      if (report.status === 'REVERSED') throw new BadRequestException('该终检报告已经撤销')
      if (report.versionNo !== versionNo) throw new ConflictException('终检报告已更新，请刷新后重试')
      if (report.reworkTask?.reports.length) throw new ConflictException('返修任务已经报工，不能撤销本次终检')
      const inventory = report.blankWarehouseReceipt?.inventoryBatch
      if (inventory && (inventory.currentQuantity !== inventory.initialQuantity || inventory.ledgers.some((item) => item.action === 'ISSUE'))) throw new ConflictException('合格毛坯已发生下游出库，不能撤销本次终检')
      for (const consumption of report.consumptions) {
        await this.lock(tx, 'InspectionBatch', consumption.inspectionBatchId)
        const batch = await tx.inspectionBatch.findUniqueOrThrow({ where: { id: consumption.inspectionBatchId } })
        const remaining = batch.remainingQuantity + consumption.quantity
        await tx.inspectionBatch.update({ where: { id: batch.id }, data: { remainingQuantity: remaining, status: remaining >= batch.originalQuantity ? 'WAITING' : 'PARTIAL', versionNo: { increment: 1 } } })
      }
      if (report.reworkTask) await tx.cleaningReworkTask.update({ where: { id: report.reworkTask.id }, data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: reason, versionNo: { increment: 1 } } })
      if (inventory && report.blankWarehouseReceipt) {
        await tx.blankInventoryBatch.update({ where: { id: inventory.id }, data: { currentQuantity: 0, status: 'CANCELED', versionNo: { increment: 1 } } })
        await tx.blankInventoryLedger.create({ data: {
          eventKey: `INSPECTION:${report.id}:REVERSAL`, inventoryBatchId: inventory.id, receiptId: report.blankWarehouseReceipt.id, warehouseId: inventory.warehouseId,
          warehouseCodeSnapshot: report.blankWarehouseReceipt.warehouseCodeSnapshot, warehouseNameSnapshot: report.blankWarehouseReceipt.warehouseNameSnapshot,
          productCode: report.productCode, productCodeSnapshot: report.productCodeSnapshot, productNameSnapshot: report.productNameSnapshot, workOrderId: report.workOrderId, workOrderCodeSnapshot: report.workOrderCodeSnapshot,
          action: 'REVERSAL', quantityChange: -report.goodQty, balanceAfter: 0, operatorUserId: actor.id, operatorNameSnapshot: actor.name, remark: reason,
        } })
      }
      if (report.scrapWriteOff && report.scrapQty > 0) {
        const warehouse = await tx.systemWarehouse.findUniqueOrThrow({ where: { id: report.scrapWriteOff.warehouseId } })
        const previous = await this.returnMeltBalance(tx, warehouse.id, report.productCode)
        await tx.returnMeltInventoryLedger.create({ data: {
          eventKey: `SCRAP:${report.scrapWriteOff.id}:REVERSAL`, warehouseId: warehouse.id, warehouseCodeSnapshot: warehouse.code, warehouseNameSnapshot: warehouse.name,
          productCode: report.productCode, productCodeSnapshot: report.productCodeSnapshot, productNameSnapshot: report.productNameSnapshot, workOrderId: report.workOrderId, workOrderCodeSnapshot: report.workOrderCodeSnapshot,
          sourceWriteOffId: report.scrapWriteOff.id, action: 'REVERSAL', weightChangeKg: Number(report.scrapWeightKg.negated()), balanceAfterKg: Number((previous - Number(report.scrapWeightKg)).toFixed(4)), operatorUserId: actor.id, operatorNameSnapshot: actor.name, remark: reason,
        } })
      }
      await tx.inspectionReport.update({ where: { id }, data: { status: 'REVERSED', reverseReason: reason, reversedByUserId: actor.id, reversedByNameSnapshot: actor.name, reversedAt: new Date(), versionNo: { increment: 1 } } })
      await tx.workOrder.updateMany({ where: { id: ref.workOrderId, productionStatus: 'COMPLETED' }, data: { productionStatus: 'IN_PRODUCTION', completedAt: null, versionNo: { increment: 1 } } })
    })
    return this.inspectionReport(request, id)
  }

  async listReworkTasks(request: RequestWithAdmin, query: FinalInspectionListQuery, mobile = false) {
    const ids = await this.visibleWorkOrderIds(request)
    if (ids?.length === 0) return []
    const keyword = query.keyword?.trim() || ''
    const rows = await this.prisma.cleaningReworkTask.findMany({ where: { ...(ids === null ? {} : { workOrderId: { in: ids } }), ...(query.status && query.status !== 'ALL' ? { status: query.status as never } : {}), ...(keyword ? { OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { workOrderCodeSnapshot: { contains: keyword, mode: 'insensitive' } }, { productNameSnapshot: { contains: keyword, mode: 'insensitive' } }] } : {}) }, include: { reports: true }, orderBy: { createdAt: 'desc' } })
    return rows.map((row) => ({ ...row, allowedActions: { report: row.remainingQuantity > 0 && this.permission(request, mobile, 'report', true) } }))
  }

  async getReworkTask(request: RequestWithAdmin, id: string, mobile = false) {
    const row = await this.prisma.cleaningReworkTask.findUnique({ where: { id }, include: { sourceInspectionReport: true, reports: { include: { outputInspectionBatch: true, scrapWriteOff: true } }, cleaningRoutingNode: { include: { equipmentLinks: { include: { equipment: true } } } } } })
    if (!row) throw new NotFoundException('清理返修任务不存在')
    await this.assertVisible(request, row.workOrderId)
    return { ...row, equipment: row.cleaningRoutingNode.equipmentLinks.map((item) => item.equipment).filter((item) => item.status === '启用' && CLEANING_EQUIPMENT_TYPES.includes(item.equipmentType)), allowedActions: { report: row.remainingQuantity > 0 && this.permission(request, mobile, 'report', true) } }
  }

  async reportRework(request: RequestWithAdmin, value: ReportCleaningReworkBody | unknown, _mobile = false) {
    const input = this.parseRework(value)
    const reference = await this.prisma.cleaningReworkTask.findUnique({ where: { id: input.taskId }, select: { workOrderId: true } })
    if (!reference) throw new NotFoundException('清理返修任务不存在')
    await this.assertVisible(request, reference.workOrderId)
    const actor = getAdminContext(request)
    const reportId = await this.serializable(async (tx) => {
      await this.lock(tx, 'WorkOrder', reference.workOrderId)
      await this.lock(tx, 'CleaningReworkTask', input.taskId)
      const existing = await tx.cleaningReworkReport.findUnique({ where: { taskId_requestId: { taskId: input.taskId, requestId: input.requestId } } })
      if (existing) return existing.id
      const task = await tx.cleaningReworkTask.findUnique({ where: { id: input.taskId }, include: { cleaningRoutingNode: true, workOrder: true } })
      if (!task || task.status === 'CANCELED' || task.status === 'COMPLETED') throw new BadRequestException('当前返修任务不能继续报工')
      if (task.versionNo !== input.versionNo) throw new ConflictException('返修任务已更新，请刷新后重试')
      const total = input.goodQty + input.scrapQty
      if (total <= 0 || total > task.remainingQuantity) throw new BadRequestException('返修数量必须大于 0 且不能超过剩余数量')
      const equipment = await tx.furnace.findFirst({ where: { code: input.equipmentCode, status: '启用', equipmentType: { in: CLEANING_EQUIPMENT_TYPES }, routingNodeLinks: { some: { routingNodeId: task.cleaningRoutingNodeId } } } })
      if (!equipment) throw new BadRequestException('请选择已绑定当前清理工序的启用设备')
      const scrapWeightKg = input.scrapWeightKg ?? calculateDefaultScrapWeightKg(input.scrapQty, Number(task.workOrder.unitNetWeightKg))
      const report = await tx.cleaningReworkReport.create({ data: { code: await this.nextCode(tx, 'CLEANING_REWORK_REPORT', 'RR'), taskId: task.id, requestId: input.requestId, goodQty: input.goodQty, scrapQty: input.scrapQty, scrapWeightKg, equipmentCode: equipment.code, equipmentNameSnapshot: equipment.name, operatorUserId: actor.id, operatorNameSnapshot: actor.name, remark: input.remark } })
      const remaining = task.remainingQuantity - total
      await tx.cleaningReworkTask.update({ where: { id: task.id }, data: { remainingQuantity: remaining, status: remaining === 0 ? 'COMPLETED' : 'IN_PROGRESS', startedAt: task.startedAt || new Date(), ...(remaining === 0 ? { completedAt: new Date() } : {}), versionNo: { increment: 1 } } })
      if (input.goodQty > 0) {
        await tx.inspectionBatch.create({ data: {
          code: `${report.code}-INSP`, sourceBlankOutputBatchId: null, sourceReworkReportId: report.id, workOrderId: task.workOrderId, productCode: task.productCode, routingVersionId: task.routingVersionId,
          inspectionRoutingNodeId: task.sourceInspectionReportId ? (await tx.inspectionReport.findUniqueOrThrow({ where: { id: task.sourceInspectionReportId } })).inspectionRoutingNodeId : task.cleaningRoutingNodeId,
          workOrderCodeSnapshot: task.workOrderCodeSnapshot, productCodeSnapshot: task.productCodeSnapshot, productNameSnapshot: task.productNameSnapshot,
          routingCodeSnapshot: task.routingCodeSnapshot, routingNameSnapshot: task.routingNameSnapshot, routingVersionSnapshot: task.routingVersionSnapshot,
          operationCodeSnapshot: 'OP-INSP', operationNameSnapshot: '成品终检', originalQuantity: input.goodQty, remainingQuantity: input.goodQty, status: 'WAITING', availableAt: report.reportedAt,
        } })
      }
      await this.createScrap(tx, { reworkReportId: report.id }, { workOrderId: task.workOrderId, workOrderCode: task.workOrderCodeSnapshot, productCode: task.productCode, productName: task.productNameSnapshot }, input.scrapQty, scrapWeightKg, actor)
      await this.refreshWorkOrderStatus(tx, task.workOrderId)
      return report.id
    })
    return this.prisma.cleaningReworkReport.findUnique({ where: { id: reportId }, include: { outputInspectionBatch: true, scrapWriteOff: { include: { returnMeltLedgers: true } } } })
  }

  private async refreshWorkOrderStatus(tx: Transaction, workOrderId: string) {
    const [activeReports, pendingInspection, openRework, openMolding, openPouring, openShake, openCleaning] = await Promise.all([
      tx.inspectionReport.count({ where: { workOrderId, status: 'ACTIVE' } }),
      tx.inspectionBatch.aggregate({ where: { workOrderId, status: { in: ['WAITING', 'PARTIAL'] } }, _sum: { remainingQuantity: true } }),
      tx.cleaningReworkTask.aggregate({ where: { workOrderId, status: { in: ['PENDING', 'IN_PROGRESS'] } }, _sum: { remainingQuantity: true } }),
      tx.moldingTask.count({ where: { workOrderId, status: { notIn: ['COMPLETED', 'CANCELED'] } } }),
      tx.pouringMoldBatch.count({ where: { workOrderId, status: { not: 'CANCELED' }, remainingQuantity: { gt: 0 } } }),
      tx.shakeBatch.count({ where: { workOrderId, status: { not: 'CANCELED' }, remainingQuantity: { gt: 0 } } }),
      tx.cleaningBatch.count({ where: { workOrderId, status: { not: 'CANCELED' }, remainingQuantity: { gt: 0 } } }),
    ])
    if (!activeReports || Number(pendingInspection._sum.remainingQuantity || 0) > 0 || Number(openRework._sum.remainingQuantity || 0) > 0 || openMolding || openPouring || openShake || openCleaning) return
    const completed = await tx.blankWarehouseReceipt.aggregate({ where: { workOrderId, inventoryBatch: { is: { status: { not: 'CANCELED' } } } }, _sum: { quantity: true } })
    await tx.workOrder.update({ where: { id: workOrderId }, data: { completedQuantity: Number(completed._sum.quantity || 0), productionStatus: 'COMPLETED', completedAt: new Date(), versionNo: { increment: 1 } } })
  }
}
