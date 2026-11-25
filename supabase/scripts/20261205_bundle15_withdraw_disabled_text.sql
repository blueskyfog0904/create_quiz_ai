-- 15번 묶음 4-6: 고지 기간의 탈퇴 화면 막힘 문구(member_withdrawal_policy.texts.blockReasons.DISABLED).
-- 근거: 계획 docs/plan-bundle15-notice-popup.md 4-6·10절 0·9단계, 런북 docs/admin-operations-runbook.md RB-11.
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 15번 마이그레이션 없이도 돈다. 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다.
--
-- 왜: 10번 코드가 배포되면 스위치(selfAnonymizeEnabled)가 꺼진 동안 결제 회원의 탈퇴 요청과 결제 시도만 있는 비결제 회원의 익명화가
--   409(DISABLED)가 된다. 그때 문구("잠시 후 다시 이용해 주세요")는 기다리라는 뜻으로 읽혀, 고지가 약속한 '시행일 전 탈퇴(바뀌기 전 약관)'와 어긋난다.
-- 실행 방식 c_mode(기본 NULL — NULL 이면 멈춘다):
--   'notice'  — 10번 push·배포 전에 실행. 지금 값이 (1) 원래 운영 문구이거나 (2) 이 스크립트의 마지막 기록(details.after)과 글자까지 같을 때만
--               DISABLED 한 경로를 고지 기간 문구로 바꾼다. 시행일을 미루면 c_effective_date 를 고쳐 다시 실행한다(13절 6번).
--   'restore' — 스위치를 켤 때(런북 RB-11 10-2 5번과 같은 창) 또는 고지를 그만둘 때(4-3 withdraw_upcoming 뒤).
--               지금 값이 마지막 기록의 after(고지 문구)와 같을 때만 원래 문구로 되돌린다.
-- 마지막 기록: member_withdrawal_policy_update 가운데 details.bundle = 'bundle15_withdraw_disabled_text' 인 것을 details.saved_at(clock_timestamp())
--   순으로 고른다(created_at 은 거래 시작 시각이고 id 는 무작위라 한 거래 안의 순서를 가리지 못함).
-- 기록자: 대표(owner) 계정 중 가장 최근에 로그인한 계정(10번 스크립트와 같음).
-- 잠금: member_withdrawal_policy 행 잠금뿐이다(몇 밀리초). 실회원이 적은 새벽에 돌린다.
-- 이 문구는 탈퇴 화면 /mypage/withdraw 에서만 보인다. 10번 시행 스크립트는 이 경로를 사전 대조하지 않으므로 충돌하지 않는다.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $withdraw_disabled_text$
DECLARE
  c_mode constant text := NULL;
  -- 고지 문구의 날짜: 바뀔 약관의 시행일, 지금(바뀌기 전) 약관의 시행일
  c_effective_date constant date := DATE '2027-01-11';
  c_current_terms_date constant date := DATE '2026-11-23';
  -- 10번 마이그레이션이 넣은 운영 문구(2026-11-25 읽기 조회로 확인)
  c_original constant text := $q$지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요.$q$;
  c_path constant text[] := ARRAY['texts', 'blockReasons', 'DISABLED'];
  v_notice text;
  v_policy jsonb;
  v_new jsonb;
  v_current text;
  v_last_after text;
  v_target text;
  v_actor uuid;
  v_audit_before integer;
