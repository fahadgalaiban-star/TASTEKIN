CREATE TABLE IF NOT EXISTS "verification_applications" (
	"user_id" text PRIMARY KEY NOT NULL,
	"statement" text NOT NULL,
	"evidence_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_applications_status_created_idx" ON "verification_applications" USING btree ("status","created_at");
