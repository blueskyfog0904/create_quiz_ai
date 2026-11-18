-- 20261118110000_question_bank_rpcs_owner_only 되돌리기: 7개 함수의 접근 검사를 public.is_owner()에서 public.is_admin()으로 되돌린다.
-- 적용 직후 정의의 md5(2026-11-18 운영 DB 리허설 값)와 같을 때만 바꾸고, 다르면 전체를 취소한다.
-- 되돌린 뒤의 정의는 적용 전 정의와 같다(리허설에서 md5로 확인).
-- 되돌린 뒤에는 staff도 자기 세션으로 이 함수들을 직접 부를 수 있는 상태로 돌아간다.
-- 반드시 한 트랜잭션으로 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $owner_only_down$
DECLARE
  v_target record;
  v_def text;
  v_new text;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('public.admin_audit_question_bank_metadata(text,jsonb)', '0728c3d48f88ca3ebf768c5f5b2790bb', '2bb5c80b67f8d5767c2cc58067e63f4d'),
      ('public.admin_list_bank_questions(text,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer)', 'b4de79c2c46657330dba88c1b9d4aac2', 'ddd4c3a19f78629fa19a371501d439b6'),
      ('public.admin_list_question_bank_backfill_candidates(text,jsonb,integer,integer)', '29d09675d3beeca586bdb8ad515a8a58', 'ae4045c6e56c83c0b609802d70f3757d'),
      ('public.backfill_question_bank_metadata(text,uuid[],uuid,uuid,boolean)', '9461b7f69dfa69a2d8fc76e9adbec3d5', '6a51436b55c697df13a299e2855aeeb5'),
      ('public.create_admin_bank_question(text,jsonb,uuid,uuid)', 'aba6bac6673dea4a873c35a1f8de82ce', '588785628fef58bbd6ec56fd73f891c0'),
      ('public.create_admin_bank_questions_bulk(text,jsonb)', 'e41d97f6dcc333af1b98931282d8c579', '5c1ddbbac9bab64cdd3cd1898c6567d2'),
      ('public.update_admin_bank_question(uuid,text,jsonb,uuid,uuid)', '514d7bebfa27c01dc2199708864c5d68', 'df16a8b474306fb626a263a88dccec54')
    ) AS t(signature, applied_md5, original_md5)
  LOOP
    v_def := pg_get_functiondef(v_target.signature::regprocedure);
    IF md5(v_def) <> v_target.applied_md5 THEN
      RAISE EXCEPTION 'QUESTION_BANK_RPC_DEFINITION_CHANGED: %', v_target.signature;
    END IF;

    v_new := replace(v_def, 'public.is_owner()', 'public.is_admin()');
    IF md5(v_new) <> v_target.original_md5 THEN
      RAISE EXCEPTION 'QUESTION_BANK_RPC_RESTORE_MISMATCH: %', v_target.signature;
    END IF;

    EXECUTE v_new;
  END LOOP;
END;
$owner_only_down$;

NOTIFY pgrst, 'reload schema';
