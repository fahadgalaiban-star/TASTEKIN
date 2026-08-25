CREATE TABLE IF NOT EXISTS "creator_featured_collections" (
	"creator_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "creator_featured_collections_creator_id_collection_id_pk" PRIMARY KEY("creator_id","collection_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creator_featured_collections_position_unique" ON "creator_featured_collections" USING btree ("creator_id","position");
