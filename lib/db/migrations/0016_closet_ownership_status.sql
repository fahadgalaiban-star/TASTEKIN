ALTER TABLE "closet_items" ADD COLUMN IF NOT EXISTS "ownership_status" text NOT NULL DEFAULT 'owned';
