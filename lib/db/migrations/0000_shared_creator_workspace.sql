CREATE TABLE IF NOT EXISTS "users" (
  "id" varchar PRIMARY KEY,
  "email" varchar UNIQUE,
  "first_name" varchar,
  "last_name" varchar,
  "profile_image_url" varchar,
  "role" text NOT NULL DEFAULT 'consumer',
  "is_verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "sid" varchar PRIMARY KEY,
  "sess" jsonb NOT NULL,
  "expire" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" ("expire");

CREATE TABLE IF NOT EXISTS "creator_workspaces" (
  "creator_id" text PRIMARY KEY,
  "owner_user_id" text,
  "edits" jsonb NOT NULL,
  "collections" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "creator_workspaces" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'consumer';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_verified" boolean NOT NULL DEFAULT false;