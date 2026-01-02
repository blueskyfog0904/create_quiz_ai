-- Add is_bookmarked and tags columns to passages table
ALTER TABLE public.passages 
ADD COLUMN IF NOT EXISTS is_bookmarked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- (Optional) Create an index for tags if you plan to search them heavily
CREATE INDEX IF NOT EXISTS idx_passages_tags ON public.passages USING GIN (tags);

-- Comment for documentation
COMMENT ON COLUMN public.passages.is_bookmarked IS '즐겨찾기 여부';
COMMENT ON COLUMN public.passages.tags IS '지문 태그 배열';
