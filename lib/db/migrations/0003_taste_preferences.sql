CREATE TABLE IF NOT EXISTS "user_taste_preferences" (
  "user_id" text PRIMARY KEY NOT NULL,
  "categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);