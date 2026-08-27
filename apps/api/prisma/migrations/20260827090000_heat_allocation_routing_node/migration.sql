ALTER TABLE "HeatOrderAllocation"
ADD COLUMN IF NOT EXISTS "routingNodeId" TEXT;

CREATE INDEX IF NOT EXISTS "HeatOrderAllocation_routingNodeId_idx"
ON "HeatOrderAllocation"("routingNodeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'HeatOrderAllocation_routingNodeId_fkey'
  ) THEN
    ALTER TABLE "HeatOrderAllocation"
    ADD CONSTRAINT "HeatOrderAllocation_routingNodeId_fkey"
    FOREIGN KEY ("routingNodeId") REFERENCES "ProcessRoutingNode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
