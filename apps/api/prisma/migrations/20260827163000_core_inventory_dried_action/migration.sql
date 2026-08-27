DO $$
BEGIN
  ALTER TYPE "CoreInventoryAction" ADD VALUE 'DRIED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
