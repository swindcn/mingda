import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from './prisma/prisma.service'
import {
  getAdminContext,
  upsertOwnership,
  visibleOwnershipEntityIds,
  type RequestWithAdmin,
} from './shared/admin-context'
import { AdminAuthGuard } from './shared/admin-auth.guard'
import { ModelingPermissionGuard } from './shared/modeling-permission.guard'

interface BomItemBody {
  itemCode?: string
  standardQuantity?: number
  unit?: string
  lossRate?: number
  remark?: string
}

interface BomCoreBoxBody {
  coreBoxCode?: string
  quantityPerProduct?: number
}

interface BomBody {
  productCode?: string
  materialGradeCode?: string
  moldCodes?: string[]
  coreBoxCodes?: string[]
  coreBoxes?: BomCoreBoxBody[]
  netWeightKg?: number
  grossWeightKg?: number
  items?: BomItemBody[]
  remark?: string
}

const allowedPhysicalItemTypes = ['半成品', '铸造辅材', '工装耗材']

@Controller('admin/modeling/boms')
@UseGuards(AdminAuthGuard, ModelingPermissionGuard)
export class CastingBomController {
  constructor(private readonly prisma: PrismaService) {}

  private include() {
    return {
      bom: { include: { product: true } },
      materialGrade: true,
      createdBy: { select: { id: true, name: true } },
      items: { include: { item: true }, orderBy: { createdAt: 'asc' as const } },
      molds: { include: { mold: { include: { item: true } } }, orderBy: { createdAt: 'asc' as const } },
      coreBoxes: { include: { coreBox: true }, orderBy: { createdAt: 'asc' as const } },
    }
  }

  private decimal(value: unknown) {
    return Number(value || 0)
  }

  private dto(record: Prisma.CastingBomVersionGetPayload<{ include: ReturnType<CastingBomController['include']> }>) {
    return {
      id: record.id,
      bomId: record.bomId,
      bomCode: record.bom.code,
      productCode: record.bom.productCode,
      productName: record.productNameSnapshot || record.bom.product.name,
      materialGradeCode: record.materialGradeCode,
      materialGradeName: record.materialGrade.name,
      netWeightKg: this.decimal(record.netWeightKg),
      grossWeightKg: this.decimal(record.grossWeightKg),
      yieldRate: this.decimal(record.yieldRate),
      returnWeightKg: this.decimal(record.returnWeightKg),
      version: record.version,
      status: record.status,
      sourceVersionId: record.sourceVersionId || undefined,
      createdByUserId: record.createdByUserId || undefined,
      createdByName: record.createdBy?.name || '',
      remark: record.remark || '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      moldCodes: record.molds.map((item) => item.moldCode),
      coreBoxCodes: record.coreBoxes.map((item) => item.coreBoxCode),
      molds: record.molds.map((item) => ({
        code: item.moldCode,
        name: item.moldNameSnapshot || item.mold.name,
        itemCode: item.mold.itemCode,
        itemName: item.mold.item.name,
      })),
      coreBoxes: record.coreBoxes.map((item) => ({
        code: item.coreBoxCode,
        name: item.coreBoxNameSnapshot || item.coreBox.name,
        moldCode: item.moldCodeSnapshot || item.coreBox.moldCode,
        quantityPerProduct: this.decimal(item.quantityPerProduct),
      })),
      items: record.items.map((item) => ({
        id: item.id,
        itemCode: item.itemCode,
        itemName: item.itemNameSnapshot || item.item.name,
        itemType: item.itemTypeSnapshot || item.item.type || '',
        standardQuantity: this.decimal(item.standardQuantity),
        unit: item.unit,
        lossRate: this.decimal(item.lossRate),
        remark: item.remark || '',
      })),
    }
  }

