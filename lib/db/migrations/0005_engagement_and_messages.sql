CREATE TABLE IF NOT EXISTS "edit_likes" (
  "edit_id" text NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "edit_likes_edit_id_user_id_pk" PRIMARY KEY("edit_id","user_id")
);
CREATE INDEX IF NOT EXISTS "edit_likes_edit_id_idx" ON "edit_likes" USING btree ("edit_id");

CREATE TABLE IF NOT EXISTS "edit_saves" (
  "edit_id" text NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "edit_saves_edit_id_user_id_pk" PRIMARY KEY("edit_id","user_id")
);
CREATE INDEX IF NOT EXISTS "edit_saves_user_id_idx" ON "edit_saves" USING btree ("user_id");

CREATE TABLE IF NOT EXISTS "edit_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "edit_id" text NOT NULL,
  "user_id" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "edit_comments_edit_created_idx" ON "edit_comments" USING btree ("edit_id","created_at");

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "participant_a" text NOT NULL,
  "participant_b" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_participants_unique" ON "conversations" USING btree ("participant_a","participant_b");
CREATE INDEX IF NOT EXISTS "conversations_participant_a_idx" ON "conversations" USING btree ("participant_a");
CREATE INDEX IF NOT EXISTS "conversations_participant_b_idx" ON "conversations" USING btree ("participant_b");

CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "sender_user_id" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "conversation_messages_conversation_created_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");
CREATE INDEX IF NOT EXISTS "conversation_messages_recipient_read_idx" ON "conversation_messages" USING btree ("sender_user_id","read_at");

CREATE TABLE IF NOT EXISTS "creator_view_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "creator_id" text NOT NULL,
  "edit_id" text,
  "viewer_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "creator_view_events_creator_created_idx" ON "creator_view_events" USING btree ("creator_id","created_at");
CREATE INDEX IF NOT EXISTS "creator_view_events_edit_id_idx" ON "creator_view_events" USING btree ("edit_id");