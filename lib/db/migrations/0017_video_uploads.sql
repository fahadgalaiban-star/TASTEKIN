CREATE TABLE IF NOT EXISTS "video_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"bunny_library_id" text NOT NULL,
	"bunny_video_id" text NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"duration_seconds" integer,
	"width" integer,
	"height" integer,
	"poster_url" text,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_uploads_owner_user_id_idx" ON "video_uploads" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_uploads_bunny_video_id_unique" ON "video_uploads" USING btree ("bunny_video_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_uploads_state_updated_idx" ON "video_uploads" USING btree ("state","updated_at");
