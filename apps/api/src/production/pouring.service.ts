import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAdminContext, visibleOwnershipEntityIds, type RequestWithAdmin } from '../shared/admin-context'
import {
  allocatePouringMoldBatches,
  calculateTheoreticalPouringWeight,
  calculateTransferBalance,
  pouringHoldLevel,
} from './pouring.calculations'
import { backfillPouringMoldBatches } from './pouring.queue'
import { createShakeBatchForPouringReport } from './shake-clean.queue'
import type { CheckPouringBody, ReportPouringBody, ReversePouringReportBody } from './pouring.types'

function bodyRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求体格式不正确')
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string, required = false) {
  const result = String(value || '').trim()
  if (required && !result) throw new BadRequestException(`请选择或填写${label}`)
  return result
}

function integer(value: unknown, label: string, minimum = 0) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) throw new BadRequestException(`${label}必须为${minimum ? '正' : '非负'}整数`)
  return value
}

function weight(value: unknown, label: string, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return null
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0) throw new BadRequestException(`${label}必须为非负数值`)
  return Number(result.toFixed(2))
}

function decimal(value: Prisma.Decimal | number | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value)
}

function serializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && String(error.meta?.code || '') === '40001'))
}

function businessDate(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { key: `${values.year}${values.month}${values.day}`, date: new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`) }
}

@Injectable()
export class PouringService {
  constructor(private readonly prisma: PrismaService) {}

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (serializableConflict(error) && attempt < 2) continue
        if (serializableConflict(error)) throw new ConflictException('数据并发冲突，请重试')
        throw error
      }
    }
    throw new ConflictException('数据并发冲突，请重试')
  }

  private async lock(tx: Prisma.TransactionClient, table: 'MoldingTask' | 'HeatOrderTransfer' | 'PouringMoldBatch' | 'PouringReport' | 'ShakeBatch', id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`)
    if (!rows.length) throw new NotFoundException('业务数据不存在')
  }

  private async nextCode(tx: Prisma.TransactionClient) {
    const current = businessDate()
    const [sequence] = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "DocumentSequence" ("documentType", "businessDate", "currentValue", "updatedAt")
      VALUES ('POURING_REPORT', ${current.date}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("documentType", "businessDate") DO UPDATE
      SET "currentValue" = "DocumentSequence"."currentValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "currentValue"
    `)
    return `PR-${current.key}-${String(sequence.currentValue).padStart(3, '0')}`
  }

  private async visibleTaskIds(request: RequestWithAdmin, mobile: boolean) {
    if (mobile) return null
    return visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:molding_tasks')
  }

  private async assertTaskVisible(request: RequestWithAdmin, moldingTaskId: string, mobile: boolean) {
    const ids = await this.visibleTaskIds(request, mobile)
    if (ids !== null && !ids.includes(moldingTaskId)) throw new NotFoundException('待浇注任务不存在')
  }

  async listQueue(request: RequestWithAdmin, query: { keyword?: string; status?: string; workOrderId?: string }, mobile = false) {
    await this.serializable((tx) => backfillPouringMoldBatches(tx))
    const taskIds = await this.visibleTaskIds(request, mobile)
    const batches = await this.prisma.pouringMoldBatch.findMany({
      where: {
        ...(taskIds === null ? {} : { moldingTaskId: { in: taskIds } }),
        ...(query.workOrderId ? { workOrderId: query.workOrderId } : {}),
        status: { not: 'CANCELED' },
        ...(query.keyword ? { OR: [
          { workOrderCodeSnapshot: { contains: query.keyword, mode: 'insensitive' } },
          { productCodeSnapshot: { contains: query.keyword, mode: 'insensitive' } },
          { productNameSnapshot: { contains: query.keyword, mode: 'insensitive' } },
        ] } : {}),
      },
      include: { moldingTask: true },
      orderBy: [{ closingTime: 'asc' }, { id: 'asc' }],
    })
    const now = Date.now()
    const grouped = new Map<string, typeof batches>()
    for (const batch of batches) grouped.set(batch.moldingTaskId, [...(grouped.get(batch.moldingTaskId) || []), batch])
    return [...grouped.values()].map((items) => {
      const first = items[0]
      const originalQuantity = items.reduce((sum, item) => sum + item.originalQuantity, 0)
      const remainingQuantity = items.reduce((sum, item) => sum + item.remainingQuantity, 0)
      const earliest = items.filter((item) => item.remainingQuantity > 0).sort((a, b) => a.closingTime.getTime() - b.closingTime.getTime())[0]
      const holdMinutes = earliest ? Math.max(0, Math.floor((now - earliest.closingTime.getTime()) / 60000)) : 0
      const completed = first.moldingTask.status === 'COMPLETED' && remainingQuantity === 0
      const executionStatus = completed ? 'COMPLETED' : remainingQuantity > 0 ? (remainingQuantity < originalQuantity ? 'PARTIAL' : 'WAITING') : 'WAITING_MOLDING'
      return {
        moldingTaskId: first.moldingTaskId,
        moldingTaskCode: first.moldingTask.code,
        workOrderId: first.workOrderId,
        workOrderCode: first.workOrderCodeSnapshot,
        productCode: first.productCodeSnapshot,
        productName: first.productNameSnapshot,
        moldName: first.moldNameSnapshot,
        pouringRoutingNodeId: first.pouringRoutingNodeId,
        pouringOperationName: first.pouringOperationNameSnapshot,
        moldedQuantity: originalQuantity,
        pouredQuantity: originalQuantity - remainingQuantity,
        remainingQuantity,
        earliestClosingTime: earliest?.closingTime || null,
        holdMinutes,
        holdLevel: pouringHoldLevel(holdMinutes),
        moldingTaskStatus: first.moldingTask.status,
        executionStatus,
      }
    }).filter((item) => !query.status || query.status === 'ALL' || item.executionStatus === query.status)
  }

  async options(request: RequestWithAdmin, moldingTaskId: string, mobile = false) {
    await this.assertTaskVisible(request, moldingTaskId, mobile)
    await this.serializable((tx) => backfillPouringMoldBatches(tx))
    const task = await this.prisma.moldingTask.findUnique({
      where: { id: moldingTaskId },
      include: {
        workOrder: true,
        pouringMoldBatches: { where: { status: { not: 'CANCELED' } }, orderBy: [{ closingTime: 'asc' }, { id: 'asc' }] },
      },
    })
    if (!task || !task.pouringMoldBatches.length) throw new NotFoundException('待浇注任务不存在')
    const pouringNodeId = task.pouringMoldBatches[0].pouringRoutingNodeId
    const pendingBatches = task.pouringMoldBatches.filter((batch) => batch.remainingQuantity > 0 && ['WAITING', 'PARTIAL'].includes(batch.status))
    const [node, transfers] = await Promise.all([
      this.prisma.processRoutingNode.findUnique({
        where: { id: pouringNodeId },
        include: { equipmentLinks: { include: { equipment: true } } },
      }),
      this.prisma.heatOrderTransfer.findMany({
        where: {
          transferDevice: { status: '启用', equipmentType: { in: ['浇注包', '球化包'] } },
          heatOrder: {
            status: { in: ['TRANSFERRING', 'COMPLETED'] },
            materialGradeCode: task.workOrder.materialGradeCode,
            allocations: { some: { workOrderId: task.workOrderId } },
          },
        },
        include: {
          transferDevice: true,
          heatOrder: true,
          pouringReports: { where: { status: 'ACTIVE' }, select: { actualWeightKg: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const stations = (node?.equipmentLinks || []).map((link) => link.equipment).filter((equipment) => equipment.status === '启用')
    const now = Date.now()
    return {
      moldingTaskId,
      moldingTaskCode: task.code,
      workOrderId: task.workOrderId,
      workOrderCode: task.workOrderCodeSnapshot,
      productCode: task.productCodeSnapshot,
      productName: task.productNameSnapshot,
      materialGradeCode: task.workOrder.materialGradeCode,
      materialGradeName: task.workOrder.materialGradeNameSnapshot,
      remainingQuantity: pendingBatches.reduce((sum, batch) => sum + batch.remainingQuantity, 0),
      earliestClosingTime: pendingBatches[0]?.closingTime || null,
      holdMinutes: pendingBatches[0] ? Math.max(0, Math.floor((now - pendingBatches[0].closingTime.getTime()) / 60000)) : 0,
      stations: stations.map((item) => ({ code: item.code, name: item.name, equipmentType: item.equipmentType })),
      transfers: transfers.map((item) => {
        const balanceKg = calculateTransferBalance(item.weightKg, item.pouringReports.map((report) => report.actualWeightKg))
        return {
          id: item.id,
          versionNo: item.versionNo,
          heatOrderId: item.heatOrderId,
          heatOrderCode: item.heatOrder.code,
          transferDeviceCode: item.transferDeviceCode,
          transferDeviceName: item.transferDeviceNameSnapshot,
          equipmentType: item.equipmentTypeSnapshot,
          materialGradeCode: item.heatOrder.materialGradeCode,
          materialGradeName: item.heatOrder.materialGradeNameSnapshot,
          transferWeightKg: decimal(item.weightKg),
          balanceKg,
          createdAt: item.createdAt,
        }
      }),
    }
  }

  private parsedCheck(value: CheckPouringBody | unknown) {
    const body = bodyRecord(value)
    return {
      moldingTaskId: stringValue(body.moldingTaskId, '造型派工单', true),
      heatOrderTransferId: stringValue(body.heatOrderTransferId, '铁水包次', true),
      stationEquipmentCode: stringValue(body.stationEquipmentCode, '浇注工位', true),
      goodQty: integer(body.goodQty, '本次浇注合格箱数'),
      scrapQty: integer(body.scrapQty, '本次浇注废品箱数'),
      actualWeightKg: weight(body.actualWeightKg, '实际浇注重量'),
    }
  }

  private async calculateCheck(client: PrismaService | Prisma.TransactionClient, input: ReturnType<PouringService['parsedCheck']>) {
    const task = await client.moldingTask.findUnique({
      where: { id: input.moldingTaskId },
      include: {
        workOrder: true,
        pouringMoldBatches: { where: { status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, orderBy: [{ closingTime: 'asc' }, { id: 'asc' }] },
      },
    })
    if (!task || !task.pouringMoldBatches.length) throw new BadRequestException('当前没有可浇注的砂型批次')
    const totalQty = input.goodQty + input.scrapQty
    if (totalQty <= 0) throw new BadRequestException('本次浇注箱数必须大于 0')
    let allocations
    try {
      allocations = allocatePouringMoldBatches(totalQty, task.pouringMoldBatches.map((batch) => ({ id: batch.id, remainingQuantity: batch.remainingQuantity, closingTime: batch.closingTime })))
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '待浇箱数不足')
    }
    const pouringNodeId = task.pouringMoldBatches[0].pouringRoutingNodeId
    if (task.pouringMoldBatches.some((batch) => batch.pouringRoutingNodeId !== pouringNodeId)) throw new BadRequestException('当前造型任务对应多个浇注节点，请拆分处理')
    const station = await client.furnace.findFirst({
      where: { code: input.stationEquipmentCode, status: '启用', routingNodeLinks: { some: { routingNodeId: pouringNodeId } } },
    })
    if (!station) throw new BadRequestException('所选浇注工位未启用或未绑定当前工艺路线')
    const transfer = await client.heatOrderTransfer.findUnique({
      where: { id: input.heatOrderTransferId },
      include: {
        transferDevice: true,
        heatOrder: { include: { allocations: true } },
        pouringReports: { where: { status: 'ACTIVE' }, select: { actualWeightKg: true } },
      },
    })
    if (!transfer
      || transfer.transferDevice.status !== '启用'
      || !['浇注包', '球化包'].includes(transfer.transferDevice.equipmentType)
      || !['TRANSFERRING', 'COMPLETED'].includes(transfer.heatOrder.status)
      || transfer.heatOrder.materialGradeCode !== task.workOrder.materialGradeCode
      || !transfer.heatOrder.allocations.some((allocation) => allocation.workOrderId === task.workOrderId)) {
      throw new BadRequestException('所选铁水包次与当前工单、材质或状态不匹配')
    }
    const theoreticalWeightKg = calculateTheoreticalPouringWeight(input.goodQty, input.scrapQty, task.cavityCountSnapshot, task.workOrder.unitGrossWeightKg)
    const actualWeightKg = input.actualWeightKg ?? theoreticalWeightKg
    const transferBalanceBeforeKg = calculateTransferBalance(transfer.weightKg, transfer.pouringReports.map((report) => report.actualWeightKg))
    const transferBalanceAfterKg = Number((transferBalanceBeforeKg - actualWeightKg).toFixed(2))
    const overdrawWeightKg = Math.max(0, Number((-transferBalanceAfterKg).toFixed(2)))
    const oldest = task.pouringMoldBatches.find((batch) => allocations.some((item) => item.batchId === batch.id))!
    const holdMinutes = Math.max(0, Math.floor((Date.now() - oldest.closingTime.getTime()) / 60000))
    const holdLevel = pouringHoldLevel(holdMinutes)
    const warningCodes = [...(holdLevel === 'CRITICAL' ? ['CRITICAL_HOLD'] : []), ...(overdrawWeightKg > 0 ? ['TRANSFER_OVERDRAW'] : [])]
    return { task, transfer, station, allocations, totalQty, theoreticalWeightKg, actualWeightKg, transferBalanceBeforeKg, transferBalanceAfterKg, overdrawWeightKg, holdMinutes, holdLevel, warningCodes }
  }

  private checkPayload(input: ReturnType<PouringService['parsedCheck']>, result: Awaited<ReturnType<PouringService['calculateCheck']>>) {
    return {
      moldingTaskId: input.moldingTaskId,
      heatOrderTransferId: input.heatOrderTransferId,
      transferVersionNo: result.transfer.versionNo,
      pendingQuantity: result.task.pouringMoldBatches.reduce((sum, item) => sum + item.remainingQuantity, 0),
      theoreticalWeightKg: result.theoreticalWeightKg,
      actualWeightKg: result.actualWeightKg,
      transferBalanceBeforeKg: result.transferBalanceBeforeKg,
      transferBalanceAfterKg: result.transferBalanceAfterKg,
      overdrawWeightKg: result.overdrawWeightKg,
      holdMinutes: result.holdMinutes,
      holdLevel: result.holdLevel,
      warningCodes: result.warningCodes,
    }
  }

  async check(request: RequestWithAdmin, value: CheckPouringBody | unknown, mobile = false) {
    const input = this.parsedCheck(value)
    await this.assertTaskVisible(request, input.moldingTaskId, mobile)
    const result = await this.calculateCheck(this.prisma, input)
    return this.checkPayload(input, result)
  }

  async report(request: RequestWithAdmin, value: ReportPouringBody | unknown, mobile = false) {
    const body = bodyRecord(value)
    const input = this.parsedCheck(body)
    await this.assertTaskVisible(request, input.moldingTaskId, mobile)
    const requestId = stringValue(body.requestId, '请求标识', true)
    const transferVersionNo = integer(body.transferVersionNo, '铁水包数据版本', 1)
    const confirmedWarningCodes = Array.isArray(body.confirmedWarningCodes) ? body.confirmedWarningCodes.map(String) : []
    const remark = stringValue(body.remark, '备注') || null
    const defects = Array.isArray(body.defects) ? body.defects.map((item) => {
      const row = bodyRecord(item)
      return { defectCode: stringValue(row.defectCode, '缺陷代码', true), quantity: integer(row.quantity, '缺陷数量', 1), remark: stringValue(row.remark, '缺陷备注') || null }
    }) : []
    if (input.scrapQty > 0 && !defects.length) throw new BadRequestException('存在浇注废品时必须选择缺陷代码')
    if (defects.reduce((sum, item) => sum + item.quantity, 0) !== input.scrapQty) throw new BadRequestException('缺陷数量合计必须等于本次浇注废品箱数')
    if (new Set(defects.map((item) => item.defectCode)).size !== defects.length) throw new BadRequestException('同一缺陷代码不能重复填写')
    const user = getAdminContext(request)
    const reportId = await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', input.moldingTaskId)
      await this.lock(tx, 'HeatOrderTransfer', input.heatOrderTransferId)
      const existing = await tx.pouringReport.findUnique({ where: { moldingTaskId_requestId: { moldingTaskId: input.moldingTaskId, requestId } } })
      if (existing) return existing.id
      const result = await this.calculateCheck(tx, input)
      if (result.transfer.versionNo !== transferVersionNo) throw new ConflictException('铁水包数据已更新，请刷新后重试')
      const unconfirmed = result.warningCodes.filter((code) => !confirmedWarningCodes.includes(code))
      if (unconfirmed.length) throw new ConflictException({
        message: '当前浇注存在需要确认的警告',
        conflictCode: 'POURING_WARNING_CONFIRMATION_REQUIRED',
        data: { warningCodes: unconfirmed, check: this.checkPayload(input, result) },
      })
      const defectCodes = defects.map((item) => item.defectCode)
      const defectRecords = defectCodes.length ? await tx.defectCode.findMany({
        where: { code: { in: defectCodes }, status: '启用', operations: { some: { operationCode: result.task.pouringMoldBatches[0].pouringOperationCodeSnapshot } } },
      }) : []
      if (defectRecords.length !== defectCodes.length) throw new BadRequestException('所选缺陷代码不适用于当前合型浇注工序')
      for (const allocation of result.allocations) await this.lock(tx, 'PouringMoldBatch', allocation.batchId)
      const report = await tx.pouringReport.create({
        data: {
          code: await this.nextCode(tx),
          requestId,
          heatOrderTransferId: result.transfer.id,
          moldingTaskId: result.task.id,
          workOrderId: result.task.workOrderId,
          pouringRoutingNodeId: result.task.pouringMoldBatches[0].pouringRoutingNodeId,
          stationEquipmentCode: result.station.code,
          heatOrderCodeSnapshot: result.transfer.heatOrder.code,
          transferDeviceCodeSnapshot: result.transfer.transferDeviceCode,
          transferDeviceNameSnapshot: result.transfer.transferDeviceNameSnapshot,
          stationEquipmentNameSnapshot: result.station.name,
          workOrderCodeSnapshot: result.task.workOrderCodeSnapshot,
          productCodeSnapshot: result.task.productCodeSnapshot,
          productNameSnapshot: result.task.productNameSnapshot,
          pouringOperationCodeSnapshot: result.task.pouringMoldBatches[0].pouringOperationCodeSnapshot,
          pouringOperationNameSnapshot: result.task.pouringMoldBatches[0].pouringOperationNameSnapshot,
          goodQty: input.goodQty,
          scrapQty: input.scrapQty,
          theoreticalWeightKg: result.theoreticalWeightKg,
          actualWeightKg: result.actualWeightKg,
          transferBalanceBeforeKg: result.transferBalanceBeforeKg,
          transferBalanceAfterKg: result.transferBalanceAfterKg,
          overdrawWeightKg: result.overdrawWeightKg,
          holdMinutesSnapshot: result.holdMinutes,
          holdLevelSnapshot: result.holdLevel,
          warningCodes: result.warningCodes,
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
          remark,
          defects: { create: defects.map((item) => {
            const defect = defectRecords.find((record) => record.code === item.defectCode)!
            return { defectCodeId: defect.id, defectCodeSnapshot: defect.code, defectNameSnapshot: defect.name, quantity: item.quantity, remark: item.remark }
          }) },
        },
      })
      await createShakeBatchForPouringReport(tx, report.id, { reportAlreadyLocked: true, moldingTaskAlreadyLocked: true })
      for (const allocation of result.allocations) {
        const batch = await tx.pouringMoldBatch.findUniqueOrThrow({ where: { id: allocation.batchId } })
        if (batch.remainingQuantity < allocation.quantity || !['WAITING', 'PARTIAL'].includes(batch.status)) throw new ConflictException('待浇砂型数量已变化，请刷新后重试')
        const quantityAfter = batch.remainingQuantity - allocation.quantity
        await tx.pouringMoldBatch.update({
          where: { id: batch.id },
          data: { remainingQuantity: quantityAfter, status: quantityAfter === 0 ? 'CONSUMED' : 'PARTIAL', versionNo: { increment: 1 } },
        })
        await tx.pouringMoldConsumption.create({ data: { pouringReportId: report.id, pouringMoldBatchId: batch.id, quantity: allocation.quantity, quantityBefore: batch.remainingQuantity, quantityAfter } })
      }
      const updated = await tx.heatOrderTransfer.updateMany({ where: { id: result.transfer.id, versionNo: transferVersionNo }, data: { versionNo: { increment: 1 } } })
      if (!updated.count) throw new ConflictException('铁水包数据已更新，请刷新后重试')
      return report.id
    })
    return this.getReport(request, reportId, mobile)
  }

  async getReport(request: RequestWithAdmin, id: string, mobile = false) {
    const report = await this.prisma.pouringReport.findUnique({
      where: { id },
      include: { heatOrderTransfer: true, moldConsumptions: { include: { pouringMoldBatch: true } }, defects: true, operator: { select: { id: true, name: true } }, reversedBy: { select: { id: true, name: true } } },
    })
    if (!report) throw new NotFoundException('浇注报工记录不存在')
    await this.assertTaskVisible(request, report.moldingTaskId, mobile)
    return { ...report, theoreticalWeightKg: decimal(report.theoreticalWeightKg), actualWeightKg: decimal(report.actualWeightKg), transferBalanceBeforeKg: decimal(report.transferBalanceBeforeKg), transferBalanceAfterKg: decimal(report.transferBalanceAfterKg), overdrawWeightKg: decimal(report.overdrawWeightKg) }
  }

  async listReports(request: RequestWithAdmin, moldingTaskId: string, mobile = false) {
    await this.assertTaskVisible(request, moldingTaskId, mobile)
    const reports = await this.prisma.pouringReport.findMany({ where: { moldingTaskId }, include: { defects: true, heatOrderTransfer: { select: { versionNo: true } } }, orderBy: { reportedAt: 'desc' } })
    return reports.map((report) => ({ ...report, transferVersionNo: report.heatOrderTransfer.versionNo, theoreticalWeightKg: decimal(report.theoreticalWeightKg), actualWeightKg: decimal(report.actualWeightKg), transferBalanceBeforeKg: decimal(report.transferBalanceBeforeKg), transferBalanceAfterKg: decimal(report.transferBalanceAfterKg), overdrawWeightKg: decimal(report.overdrawWeightKg) }))
  }

  async defectOptions(request: RequestWithAdmin, moldingTaskId: string, mobile = false) {
    await this.assertTaskVisible(request, moldingTaskId, mobile)
    const batch = await this.prisma.pouringMoldBatch.findFirst({ where: { moldingTaskId, status: { not: 'CANCELED' } }, orderBy: { closingTime: 'asc' } })
    if (!batch) return []
    return this.prisma.defectCode.findMany({ where: { status: '启用', operations: { some: { operationCode: batch.pouringOperationCodeSnapshot } } }, orderBy: { code: 'asc' } })
  }

  async reverse(request: RequestWithAdmin, id: string, value: ReversePouringReportBody | unknown) {
    const body = bodyRecord(value)
    const transferVersionNo = integer(body.transferVersionNo, '铁水包数据版本', 1)
    const reason = stringValue(body.reason, '撤销原因', true)
    const reference = await this.prisma.pouringReport.findUnique({ where: { id }, select: { moldingTaskId: true } })
    if (!reference) throw new NotFoundException('浇注报工记录不存在')
    await this.assertTaskVisible(request, reference.moldingTaskId, false)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', reference.moldingTaskId)
      await this.lock(tx, 'PouringReport', id)
      const report = await tx.pouringReport.findUnique({ where: { id }, include: { moldConsumptions: true, heatOrderTransfer: true } })
      if (!report) throw new NotFoundException('浇注报工记录不存在')
      if (report.status === 'REVERSED') throw new BadRequestException('该浇注报工已经撤销')
      const shakeBatch = await tx.shakeBatch.findUnique({ where: { sourcePouringReportId: report.id }, select: { id: true } })
      if (shakeBatch) {
        await this.lock(tx, 'ShakeBatch', shakeBatch.id)
        const lockedShakeBatch = await tx.shakeBatch.findUniqueOrThrow({
          where: { id: shakeBatch.id },
          include: { consumptions: { where: { shakeReport: { status: 'ACTIVE' } }, select: { id: true } } },
        })
        if (lockedShakeBatch.consumptions.length) {
          throw new BadRequestException('该浇注报工已进入落砂追溯，请先撤销落砂报工')
        }
        if (lockedShakeBatch.status !== 'CANCELED') {
          await tx.shakeBatch.update({
            where: { id: lockedShakeBatch.id },
            data: { status: 'CANCELED', versionNo: { increment: 1 } },
          })
        }
      }
      await this.lock(tx, 'HeatOrderTransfer', report.heatOrderTransferId)
      if (report.heatOrderTransfer.versionNo !== transferVersionNo) throw new ConflictException('铁水包数据已更新，请刷新后重试')
      for (const consumption of report.moldConsumptions) {
        await this.lock(tx, 'PouringMoldBatch', consumption.pouringMoldBatchId)
        const batch = await tx.pouringMoldBatch.findUniqueOrThrow({ where: { id: consumption.pouringMoldBatchId } })
        const remainingQuantity = batch.remainingQuantity + consumption.quantity
        await tx.pouringMoldBatch.update({
          where: { id: batch.id },
          data: { remainingQuantity, status: remainingQuantity >= batch.originalQuantity ? 'WAITING' : 'PARTIAL', versionNo: { increment: 1 } },
        })
      }
      await tx.pouringReport.update({ where: { id }, data: { status: 'REVERSED', shakeQueueResolution: 'NOT_APPLICABLE', reversedByUserId: user.id, reversedAt: new Date(), reverseReason: reason } })
      const updated = await tx.heatOrderTransfer.updateMany({ where: { id: report.heatOrderTransferId, versionNo: transferVersionNo }, data: { versionNo: { increment: 1 } } })
      if (!updated.count) throw new ConflictException('铁水包数据已更新，请刷新后重试')
    })
    return this.getReport(request, id)
  }
}
