CREATE TABLE IF NOT EXISTS "native_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "token_hash" varchar NOT NULL,
  "platform" text NOT NULL,
  "app_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  CONSTRAINT "native_sessions_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "native_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "native_sessions_user_id_idx" ON "native_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "native_sessions_expires_at_idx" ON "native_sessions" USING btree ("expires_at");
