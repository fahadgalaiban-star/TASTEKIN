CREATE TABLE IF NOT EXISTS "creator_media_uploads" (
  "object_path" text PRIMARY KEY,
  "creator_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);