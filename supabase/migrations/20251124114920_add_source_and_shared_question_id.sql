-- Add source column to questions table
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ai_generated' CHECK (source IN ('ai_generated', 'admin_uploaded', 'from_community'));

-- Add shared_question_id column (for tracking original question from community)
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS shared_question_id UUID REFERENCES questions(id);

-- Update existing data to have 'ai_generated' as source
UPDATE questions SET source = 'ai_generated' WHERE source IS NULL;
