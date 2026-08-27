CREATE TABLE IF NOT EXISTS "WorkOrderMeltRelease" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "routingNodeId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByUserId" TEXT,
    CONSTRAINT "WorkOrderMeltRelease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderMeltRelease_workOrderId_routingNodeId_key"
ON "WorkOrderMeltRelease"("workOrderId", "routingNodeId");

CREATE INDEX IF NOT EXISTS "WorkOrderMeltRelease_routingNodeId_idx"
ON "WorkOrderMeltRelease"("routingNodeId");

CREATE INDEX IF NOT EXISTS "WorkOrderMeltRelease_releasedByUserId_idx"
ON "WorkOrderMeltRelease"("releasedByUserId");

CREATE INDEX IF NOT EXISTS "WorkOrderMeltRelease_releasedAt_idx"
ON "WorkOrderMeltRelease"("releasedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderMeltRelease_workOrderId_fkey'
  ) THEN
    ALTER TABLE "WorkOrderMeltRelease"
    ADD CONSTRAINT "WorkOrderMeltRelease_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderMeltRelease_routingNodeId_fkey'
  ) THEN
    ALTER TABLE "WorkOrderMeltRelease"
    ADD CONSTRAINT "WorkOrderMeltRelease_routingNodeId_fkey"
    FOREIGN KEY ("routingNodeId") REFERENCES "ProcessRoutingNode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderMeltRelease_releasedByUserId_fkey'
  ) THEN
    ALTER TABLE "WorkOrderMeltRelease"
    ADD CONSTRAINT "WorkOrderMeltRelease_releasedByUserId_fkey"
    FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
