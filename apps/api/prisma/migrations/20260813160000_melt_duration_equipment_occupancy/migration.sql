ALTER TABLE "MeltRecipe"
  ADD COLUMN "meltingDurationMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transferDurationMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cleaningDurationMinutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "HeatOrder"
  ADD COLUMN "workshopCodeSnapshot" TEXT,
  ADD COLUMN "workshopNameSnapshot" TEXT,
  ADD COLUMN "plannedStartAt" TIMESTAMP(3),
  ADD COLUMN "calculatedFinishAt" TIMESTAMP(3),
  ADD COLUMN "plannedFinishAt" TIMESTAMP(3),
  ADD COLUMN "meltingDurationMinutesSnapshot" INTEGER,
  ADD COLUMN "transferDurationMinutesSnapshot" INTEGER,
  ADD COLUMN "cleaningDurationMinutesSnapshot" INTEGER,
  ADD COLUMN "occupancyDurationMinutesSnapshot" INTEGER,
  ADD COLUMN "finishTimeAdjusted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "HeatOrder_furnaceCode_plannedStartAt_plannedFinishAt_idx"
  ON "HeatOrder"("furnaceCode", "plannedStartAt", "plannedFinishAt");
