-- Custom migration: additive repair for a Production migration-ledger/
-- schema inconsistency. The Drizzle ledger (drizzle.__drizzle_migrations)
-- already records 0012 and 0013 as applied — this migration never touches
-- that ledger table — but the tables those two migrations were supposed
-- to create (kin_search_usage, kin_saved_recommendations, kin_trips,
-- kin_trip_items) are absent on at least one real database. Every
-- statement below is guarded (IF NOT EXISTS / duplicate_object-caught) so
-- this migration converges to the same end state whether those objects
-- are entirely missing (the broken case) or already exist (a healthy
-- database, or a re-run) — it never fails, never duplicates, and never
-- touches any row of application data.
--
-- Definitions are copied verbatim from 0012_kin_search_usage.sql and
-- 0013_kin_looks_travel.sql; nothing here is new schema.

-- --- from 0012_kin_search_usage.sql ----------------------------------

CREATE TABLE IF NOT EXISTS "kin_search_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kin_search_usage" ADD CONSTRAINT "kin_search_usage_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kin_search_usage_owner_created_idx" ON "kin_search_usage" USING btree ("owner_user_id","created_at");--> statement-breakpoint

-- --- from 0013_kin_looks_travel.sql -----------------------------------

CREATE TABLE IF NOT EXISTS "kin_saved_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"mode" text NOT NULL,
	"query" text NOT NULL,
	"answer" text NOT NULL,
	"options" jsonb,
	"citations" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kin_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"destination" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"budget" real,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kin_trip_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"day_index" integer DEFAULT 0 NOT NULL,
	"place_id" text,
	"name" text NOT NULL,
	"formatted_address" text,
	"lat" double precision,
	"lng" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kin_saved_recommendations" ADD CONSTRAINT "kin_saved_recommendations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kin_trips" ADD CONSTRAINT "kin_trips_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kin_trip_items" ADD CONSTRAINT "kin_trip_items_trip_id_kin_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."kin_trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kin_trip_items" ADD CONSTRAINT "kin_trip_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kin_saved_recommendations_owner_created_idx" ON "kin_saved_recommendations" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kin_trips_owner_created_idx" ON "kin_trips" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kin_trip_items_trip_idx" ON "kin_trip_items" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kin_trip_items_owner_idx" ON "kin_trip_items" USING btree ("owner_user_id");
