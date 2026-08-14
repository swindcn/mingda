ALTER TYPE "HeatOrderStatus" ADD VALUE IF NOT EXISTS 'TRANSFERRING';
ALTER TYPE "HeatOrderAction" ADD VALUE IF NOT EXISTS 'TRANSFERRED';

ALTER TABLE "Furnace"
ADD COLUMN "equipmentType" TEXT NOT NULL DEFAULT '熔炼炉';

ALTER TABLE "WorkOrder"
ADD COLUMN "meltCompletedWeightKg" DECIMAL(14,4) NOT NULL DEFAULT 0;

ALTER TABLE "HeatOrder"
ADD COLUMN "actualFurnaceCode" TEXT,
ADD COLUMN "actualFurnaceNameSnapshot" TEXT;

CREATE TABLE "HeatOrderTransfer" (
    "id" TEXT NOT NULL,
    "heatOrderId" TEXT NOT NULL,
    "transferDeviceCode" TEXT NOT NULL,
    "transferDeviceNameSnapshot" TEXT NOT NULL,
    "equipmentTypeSnapshot" TEXT NOT NULL,
    "weightKg" DECIMAL(14,4) NOT NULL,
    "weightSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "operatorUserId" TEXT,
    "operatorNameSnapshot" TEXT NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HeatOrderTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Furnace_equipmentType_idx" ON "Furnace"("equipmentType");
CREATE INDEX "HeatOrder_actualFurnaceCode_idx" ON "HeatOrder"("actualFurnaceCode");
CREATE INDEX "HeatOrderTransfer_heatOrderId_createdAt_idx" ON "HeatOrderTransfer"("heatOrderId", "createdAt");
CREATE INDEX "HeatOrderTransfer_transferDeviceCode_idx" ON "HeatOrderTransfer"("transferDeviceCode");
CREATE INDEX "HeatOrderTransfer_operatorUserId_idx" ON "HeatOrderTransfer"("operatorUserId");

ALTER TABLE "HeatOrder"
ADD CONSTRAINT "HeatOrder_actualFurnaceCode_fkey" FOREIGN KEY ("actualFurnaceCode") REFERENCES "Furnace"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HeatOrderTransfer"
ADD CONSTRAINT "HeatOrderTransfer_heatOrderId_fkey" FOREIGN KEY ("heatOrderId") REFERENCES "HeatOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HeatOrderTransfer"
ADD CONSTRAINT "HeatOrderTransfer_transferDeviceCode_fkey" FOREIGN KEY ("transferDeviceCode") REFERENCES "Furnace"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HeatOrderTransfer"
ADD CONSTRAINT "HeatOrderTransfer_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Role"
SET "permissions" = "permissions" || '["production.heat.transfer"]'::jsonb
WHERE "permissions" @> '["production.heat.complete"]'::jsonb
  AND NOT "permissions" @> '["production.heat.transfer"]'::jsonb;

UPDATE "Role"
SET "permissions" = "permissions" || '["mini.production.heat.transfer"]'::jsonb
WHERE "permissions" @> '["mini.production.heat.complete"]'::jsonb
  AND NOT "permissions" @> '["mini.production.heat.transfer"]'::jsonb;
