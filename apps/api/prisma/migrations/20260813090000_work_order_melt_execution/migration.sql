-- CreateEnum
CREATE TYPE "WorkOrderScheduleStatus" AS ENUM ('PENDING', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "WorkOrderProductionStatus" AS ENUM ('RELEASED', 'IN_PRODUCTION', 'MELT_COMPLETED', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HeatOrderStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "HeatOrderAction" AS ENUM ('CREATED', 'STARTED', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalNo" TEXT,
    "productCode" TEXT NOT NULL,
    "productCodeSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "bomCodeSnapshot" TEXT NOT NULL,
    "bomVersionSnapshot" TEXT NOT NULL,
    "routingVersionId" TEXT NOT NULL,
    "routingCodeSnapshot" TEXT NOT NULL,
    "routingNameSnapshot" TEXT NOT NULL,
    "routingVersionSnapshot" TEXT NOT NULL,
    "materialGradeCode" TEXT NOT NULL,
    "materialGradeNameSnapshot" TEXT NOT NULL,
    "plannedQuantity" INTEGER NOT NULL,
    "plannedStartDate" DATE,
    "plannedDeliveryDate" DATE NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "unitNetWeightKg" DECIMAL(14,4) NOT NULL,
    "unitGrossWeightKg" DECIMAL(14,4) NOT NULL,
    "yieldRate" DECIMAL(8,4) NOT NULL,
    "unitReturnWeightKg" DECIMAL(14,4) NOT NULL,
    "totalNetWeightKg" DECIMAL(14,4) NOT NULL,
    "totalMeltWeightKg" DECIMAL(14,4) NOT NULL,
    "expectedReturnWeightKg" DECIMAL(14,4) NOT NULL,
    "scheduledQuantity" INTEGER NOT NULL DEFAULT 0,
    "meltCompletedQuantity" INTEGER NOT NULL DEFAULT 0,
    "completedQuantity" INTEGER NOT NULL DEFAULT 0,
    "scheduleStatus" "WorkOrderScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "productionStatus" "WorkOrderProductionStatus" NOT NULL DEFAULT 'RELEASED',
    "meltCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "materialGradeCode" TEXT NOT NULL,
    "materialGradeNameSnapshot" TEXT NOT NULL,
    "furnaceCode" TEXT NOT NULL,
    "furnaceNameSnapshot" TEXT NOT NULL,
    "furnaceCapacityKgSnapshot" DECIMAL(14,4) NOT NULL,
    "recipeCode" TEXT NOT NULL,
    "recipeNameSnapshot" TEXT NOT NULL,
    "recipeVersionSnapshot" TEXT NOT NULL,
    "teamCode" TEXT NOT NULL,
    "teamNameSnapshot" TEXT NOT NULL,
    "shiftCode" TEXT,
    "plannedOutputAt" TIMESTAMP(3) NOT NULL,
    "targetWeightKg" DECIMAL(14,4) NOT NULL,
    "actualOutputWeightKg" DECIMAL(14,4),
    "status" "HeatOrderStatus" NOT NULL DEFAULT 'WAITING',
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "startedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "canceledByUserId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeatOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatOrderAllocation" (
    "id" TEXT NOT NULL,
    "heatOrderId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL,
    "plannedWeightKg" DECIMAL(14,4) NOT NULL,
    "actualWeightKg" DECIMAL(14,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeatOrderAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatOrderRecord" (
    "id" TEXT NOT NULL,
    "heatOrderId" TEXT NOT NULL,
    "action" "HeatOrderAction" NOT NULL,
    "fromStatus" "HeatOrderStatus",
    "toStatus" "HeatOrderStatus" NOT NULL,
    "operatorUserId" TEXT,
    "operatorNameSnapshot" TEXT NOT NULL,
    "remark" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeatOrderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "documentType" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("documentType","businessDate")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_code_key" ON "WorkOrder"("code");

-- CreateIndex
CREATE INDEX "WorkOrder_productCode_idx" ON "WorkOrder"("productCode");

-- CreateIndex
CREATE INDEX "WorkOrder_bomVersionId_idx" ON "WorkOrder"("bomVersionId");

-- CreateIndex
CREATE INDEX "WorkOrder_routingVersionId_idx" ON "WorkOrder"("routingVersionId");

-- CreateIndex
CREATE INDEX "WorkOrder_materialGradeCode_idx" ON "WorkOrder"("materialGradeCode");

-- CreateIndex
CREATE INDEX "WorkOrder_scheduleStatus_idx" ON "WorkOrder"("scheduleStatus");

-- CreateIndex
CREATE INDEX "WorkOrder_productionStatus_idx" ON "WorkOrder"("productionStatus");

-- CreateIndex
CREATE INDEX "WorkOrder_plannedDeliveryDate_idx" ON "WorkOrder"("plannedDeliveryDate");

-- CreateIndex
CREATE INDEX "WorkOrder_createdByUserId_idx" ON "WorkOrder"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "HeatOrder_code_key" ON "HeatOrder"("code");

-- CreateIndex
CREATE INDEX "HeatOrder_materialGradeCode_idx" ON "HeatOrder"("materialGradeCode");

-- CreateIndex
CREATE INDEX "HeatOrder_furnaceCode_idx" ON "HeatOrder"("furnaceCode");

-- CreateIndex
CREATE INDEX "HeatOrder_recipeCode_idx" ON "HeatOrder"("recipeCode");

-- CreateIndex
CREATE INDEX "HeatOrder_teamCode_idx" ON "HeatOrder"("teamCode");

-- CreateIndex
CREATE INDEX "HeatOrder_shiftCode_idx" ON "HeatOrder"("shiftCode");

-- CreateIndex
CREATE INDEX "HeatOrder_status_idx" ON "HeatOrder"("status");

-- CreateIndex
CREATE INDEX "HeatOrder_plannedOutputAt_idx" ON "HeatOrder"("plannedOutputAt");

-- CreateIndex
CREATE INDEX "HeatOrderAllocation_workOrderId_idx" ON "HeatOrderAllocation"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "HeatOrderAllocation_heatOrderId_workOrderId_key" ON "HeatOrderAllocation"("heatOrderId", "workOrderId");

-- CreateIndex
CREATE INDEX "HeatOrderRecord_heatOrderId_createdAt_idx" ON "HeatOrderRecord"("heatOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "HeatOrderRecord_operatorUserId_idx" ON "HeatOrderRecord"("operatorUserId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "CastingBomVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_routingVersionId_fkey" FOREIGN KEY ("routingVersionId") REFERENCES "ProcessRoutingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_materialGradeCode_fkey" FOREIGN KEY ("materialGradeCode") REFERENCES "MaterialGrade"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_materialGradeCode_fkey" FOREIGN KEY ("materialGradeCode") REFERENCES "MaterialGrade"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_furnaceCode_fkey" FOREIGN KEY ("furnaceCode") REFERENCES "Furnace"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_recipeCode_fkey" FOREIGN KEY ("recipeCode") REFERENCES "MeltRecipe"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_teamCode_fkey" FOREIGN KEY ("teamCode") REFERENCES "Team"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_shiftCode_fkey" FOREIGN KEY ("shiftCode") REFERENCES "ShiftMaster"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrder" ADD CONSTRAINT "HeatOrder_canceledByUserId_fkey" FOREIGN KEY ("canceledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrderAllocation" ADD CONSTRAINT "HeatOrderAllocation_heatOrderId_fkey" FOREIGN KEY ("heatOrderId") REFERENCES "HeatOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrderAllocation" ADD CONSTRAINT "HeatOrderAllocation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrderRecord" ADD CONSTRAINT "HeatOrderRecord_heatOrderId_fkey" FOREIGN KEY ("heatOrderId") REFERENCES "HeatOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatOrderRecord" ADD CONSTRAINT "HeatOrderRecord_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
