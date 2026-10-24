-- Additive only. Apply ONLY after separate migration approval and backup preparation.
-- "Not interested" on an Edit (feature flag taste_learning): hides the Edit from the
-- member's feeds and is a negative taste signal for that member only.
CREATE TABLE "edit_dismissals" (
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "creator_id" text NOT NULL REFERENCES "creator_workspaces"("creator_id") ON DELETE cascade,
  "edit_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "edit_dismissals_pk" PRIMARY KEY ("user_id", "edit_id")
);
--> statement-breakpoint
CREATE INDEX "edit_dismissals_user_created_idx" ON "edit_dismissals" ("user_id", "created_at");
