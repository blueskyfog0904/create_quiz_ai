-- 옛 크레딧 지급 함수 grant_admin_credits(5인자)를 지운다(20261118120000의 뒷정리, 계획 U3-6 "옛 함수 DROP").
-- 배경: 20261118120000이 행위자·한도·작업 기록을 한 트랜잭션으로 처리하는 7인자 함수를 더했고, 그 함수를 부르는 코드(96c0858)가
--       2026-11-18 배포됐다. 옛 5인자 함수는 누가 지급하는지 모르고 직원 한도·작업 기록도 없지만 service_role로 여전히 부를 수 있다.
-- 확인(2026-11-18 운영): 앱 코드에 옛 함수 호출 없음(rpc 이름이 같은 호출은 7인자 인자만 넘김), DB의 다른 함수 본문·의존 객체에서 참조 0.
-- 하는 일: 옛 함수의 정의가 확인한 값(md5)과 같고 새 함수가 있을 때만 옛 함수를 지운다. 다르면 전체를 취소한다.
-- 영향: 없음(호출처 없음). PostgREST에서 같은 이름의 함수는 새 7인자 하나만 남는다.
-- 잠금: 함수 삭제만(표 잠금 없음).
-- 선행: 20261118120000 적용, 그 코드(96c0858) 배포.
-- 되돌리기: supabase/rollback/20261118130000_drop_old_grant_admin_credits_down.sql (20261110110000의 정의 그대로 다시 만든다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $check_old_grant$
BEGIN
  IF to_regprocedure('public.grant_admin_credits(uuid,uuid,integer,text,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'NEW_GRANT_ADMIN_CREDITS_MISSING';
  END IF;
  IF md5(pg_get_functiondef('public.grant_admin_credits(uuid,integer,text,text,text)'::regprocedure)) <> '05b1c69bfb2d0e69662df8738dde1020' THEN
    RAISE EXCEPTION 'OLD_GRANT_ADMIN_CREDITS_DEFINITION_CHANGED';
  END IF;
END;
$check_old_grant$;

DROP FUNCTION public.grant_admin_credits(uuid, integer, text, text, text);

NOTIFY pgrst, 'reload schema';
