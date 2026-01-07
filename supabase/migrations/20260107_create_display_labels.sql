-- Create display_labels table for managing user-facing display values
CREATE TABLE IF NOT EXISTS public.display_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(50) NOT NULL,  -- 'grade_level' or 'difficulty'
    db_value VARCHAR(50) NOT NULL,  -- Value stored in DB (e.g., 'High1', 'Low')
    display_value VARCHAR(100) NOT NULL,  -- User-facing display (e.g., '고1', '하')
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(category, db_value)
);

-- Enable RLS
ALTER TABLE public.display_labels ENABLE ROW LEVEL SECURITY;

-- Create policy for read access (everyone can read)
CREATE POLICY "Display labels are viewable by all authenticated users"
    ON public.display_labels FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for write access (only admins can modify)
CREATE POLICY "Only admins can modify display labels"
    ON public.display_labels FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Insert default values for difficulty
INSERT INTO public.display_labels (category, db_value, display_value, sort_order) VALUES
    ('difficulty', 'Low', '하', 1),
    ('difficulty', 'Medium', '중', 2),
    ('difficulty', 'High', '상', 3)
ON CONFLICT (category, db_value) DO NOTHING;

-- Insert default values for grade_level
INSERT INTO public.display_labels (category, db_value, display_value, sort_order) VALUES
    ('grade_level', 'Middle1', '중1', 1),
    ('grade_level', 'Middle2', '중2', 2),
    ('grade_level', 'Middle3', '중3', 3),
    ('grade_level', 'High1', '고1', 4),
    ('grade_level', 'High2', '고2', 5),
    ('grade_level', 'High3', '고3', 6)
ON CONFLICT (category, db_value) DO NOTHING;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_display_labels_category ON public.display_labels(category);
CREATE INDEX IF NOT EXISTS idx_display_labels_lookup ON public.display_labels(category, db_value);
