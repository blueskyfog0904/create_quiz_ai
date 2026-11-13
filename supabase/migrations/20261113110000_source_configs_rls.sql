-- source_configs 잠금 (계획 W1-8, DB-1).
-- 문제: RLS가 꺼져 있고 anon·authenticated에 모든 권한이 있어 공개 키만으로 누구나 읽고 고칠 수 있었다.
-- 사용처(2026-11-13 확인): api/admin/source-configs/** 뿐이고, is_admin 확인 뒤 관리자 세션으로 읽고 쓴다.
-- 되돌리기: supabase/rollback/20261113110000_source_configs_rls_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.source_configs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.source_configs FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.source_configs FROM authenticated;

CREATE POLICY "Admins can manage source configs" ON public.source_configs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';
