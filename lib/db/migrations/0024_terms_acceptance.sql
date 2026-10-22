-- Additive only. Apply ONLY after separate migration approval and backup preparation.
-- Records Terms of Use / Privacy Policy acceptance given at email/password signup.
-- Both columns are nullable: existing accounts and OAuth signups keep NULL.
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" text;
