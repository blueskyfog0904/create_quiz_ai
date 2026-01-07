-- Add tags column (text array, inherits from passage)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tags text[] DEFAULT NULL;

-- Add rating column (0-3 stars, 0 = no rating)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS rating smallint DEFAULT 0;

-- Add constraint for rating range
-- We use DO block to avoid error if constraint already exists (since ADD CONSTRAINT IF NOT EXISTS is not standard until PG 15+, wait, Supabase is PG 15+)
-- Even in PG 17, ADD CONSTRAINT IF NOT EXISTS is not always available for all constraint types or supported in all contexts easily without specific syntax.
-- Simpler approach: Drop if exists then add, or just add and fail if exists (but valid for repeated runs).
-- Better: standard check.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_rating_range') THEN
        ALTER TABLE questions ADD CONSTRAINT questions_rating_range CHECK (rating >= 0 AND rating <= 3);
    END IF;
END $$;

-- Create index for tag filtering
CREATE INDEX IF NOT EXISTS idx_questions_tags ON questions USING GIN (tags);

-- Create index for rating filtering
CREATE INDEX IF NOT EXISTS idx_questions_rating ON questions (rating);
