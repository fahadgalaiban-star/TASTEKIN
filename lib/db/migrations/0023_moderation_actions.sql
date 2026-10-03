-- Additive only. Apply ONLY after separate migration approval and backup preparation.
CREATE TABLE "moderation_content_states" (
  "target_type" text NOT NULL,
  "creator_id" text NOT NULL,
  "target_id" text NOT NULL,
  "is_hidden" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "moderation_content_states_pk" PRIMARY KEY ("target_type", "creator_id", "target_id"),
  CONSTRAINT "moderation_content_states_type_check" CHECK ("target_type" IN ('edit', 'comment')),
  CONSTRAINT "moderation_content_states_identity_check" CHECK (length(btrim("creator_id")) > 0 AND length(btrim("target_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_suspended" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "moderation_audit_log"
  ADD COLUMN "action" text,
  ADD COLUMN "target_type" text,
  ADD COLUMN "target_id" text,
  ADD COLUMN "previous_state" jsonb,
  ADD COLUMN "new_state" jsonb;
--> statement-breakpoint
ALTER TABLE "moderation_audit_log" ADD CONSTRAINT "moderation_action_complete_check" CHECK (
  "action" IS NULL OR (
    "target_type" IS NOT NULL AND "target_id" IS NOT NULL
    AND length(btrim("target_id")) > 0
    AND "note" IS NOT NULL AND length(btrim("note")) BETWEEN 1 AND 1000
    AND "previous_state" IS NOT NULL AND "new_state" IS NOT NULL
    AND jsonb_typeof("previous_state") = 'object' AND jsonb_typeof("new_state") = 'object'
    AND (
      ("action" IN ('hide_edit', 'restore_edit') AND "target_type" = 'edit')
      OR ("action" IN ('hide_comment', 'restore_comment') AND "target_type" = 'comment')
      OR ("action" IN ('suspend_user', 'unsuspend_user') AND "target_type" = 'user')
    )
    AND (
      ("target_type" = 'user'
        AND "previous_state" ? 'suspended' AND "new_state" ? 'suspended'
        AND jsonb_typeof("previous_state"->'suspended') = 'boolean'
        AND jsonb_typeof("new_state"->'suspended') = 'boolean'
        AND ("new_state"->>'suspended')::boolean = ("action" = 'suspend_user'))
      OR ("target_type" IN ('edit', 'comment')
        AND "previous_state" ? 'hidden' AND "new_state" ? 'hidden'
        AND jsonb_typeof("previous_state"->'hidden') = 'boolean'
        AND jsonb_typeof("new_state"->'hidden') = 'boolean'
        AND "previous_state" ? 'creatorId' AND "new_state" ? 'creatorId'
        AND length("new_state"->>'creatorId') > 0
        AND "previous_state"->>'creatorId' = "new_state"->>'creatorId'
        AND ("new_state"->>'hidden')::boolean = ("action" IN ('hide_edit', 'hide_comment')))
    )
  )
);