-- 20261113110000_source_configs_rls 되돌리기. 적용 직전(2026-11-13 조회: RLS 꺼짐, 정책 0, anon·authenticated 전 권한) 상태로 복원한다.
-- 주의: 되돌리면 공개 키만으로 누구나 이 표를 읽고 고칠 수 있는 상태로 돌아간다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP POLICY "Admins can manage source configs" ON public.source_configs;
ALTER TABLE public.source_configs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.source_configs TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
