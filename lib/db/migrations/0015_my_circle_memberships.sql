CREATE TABLE IF NOT EXISTS "my_circle_memberships" (
	"owner_user_id" varchar NOT NULL,
	"creator_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "my_circle_memberships_owner_creator_pk" PRIMARY KEY ("owner_user_id","creator_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_circle_memberships" ADD CONSTRAINT "my_circle_memberships_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_circle_memberships" ADD CONSTRAINT "my_circle_memberships_creator_id_creator_workspaces_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_workspaces"("creator_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "my_circle_memberships_owner_created_idx" ON "my_circle_memberships" USING btree ("owner_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "my_circle_memberships_creator_idx" ON "my_circle_memberships" USING btree ("creator_id");