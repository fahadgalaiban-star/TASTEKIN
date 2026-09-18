CREATE TABLE IF NOT EXISTS "saved_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_lists_user_name_unique" ON "saved_lists" USING btree ("user_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_lists_user_id_idx" ON "saved_lists" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_list_items" (
  "list_id" uuid NOT NULL,
  "edit_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_list_items_list_id_edit_id_pk" PRIMARY KEY("list_id","edit_id"),
  CONSTRAINT "saved_list_items_list_id_saved_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."saved_lists"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_list_items_edit_id_idx" ON "saved_list_items" USING btree ("edit_id");