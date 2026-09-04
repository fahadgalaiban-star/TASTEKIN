CREATE TABLE "kin_saved_recommendations" (
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
CREATE TABLE "kin_trips" (
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
CREATE TABLE "kin_trip_items" (
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
ALTER TABLE "kin_saved_recommendations" ADD CONSTRAINT "kin_saved_recommendations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kin_trips" ADD CONSTRAINT "kin_trips_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kin_trip_items" ADD CONSTRAINT "kin_trip_items_trip_id_kin_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."kin_trips"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kin_trip_items" ADD CONSTRAINT "kin_trip_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "kin_saved_recommendations_owner_created_idx" ON "kin_saved_recommendations" USING btree ("owner_user_id","created_at");
--> statement-breakpoint
CREATE INDEX "kin_trips_owner_created_idx" ON "kin_trips" USING btree ("owner_user_id","created_at");
--> statement-breakpoint
CREATE INDEX "kin_trip_items_trip_idx" ON "kin_trip_items" USING btree ("trip_id");
--> statement-breakpoint
CREATE INDEX "kin_trip_items_owner_idx" ON "kin_trip_items" USING btree ("owner_user_id");
