-- 회원이 자기 세션으로 '관리자 업로드' 문제를 만들거나 바꾸지 못하게 한다(2026-11-18 검증 중 발견, 출시 전 정리).
-- 배경: questions의 INSERT·UPDATE 정책은 "자기 행(auth.uid() = user_id)"만 본다. 그래서 일반 회원도 PostgREST에 직접 요청해
--       source='admin_uploaded'인 문제를 넣거나 자기 문제를 그 값으로 바꿀 수 있고, 그 문제는 조회 정책
--       ("Users can view admin uploaded questions" 등)에 따라 다른 사용자에게도 보인다. 문제은행은 꺼진 기능이라 화면에는 나오지 않는다.
-- 확인(2026-11-18 운영): admin_uploaded 행 0건. 관리자 업로드·수정·복사는 모두 SECURITY DEFINER 함수(소유자 postgres = 표 소유자,
--       FORCE RLS 꺼짐)로 하므로 행 정책을 거치지 않는다. 앱의 세션 쓰기는 ai_generated·from_community만 넣는다.
-- 바꾸는 것: RESTRICTIVE 정책 2개를 더한다(기존 정책은 그대로).
--   INSERT: 새 행의 source가 'admin_uploaded'이면 대표(is_owner())만.
--   UPDATE: 바꾸기 전 행(USING)과 바꾼 뒤 행(WITH CHECK) 모두, source가 'admin_uploaded'이면 대표만.
--   RESTRICTIVE라 기존 "자기 행" 조건과 함께(AND) 걸린다. service_role과 표 소유자(정의자 함수)는 RLS를 거치지 않는다.
-- 영향: 일반 회원·직원의 일반 문제 저장·수정은 그대로. 대표 세션의 동작도 그대로.
-- 잠금: questions에 정책을 더하며 ACCESS EXCLUSIVE를 커밋까지 잡는다(짧음). 잡지 못하면 최대 3초 대기 뒤 전체 취소.
-- 되돌리기: supabase/rollback/20261118140000_questions_admin_uploaded_owner_only_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE POLICY questions_admin_uploaded_insert_owner_only
  ON public.questions
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK ((source)::text IS DISTINCT FROM 'admin_uploaded' OR (SELECT public.is_owner()));

CREATE POLICY questions_admin_uploaded_update_owner_only
  ON public.questions
  AS RESTRICTIVE
  FOR UPDATE
  USING ((source)::text IS DISTINCT FROM 'admin_uploaded' OR (SELECT public.is_owner()))
  WITH CHECK ((source)::text IS DISTINCT FROM 'admin_uploaded' OR (SELECT public.is_owner()));

NOTIFY pgrst, 'reload schema';
