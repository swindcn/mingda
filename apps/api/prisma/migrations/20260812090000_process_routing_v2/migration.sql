-- Create the new versioned route structures first. Existing linear routes are
-- migrated below before legacy columns and tables are removed.

-- CreateTable
CREATE TABLE "OperationMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "reportMode" TEXT NOT NULL DEFAULT 'BATCH',
    "qualityControlPoint" BOOLEAN NOT NULL DEFAULT false,
    "pouringMergePoint" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessRoutingVersion" (
    "id" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceVersionId" TEXT,
    "createdByUserId" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessRoutingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingApplicableProduct" (
    "routingVersionId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingApplicableProduct_pkey" PRIMARY KEY ("routingVersionId","productCode")
);

-- CreateTable
CREATE TABLE "ProductDefaultRouting" (
    "productCode" TEXT NOT NULL,
    "routingVersionId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDefaultRouting_pkey" PRIMARY KEY ("productCode")
);

-- CreateTable
CREATE TABLE "ProcessRoutingNode" (
    "id" TEXT NOT NULL,
    "routingVersionId" TEXT NOT NULL,
    "operationCode" TEXT NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "routeType" TEXT NOT NULL,
    "reportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qualityControlEnabled" BOOLEAN NOT NULL DEFAULT false,
    "qualityRequirement" TEXT,
    "requireFurnaceBatch" BOOLEAN NOT NULL DEFAULT false,
    "requireLadle" BOOLEAN NOT NULL DEFAULT false,
    "requireCoreBatch" BOOLEAN NOT NULL DEFAULT false,
    "standardCycleSeconds" INTEGER,
    "positionX" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "positionY" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessRoutingNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingNodeEquipment" (
    "routingNodeId" TEXT NOT NULL,
    "equipmentCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingNodeEquipment_pkey" PRIMARY KEY ("routingNodeId","equipmentCode")
);

