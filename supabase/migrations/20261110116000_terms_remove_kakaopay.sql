-- 약관에서 카카오페이 문구 제거 (DB-13, docs/admin-implementation-workplan.md W1-9b). 출시 스위치 전에 적용한다.
-- 카카오페이는 사용하지 않기로 했다(2026-10-29 결정, 2026-11-11 사용자 재확인). 결제 코드·DB는 꺼진 채 두고 약관 문구만 고친다.
-- B1과 같은 방식으로 실제 DB 문구의 정해진 경로에서 미리 확인한 조각(각각 정확히 1번 나옴)만 바꾼다.
--   policyDocuments.refundPolicy.content: 환불 경로 문장, 결제수단 안내 줄
--   policyDocuments.privacyPolicy.content: 6조 위탁 목록의 (주)카카오페이 줄(앞 줄바꿈과 함께 삭제)
-- '카카오 로그인' 문구는 그대로 둔다.
-- 적용 전 md5와 다르면(관리자 화면에서 고쳤으면) 아무것도 바꾸지 않고 멈춘다.
-- 적용 전 value 원문: supabase/rollback/20261110116000_terms_remove_kakaopay_before.json (md5 같음)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  c_expected_md5 constant text := '0eaa00b3ac686387a4c9110b2fc085ca';
  c_refund_pg_old constant text := '결제대행사(페이앱) 또는 카카오페이를 통해';
  c_refund_pg_new constant text := '결제대행사(페이앱)를 통해';
  c_refund_methods_old constant text := '휴대폰 결제와 카카오페이를 사용할 수 있습니다.';
  c_refund_methods_new constant text := '휴대폰 결제를 사용할 수 있습니다.';
  c_privacy_old constant text :=
    E'\n'
    || '- (주)카카오페이: 카카오페이 결제 승인, 결제 결과 확인 및 환불 처리 '
    || '(제공 정보: 주문번호, 상품명, 결제금액, 가명 처리된 회원 식별값)';
  c_privacy_new constant text := '';
  v_value jsonb;
  v_refund text;
  v_privacy text;
  v_count integer;
  v_text text;
BEGIN
  SELECT value INTO v_value
    FROM public.system_settings
   WHERE key = 'site_footer_content'
     AND md5(value::text) = c_expected_md5
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DB13: site_footer_content changed since dry-run';
  END IF;

  v_refund := v_value #>> '{policyDocuments,refundPolicy,content}';
  v_privacy := v_value #>> '{policyDocuments,privacyPolicy,content}';

  IF (length(v_refund) - length(replace(v_refund, c_refund_pg_old, ''))) / length(c_refund_pg_old) IS DISTINCT FROM 1
     OR (length(v_refund) - length(replace(v_refund, c_refund_methods_old, ''))) / length(c_refund_methods_old) IS DISTINCT FROM 1
     OR (length(v_privacy) - length(replace(v_privacy, c_privacy_old, ''))) / length(c_privacy_old) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'DB13: expected fragments not found exactly once';
  END IF;

  v_refund := replace(replace(v_refund, c_refund_pg_old, c_refund_pg_new), c_refund_methods_old, c_refund_methods_new);
  v_privacy := replace(v_privacy, c_privacy_old, c_privacy_new);

  UPDATE public.system_settings
     SET value = jsonb_set(
           jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund)),
           '{policyDocuments,privacyPolicy,content}', to_jsonb(v_privacy)),
         updated_at = now()
   WHERE key = 'site_footer_content'
     AND md5(value::text) = c_expected_md5;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'DB13: expected 1 updated row, got %', v_count;
  END IF;

  -- 검증: 카카오페이가 0건이고 새 문구가 들어갔으며, 카카오 로그인 문구와 고친 두 경로 밖은 그대로다.
  SELECT value::text INTO v_text FROM public.system_settings WHERE key = 'site_footer_content';
  IF position('카카오페이' IN v_text) > 0 THEN
    RAISE EXCEPTION 'VERIFY: kakaopay wording remains';
  END IF;
  IF position(c_refund_pg_new IN v_text) = 0
     OR position(c_refund_methods_new IN v_text) = 0
     OR position('(주)유디아이디(페이앱)' IN v_text) = 0
     OR (length(v_text) - length(replace(v_text, '카카오 로그인', ''))) / length('카카오 로그인')
        IS DISTINCT FROM (length(v_value::text) - length(replace(v_value::text, '카카오 로그인', ''))) / length('카카오 로그인') THEN
    RAISE EXCEPTION 'VERIFY: expected wording missing';
  END IF;
  IF (SELECT value #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,privacyPolicy,content}'
        FROM public.system_settings WHERE key = 'site_footer_content')
     IS DISTINCT FROM (v_value #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,privacyPolicy,content}') THEN
    RAISE EXCEPTION 'VERIFY: unrelated footer content changed';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
