import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAdminContext, hasAdminPermission, visibleOwnershipEntityIds, type RequestWithAdmin } from '../shared/admin-context'
import { allocateQueueBatches, calculateCoolingState } from './shake-clean.calculations'
import { ensureInspectionBatchForBlankOutput } from './final-inspection.queue'
import type {
  CheckShakeBody,
  ReportCleaningBody,
  ReportShakeBody,
  ReverseShakeCleanReportBody,
  ShakeCleanBatchVersionInput,
  ShakeCleanDefectInput,
  ShakeCleanListQuery,
  ShakeCleanListResponse,
} from './shake-clean.types'

type Transaction = Prisma.TransactionClient
type DatabaseClient = PrismaService | Transaction
type Phase = 'SHAKE' | 'CLEANING'

const CLEANING_TYPES = ['清理', '抛丸', '打磨', '切割']

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求体格式不正确')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, required = false) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (required && !result) throw new BadRequestException(`请填写或选择${label}`)
  return result
}

function integer(value: unknown, label: string, minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new BadRequestException(`${label}必须为${minimum > 0 ? '正' : '非负'}整数`)
  }
  return value
}

function nonNegativeNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return 0
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0) throw new BadRequestException(`${label}必须为非负数值`)
  return Number(result.toFixed(4))
}

