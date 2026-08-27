ALTER TABLE "WorkOrder"
ADD COLUMN IF NOT EXISTS "meltReleasedAt" TIMESTAMP(3);

ALTER TABLE "WorkOrder"
ADD COLUMN IF NOT EXISTS "meltReleasedByUserId" TEXT;

UPDATE "WorkOrder"
SET "meltReleasedAt" = "createdAt"
WHERE "meltReleasedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "WorkOrder_meltReleasedAt_idx"
ON "WorkOrder"("meltReleasedAt");

CREATE INDEX IF NOT EXISTS "WorkOrder_meltReleasedByUserId_idx"
ON "WorkOrder"("meltReleasedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WorkOrder_meltReleasedByUserId_fkey'
      AND conrelid = '"WorkOrder"'::regclass
  ) THEN
    ALTER TABLE "WorkOrder"
    ADD CONSTRAINT "WorkOrder_meltReleasedByUserId_fkey"
    FOREIGN KEY ("meltReleasedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
