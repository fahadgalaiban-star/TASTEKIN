-- Additive idempotent migration: backfill five place fields as null in each
-- existing creator_workspaces.edits JSON object, preserving current values
-- and array order.  Safe to run multiple times.

UPDATE "creator_workspaces"
SET "edits" = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(edit) = 'object' THEN
        -- Start from null defaults, then overlay with existing edit fields so
        -- any already-present values are preserved (right side wins with ||).
        jsonb_build_object(
          'placeName',     'null'::jsonb,
          'locationLabel', 'null'::jsonb,
          'mapsUrl',       'null'::jsonb,
          'tasteRating',   'null'::jsonb,
          'creatorReview', 'null'::jsonb
        ) || edit
      ELSE edit
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements("creator_workspaces"."edits") WITH ORDINALITY AS t(edit, ordinality)
), '[]'::jsonb)
WHERE jsonb_typeof("edits") = 'array';