function dateValue(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return new Date()
  if (typeof value !== 'string') throw new BadRequestException(`${label}格式不正确`)
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${label}格式不正确`)
  return result
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
export class ShakeCleanService {
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

  private async lock(tx: Transaction, table: 'MoldingTask' | 'ShakeBatch' | 'CleaningBatch' | 'ShakeReport' | 'CleaningReport', id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE
    `)
    if (!rows.length) throw new NotFoundException('落砂清理业务数据不存在')
  }

  private async assertHistoryBackfilled(client: DatabaseClient, moldingTaskId: string) {
    const missing = await client.pouringReport.findFirst({
      where: { moldingTaskId, shakeQueueResolution: 'PENDING' },
      select: { id: true },
    })
    if (missing) {
      throw new ConflictException('历史浇注数据尚未补建，请先执行 npm --prefix apps/api run backfill:shake-batches')
    }
  }

  private async visibleTaskIds(request: RequestWithAdmin) {
    return visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:molding_tasks')
  }

  private async assertVisible(request: RequestWithAdmin, moldingTaskId: string) {
    const ids = await this.visibleTaskIds(request)
    if (ids !== null && !ids.includes(moldingTaskId)) throw new NotFoundException('落砂清理任务不存在')
  }

  private permission(request: RequestWithAdmin, mobile: boolean, action: 'view' | 'shake_report' | 'clean_report' | 'reverse') {
    if (action === 'reverse') return !mobile && hasAdminPermission(getAdminContext(request), 'production.shake_clean.reverse')
    return hasAdminPermission(getAdminContext(request), `${mobile ? 'mini.' : ''}production.shake_clean.${action}`)
  }

  private taskStatus(task: any) {
    const shakeBatches = task.shakeBatches.filter((item: any) => item.status !== 'CANCELED')
    const cleaningBatches = task.cleaningBatches.filter((item: any) => item.status !== 'CANCELED')
    const shakeOriginal = shakeBatches.reduce((sum: number, item: any) => sum + item.originalQuantity, 0)
    const shakeRemaining = shakeBatches.reduce((sum: number, item: any) => sum + item.remainingQuantity, 0)
    const cleaningOriginal = cleaningBatches.reduce((sum: number, item: any) => sum + item.originalQuantity, 0)
    const cleaningRemaining = cleaningBatches.reduce((sum: number, item: any) => sum + item.remainingQuantity, 0)
    const upstreamComplete = task.status === 'COMPLETED'
      && task.pouringMoldBatches.every((item: any) => item.status === 'CANCELED' || item.remainingQuantity === 0)
    return { shakeOriginal, shakeRemaining, cleaningOriginal, cleaningRemaining, upstreamComplete, executionStatus: this.executionStatus({ shakeOriginal, shakeRemaining, cleaningOriginal, cleaningRemaining, upstreamComplete }) }
  }

  private executionStatus(values: { shakeOriginal: number; shakeRemaining: number; cleaningOriginal: number; cleaningRemaining: number; upstreamComplete: boolean }) {
    if (values.shakeRemaining > 0) return values.shakeRemaining < values.shakeOriginal ? 'SHAKING' : 'WAITING_SHAKE'
    if (values.cleaningRemaining > 0) return values.cleaningRemaining < values.cleaningOriginal ? 'CLEANING' : 'WAITING_CLEANING'
    return values.upstreamComplete ? 'COMPLETED' : 'WAITING_POURING'
  }

  private listNumber(value: unknown, fallback: number, maximum: number) {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback
    return Math.min(parsed, maximum)
  }

  private decodeListCursor(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return null
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { stableSortKey?: string; createdAtKey?: string; id?: string }
      if (!parsed.stableSortKey || !parsed.createdAtKey || !parsed.id || !/^\d+$/.test(parsed.stableSortKey) || !/^\d+$/.test(parsed.createdAtKey)) throw new BadRequestException('游标格式无效')
      return { stableSortKey: BigInt(parsed.stableSortKey), createdAtKey: BigInt(parsed.createdAtKey), id: parsed.id }
    } catch (error) { if (error instanceof BadRequestException) throw error; throw new BadRequestException('游标编码无效') }
  }

  private encodeListCursor(value: { stableSortKey: unknown; createdAtKey: unknown; id: string }) {
    const integer = (input: unknown) => String(typeof input === 'bigint' ? input : BigInt(String(input)))
    return Buffer.from(JSON.stringify({ stableSortKey: integer(value.stableSortKey), createdAtKey: integer(value.createdAtKey), id: value.id })).toString('base64url')
  }

  private async taskRecord(client: DatabaseClient, moldingTaskId: string) {
    return client.moldingTask.findUnique({
      where: { id: moldingTaskId },
      include: {
        workOrder: true,
        pouringMoldBatches: { where: { status: { not: 'CANCELED' } }, select: { id: true, remainingQuantity: true, status: true } },
        shakeBatches: { where: { status: { not: 'CANCELED' } }, orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }] },
        cleaningBatches: { where: { status: { not: 'CANCELED' } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] },
      },
    })
  }

  async list(request: RequestWithAdmin, query: ShakeCleanListQuery, mobile = false): Promise<ShakeCleanListResponse> {
    const page = this.listNumber(query.page, 1, Number.MAX_SAFE_INTEGER)
    const pageSize = this.listNumber(query.pageSize, 20, 100)
    const cursor = this.decodeListCursor(query.cursor)
    const stableOrdering = mobile || Boolean(cursor)
    const visibleIds = await this.visibleTaskIds(request)
    if (visibleIds?.length === 0) return { records: [], total: 0, page, pageSize }
    const visibleFilter = visibleIds === null ? Prisma.sql`` : Prisma.sql`AND mt."id" IN (${Prisma.join(visibleIds)})`
    const keyword = query.keyword?.trim() || ''
    const keywordFilter = keyword ? Prisma.sql`AND (
      mt."code" ILIKE ${`%${keyword}%`} OR
      mt."workOrderCodeSnapshot" ILIKE ${`%${keyword}%`} OR
      mt."productCodeSnapshot" ILIKE ${`%${keyword}%`} OR
      mt."productNameSnapshot" ILIKE ${`%${keyword}%`}
    )` : Prisma.sql``
    const workOrderFilter = query.workOrderId ? Prisma.sql`AND mt."workOrderId" = ${query.workOrderId}` : Prisma.sql``
    const statusFilter = query.status && query.status !== 'ALL' ? Prisma.sql`WHERE "executionStatus" = ${query.status}` : Prisma.sql``
    const cursorCondition = cursor ? Prisma.sql`("stableSortKey" > ${cursor.stableSortKey} OR ("stableSortKey" = ${cursor.stableSortKey} AND ("createdAtKey" > ${cursor.createdAtKey} OR ("createdAtKey" = ${cursor.createdAtKey} AND "id" > ${cursor.id}))))` : Prisma.sql``
    const cursorFilter = cursor ? Prisma.sql`WHERE ${cursorCondition}` : Prisma.sql``
    const orderBy = stableOrdering ? Prisma.sql`"stableSortKey" ASC, "createdAtKey" ASC, "id" ASC` : Prisma.sql`"sortAt" ASC, "createdAt" ASC, "id" ASC`
    const queryCte = Prisma.sql`
      WITH shake AS (
        SELECT "moldingTaskId", SUM("originalQuantity") AS "shakeOriginal", SUM("remainingQuantity") AS "shakeRemaining"
        FROM "ShakeBatch" WHERE "status" <> 'CANCELED' GROUP BY "moldingTaskId"
      ), shake_pending AS (
        SELECT "moldingTaskId", MIN("pouredAt") AS "earliestPouredAt"
        FROM "ShakeBatch" WHERE "status" <> 'CANCELED' AND "remainingQuantity" > 0 GROUP BY "moldingTaskId"
      ), shake_all AS (
        SELECT "moldingTaskId", MIN("pouredAt") AS "firstPouredAt"
        FROM "ShakeBatch" GROUP BY "moldingTaskId"
      ), cleaning AS (
        SELECT "moldingTaskId", SUM("originalQuantity") AS "cleaningOriginal", SUM("remainingQuantity") AS "cleaningRemaining"
        FROM "CleaningBatch" WHERE "status" <> 'CANCELED' GROUP BY "moldingTaskId"
      ), cleaning_pending AS (
        SELECT "moldingTaskId", MIN("availableAt") AS "earliestAvailableAt"
        FROM "CleaningBatch" WHERE "status" <> 'CANCELED' AND "remainingQuantity" > 0 GROUP BY "moldingTaskId"
      ), blanks AS (
        SELECT "moldingTaskId", SUM("quantity") AS "blankOutputQuantity"
        FROM "BlankOutputBatch" WHERE "status" <> 'CANCELED' GROUP BY "moldingTaskId"
      ), open_pouring AS (
        SELECT "moldingTaskId", COUNT(*) AS "openCount"
        FROM "PouringMoldBatch" WHERE "status" <> 'CANCELED' AND "remainingQuantity" > 0 GROUP BY "moldingTaskId"
      ), derived AS (
        SELECT mt."id", mt."status", mt."code", mt."workOrderId", mt."workOrderCodeSnapshot", mt."productCodeSnapshot", mt."productNameSnapshot", mt."createdAt",
          COALESCE(shake."shakeOriginal", 0)::int AS "shakeOriginal",
          COALESCE(shake."shakeRemaining", 0)::int AS "shakeRemaining",
          COALESCE(cleaning."cleaningOriginal", 0)::int AS "cleaningOriginal",
          COALESCE(cleaning."cleaningRemaining", 0)::int AS "cleaningRemaining",
          COALESCE(blanks."blankOutputQuantity", 0)::int AS "blankOutputQuantity",
          shake_pending."earliestPouredAt",
          COALESCE(shake_all."firstPouredAt", mt."createdAt") AS "stableSortAt",
          (EXTRACT(EPOCH FROM COALESCE(shake_all."firstPouredAt", mt."createdAt")) * 1000000)::bigint AS "stableSortKey",
          (EXTRACT(EPOCH FROM mt."createdAt") * 1000000)::bigint AS "createdAtKey",
          COALESCE(shake_pending."earliestPouredAt", cleaning_pending."earliestAvailableAt", mt."createdAt") AS "sortAt",
          (mt."status" = 'COMPLETED' AND COALESCE(open_pouring."openCount", 0) = 0) AS "upstreamComplete"
        FROM "MoldingTask" mt
        LEFT JOIN shake ON shake."moldingTaskId" = mt."id"
        LEFT JOIN shake_all ON shake_all."moldingTaskId" = mt."id"
        LEFT JOIN shake_pending ON shake_pending."moldingTaskId" = mt."id"
        LEFT JOIN cleaning ON cleaning."moldingTaskId" = mt."id"
        LEFT JOIN cleaning_pending ON cleaning_pending."moldingTaskId" = mt."id"
        LEFT JOIN blanks ON blanks."moldingTaskId" = mt."id"
        LEFT JOIN open_pouring ON open_pouring."moldingTaskId" = mt."id"
        WHERE (shake."moldingTaskId" IS NOT NULL OR cleaning."moldingTaskId" IS NOT NULL)
        ${visibleFilter} ${workOrderFilter} ${keywordFilter}
      ), filtered AS (
        SELECT derived.*,
          CASE
            WHEN "shakeRemaining" > 0 AND "shakeRemaining" < "shakeOriginal" THEN 'SHAKING'
            WHEN "shakeRemaining" > 0 THEN 'WAITING_SHAKE'
            WHEN "cleaningRemaining" > 0 AND "cleaningRemaining" < "cleaningOriginal" THEN 'CLEANING'
            WHEN "cleaningRemaining" > 0 THEN 'WAITING_CLEANING'
            WHEN "upstreamComplete" THEN 'COMPLETED'
            ELSE 'WAITING_POURING'
          END AS "executionStatus"
        FROM derived
      ), status_filtered AS (
        SELECT * FROM filtered ${statusFilter}
      ), counted AS (
        SELECT status_filtered.*, COUNT(*) OVER()::int AS "total"
        FROM status_filtered
      )
    `
    const pageRows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      ${queryCte}
      SELECT counted.*
      FROM counted ${cursorFilter}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${cursor ? 0 : (page - 1) * pageSize}
    `)
    const total = pageRows.length ? Number(pageRows[0].total || 0) : Number((await this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`${queryCte} SELECT COUNT(*)::int AS total FROM counted`))[0]?.total || 0)
    const pageIds = pageRows.map((item) => String(item.id))
    if (!pageIds.length) return { records: [], total, page, pageSize, nextCursor: null }
    const pageTasks = await this.prisma.moldingTask.findMany({ where: { id: { in: pageIds } }, include: {
      shakeBatches: { where: { status: { not: 'CANCELED' } }, orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }] },
      cleaningBatches: { where: { status: { not: 'CANCELED' } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] },
    } })
    const pageTaskById = new Map(pageTasks.map((task) => [task.id, task]))
    const records = pageRows.map((summary) => {
      const summaryId = String(summary.id)
      const task = pageTaskById.get(summaryId)
      const pendingShake = task?.shakeBatches.find((item) => item.remainingQuantity > 0)
      const coolingState = pendingShake ? calculateCoolingState(pendingShake.pouredAt, new Date(), pendingShake.coolingDurationMinutesSnapshot) : null
      return {
        id: summaryId, code: String(summary.code), workOrderId: String(summary.workOrderId), workOrderCode: String(summary.workOrderCodeSnapshot),
        productCode: summary.productCodeSnapshot, productName: summary.productNameSnapshot,
        operationName: task?.shakeBatches[0]?.shakeOperationNameSnapshot || task?.cleaningBatches[0]?.shakeOperationNameSnapshot || '落砂清理',
        earliestPouredAt: summary.earliestPouredAt,
        cooling: coolingState ? { earlyShake: coolingState.early, remainingCoolingMinutes: coolingState.remainingMinutes, requiredCoolingMinutes: coolingState.requiredMinutes, actualCoolingMinutes: coolingState.actualMinutes } : null,
        shakeOriginal: Number(summary.shakeOriginal || 0), shakeRemaining: Number(summary.shakeRemaining || 0), cleaningOriginal: Number(summary.cleaningOriginal || 0), cleaningRemaining: Number(summary.cleaningRemaining || 0),
        upstreamComplete: Boolean(summary.upstreamComplete), executionStatus: String(summary.executionStatus), blankOutputQuantity: Number(summary.blankOutputQuantity || 0),
        allowedActions: {
          shakeReport: ['WAITING_SHAKE', 'SHAKING'].includes(String(summary.executionStatus)) && this.permission(request, mobile, 'shake_report'),
          cleanReport: ['WAITING_CLEANING', 'CLEANING'].includes(String(summary.executionStatus)) && this.permission(request, mobile, 'clean_report'),
          reverse: this.permission(request, mobile, 'reverse'),
        },
      }
    })
    const last = pageRows[pageRows.length - 1]
    const nextCursor = pageRows.length === pageSize ? this.encodeListCursor({ stableSortKey: last.stableSortKey, createdAtKey: last.createdAtKey, id: String(last.id) }) : null
    return { records, total, page, pageSize, nextCursor }
  }

  private batchVersions(value: unknown) {
    if (!Array.isArray(value)) throw new BadRequestException('请提交批次版本')
    const result = value.map((item) => {
      const row = record(item)
      return { id: text(row.id, '批次', true), versionNo: integer(row.versionNo, '批次版本', 1) }
    })
    if (new Set(result.map((item) => item.id)).size !== result.length) throw new BadRequestException('批次版本不能重复')
    return result
  }

  private defects(value: unknown): ShakeCleanDefectInput[] {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new BadRequestException('缺陷明细格式不正确')
    const defects = value.map((item) => {
      const row = record(item)
      return { defectCode: text(row.defectCode, '缺陷代码', true), quantity: integer(row.quantity, '缺陷数量', 1), remark: text(row.remark, '缺陷备注') || undefined }
    })
    if (new Set(defects.map((item) => item.defectCode)).size !== defects.length) throw new BadRequestException('同一缺陷不能重复')
    return defects
  }

  private parseCheck(value: CheckShakeBody | unknown) {
    const body = record(value)
    return { moldingTaskId: text(body.moldingTaskId, '造型派工单', true), quantity: integer(body.quantity, '落砂数量', 1), checkedAt: dateValue(body.checkedAt, '检查时间') }
  }

  private async shakeCheck(client: DatabaseClient, input: ReturnType<ShakeCleanService['parseCheck']>) {
    await this.assertHistoryBackfilled(client, input.moldingTaskId)
    const batches = await client.shakeBatch.findMany({
      where: { moldingTaskId: input.moldingTaskId, status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } },
      orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }],
    })
    if (!batches.length) throw new BadRequestException('当前没有待落砂批次')
    let allocations
    try {
      allocations = allocateQueueBatches(input.quantity, batches.map((item) => ({ id: item.id, remainingQuantity: item.remainingQuantity, availableAt: item.pouredAt })))
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '待落砂数量不足')
    }
    const byId = new Map(batches.map((item) => [item.id, item]))
    const cooling = allocations.map((item) => {
      const batch = byId.get(item.batchId)!
      return { batchId: batch.id, quantity: item.quantity, ...calculateCoolingState(batch.pouredAt, input.checkedAt, batch.coolingDurationMinutesSnapshot) }
    })
    return {
      code: cooling.some((item) => item.early) ? 'EARLY_SHAKE' : 'READY',
      earlyShake: cooling.some((item) => item.early),
      requiredCoolingMinutes: Math.max(...cooling.map((item) => item.requiredMinutes)),
      actualCoolingMinutes: Math.min(...cooling.map((item) => item.actualMinutes)),
      remainingCoolingMinutes: Math.max(...cooling.map((item) => item.remainingMinutes)),
      allocations: cooling,
    }
  }

  async checkShake(request: RequestWithAdmin, value: CheckShakeBody | unknown, _mobile = false) {
    const input = this.parseCheck(value)
    await this.assertVisible(request, input.moldingTaskId)
    return this.shakeCheck(this.prisma, input)
  }

  private async equipment(client: DatabaseClient, nodeId: string, code: string, phase: Phase) {
    const equipment = await client.furnace.findFirst({
      where: { code, status: '启用', routingNodeLinks: { some: { routingNodeId: nodeId } } },
    })
    const allowedTypes = phase === 'SHAKE' ? ['落砂'] : CLEANING_TYPES
    if (!equipment || !allowedTypes.includes(equipment.equipmentType)) {
      throw new BadRequestException(phase === 'SHAKE' ? '请选择已绑定当前工序的启用落砂设备' : '请选择已绑定当前工序的启用清理设备')
    }
    return equipment
  }

  private async validDefects(client: DatabaseClient, nodeId: string, scrapQty: number, inputs: ShakeCleanDefectInput[]) {
    if (scrapQty === 0 && inputs.length > 0) throw new BadRequestException('废品数量为 0 时不能提交缺陷明细')
    if (scrapQty > 0 && !inputs.length) throw new BadRequestException('存在废品时必须选择缺陷原因')
    if (inputs.reduce((sum, item) => sum + item.quantity, 0) !== scrapQty) throw new BadRequestException('缺陷数量合计必须等于废品数量')
    if (!inputs.length) return []
    const nodeExists = await client.processRoutingNode.findUnique({ where: { id: nodeId }, select: { id: true } })
    if (!nodeExists) throw new BadRequestException('工艺节点不存在')
    const rows = await client.defectCode.findMany({
      where: { code: { in: inputs.map((item) => item.defectCode) }, status: '启用', operations: { some: { operationCode: 'OP-SHAKE' } } },
    })
    if (rows.length !== inputs.length) throw new BadRequestException('存在未启用或未绑定落砂清理工序的缺陷')
    const inputByCode = new Map(inputs.map((item) => [item.defectCode, item]))
    return rows.map((row) => ({ row, input: inputByCode.get(row.code)! }))
  }

  private assertVersions(allocations: Array<{ batchId: string }>, batches: Array<{ id: string; versionNo: number }>, versions: ShakeCleanBatchVersionInput[]) {
    const submitted = new Map(versions.map((item) => [item.id, item.versionNo]))
    const current = new Map(batches.map((item) => [item.id, item.versionNo]))
    for (const allocation of allocations) {
      if (submitted.get(allocation.batchId) !== current.get(allocation.batchId)) throw new ConflictException('批次数据已更新，请刷新后重试')
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

  async options(request: RequestWithAdmin, moldingTaskId: string, mobile = false) {
    await this.assertVisible(request, moldingTaskId)
    await this.assertHistoryBackfilled(this.prisma, moldingTaskId)
    const task = await this.taskRecord(this.prisma, moldingTaskId)
    if (!task || (!task.shakeBatches.length && !task.cleaningBatches.length)) throw new NotFoundException('落砂清理任务不存在')
    const nodeId = task.shakeBatches[0]?.shakeRoutingNodeId || task.cleaningBatches[0]?.shakeRoutingNodeId
    const node = await this.prisma.processRoutingNode.findUnique({ where: { id: nodeId }, include: { equipmentLinks: { include: { equipment: true } } } })
    if (!node) throw new NotFoundException('落砂清理工艺节点不存在')
    const pendingShake = task.shakeBatches.filter((item) => item.remainingQuantity > 0)
    const check = pendingShake.length ? await this.shakeCheck(this.prisma, { moldingTaskId, quantity: 1, checkedAt: new Date() }) : null
    const status = this.taskStatus(task)
    return {
      moldingTaskId,
      moldingTaskCode: task.code,
      workOrderId: task.workOrderId,
      workOrderCode: task.workOrderCodeSnapshot,
      productCode: task.productCodeSnapshot,
      productName: task.productNameSnapshot,
      ...status,
      cooling: check,
      shakeBatchVersions: pendingShake.map((item) => ({ id: item.id, versionNo: item.versionNo, remainingQuantity: item.remainingQuantity, pouredAt: item.pouredAt })),
      cleaningBatchVersions: task.cleaningBatches.filter((item) => item.remainingQuantity > 0).map((item) => ({ id: item.id, versionNo: item.versionNo, remainingQuantity: item.remainingQuantity, availableAt: item.availableAt })),
      shakeEquipment: node.equipmentLinks.map((item) => item.equipment).filter((item) => item.status === '启用' && item.equipmentType === '落砂').map((item) => ({ code: item.code, name: item.name, equipmentType: item.equipmentType })),
      cleaningEquipment: node.equipmentLinks.map((item) => item.equipment).filter((item) => item.status === '启用' && CLEANING_TYPES.includes(item.equipmentType)).map((item) => ({ code: item.code, name: item.name, equipmentType: item.equipmentType })),
      allowedActions: {
        shakeReport: status.shakeRemaining > 0 && this.permission(request, mobile, 'shake_report'),
        cleanReport: status.cleaningRemaining > 0 && this.permission(request, mobile, 'clean_report'),
        reverse: this.permission(request, mobile, 'reverse'),
      },
    }
  }

  async defectOptions(request: RequestWithAdmin, moldingTaskId: string, _mobile = false) {
    await this.assertVisible(request, moldingTaskId)
    const batch = await this.prisma.shakeBatch.findFirst({ where: { moldingTaskId, status: { not: 'CANCELED' } }, orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }] })
    if (!batch) return []
    const nodeExists = await this.prisma.processRoutingNode.findUnique({ where: { id: batch.shakeRoutingNodeId }, select: { id: true } })
    if (!nodeExists) return []
    return this.prisma.defectCode.findMany({
      where: { status: '启用', operations: { some: { operationCode: 'OP-SHAKE' } } },
      orderBy: { code: 'asc' },
    })
  }

  private parseShake(value: ReportShakeBody | unknown) {
    const body = record(value)
    return {
      moldingTaskId: text(body.moldingTaskId, '造型派工单', true),
      requestId: text(body.requestId, '请求标识', true),
      stationEquipmentCode: text(body.stationEquipmentCode, '落砂设备', true),
      goodQty: integer(body.goodQty, '落砂合格数'),
      scrapQty: integer(body.scrapQty, '落砂废品数'),
      batchVersions: this.batchVersions(body.batchVersions),
      confirmedEarlyShake: body.confirmedEarlyShake === true,
      defects: this.defects(body.defects),
      remark: text(body.remark, '备注') || null,
    }
  }

  async reportShake(request: RequestWithAdmin, value: ReportShakeBody | unknown, _mobile = false) {
    const input = this.parseShake(value)
    await this.assertVisible(request, input.moldingTaskId)
    const user = getAdminContext(request)
    const id = await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', input.moldingTaskId)
      await this.assertHistoryBackfilled(tx, input.moldingTaskId)
      const references = await tx.shakeBatch.findMany({ where: { moldingTaskId: input.moldingTaskId, status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, select: { id: true }, orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }] })
      for (const item of references) await this.lock(tx, 'ShakeBatch', item.id)
      const existing = await tx.shakeReport.findUnique({ where: { moldingTaskId_requestId: { moldingTaskId: input.moldingTaskId, requestId: input.requestId } } })
      if (existing) return existing.id
      const batches = await tx.shakeBatch.findMany({ where: { moldingTaskId: input.moldingTaskId, status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }] })
      if (!batches.length) throw new BadRequestException('当前没有待落砂批次')
      const total = input.goodQty + input.scrapQty
      if (total <= 0) throw new BadRequestException('本次落砂数量必须大于 0')
      let allocations
      try {
        allocations = allocateQueueBatches(total, batches.map((item) => ({ id: item.id, remainingQuantity: item.remainingQuantity, availableAt: item.pouredAt })))
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : '待落砂数量不足')
      }
      this.assertVersions(allocations, batches, input.batchVersions)
      const nodeId = batches[0].shakeRoutingNodeId
      if (batches.some((item) => item.shakeRoutingNodeId !== nodeId)) throw new BadRequestException('当前任务存在多个落砂清理节点，请拆分处理')
      const [station, defects] = await Promise.all([
        this.equipment(tx, nodeId, input.stationEquipmentCode, 'SHAKE'),
        this.validDefects(tx, nodeId, input.scrapQty, input.defects),
      ])
      const checkedAt = new Date()
      const byId = new Map(batches.map((item) => [item.id, item]))
      const coolingRows = allocations.map((allocation) => {
        const batch = byId.get(allocation.batchId)!
        return { ...allocation, ...calculateCoolingState(batch.pouredAt, checkedAt, batch.coolingDurationMinutesSnapshot) }
      })
      if (coolingRows.some((item) => item.early) && !input.confirmedEarlyShake) throw new ConflictException('EARLY_SHAKE: 冷却未到期，请确认风险后提交')
      const first = batches[0]
      const report = await tx.shakeReport.create({
        data: {
          code: await this.nextCode(tx, 'SHAKE_REPORT', 'SR'), requestId: input.requestId,
          moldingTaskId: input.moldingTaskId, workOrderId: first.workOrderId, shakeRoutingNodeId: nodeId,
          stationEquipmentCode: station.code, workOrderCodeSnapshot: first.workOrderCodeSnapshot,
          productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot,
          shakeOperationCodeSnapshot: first.shakeOperationCodeSnapshot, shakeOperationNameSnapshot: first.shakeOperationNameSnapshot,
          stationEquipmentNameSnapshot: station.name, operatorUserId: user.id, operatorNameSnapshot: user.name,
          goodQty: input.goodQty, scrapQty: input.scrapQty,
          requiredCoolingMinutesSnapshot: Math.max(...coolingRows.map((item) => item.requiredMinutes)),
          actualCoolingMinutesSnapshot: Math.min(...coolingRows.map((item) => item.actualMinutes)),
          earlyShake: coolingRows.some((item) => item.early), remark: input.remark, reportedAt: checkedAt,
          defects: { create: defects.map(({ row, input: defect }) => ({ defectCodeId: row.id, defectCodeSnapshot: row.code, defectNameSnapshot: row.name, quantity: defect.quantity, remark: defect.remark || null })) },
        },
      })
      for (const allocation of coolingRows) {
        const batch = byId.get(allocation.batchId)!
        const after = batch.remainingQuantity - allocation.quantity
        await tx.shakeBatch.update({ where: { id: batch.id }, data: { remainingQuantity: after, status: after === 0 ? 'CONSUMED' : 'PARTIAL', versionNo: { increment: 1 } } })
        await tx.shakeBatchConsumption.create({ data: {
          shakeReportId: report.id, shakeBatchId: batch.id, quantity: allocation.quantity,
          quantityBefore: batch.remainingQuantity, quantityAfter: after,
          requiredCoolingMinutesSnapshot: allocation.requiredMinutes,
          actualCoolingMinutesSnapshot: allocation.actualMinutes,
          earlyShake: allocation.early,
        } })
      }
      if (input.goodQty > 0) {
        await tx.cleaningBatch.create({ data: {
          sourceShakeReportId: report.id, moldingTaskId: input.moldingTaskId, workOrderId: first.workOrderId,
          routingVersionId: first.routingVersionId, shakeRoutingNodeId: nodeId,
          workOrderCodeSnapshot: first.workOrderCodeSnapshot, productCodeSnapshot: first.productCodeSnapshot,
          productNameSnapshot: first.productNameSnapshot, shakeOperationCodeSnapshot: first.shakeOperationCodeSnapshot,
          shakeOperationNameSnapshot: first.shakeOperationNameSnapshot, originalQuantity: input.goodQty,
          remainingQuantity: input.goodQty, availableAt: checkedAt,
        } })
      }
      return report.id
    })
    return this.shakeReport(request, id)
  }

  private parseCleaning(value: ReportCleaningBody | unknown) {
    const body = record(value)
    return {
      moldingTaskId: text(body.moldingTaskId, '造型派工单', true), requestId: text(body.requestId, '请求标识', true),
      stationEquipmentCode: text(body.stationEquipmentCode, '清理设备', true), goodQty: integer(body.goodQty, '清理合格数'),
      scrapQty: integer(body.scrapQty, '清理废品数'), riseringScrapWeightKg: nonNegativeNumber(body.riseringScrapWeightKg, '切割浇冒口重量'),
      batchVersions: this.batchVersions(body.batchVersions), defects: this.defects(body.defects), remark: text(body.remark, '备注') || null,
    }
  }

  private async nextNode(client: DatabaseClient, routingVersionId: string, nodeId: string) {
    const edges = await client.processRoutingEdge.findMany({
      where: { routingVersionId, sourceNodeId: nodeId }, include: { targetNode: { include: { operation: true } } }, orderBy: { targetNodeId: 'asc' },
    })
    if (edges.length > 1) throw new BadRequestException('落砂清理工序存在多个后续节点，请先修正工艺路线')
    if (edges[0] && edges[0].targetNode.routingVersionId !== routingVersionId) throw new BadRequestException('落砂清理后续节点不属于工单锁定路线版本')
    return edges[0]?.targetNode || null
  }

  async reportCleaning(request: RequestWithAdmin, value: ReportCleaningBody | unknown, _mobile = false) {
    const input = this.parseCleaning(value)
    await this.assertVisible(request, input.moldingTaskId)
    const user = getAdminContext(request)
    const id = await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', input.moldingTaskId)
      const references = await tx.cleaningBatch.findMany({ where: { moldingTaskId: input.moldingTaskId, status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, select: { id: true }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] })
      for (const item of references) await this.lock(tx, 'CleaningBatch', item.id)
      const existing = await tx.cleaningReport.findUnique({ where: { moldingTaskId_requestId: { moldingTaskId: input.moldingTaskId, requestId: input.requestId } } })
      if (existing) return existing.id
      const batches = await tx.cleaningBatch.findMany({ where: { moldingTaskId: input.moldingTaskId, status: { in: ['WAITING', 'PARTIAL'] }, remainingQuantity: { gt: 0 } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] })
      if (!batches.length) throw new BadRequestException('当前没有待清理批次')
      const total = input.goodQty + input.scrapQty
      if (total <= 0) throw new BadRequestException('本次清理数量必须大于 0')
      let allocations
      try {
        allocations = allocateQueueBatches(total, batches.map((item) => ({ id: item.id, remainingQuantity: item.remainingQuantity, availableAt: item.availableAt })))
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : '待清理数量不足')
      }
      this.assertVersions(allocations, batches, input.batchVersions)
      const nodeId = batches[0].shakeRoutingNodeId
      if (batches.some((item) => item.shakeRoutingNodeId !== nodeId)) throw new BadRequestException('当前任务存在多个落砂清理节点，请拆分处理')
      const [station, defects, nextNode] = await Promise.all([
        this.equipment(tx, nodeId, input.stationEquipmentCode, 'CLEANING'),
        this.validDefects(tx, nodeId, input.scrapQty, input.defects),
        this.nextNode(tx, batches[0].routingVersionId, nodeId),
      ])
      const first = batches[0]
      const report = await tx.cleaningReport.create({ data: {
        code: await this.nextCode(tx, 'CLEANING_REPORT', 'CR'), requestId: input.requestId,
        moldingTaskId: input.moldingTaskId, workOrderId: first.workOrderId, shakeRoutingNodeId: nodeId,
        stationEquipmentCode: station.code, workOrderCodeSnapshot: first.workOrderCodeSnapshot,
        productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot,
        shakeOperationCodeSnapshot: first.shakeOperationCodeSnapshot, shakeOperationNameSnapshot: first.shakeOperationNameSnapshot,
        stationEquipmentNameSnapshot: station.name, operatorUserId: user.id, operatorNameSnapshot: user.name,
        goodQty: input.goodQty, scrapQty: input.scrapQty, riseringScrapWeightKg: input.riseringScrapWeightKg,
        remark: input.remark, defects: { create: defects.map(({ row, input: defect }) => ({ defectCodeId: row.id, defectCodeSnapshot: row.code, defectNameSnapshot: row.name, quantity: defect.quantity, remark: defect.remark || null })) },
      } })
      const byId = new Map(batches.map((item) => [item.id, item]))
      for (const allocation of allocations) {
        const batch = byId.get(allocation.batchId)!
        const after = batch.remainingQuantity - allocation.quantity
        await tx.cleaningBatch.update({ where: { id: batch.id }, data: { remainingQuantity: after, status: after === 0 ? 'CONSUMED' : 'PARTIAL', versionNo: { increment: 1 } } })
        await tx.cleaningBatchConsumption.create({ data: { cleaningReportId: report.id, cleaningBatchId: batch.id, quantity: allocation.quantity, quantityBefore: batch.remainingQuantity, quantityAfter: after } })
      }
      if (input.goodQty > 0) {
        const blankOutput = await tx.blankOutputBatch.create({ data: {
          code: `${report.code}-BLANK`, sourceCleaningReportId: report.id, moldingTaskId: input.moldingTaskId,
          workOrderId: first.workOrderId, routingVersionId: first.routingVersionId, shakeRoutingNodeId: nodeId,
          nextRoutingNodeId: nextNode?.id || null, workOrderCodeSnapshot: first.workOrderCodeSnapshot,
          productCodeSnapshot: first.productCodeSnapshot, productNameSnapshot: first.productNameSnapshot,
          shakeOperationCodeSnapshot: first.shakeOperationCodeSnapshot, shakeOperationNameSnapshot: first.shakeOperationNameSnapshot,
          nextOperationCodeSnapshot: nextNode?.operationCode || null, nextOperationNameSnapshot: nextNode?.operation.name || null,
          quantity: input.goodQty, status: nextNode ? 'WAITING_NEXT_OPERATION' : 'WAITING_WAREHOUSE',
        } })
        await ensureInspectionBatchForBlankOutput(tx, blankOutput.id)
      }
      return report.id
    })
    return this.cleaningReport(request, id)
  }

  private async shakeReport(request: RequestWithAdmin, id: string) {
    const report = await this.prisma.shakeReport.findUnique({ where: { id }, include: { consumptions: true, defects: true, sourceCleaningBatch: true } })
    if (!report) throw new NotFoundException('落砂报工不存在')
    await this.assertVisible(request, report.moldingTaskId)
    return report
  }

  private async cleaningReport(request: RequestWithAdmin, id: string) {
    const report = await this.prisma.cleaningReport.findUnique({ where: { id }, include: { consumptions: true, defects: true, blankOutput: true } })
    if (!report) throw new NotFoundException('清理报工不存在')
    await this.assertVisible(request, report.moldingTaskId)
    return { ...report, riseringScrapWeightKg: Number(report.riseringScrapWeightKg) }
  }

  async reports(request: RequestWithAdmin, moldingTaskId: string, _mobile = false) {
    await this.assertVisible(request, moldingTaskId)
    const [shakeReports, cleaningReports] = await Promise.all([
      this.prisma.shakeReport.findMany({ where: { moldingTaskId }, include: { consumptions: true, defects: true }, orderBy: { reportedAt: 'desc' } }),
      this.prisma.cleaningReport.findMany({ where: { moldingTaskId }, include: { consumptions: true, defects: true }, orderBy: { reportedAt: 'desc' } }),
    ])
    return { shakeReports, cleaningReports: cleaningReports.map((item) => ({ ...item, riseringScrapWeightKg: Number(item.riseringScrapWeightKg) })) }
  }

  async trace(request: RequestWithAdmin, moldingTaskId: string, _mobile = false) {
    await this.assertVisible(request, moldingTaskId)
    const task = await this.prisma.moldingTask.findUnique({ where: { id: moldingTaskId }, include: {
      shakeBatches: { include: { sourcePouringReport: true, consumptions: { include: { shakeReport: true } } }, orderBy: [{ pouredAt: 'asc' }, { id: 'asc' }] },
      cleaningBatches: { include: { sourceShakeReport: true, consumptions: { include: { cleaningReport: true } } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] },
      blankOutputBatches: { include: { sourceCleaningReport: true, nextRoutingNode: { include: { operation: true } } }, orderBy: { createdAt: 'asc' } },
    } })
    if (!task) throw new NotFoundException('落砂清理任务不存在')
    return { shakeBatches: task.shakeBatches, cleaningBatches: task.cleaningBatches, blankOutputBatches: task.blankOutputBatches }
  }

  private reverseBody(value: ReverseShakeCleanReportBody | unknown) {
    const body = record(value)
    return { versionNo: integer(body.versionNo, '报工版本', 1), reason: text(body.reason, '撤销原因', true) }
  }

  async reverseCleaning(request: RequestWithAdmin, id: string, value: ReverseShakeCleanReportBody | unknown) {
    const input = this.reverseBody(value)
    const reference = await this.prisma.cleaningReport.findUnique({ where: { id }, select: { moldingTaskId: true } })
    if (!reference) throw new NotFoundException('清理报工不存在')
    await this.assertVisible(request, reference.moldingTaskId)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', reference.moldingTaskId)
      await this.lock(tx, 'CleaningReport', id)
      const report = await tx.cleaningReport.findUnique({ where: { id }, include: { consumptions: true, blankOutput: true } })
      if (!report) throw new NotFoundException('清理报工不存在')
      if (report.status === 'REVERSED') throw new BadRequestException('该清理报工已经撤销')
      if (report.versionNo !== input.versionNo) throw new ConflictException('清理报工已更新，请刷新后重试')
      for (const consumption of report.consumptions) {
        await this.lock(tx, 'CleaningBatch', consumption.cleaningBatchId)
        const batch = await tx.cleaningBatch.findUniqueOrThrow({ where: { id: consumption.cleaningBatchId } })
        const remaining = batch.remainingQuantity + consumption.quantity
        await tx.cleaningBatch.update({ where: { id: batch.id }, data: { remainingQuantity: remaining, status: remaining >= batch.originalQuantity ? 'WAITING' : 'PARTIAL', versionNo: { increment: 1 } } })
      }
      if (report.blankOutput && report.blankOutput.status !== 'CANCELED') await tx.blankOutputBatch.update({ where: { id: report.blankOutput.id }, data: { status: 'CANCELED', versionNo: { increment: 1 } } })
      await tx.cleaningReport.update({ where: { id }, data: { status: 'REVERSED', reverseReason: input.reason, reversedByUserId: user.id, reversedByNameSnapshot: user.name, reversedAt: new Date(), versionNo: { increment: 1 } } })
    })
    return this.cleaningReport(request, id)
  }

  async reverseShake(request: RequestWithAdmin, id: string, value: ReverseShakeCleanReportBody | unknown) {
    const input = this.reverseBody(value)
    const reference = await this.prisma.shakeReport.findUnique({ where: { id }, select: { moldingTaskId: true } })
    if (!reference) throw new NotFoundException('落砂报工不存在')
    await this.assertVisible(request, reference.moldingTaskId)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', reference.moldingTaskId)
      await this.lock(tx, 'ShakeReport', id)
      let report = await tx.shakeReport.findUnique({ where: { id }, include: { consumptions: true, sourceCleaningBatch: true } })
      if (!report) throw new NotFoundException('落砂报工不存在')
      if (report.status === 'REVERSED') throw new BadRequestException('该落砂报工已经撤销')
      if (report.versionNo !== input.versionNo) throw new ConflictException('落砂报工已更新，请刷新后重试')
      if (report.sourceCleaningBatch) {
        await this.lock(tx, 'CleaningBatch', report.sourceCleaningBatch.id)
        const lockedCleaningBatch = await tx.cleaningBatch.findUniqueOrThrow({
          where: { id: report.sourceCleaningBatch.id },
          include: { consumptions: { where: { cleaningReport: { status: 'ACTIVE' } }, select: { id: true } } },
        })
        if (lockedCleaningBatch.consumptions.length) throw new BadRequestException('该落砂报工已进入清理追溯，请先撤销清理报工')
        if (lockedCleaningBatch.status !== 'CANCELED') {
          await tx.cleaningBatch.update({ where: { id: lockedCleaningBatch.id }, data: { status: 'CANCELED', versionNo: { increment: 1 } } })
        }
      }
      for (const consumption of report.consumptions) {
        await this.lock(tx, 'ShakeBatch', consumption.shakeBatchId)
        const batch = await tx.shakeBatch.findUniqueOrThrow({ where: { id: consumption.shakeBatchId } })
        const remaining = batch.remainingQuantity + consumption.quantity
        await tx.shakeBatch.update({ where: { id: batch.id }, data: { remainingQuantity: remaining, status: remaining >= batch.originalQuantity ? 'WAITING' : 'PARTIAL', versionNo: { increment: 1 } } })
      }
      await tx.shakeReport.update({ where: { id }, data: { status: 'REVERSED', reverseReason: input.reason, reversedByUserId: user.id, reversedByNameSnapshot: user.name, reversedAt: new Date(), versionNo: { increment: 1 } } })
    })
    return this.shakeReport(request, id)
  }
}
