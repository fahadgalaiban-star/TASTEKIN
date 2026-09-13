ALTER TABLE "video_uploads" ADD COLUMN "recovery_lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "recovery_lease_token" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_uploads_recovery_lease_idx" ON "video_uploads" USING btree ("state","recovery_lease_until");
