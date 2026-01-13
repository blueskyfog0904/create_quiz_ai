-- Add source fields to questions table
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS source_type text,
ADD COLUMN IF NOT EXISTS source_1 text,
ADD COLUMN IF NOT EXISTS source_2 text,
ADD COLUMN IF NOT EXISTS source_3 text,
ADD COLUMN IF NOT EXISTS source_4 text;

-- Add comment for documentation
COMMENT ON COLUMN questions.source_type IS '출처 종류 (예: 모의고사, 수능, 교과서 등)';
COMMENT ON COLUMN questions.source_1 IS '출처 상세 1';
COMMENT ON COLUMN questions.source_2 IS '출처 상세 2';
COMMENT ON COLUMN questions.source_3 IS '출처 상세 3';
COMMENT ON COLUMN questions.source_4 IS '출처 상세 4';