  private isAllowedPhysicalType(type?: string | null) {
    const value = String(type || '')
    return allowedPhysicalItemTypes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))
  }

  private nextVersion(versions: string[]) {
    const max = versions.reduce((current, version) => {
      const matched = /^V(\d+)\.0$/.exec(version)
      return matched ? Math.max(current, Number(matched[1])) : current
    }, 0)
    return `V${max + 1}.0`
  }

  private async normalize(body: BomBody) {
    const productCode = String(body.productCode || '').trim()
    const materialGradeCode = String(body.materialGradeCode || '').trim()
    const netWeightKg = Number(body.netWeightKg)
    const grossWeightKg = Number(body.grossWeightKg)
    const items = Array.isArray(body.items) ? body.items : []
    const moldCodes = Array.isArray(body.moldCodes) ? body.moldCodes.map((code) => String(code).trim()).filter(Boolean) : []
    const requestedCoreBoxes = Array.isArray(body.coreBoxes)
      ? body.coreBoxes.map((item) => ({
        coreBoxCode: String(item.coreBoxCode || '').trim(),
        quantityPerProduct: item.quantityPerProduct === undefined ? 1 : Number(item.quantityPerProduct),
      }))
      : (Array.isArray(body.coreBoxCodes) ? body.coreBoxCodes : []).map((code) => ({
        coreBoxCode: String(code).trim(),
        quantityPerProduct: 1,
      }))
    const coreBoxCodes = requestedCoreBoxes.map((item) => item.coreBoxCode).filter(Boolean)
    if (!productCode || !materialGradeCode) throw new BadRequestException('请选择产品和材质牌号')
    if (!Number.isFinite(netWeightKg) || netWeightKg <= 0) throw new BadRequestException('毛坯净重必须大于 0')
    if (!Number.isFinite(grossWeightKg) || grossWeightKg < netWeightKg) throw new BadRequestException('浇注毛重必须大于或等于毛坯净重')
    const itemCodes = items.map((item) => String(item.itemCode || '').trim()).filter(Boolean)
    if (itemCodes.length !== items.length) throw new BadRequestException('请选择物理用料')
    if (new Set(itemCodes).size !== itemCodes.length) throw new BadRequestException('同一 BOM 版本不能重复选择物料')
    if (new Set(moldCodes).size !== moldCodes.length) throw new BadRequestException('同一 BOM 版本不能重复选择模具')
    if (new Set(coreBoxCodes).size !== coreBoxCodes.length) throw new BadRequestException('同一 BOM 版本不能重复选择芯盒')
    if (coreBoxCodes.length !== requestedCoreBoxes.length) throw new BadRequestException('请选择芯盒工装')
    if (requestedCoreBoxes.some((item) => !Number.isFinite(item.quantityPerProduct) || item.quantityPerProduct <= 0)) {
      throw new BadRequestException('芯件比必须大于 0')
    }
    items.forEach((item) => {
      const quantity = Number(item.standardQuantity)
      const lossRate = Number(item.lossRate || 0)
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('单件标准用量必须大于 0')
      if (!Number.isFinite(lossRate) || lossRate < 0 || lossRate > 100) throw new BadRequestException('损耗率必须在 0 到 100 之间')
    })
    const [product, grade, itemRecords, moldRecords, coreBoxRecords] = await Promise.all([
      this.prisma.product.findUnique({ where: { code: productCode } }),
      this.prisma.materialGrade.findUnique({ where: { code: materialGradeCode } }),
      this.prisma.product.findMany({ where: { code: { in: itemCodes } } }),
      this.prisma.moldMaster.findMany({ where: { code: { in: moldCodes } } }),
      this.prisma.coreBoxMaster.findMany({ where: { code: { in: coreBoxCodes } } }),
    ])
    if (!product) throw new BadRequestException('产品不存在')
    if (!['成品', '半成品'].some((prefix) => product.type === prefix || product.type?.startsWith(`${prefix}/`))) {
      throw new BadRequestException('BOM 主物料只能选择成品或半成品')
    }
    if (!grade) throw new BadRequestException('材质牌号不存在')
    if (itemRecords.length !== itemCodes.length) throw new BadRequestException('物理用料不存在')
    if (itemRecords.some((item) => !this.isAllowedPhysicalType(item.type))) {
      throw new BadRequestException('物理用料只能选择半成品、铸造辅材或工装耗材')
    }
    if (moldRecords.length !== moldCodes.length) throw new BadRequestException('生产模具不存在')
    if (moldRecords.some((mold) => mold.status !== '启用')) throw new BadRequestException('生产模具已停用')
    if (coreBoxRecords.length !== coreBoxCodes.length) throw new BadRequestException('芯盒工装不存在')
    if (coreBoxRecords.some((coreBox) => coreBox.status !== '启用')) throw new BadRequestException('芯盒工装已停用')
    const selectedMolds = new Set(moldCodes)
    if (coreBoxRecords.some((coreBox) => !selectedMolds.has(coreBox.moldCode))) {
      throw new BadRequestException('芯盒工装必须属于已选生产模具')
    }
    const byCode = new Map(itemRecords.map((item) => [item.code, item]))
    const coreBoxByCode = new Map(coreBoxRecords.map((item) => [item.code, item]))
    return {
      product,
      grade,
      materialGradeCode,
      netWeightKg,
      grossWeightKg,
      yieldRate: netWeightKg / grossWeightKg * 100,
      returnWeightKg: grossWeightKg - netWeightKg,
      remark: String(body.remark || '').trim() || null,
      molds: moldRecords.map((mold) => ({ moldCode: mold.code, moldNameSnapshot: mold.name })),
      coreBoxes: requestedCoreBoxes.map((item) => ({
        coreBoxCode: item.coreBoxCode,
        coreBoxNameSnapshot: coreBoxByCode.get(item.coreBoxCode)!.name,
        moldCodeSnapshot: coreBoxByCode.get(item.coreBoxCode)!.moldCode,
        quantityPerProduct: item.quantityPerProduct,
      })),
      items: items.map((item) => {
        const record = byCode.get(String(item.itemCode))!
        return {
          itemCode: record.code,
          itemNameSnapshot: record.name,
          itemTypeSnapshot: record.type || '',
          standardQuantity: Number(item.standardQuantity),
          unit: String(item.unit || record.unit || '').trim() || '件',
          lossRate: Number(item.lossRate || 0),
          remark: String(item.remark || '').trim() || null,
        }
      }),
    }
  }

  private async assertVisible(request: RequestWithAdmin, id: string) {
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:boms')
    if (visibleIds && !visibleIds.includes(id)) throw new NotFoundException('BOM 版本不存在')
  }

  @Get('options')
  async options() {
    const [products, materials, physicalItems, creators, molds, coreBoxes, activeRecipes] = await Promise.all([
      this.prisma.product.findMany({
        where: { OR: [{ type: { startsWith: '成品' } }, { type: { startsWith: '半成品' } }] },
        orderBy: { code: 'asc' },
      }),
      this.prisma.materialGrade.findMany({ where: { status: '启用' }, orderBy: { code: 'asc' } }),
      this.prisma.product.findMany({
        where: { OR: allowedPhysicalItemTypes.map((type) => ({ type: { startsWith: type } })) },
        orderBy: { code: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { deletedAt: null, status: 'ENABLED', userType: { in: ['EMPLOYEE', 'SUPER_ADMIN'] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.moldMaster.findMany({
        where: { status: '启用' },
        select: { code: true, name: true, itemCode: true, item: { select: { name: true } } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.coreBoxMaster.findMany({ where: { status: '启用' }, select: { code: true, name: true, moldCode: true }, orderBy: { code: 'asc' } }),
      this.prisma.meltRecipe.findMany({
        where: { status: 'ACTIVE' },
        include: { applicableFurnaces: { include: { furnace: true } }, recipeItems: { include: { item: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ])
    return {
      products: products.map((item) => ({ code: item.code, name: item.name, type: item.type || '', materialGradeCode: item.materialGradeCode || '' })),
      materials: materials.map((item) => ({ code: item.code, name: item.name })),
      physicalItems: physicalItems.map((item) => ({ code: item.code, name: item.name, type: item.type || '', unit: item.unit || '' })),
      creators,
      molds: molds.map((item) => ({
        code: item.code,
        name: item.name,
        itemCode: item.itemCode,
        itemName: item.item.name,
      })),
      coreBoxes,
      activeRecipes: activeRecipes.map((recipe) => ({
        code: recipe.code,
        name: recipe.name,
        version: recipe.version,
        materialGradeCode: recipe.materialGradeCode,
        furnaceNames: recipe.applicableFurnaces.map((item) => item.furnace.name),
        items: recipe.recipeItems.map((item) => ({ itemName: item.item.name, ratio: this.decimal(item.ratio), quantity: this.decimal(item.quantity), unit: item.unit || '' })),
      })),
    }
  }

  @Get()
  async list(
    @Req() request: RequestWithAdmin,
    @Query('keyword') keyword?: string,
    @Query('materialGradeCode') materialGradeCode?: string,
    @Query('createdByUserId') createdByUserId?: string,
    @Query('status') status?: string,
  ) {
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:boms')
    const normalizedKeyword = String(keyword || '').trim()
    const records = await this.prisma.castingBomVersion.findMany({
      where: {
        ...(visibleIds ? { id: { in: visibleIds } } : {}),
        ...(materialGradeCode ? { materialGradeCode } : {}),
        ...(createdByUserId ? { createdByUserId } : {}),
        ...(status ? { status } : {}),
        ...(normalizedKeyword ? { bom: { product: { OR: [
          { code: { contains: normalizedKeyword, mode: 'insensitive' } },
          { name: { contains: normalizedKeyword, mode: 'insensitive' } },
        ] } } } : {}),
      },
      include: this.include(),
      orderBy: { updatedAt: 'desc' },
    })
    return records.map((record) => this.dto(record))
  }

  @Get(':id')
  async detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, id)
    const record = await this.prisma.castingBomVersion.findUnique({ where: { id }, include: this.include() })
    if (!record) throw new NotFoundException('BOM 版本不存在')
    return this.dto(record)
  }

  @Post()
  async create(@Req() request: RequestWithAdmin, @Body() body: BomBody) {
    const input = await this.normalize(body)
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casting-bom:${input.product.code}`}))`
      const existing = await tx.castingBom.findUnique({ where: { productCode: input.product.code } })
      if (existing) throw new BadRequestException('该产品已存在 BOM，请从现有版本创建新版本')
      const bom = await tx.castingBom.create({ data: { code: `BOM-${input.product.code}`, productCode: input.product.code } })
      const version = await tx.castingBomVersion.create({
        data: {
          bomId: bom.id,
          version: 'V1.0',
          materialGradeCode: input.materialGradeCode,
          productNameSnapshot: input.product.name,
          netWeightKg: input.netWeightKg,
          grossWeightKg: input.grossWeightKg,
          yieldRate: input.yieldRate,
          returnWeightKg: input.returnWeightKg,
          createdByUserId: getAdminContext(request).id,
          remark: input.remark,
          items: { create: input.items },
          molds: { create: input.molds },
          coreBoxes: { create: input.coreBoxes },
        },
        include: this.include(),
      })
      await upsertOwnership(tx, request.adminUser, 'modeling:boms', version.id)
      return version
    })
    return this.dto(record)
  }

  @Put(':id')
  async update(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: BomBody) {
    await this.assertVisible(request, id)
    const existing = await this.prisma.castingBomVersion.findUnique({ where: { id }, include: { bom: true } })
    if (!existing) throw new NotFoundException('BOM 版本不存在')
    if (existing.status !== 'DRAFT') throw new BadRequestException('仅草稿 BOM 可以编辑')
    const input = await this.normalize({ ...body, productCode: existing.bom.productCode })
    const record = await this.prisma.castingBomVersion.update({
      where: { id },
      data: {
        materialGradeCode: input.materialGradeCode,
        productNameSnapshot: input.product.name,
        netWeightKg: input.netWeightKg,
        grossWeightKg: input.grossWeightKg,
        yieldRate: input.yieldRate,
        returnWeightKg: input.returnWeightKg,
        remark: input.remark,
        items: { deleteMany: {}, create: input.items },
        molds: { deleteMany: {}, create: input.molds },
        coreBoxes: { deleteMany: {}, create: input.coreBoxes },
      },
      include: this.include(),
    })
    return this.dto(record)
  }

  @Delete(':id')
  async delete(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, id)
    const existing = await this.prisma.castingBomVersion.findUnique({
      where: { id },
      select: { status: true, bomId: true, _count: { select: { derivedVersions: true } } },
    })
    if (!existing) throw new NotFoundException('BOM 版本不存在')
    if (existing.status !== 'DRAFT') throw new BadRequestException('仅草稿 BOM 可以删除')
    if (existing._count.derivedVersions) throw new BadRequestException('该草稿已生成派生版本，不能删除')
    await this.prisma.$transaction(async (tx) => {
      await tx.castingBomVersion.delete({ where: { id } })
      const count = await tx.castingBomVersion.count({ where: { bomId: existing.bomId } })
      if (!count) await tx.castingBom.delete({ where: { id: existing.bomId } })
    })
    return { id }
  }

  @Post(':id/activate')
  async activate(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, id)
    const identity = await this.prisma.castingBomVersion.findUnique({ where: { id }, select: { bomId: true } })
    if (!identity) throw new NotFoundException('BOM 版本不存在')
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casting-bom:${identity.bomId}`}))`
      const existing = await tx.castingBomVersion.findUnique({ where: { id }, include: { materialGrade: true } })
      if (!existing) throw new NotFoundException('BOM 版本不存在')
      if (existing.status !== 'DRAFT') throw new BadRequestException('仅草稿 BOM 可以提交生效')
      if (existing.materialGrade.status !== '启用') throw new BadRequestException('材质牌号已停用，BOM 不能生效')
      await tx.castingBomVersion.updateMany({ where: { bomId: existing.bomId, status: 'ACTIVE' }, data: { status: 'DISABLED' } })
      await tx.castingBomVersion.update({ where: { id }, data: { status: 'ACTIVE' } })
    })
    return this.detail(request, id)
  }

  @Post(':id/disable')
  async disable(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, id)
    const existing = await this.prisma.castingBomVersion.findUnique({ where: { id }, select: { status: true } })
    if (!existing) throw new NotFoundException('BOM 版本不存在')
    if (existing.status !== 'ACTIVE') throw new BadRequestException('仅已生效 BOM 可以停用')
    await this.prisma.castingBomVersion.update({ where: { id }, data: { status: 'DISABLED' } })
    return this.detail(request, id)
  }

  private async copyVersion(request: RequestWithAdmin, sourceId: string, targetProductCode: string) {
    const source = await this.prisma.castingBomVersion.findUnique({ where: { id: sourceId }, include: this.include() })
    if (!source) throw new NotFoundException('来源 BOM 版本不存在')
    const targetProduct = await this.prisma.product.findUnique({ where: { code: targetProductCode } })
    if (!targetProduct) throw new BadRequestException('目标产品不存在')
    if (!['成品', '半成品'].some((prefix) => targetProduct.type === prefix || targetProduct.type?.startsWith(`${prefix}/`))) {
      throw new BadRequestException('目标物料只能选择成品或半成品')
    }
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casting-bom:${targetProductCode}`}))`
      let bom = await tx.castingBom.findUnique({ where: { productCode: targetProductCode }, include: { versions: { select: { version: true } } } })
      if (!bom) {
        bom = await tx.castingBom.create({
          data: { code: `BOM-${targetProductCode}`, productCode: targetProductCode },
          include: { versions: { select: { version: true } } },
        })
      }
      const version = this.nextVersion(bom.versions.map((item) => item.version))
      const copiedMolds = source.bom.productCode === targetProductCode
        ? source.molds
        : source.molds.filter((item) => item.mold.itemCode === targetProductCode)
      const copiedMoldCodes = new Set(copiedMolds.map((item) => item.moldCode))
      const copiedCoreBoxes = source.coreBoxes.filter((item) => copiedMoldCodes.has(item.moldCodeSnapshot))
      const versionRecord = await tx.castingBomVersion.create({
        data: {
          bomId: bom.id,
          version,
          materialGradeCode: targetProduct.materialGradeCode || source.materialGradeCode,
          productNameSnapshot: targetProduct.name,
          netWeightKg: source.netWeightKg,
          grossWeightKg: source.grossWeightKg,
          yieldRate: source.yieldRate,
          returnWeightKg: source.returnWeightKg,
          sourceVersionId: source.id,
          createdByUserId: getAdminContext(request).id,
          remark: source.remark,
          items: { create: source.items.map((item) => ({
            itemCode: item.itemCode,
            itemNameSnapshot: item.itemNameSnapshot,
            itemTypeSnapshot: item.itemTypeSnapshot,
            standardQuantity: item.standardQuantity,
            unit: item.unit,
            lossRate: item.lossRate,
            remark: item.remark,
          })) },
          molds: { create: copiedMolds.map((item) => ({
            moldCode: item.moldCode,
            moldNameSnapshot: item.moldNameSnapshot,
          })) },
          coreBoxes: { create: copiedCoreBoxes.map((item) => ({
            coreBoxCode: item.coreBoxCode,
            coreBoxNameSnapshot: item.coreBoxNameSnapshot,
            moldCodeSnapshot: item.moldCodeSnapshot,
            quantityPerProduct: item.quantityPerProduct,
          })) },
        },
        include: this.include(),
      })
      await upsertOwnership(tx, request.adminUser, 'modeling:boms', versionRecord.id)
      return versionRecord
    })
    return this.dto(record)
  }

  @Post(':id/new-version')
  async newVersion(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, id)
    const source = await this.prisma.castingBomVersion.findUnique({ where: { id }, include: { bom: true } })
    if (!source) throw new NotFoundException('来源 BOM 版本不存在')
    if (!['ACTIVE', 'DISABLED'].includes(source.status)) throw new BadRequestException('仅已生效或已停用 BOM 可以创建新版本')
    return this.copyVersion(request, id, source.bom.productCode)
  }

  @Post(':id/clone')
  async clone(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: { targetProductCode?: string }) {
    await this.assertVisible(request, id)
    const targetProductCode = String(body.targetProductCode || '').trim()
    if (!targetProductCode) throw new BadRequestException('请选择目标产品')
    const source = await this.prisma.castingBomVersion.findUnique({ where: { id }, include: { bom: true } })
    if (!source) throw new NotFoundException('来源 BOM 版本不存在')
    if (source.bom.productCode === targetProductCode) throw new BadRequestException('克隆目标不能是当前产品，请使用新版本功能')
    return this.copyVersion(request, id, targetProductCode)
  }

  @Get(':id/calculate')
  async calculate(@Req() request: RequestWithAdmin, @Param('id') id: string, @Query('quantity') quantityValue?: string) {
    await this.assertVisible(request, id)
    const quantity = Number(quantityValue)
    if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('生产数量必须大于 0')
    const record = await this.prisma.castingBomVersion.findUnique({ where: { id }, include: this.include() })
    if (!record) throw new NotFoundException('BOM 版本不存在')
    const recipes = await this.prisma.meltRecipe.findMany({
      where: { materialGradeCode: record.materialGradeCode, status: 'ACTIVE' },
      include: { applicableFurnaces: { include: { furnace: true } }, recipeItems: { include: { item: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    return {
      bomVersionId: record.id,
      bomCode: record.bom.code,
      version: record.version,
      materialGradeCode: record.materialGradeCode,
      quantity,
      moltenMetalWeightKg: Number((quantity * this.decimal(record.grossWeightKg)).toFixed(4)),
      returnWeightKg: Number((quantity * this.decimal(record.returnWeightKg)).toFixed(4)),
      physicalItems: record.items.map((item) => ({
        itemCode: item.itemCode,
        itemName: item.itemNameSnapshot,
        unit: item.unit,
        requiredQuantity: Number((quantity * this.decimal(item.standardQuantity) * (1 + this.decimal(item.lossRate) / 100)).toFixed(4)),
      })),
      molds: record.molds.map((item) => ({ code: item.moldCode, name: item.moldNameSnapshot })),
      coreBoxes: record.coreBoxes.map((item) => ({
        code: item.coreBoxCode,
        name: item.coreBoxNameSnapshot,
        moldCode: item.moldCodeSnapshot,
        quantityPerProduct: this.decimal(item.quantityPerProduct),
        requiredQuantity: Number((quantity * this.decimal(item.quantityPerProduct)).toFixed(4)),
      })),
      activeRecipes: recipes.map((recipe) => ({
        code: recipe.code,
        name: recipe.name,
        version: recipe.version,
        furnaceNames: recipe.applicableFurnaces.map((item) => item.furnace.name),
        items: recipe.recipeItems.map((item) => ({ itemCode: item.itemCode, itemName: item.item.name, ratio: this.decimal(item.ratio), quantity: this.decimal(item.quantity), unit: item.unit || '' })),
      })),
    }
  }
}
