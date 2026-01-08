-- Update problem_types provider check constraint to include 'admin'
ALTER TABLE problem_types 
DROP CONSTRAINT IF EXISTS problem_types_provider_check;

ALTER TABLE problem_types 
ADD CONSTRAINT problem_types_provider_check 
CHECK (provider IN ('gemini', 'openai', 'admin'));
