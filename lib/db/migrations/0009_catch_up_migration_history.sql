CREATE TABLE "password_reset_tokens" (
	"token" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_user_id" varchar NOT NULL,
	"blocked_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_no_self_block" CHECK ("user_blocks"."blocker_user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "creator_featured_collections" (
	"creator_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "creator_featured_collections_creator_id_collection_id_pk" PRIMARY KEY("creator_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_a" text NOT NULL,
	"participant_b" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_follows" (
	"follower_user_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_follows_follower_user_id_creator_id_pk" PRIMARY KEY("follower_user_id","creator_id")
);
--> statement-breakpoint
CREATE TABLE "creator_view_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"edit_id" text,
	"viewer_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edit_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_likes" (
	"edit_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edit_likes_edit_id_user_id_pk" PRIMARY KEY("edit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "edit_saves" (
	"edit_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edit_saves_edit_id_user_id_pk" PRIMARY KEY("edit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "verification_applications" (
	"user_id" text PRIMARY KEY NOT NULL,
	"statement" text NOT NULL,
	"evidence_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"re_eligible_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "moderation_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"admin_user_id" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_mutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"muter_user_id" varchar NOT NULL,
	"muted_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mutes_no_self_mute" CHECK ("user_mutes"."muter_user_id" <> "user_mutes"."muted_user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_step" text DEFAULT 'basics' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" text DEFAULT 'replit' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_id" varchar;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_users_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_audit_log" ADD CONSTRAINT "moderation_audit_log_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mutes" ADD CONSTRAINT "user_mutes_muter_user_id_users_id_fk" FOREIGN KEY ("muter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mutes" ADD CONSTRAINT "user_mutes_muted_user_id_users_id_fk" FOREIGN KEY ("muted_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_blocks_blocker_blocked_unique" ON "user_blocks" USING btree ("blocker_user_id","blocked_user_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocker_idx" ON "user_blocks" USING btree ("blocker_user_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_featured_collections_position_unique" ON "creator_featured_collections" USING btree ("creator_id","position");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_created_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_recipient_read_idx" ON "conversation_messages" USING btree ("sender_user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_participants_unique" ON "conversations" USING btree ("participant_a","participant_b");--> statement-breakpoint
CREATE INDEX "conversations_participant_a_idx" ON "conversations" USING btree ("participant_a");--> statement-breakpoint
CREATE INDEX "conversations_participant_b_idx" ON "conversations" USING btree ("participant_b");--> statement-breakpoint
CREATE INDEX "creator_follows_creator_id_idx" ON "creator_follows" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "creator_view_events_creator_created_idx" ON "creator_view_events" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_view_events_edit_id_idx" ON "creator_view_events" USING btree ("edit_id");--> statement-breakpoint
CREATE INDEX "edit_comments_edit_created_idx" ON "edit_comments" USING btree ("edit_id","created_at");--> statement-breakpoint
CREATE INDEX "edit_likes_edit_id_idx" ON "edit_likes" USING btree ("edit_id");--> statement-breakpoint
CREATE INDEX "edit_saves_user_id_idx" ON "edit_saves" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_applications_status_created_idx" ON "verification_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "moderation_audit_log_report_id_idx" ON "moderation_audit_log" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_reporter_created_idx" ON "reports" USING btree ("reporter_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_active_dedupe_unique" ON "reports" USING btree ("reporter_user_id","target_type","target_id") WHERE "reports"."status" in ('pending', 'under_review');--> statement-breakpoint
CREATE UNIQUE INDEX "user_mutes_muter_muted_unique" ON "user_mutes" USING btree ("muter_user_id","muted_user_id");--> statement-breakpoint
CREATE INDEX "user_mutes_muter_idx" ON "user_mutes" USING btree ("muter_user_id");--> statement-breakpoint
CREATE INDEX "user_mutes_muted_idx" ON "user_mutes" USING btree ("muted_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_workspaces_owner_user_id_unique" ON "creator_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "creator_workspaces_updated_at_idx" ON "creator_workspaces" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_workspaces_username_unique" ON "creator_workspaces" USING btree (lower("profile"->>'username'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE("google_id");