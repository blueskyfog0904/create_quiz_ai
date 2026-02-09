-- Create user_roles table for managing signup role options
-- Run this migration in Supabase SQL Editor

CREATE TABLE public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,      -- DB storage value (e.g., parent, student)
  label TEXT NOT NULL,              -- Display label (e.g., 학부모, 학생)
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert initial role data
INSERT INTO public.user_roles (value, label, sort_order) VALUES
  ('parent', '학부모', 1),
  ('student', '학생', 2),
  ('instructor', '강사', 3),
  ('teacher', '교사', 4);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Anyone can read active roles (needed for signup form)
CREATE POLICY "Anyone can read active roles" ON public.user_roles
  FOR SELECT USING (is_active = true);

-- Only admins can manage roles
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.is_admin());

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_user_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_roles_updated_at();
