-- Phase 1: make creator ownership one-to-one and persist private follows.
-- The profile username remains in JSON so creator_id can stay immutable when
-- a creator changes their public handle.

CREATE UNIQUE INDEX IF NOT EXISTS "creator_workspaces_owner_user_id_unique"
  ON "creator_workspaces" ("owner_user_id")
  WHERE "owner_user_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "creator_workspaces_updated_at_idx"
  ON "creator_workspaces" ("updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "creator_workspaces_profile_username_unique"
  ON "creator_workspaces" (lower("profile"->>'username'));

CREATE TABLE IF NOT EXISTS "creator_follows" (
  "follower_user_id" text NOT NULL,
  "creator_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_follows_follower_user_id_creator_id_pk"
    PRIMARY KEY("follower_user_id", "creator_id")
);

CREATE INDEX IF NOT EXISTS "creator_follows_creator_id_idx"
  ON "creator_follows" ("creator_id");