BEGIN
  IF c_mode IS NULL OR c_mode NOT IN ('notice', 'restore') THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: set c_mode to notice or restore';
  END IF;
  v_notice := '지금은 이 화면에서 탈퇴를 받을 수 없습니다. 고객센터(이메일·전화)로 탈퇴를 요청해 주세요. 요청일부터 10일 안에 처리해 이메일로 알려 드립니다. '
    || to_char(c_effective_date, 'YYYY"년" FMMM"월" FMDD"일"') || ' 전에 요청하시면 바뀌기 전 약관('
    || to_char(c_current_terms_date, 'YYYY"년" FMMM"월" FMDD"일"') || ' 시행)이 적용됩니다.';

  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: signed-in owner account not found';
  END IF;

  SELECT value INTO v_policy FROM public.system_settings WHERE key = 'member_withdrawal_policy' FOR UPDATE;
  IF v_policy IS NULL OR jsonb_typeof(v_policy #> c_path) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: member_withdrawal_policy texts.blockReasons.DISABLED missing';
  END IF;
  v_current := v_policy #>> c_path;
  SELECT a.details ->> 'after' INTO v_last_after FROM public.admin_audit_log a
   WHERE a.action = 'member_withdrawal_policy_update' AND a.details ->> 'bundle' = 'bundle15_withdraw_disabled_text'
   ORDER BY (a.details ->> 'saved_at')::timestamptz DESC LIMIT 1;

  IF c_mode = 'notice' THEN
    IF v_current IS DISTINCT FROM c_original AND v_current IS DISTINCT FROM v_last_after THEN
      RAISE EXCEPTION 'WITHDRAW_TEXT: DISABLED is neither the original text nor the last notice text — merge by hand';
    END IF;
    IF v_current = v_notice THEN
      RAISE EXCEPTION 'WITHDRAW_TEXT: DISABLED is already this notice text (nothing to do)';
    END IF;
    v_target := v_notice;
  ELSE
    IF v_last_after IS NULL OR v_current IS DISTINCT FROM v_last_after OR v_current = c_original THEN
      RAISE EXCEPTION 'WITHDRAW_TEXT: DISABLED is not the last notice text — nothing to restore or changed by hand';
    END IF;
    v_target := c_original;
  END IF;

  v_new := jsonb_set(v_policy, c_path, to_jsonb(v_target));
  -- 그 한 경로만 바뀐다(바꾼 경로를 되돌린 값 = 처음 값)
  IF jsonb_set(v_new, c_path, to_jsonb(v_current)) IS DISTINCT FROM v_policy THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: unexpected change outside DISABLED';
  END IF;

  SELECT count(*) INTO v_audit_before FROM public.admin_audit_log
   WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text';
  UPDATE public.system_settings SET value = v_new, updated_at = now() WHERE key = 'member_withdrawal_policy';
  PERFORM public.record_admin_audit(v_actor, 'member_withdrawal_policy_update', 'system_settings', 'member_withdrawal_policy', NULL, NULL,
    '15번 탈퇴 화면 막힘 문구(' || c_mode || ') — SQL 스크립트 supabase/scripts/20261205_bundle15_withdraw_disabled_text.sql',
    jsonb_build_object('bundle', 'bundle15_withdraw_disabled_text',
      'mode', c_mode,
      'changed_paths', jsonb_build_array('{texts,blockReasons,DISABLED}'),
      'before', v_current,
      'after', v_target,
      'saved_at', to_jsonb(clock_timestamp())),
    NULL);

  -- VERIFY
  IF (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy') IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy not saved';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log
       WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text') - v_audit_before <> 1 THEN
    RAISE EXCEPTION 'VERIFY: audit row';
  END IF;
  RAISE NOTICE 'WITHDRAW_TEXT OK: % → %', c_mode, v_target;
END;
$withdraw_disabled_text$;

COMMIT;

-- 확인 조회(읽기만): 기대값 — notice 뒤 disabled_text 가 고지 문구, restore 뒤 원래 문구. 마지막 기록의 after 가 disabled_text 와 같다.
SELECT (SELECT value #>> '{texts,blockReasons,DISABLED}' FROM public.system_settings WHERE key = 'member_withdrawal_policy') AS disabled_text,
       (SELECT details ->> 'mode' FROM public.admin_audit_log
         WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text'
         ORDER BY (details ->> 'saved_at')::timestamptz DESC LIMIT 1) AS last_mode,
       (SELECT details ->> 'after' FROM public.admin_audit_log
         WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text'
         ORDER BY (details ->> 'saved_at')::timestamptz DESC LIMIT 1) AS last_after,
       (SELECT count(*) FROM public.admin_audit_log
         WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text') AS audit_rows;