-- CreateTable
CREATE TABLE "ProcessRoutingEdge" (
    "id" TEXT NOT NULL,
    "routingVersionId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessRoutingEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationMaster_code_key" ON "OperationMaster"("code");

-- CreateIndex
CREATE INDEX "OperationMaster_section_idx" ON "OperationMaster"("section");

-- CreateIndex
CREATE INDEX "OperationMaster_status_idx" ON "OperationMaster"("status");

-- CreateIndex
CREATE INDEX "ProcessRoutingVersion_status_idx" ON "ProcessRoutingVersion"("status");

-- CreateIndex
CREATE INDEX "ProcessRoutingVersion_sourceVersionId_idx" ON "ProcessRoutingVersion"("sourceVersionId");

-- CreateIndex
CREATE INDEX "ProcessRoutingVersion_createdByUserId_idx" ON "ProcessRoutingVersion"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRoutingVersion_routingId_version_key" ON "ProcessRoutingVersion"("routingId", "version");

-- CreateIndex
CREATE INDEX "RoutingApplicableProduct_productCode_idx" ON "RoutingApplicableProduct"("productCode");

-- CreateIndex
CREATE INDEX "ProductDefaultRouting_routingVersionId_idx" ON "ProductDefaultRouting"("routingVersionId");

-- CreateIndex
CREATE INDEX "ProcessRoutingNode_operationCode_idx" ON "ProcessRoutingNode"("operationCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRoutingNode_routingVersionId_seqNo_key" ON "ProcessRoutingNode"("routingVersionId", "seqNo");

-- CreateIndex
CREATE INDEX "RoutingNodeEquipment_equipmentCode_idx" ON "RoutingNodeEquipment"("equipmentCode");

-- CreateIndex
CREATE INDEX "ProcessRoutingEdge_sourceNodeId_idx" ON "ProcessRoutingEdge"("sourceNodeId");

-- CreateIndex
CREATE INDEX "ProcessRoutingEdge_targetNodeId_idx" ON "ProcessRoutingEdge"("targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRoutingEdge_routingVersionId_sourceNodeId_targetNode_key" ON "ProcessRoutingEdge"("routingVersionId", "sourceNodeId", "targetNodeId");

-- Preserve legacy routes as V1.0. Legacy operation names become private
-- operation-master records so every migrated node has a real relation.
INSERT INTO "OperationMaster" (
  "id", "code", "name", "section", "reportMode", "status", "createdAt", "updatedAt"
)
SELECT
  'legacy-op-' || substr(md5(source."operationName"), 1, 16),
  'LEGACY-' || upper(substr(md5(source."operationName"), 1, 12)),
  source."operationName",
  '其他',
  'BATCH',
  'ENABLED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "operationName" FROM "ProcessRoutingStep") source
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "ProcessRoutingVersion" (
  "id", "routingId", "version", "status", "remark", "createdAt", "updatedAt"
)
SELECT
  routing."id" || '-V1',
  routing."id",
  COALESCE(NULLIF(routing."version", ''), 'V1.0'),
  CASE
    WHEN routing."status" IN ('启用', 'ACTIVE', '已生效') THEN 'ACTIVE'
    WHEN routing."status" IN ('停用', 'DISABLED', '已停用') THEN 'DISABLED'
    ELSE 'DRAFT'
  END,
  routing."remark",
  routing."createdAt",
  routing."updatedAt"
FROM "ProcessRouting" routing;

INSERT INTO "RoutingApplicableProduct" ("routingVersionId", "productCode", "createdAt")
SELECT routing."id" || '-V1', routing."itemCode", routing."createdAt"
FROM "ProcessRouting" routing;

INSERT INTO "ProcessRoutingNode" (
  "id", "routingVersionId", "operationCode", "seqNo", "routeType",
  "reportEnabled", "qualityControlEnabled", "standardCycleSeconds",
  "positionX", "positionY", "remark", "createdAt", "updatedAt"
)
SELECT
  ordered."id",
  ordered."routingId" || '-V1',
  'LEGACY-' || upper(substr(md5(ordered."operationName"), 1, 12)),
  ordered.normalized_seq,
  'MOLD_MAIN',
  true,
  false,
  CASE WHEN ordered."standardHours" IS NULL THEN NULL ELSE round(ordered."standardHours" * 3600)::integer END,
  70 + ((ordered.normalized_seq / 10) - 1) * 210,
  362,
  ordered."remark",
  ordered."createdAt",
  ordered."updatedAt"
FROM (
  SELECT step.*, row_number() OVER (PARTITION BY step."routingId" ORDER BY step."seqNo", step."createdAt", step."id")::integer * 10 AS normalized_seq
  FROM "ProcessRoutingStep" step
) ordered;

INSERT INTO "ProcessRoutingEdge" (
  "id", "routingVersionId", "sourceNodeId", "targetNodeId", "createdAt"
)
SELECT
  'legacy-edge-' || substr(md5(chain.source_id || ':' || chain.target_id), 1, 20),
  chain."routingId" || '-V1',
  chain.source_id,
  chain.target_id,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    step."routingId",
    step."id" AS source_id,
    lead(step."id") OVER (PARTITION BY step."routingId" ORDER BY step."seqNo", step."createdAt", step."id") AS target_id
  FROM "ProcessRoutingStep" step
) chain
WHERE chain.target_id IS NOT NULL;

INSERT INTO "ProductDefaultRouting" ("productCode", "routingVersionId", "updatedAt")
SELECT selected."itemCode", selected."id" || '-V1', selected."updatedAt"
FROM (
  SELECT routing.*, row_number() OVER (PARTITION BY routing."itemCode" ORDER BY routing."updatedAt" DESC, routing."id") AS priority
  FROM "ProcessRouting" routing
  WHERE routing."status" IN ('启用', 'ACTIVE', '已生效')
) selected
WHERE selected.priority = 1;

UPDATE "BusinessDataOwnership" ownership
SET "entityId" = ownership."entityId" || '-V1'
WHERE ownership."entityType" = 'modeling:routings'
  AND EXISTS (SELECT 1 FROM "ProcessRouting" routing WHERE routing."id" = ownership."entityId");

-- Remove the legacy linear route structure only after migration succeeds.
ALTER TABLE "ProcessRouting" DROP CONSTRAINT "ProcessRouting_itemCode_fkey";
ALTER TABLE "ProcessRoutingStep" DROP CONSTRAINT "ProcessRoutingStep_productionLineCode_fkey";
ALTER TABLE "ProcessRoutingStep" DROP CONSTRAINT "ProcessRoutingStep_routingId_fkey";
ALTER TABLE "ProcessRoutingStep" DROP CONSTRAINT "ProcessRoutingStep_workshopCode_fkey";
DROP INDEX "ProcessRouting_itemCode_idx";
DROP INDEX "ProcessRouting_status_idx";
DROP TABLE "ProcessRoutingStep";
ALTER TABLE "ProcessRouting"
  DROP COLUMN "itemCode",
  DROP COLUMN "remark",
  DROP COLUMN "status",
  DROP COLUMN "version";

-- AddForeignKey
ALTER TABLE "ProcessRoutingVersion" ADD CONSTRAINT "ProcessRoutingVersion_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "ProcessRouting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingVersion" ADD CONSTRAINT "ProcessRoutingVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "ProcessRoutingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingVersion" ADD CONSTRAINT "ProcessRoutingVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingApplicableProduct" ADD CONSTRAINT "RoutingApplicableProduct_routingVersionId_fkey" FOREIGN KEY ("routingVersionId") REFERENCES "ProcessRoutingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingApplicableProduct" ADD CONSTRAINT "RoutingApplicableProduct_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDefaultRouting" ADD CONSTRAINT "ProductDefaultRouting_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDefaultRouting" ADD CONSTRAINT "ProductDefaultRouting_routingVersionId_fkey" FOREIGN KEY ("routingVersionId") REFERENCES "ProcessRoutingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingNode" ADD CONSTRAINT "ProcessRoutingNode_routingVersionId_fkey" FOREIGN KEY ("routingVersionId") REFERENCES "ProcessRoutingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingNode" ADD CONSTRAINT "ProcessRoutingNode_operationCode_fkey" FOREIGN KEY ("operationCode") REFERENCES "OperationMaster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingNodeEquipment" ADD CONSTRAINT "RoutingNodeEquipment_routingNodeId_fkey" FOREIGN KEY ("routingNodeId") REFERENCES "ProcessRoutingNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingNodeEquipment" ADD CONSTRAINT "RoutingNodeEquipment_equipmentCode_fkey" FOREIGN KEY ("equipmentCode") REFERENCES "Furnace"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingEdge" ADD CONSTRAINT "ProcessRoutingEdge_routingVersionId_fkey" FOREIGN KEY ("routingVersionId") REFERENCES "ProcessRoutingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingEdge" ADD CONSTRAINT "ProcessRoutingEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "ProcessRoutingNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRoutingEdge" ADD CONSTRAINT "ProcessRoutingEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "ProcessRoutingNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
