-- 닫아 둔 문제은행의 관리자 함수 7개를 대표(owner) 전용으로 바꾼다(계획 4-2절 "꺼진 기능은 대표 전용"의 DB 쪽).
-- 배경: 문제은행 화면·API는 모두 대표 전용(requireAdminApiPermission('owner'))인데, 그 화면이 부르는 함수는 안에서
--       public.is_admin()만 확인한다. 함수가 SECURITY DEFINER이고 authenticated에 EXECUTE가 있어, 권한이 적은 일반 관리자(staff)도
--       자기 로그인 세션으로 PostgREST에 직접 요청하면 문제를 만들거나 고치고 메타데이터를 일괄 수정할 수 있었다.
-- 바꾸는 것: 아래 7개 함수의 접근 검사 한 줄 `public.is_admin()` → `public.is_owner()`. 그 밖의 본문·인자·반환·SET·권한은 그대로다.
--   admin_audit_question_bank_metadata(text, jsonb)
--   admin_list_bank_questions(text, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer)
--   admin_list_question_bank_backfill_candidates(text, jsonb, integer, integer)
--   backfill_question_bank_metadata(text, uuid[], uuid, uuid, boolean)
--   create_admin_bank_question(text, jsonb, uuid, uuid)
--   create_admin_bank_questions_bulk(text, jsonb)
--   update_admin_bank_question(uuid, text, jsonb, uuid, uuid)
-- 방식: 본문(합계 약 27KB)을 옮겨 적다가 생기는 실수를 막으려고, 운영 DB의 현재 정의(pg_get_functiondef)를 읽어 바꾼다.
--   - 현재 정의의 md5가 2026-11-18 운영 DB에서 확인한 값과 다르면(그 사이 누가 고쳤으면) 전체를 취소한다.
--   - `public.is_admin()`이 정확히 한 번 있어야 하고, 바꾼 뒤에는 `public.is_owner()` 한 번·`is_admin` 0번이어야 한다.
--   - CREATE OR REPLACE라 소유자(postgres)·EXECUTE 권한·SECURITY DEFINER·search_path는 그대로 남는다.
-- 영향: 대표는 그대로(is_owner()는 대표에게 참). staff와 비관리자는 ADMIN_REQUIRED로 거부된다(예외 문구도 그대로).
--       앱에서 부르는 곳(api/admin/questions/**, api/admin/question-bank/backfill)은 모두 이미 대표 전용이라 화면 동작은 바뀌지 않는다.
-- 선행: 20261116110000_admin_permissions_base(is_owner). 코드 변경 없음 — 언제 적용해도 된다.
-- 잠금: 함수 정의만 바꾼다(표 잠금 없음).
-- 적용: 반드시 한 트랜잭션으로 실행한다(중간에 실패하면 앞의 함수만 바뀐 채 남지 않게).
-- 되돌리기: supabase/rollback/20261118110000_question_bank_rpcs_owner_only_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $owner_only$
DECLARE
  v_target record;
  v_def text;
  v_new text;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('public.admin_audit_question_bank_metadata(text,jsonb)', '2bb5c80b67f8d5767c2cc58067e63f4d'),
      ('public.admin_list_bank_questions(text,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer)', 'ddd4c3a19f78629fa19a371501d439b6'),
      ('public.admin_list_question_bank_backfill_candidates(text,jsonb,integer,integer)', 'ae4045c6e56c83c0b609802d70f3757d'),
      ('public.backfill_question_bank_metadata(text,uuid[],uuid,uuid,boolean)', '6a51436b55c697df13a299e2855aeeb5'),
      ('public.create_admin_bank_question(text,jsonb,uuid,uuid)', '588785628fef58bbd6ec56fd73f891c0'),
      ('public.create_admin_bank_questions_bulk(text,jsonb)', '5c1ddbbac9bab64cdd3cd1898c6567d2'),
      ('public.update_admin_bank_question(uuid,text,jsonb,uuid,uuid)', 'df16a8b474306fb626a263a88dccec54')
    ) AS t(signature, expected_md5)
  LOOP
    v_def := pg_get_functiondef(v_target.signature::regprocedure);
    IF md5(v_def) <> v_target.expected_md5 THEN
      RAISE EXCEPTION 'QUESTION_BANK_RPC_DEFINITION_CHANGED: %', v_target.signature;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, 'public\.is_admin\(\)', 'g')) <> 1 THEN
      RAISE EXCEPTION 'QUESTION_BANK_RPC_ADMIN_CHECK_NOT_SINGLE: %', v_target.signature;
    END IF;

    v_new := replace(v_def, 'public.is_admin()', 'public.is_owner()');
    IF (SELECT count(*) FROM regexp_matches(v_new, 'public\.is_owner\(\)', 'g')) <> 1
       OR v_new ~ 'is_admin' THEN
      RAISE EXCEPTION 'QUESTION_BANK_RPC_REPLACE_FAILED: %', v_target.signature;
    END IF;

    EXECUTE v_new;
  END LOOP;
END;
$owner_only$;

NOTIFY pgrst, 'reload schema';
