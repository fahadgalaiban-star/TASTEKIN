ALTER TABLE "video_uploads" ALTER COLUMN "bunny_video_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "declared_file_name" text;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "declared_size_bytes" bigint;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "declared_mime_type" text;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "last_error" text;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "last_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "last_reconciled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "video_uploads" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_uploads_owner_created_idx" ON "video_uploads" USING btree ("owner_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_uploads_owner_state_idx" ON "video_uploads" USING btree ("owner_user_id","state");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_uploads_owner_idempotency_key_unique" ON "video_uploads" USING btree ("owner_user_id","idempotency_key") WHERE "idempotency_key" is not null;
