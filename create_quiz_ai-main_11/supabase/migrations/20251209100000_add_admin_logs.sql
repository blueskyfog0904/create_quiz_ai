-- Migration: Add admin_logs table for tracking statistics
-- Date: 2024-12-09

-- 1. Create admin_logs table for tracking various admin statistics
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('ai_generation', 'error', 'question_download', 'question_purchase', 'question_upload')),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  details jsonb DEFAULT '{}',
  ip_address text,
  status text DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  error_message text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable RLS
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies - Only admins can view logs
CREATE POLICY "Admins can view all logs" ON public.admin_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 4. Allow system to insert logs (via service role or authenticated users for their own actions)
CREATE POLICY "Authenticated users can insert logs" ON public.admin_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 5. Admins can delete logs
CREATE POLICY "Admins can delete logs" ON public.admin_logs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 6. Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_admin_logs_type ON public.admin_logs(type);
CREATE INDEX IF NOT EXISTS idx_admin_logs_status ON public.admin_logs(status);
CREATE INDEX IF NOT EXISTS idx_admin_logs_user_id ON public.admin_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON public.admin_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_logs_type_created_at ON public.admin_logs(type, created_at);

-- 7. Add RLS policy for admins to view all questions (for admin question management)
CREATE POLICY "Admins can view all questions" ON public.questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 8. Add RLS policy for admins to update all questions
CREATE POLICY "Admins can update all questions" ON public.questions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 9. Add RLS policy for admins to delete all questions
CREATE POLICY "Admins can delete all questions" ON public.questions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 10. Add RLS policy for admins to view all profiles (for user management)
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS admin_profile
      WHERE admin_profile.id = auth.uid() AND admin_profile.is_admin = true
    )
  );

