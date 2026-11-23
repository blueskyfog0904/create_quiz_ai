-- 9번 묶음 ④ + 8번 묶음 ⑤: 취소·환불정책·이용약관 본문과 충전 화면 문구(pricing_page_content)를 한 트랜잭션으로 고친다.
-- 근거: 계획 docs/plan-bundle9-payment-refund-notice.md 4절, 문구 docs/bundle9-copy-draft.md A·D·E, 8번 문구 docs/bundle8-copy-draft.md B(⑥ 은 9번 초안 E 로 바꿈).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 이 파일 전체를 한 번에 실행한다.
--
-- 실행 순서(반드시 이 뒤에):
--   1) 9번 마이그레이션 20261125100000_point_charge_policy 적용 → 2) 타입 재생성·코드 배포 → 3) 마이그레이션 VERIFY·사후 점검 통과
--   → 4) 이 스크립트. 실행 전부터 끝까지 관리자 '사이트 기본 정보(약관)'·'요금제(충전 화면 문구)' 화면 저장 금지(열린 화면은 닫고 다시 연다).
-- 한 트랜잭션이라 8번 본문(3-2절)과 9번 범위 문장('3-2절 ⑥' 참조)이 늘 함께 들어간다(어느 하나만 들어간 판이 생기지 않음).
-- site_footer_content 는 한 번만 UPDATE 해 약관 사본(policy_document_snapshots)이 refundPolicy·serviceTerms 1행씩만 늘어난다(privacyPolicy 는 그대로).
-- 사전 점검: 문서 3개 본문 md5, pricing_page_content md5 가 아래 값과 다르면(그사이 누가 고쳤으면) 아무것도 바꾸지 않고 멈춘다.
--   바꿀 문장은 각각 정확히 1번 있어야 한다.
-- 약관의 일수(충전 7일째·자료 30일째)는 문장 그대로 적고, VERIFY 가 DB 값(point_charge_policy.refundDays·market_purchase_policy.refundDays)과 대조한다.
--
-- 되돌리기: 바꾸기 전 값은 admin_audit_log(action site_footer_save·pricing_page_content_update, details.bundle = 'bundle9_policy_text')의
--   details.before 에 통째로 남는다. 되돌릴 때는 아래처럼 그 값으로 덮는다(사본은 추가 전용이라 되돌린 본문도 새 사본으로 남음 — 정상).
--   BEGIN;
--   UPDATE public.system_settings s
--      SET value = jsonb_set(jsonb_set(s.value, '{policyDocuments,refundPolicy,content}', a.details #> '{before,refundPolicy}'),
--                            '{policyDocuments,serviceTerms,content}', a.details #> '{before,serviceTerms}'), updated_at = now()
--     FROM (SELECT details FROM public.admin_audit_log WHERE action = 'site_footer_save' AND details->>'bundle' = 'bundle9_policy_text'
--            ORDER BY created_at DESC LIMIT 1) a
--    WHERE s.key = 'site_footer_content';
--   UPDATE public.system_settings s SET value = a.details -> 'before', updated_at = now()
--     FROM (SELECT details FROM public.admin_audit_log WHERE action = 'pricing_page_content_update' AND details->>'bundle' = 'bundle9_policy_text'
--            ORDER BY created_at DESC LIMIT 1) a
--    WHERE s.key = 'pricing_page_content';
--   COMMIT;
--   (되돌린 뒤에는 결제 화면·크레딧 화면 문구(point_charge_policy)와 약관이 다시 어긋나므로, 판매를 켜기 전에 이 스크립트를 고쳐 다시 실행한다.)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $policy_text$
DECLARE
  -- 사전 md5(2026-11-23 운영 DB 에서 읽은 값)
  c_refund_md5 constant text := '0bdffc66a6074b1a994d8d3da95ab8c7';
  c_terms_md5 constant text := '13336145f0a3036fd5431a8395029037';
  c_privacy_md5 constant text := 'ddcc8ba57de67025076f12638edeee76';
  c_pricing_md5 constant text := '2ca49365eb9d5f3ec9dd20d5b40866ca';

  -- ── 취소·환불정책: [old, new] 쌍(각 old 는 정확히 1번) ──────────────────────────────────────────────
  r_pairs text[][] := ARRAY[
    -- 8번 B-1: 1절
    ARRAY[$q$개별 상품 또는 이벤트 페이지에 별도 환불 조건이 표시된 경우 해당 조건이 우선 적용되며$q$,
          $q$개별 상품 또는 이벤트 페이지에 표시된 환불 조건이 이 정책보다 회원에게 유리한 경우 그 조건이 우선 적용되며$q$],
    -- 9번 A: 2절③(두 문장 전체)
    ARRAY[$q$결제일로부터 1년입니다. 기간이 경과한 크레딧은 사용이 제한될 수 있습니다.$q$,
          $q$결제한 때부터 1년(만료 일시는 크레딧 화면에 표시)이며, 기간이 지나면 남은 크레딧은 쓸 수 없습니다.$q$],
    -- 9번 A: 3절①
    ARRAY[$q$① 구매 후 7일 이내이고 해당 결제로 충전된 크레딧(포인트)을 1개도 사용하지 않은 경우 결제 취소 또는 환불을 요청할 수 있습니다.$q$,
          $q$① 결제일 다음 날부터 7일째 되는 날까지(크레딧 지급이 결제보다 늦어지면 지급일 다음 날부터), 해당 결제로 충전된 크레딧을 1개도 사용하지 않은 경우 크레딧 화면 또는 고객센터로 결제 취소(환불)를 요청할 수 있습니다.$q$],
    -- 8번 B-2: 3절③
    ARRAY[$q$구매한 디지털 자료, 문제지, 파일, 샘플 제외 자료를 다운로드 또는 열람한 경우 제공이 완료된 것으로 보아 환불이 제한될 수 있습니다.$q$,
          $q$문제마켓 자료의 환불은 아래 '3-2. 문제마켓 자료 환불'에 따릅니다.$q$],
    -- 9번 A: 3절④ 끝에 덧붙임
    ARRAY[$q$회사의 시스템 오류 또는 서비스 장애가 확인되는 경우 회사는 결제 취소, 환불 또는 크레딧 복구로 처리할 수 있습니다.$q$,
          $q$회사의 시스템 오류 또는 서비스 장애가 확인되는 경우 회사는 결제 취소, 환불 또는 크레딧 복구로 처리할 수 있습니다. 표시·광고나 계약 내용과 다르게 제공된 경우에는 제공받은 날부터 3개월, 그 사실을 안 날(또는 알 수 있었던 날)부터 30일 안에 취소할 수 있습니다.$q$],
    -- 8번 B-2: 3절⑤
    ARRAY[$q$단순 변심, 계정 공유, 부정 사용 또는 약관 위반으로 발생한 문제는 환불이 제한될 수 있습니다.$q$,
          $q$계정 공유, 부정 사용 또는 약관 위반이 확인되면 9절에 따라 조치할 수 있습니다. 다만 법령이 정한 청약철회는 제한하지 않습니다.$q$],
    -- 8번 B-3: 새 절 3-2(3절 ⑥ 다음, 4절 앞). ⑥ 은 9번 초안 E.
    ARRAY[$q$현금 결제 없이 제공된 혜택은 환불 대상에서 제외됩니다.$q$ || E'\n\n## 4. 환불 신청 절차',
          $q$현금 결제 없이 제공된 혜택은 환불 대상에서 제외됩니다.$q$ || E'\n\n' || concat_ws(E'\n',
            $q$## 3-2. 문제마켓 자료 환불$q$,
            $q$① 받지 않은 자료는 구매일 다음 날부터 30일째 되는 날 24시까지 환불을 신청할 수 있습니다. 자료 보관함에서 신청하거나, 회사가 표시한 연락처(1:1 문의·이메일·전화)로 환불 의사를 보낸 경우 그 시각을 신청 시각으로 봅니다.$q$,
            $q$② 다운로드한 자료는 단순 변심으로 환불할 수 없습니다. 자료 안의 파일을 하나라도 받으면 그 자료를 받은 것으로 보고, 문제(HWP)에 PDF 파일이 들어 있으면 HWP를 받을 때 문제(PDF)도 받은 것으로 봅니다. 구매한 자료와 관계없는 다른 자료를 받은 것은 환불 판단에 영향을 주지 않습니다.$q$,
            $q$③ 전체 패키지는 받지 않은 자료만큼 환불합니다. 금액은 낸 크레딧에 '환불할 자료의 정가 합 ÷ 구매 당시 구성 자료(문제 PDF 포함)의 정가 합'을 곱하고 1크레딧 미만은 버립니다. 환불로 남는 자료가 없게 되면 남은 금액을 모두 돌려드립니다. 받지 않은 자료는 한 번에 함께 환불되며, 환불 뒤에는 이미 받은 자료만 받을 수 있습니다. 남은 문제(PDF)는 문제(HWP) 차액 구매의 기준이 되지 않습니다.$q$,
            $q$④ 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 고객센터로 신청하면 환불해 드립니다. 하자 자료 몫의 환불이 원칙이지만, 그 하자로 패키지를 이용하려던 목적을 이룰 수 없으면 패키지 전체 환불을 요청할 수 있습니다.$q$,
            $q$⑤ HWP로 업그레이드한 PDF 주문은 업그레이드 주문을 먼저(또는 함께) 환불하면 환불할 수 있습니다. 하자가 있는 경우에는 두 주문을 함께 환불합니다.$q$,
            $q$⑥ 환불은 결제에 쓴 크레딧으로 돌려드립니다. 그 크레딧의 유효기간이 이미 지났거나 남은 기간이 짧으면, 구매할 때 남아 있던 기간만큼 쓸 수 있는 크레딧으로 다시 지급합니다. 이렇게 다시 받은 크레딧은 3절 ⑥의 무상 크레딧이 아니며 원래 충전 크레딧과 같게 봅니다(미성년자 결제 취소·서비스 종료 때 유료 크레딧으로 계산). 회사는 이 크레딧을 임의로 회수하지 않습니다. 다만 원래 충전 결제가 취소·환불되면, 확인하는 동안 그 결제에서 비롯해 다시 받은 크레딧은 사용이 보류되고, 취소·환불된 금액만큼 그 결제에서 비롯해 다시 받은 크레딧도 원래 충전 크레딧과 함께 회수하며(전액 취소면 남은 것 전부), 이미 쓴 몫은 담당자가 내역을 확인해 회원에게 알리고 정산합니다(미성년자 결제 취소는 7절에 따릅니다). 원래 충전 크레딧으로 되돌린 몫은 사용하지 않은 크레딧으로 보며, 그 현금 환불은 2절·3절에 따릅니다. 결제에 쓴 충전 크레딧에 현금 환불 이력이 있으면 담당자가 내역을 확인해 개별로 정산합니다.$q$,
            $q$⑦ 환불 신청은 3영업일 안에 처리합니다(결제 취소가 진행 중이면 그 처리 뒤). 받지 않은 자료의 환불 신청은 판정 근거가 바뀐 경우나 그 자료를 실제로 받은 사실이 확인된 경우에만 거절합니다. 하자·소개와 다름 주장을 받아들이지 않을 때를 포함해, 거절할 때는 언제나 사유를 알려 드립니다.$q$
          ) || E'\n\n## 4. 환불 신청 절차'],
    -- 8번 B-4: 4절 끝
    ARRAY[$q$회원이 합리적인 기간 내에 자료를 제출하지 않으면 신청이 보류 또는 취소될 수 있습니다.$q$,
          $q$회원이 합리적인 기간 내에 자료를 제출하지 않으면 신청이 보류 또는 취소될 수 있습니다. 다만 받지 않은 자료의 환불은 다운로드 기록으로 판단하며, 자료 보완 요청은 하자·오류를 주장하는 경우에만 합니다.$q$],
    -- 9번 A: 5절 끝
    ARRAY[$q$환불 승인 후 실제 입금 또는 한도 복구 시점은 결제수단 제공사의 정책에 따릅니다.$q$,
          $q$환불 승인 후 실제 입금 또는 한도 복구 시점은 결제수단 제공사의 정책에 따릅니다. 회사 사정으로 환급이 늦어지면 관련 법령에 따른 지연배상금을 지급합니다.$q$],
    -- 8번 B-5: 6절 끝
    ARRAY[$q$디지털 자료, 다운로드 권한, 구매 권한은 회수되거나 제한될 수 있습니다.$q$,
          $q$디지털 자료, 다운로드 권한, 구매 권한은 회수되거나 제한될 수 있습니다. 패키지 일부 환불은 환불된 자료의 다운로드 권한만 회수합니다.$q$],
    -- 9번 A: 8절 끝(환산식)
    ARRAY[$q$원 결제수단으로 환불하고, 원 결제수단으로 환불할 수 없으면 회원이 지정한 본인 명의 계좌로 환불합니다.$q$,
          $q$원 결제수단으로 환불하고, 원 결제수단으로 환불할 수 없으면 회원이 지정한 본인 명의 계좌로 환불합니다. 환불 금액은 남은 유료 크레딧 × (그 충전의 결제 금액 − 이미 환불한 금액) ÷ (지급 크레딧(보너스 포함) − 회수한 크레딧)으로 계산하며 1원 미만은 버립니다. 유효기간이 지나지 않은 크레딧만 계산하고, 자료 환불로 다시 받은 크레딧은 원래 충전분으로 계산합니다.$q$],
    -- 8번 B-6: 9절 끝
    ARRAY[$q$계정 이용제한 등 필요한 조치를 할 수 있습니다.$q$,
          $q$계정 이용제한 등 필요한 조치를 할 수 있습니다. 환불 보류는 사실 확인에 필요한 기간에 한하며 그 사유를 알려 드리고, 확인되지 않으면 바로 처리합니다. 법령이 정한 청약철회는 제한하지 않습니다.$q$],
    -- 9번 A: '포인트 충전 심사 필수 안내' 첫 줄(범위 문장 포함)
    ARRAY[$q$- 충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.$q$,
          $q$- 충전한 크레딧은 결제한 때부터 1년 동안 쓸 수 있고(만료 일시는 크레딧 화면에 표시), 기간이 지나면 남은 크레딧은 쓸 수 없습니다. 단순 변심에 따른 결제 취소(환불)는 결제일 다음 날부터 7일째 되는 날까지, 그 충전 건의 크레딧을 하나도 쓰지 않았을 때 신청할 수 있습니다. 충전한 크레딧의 이용기간과 단순 변심에 따른 환불 신청 기간은 모두 결제한 때부터 1년을 넘지 않습니다(자료 환불로 다시 받은 크레딧의 이용기간은 3-2절 ⑥, 결제 오류·표시와 다른 제공·미성년자·서비스 종료는 3절④·7절·8절).$q$],
    -- 9번 A: 같은 안내 넷째 줄
    ARRAY[$q$- 구매 후 7일 이내이고 해당 충전 크레딧을 전혀 사용하지 않은 경우에만 환불을 요청할 수 있습니다.$q$,
          $q$- 단순 변심에 따른 환불은 결제일 다음 날부터 7일째 되는 날까지, 해당 충전 크레딧을 전혀 쓰지 않았을 때 마이페이지 크레딧 화면 또는 고객센터로 요청할 수 있습니다(결제 오류·미성년자 결제·서비스 종료는 3절④·7절·8절).$q$]
  ];

  -- ── 이용약관 ──────────────────────────────────────────────────────────────────────────────────────
  t_pairs text[][] := ARRAY[
    -- 9번 A: '크레딧(충전형 포인트) 이용조건' 첫 문장
    ARRAY[$q$충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.$q$,
          $q$충전한 크레딧의 이용기간은 결제한 때부터 1년이며, 단순 변심에 따른 결제 취소(환불)는 결제일 다음 날부터 7일째 되는 날까지 그 충전 건을 쓰지 않았을 때 신청할 수 있습니다.$q$],
    -- 9번 A: 13조 끝
    ARRAY[$q$구매 자료를 내려받을 수 있는 기간을 종료 안내와 함께 알립니다.$q$,
          $q$구매 자료를 내려받을 수 있는 기간을 종료 안내와 함께 알립니다. 환불 금액 계산은 취소·환불정책 8절에 따릅니다.$q$]
  ];

  -- ── 충전 화면(pricing_page_content): [경로, old, new] ──────────────────────────────────────────────
  p_paths text[][] := ARRAY[
    ARRAY['{notice_items,0,body}', $q$결제일로부터 {사용기한}년. 문제마켓 자료 구매에 씁니다.$q$,
          $q$결제한 때부터 {사용기한}년 동안 쓸 수 있습니다(만료 일시는 크레딧 화면에 표시).$q$],
    ARRAY['{notice_items,1,body}', $q$구매 후 {환불기간}일 안에 1개도 쓰지 않았다면 환불을 요청할 수 있습니다(원 결제수단으로 환불).$q$,
          $q$결제일 다음 날부터 {환불기간}일째 되는 날까지 1개도 쓰지 않았다면 환불을 요청할 수 있습니다(원 결제수단으로 취소, 휴대폰 결제는 결제한 달이 지나면 본인 명의 계좌로 환불).$q$],
    ARRAY['{refund_items,1}', $q$구매한 크레딧은 결제일로부터 {사용기한}년 동안 사용할 수 있으며, 환불은 구매 후 {환불기간}일 이내에 크레딧을 1개도 사용하지 않은 경우 가능합니다.$q$,
          $q$구매한 크레딧은 결제한 때부터 {사용기한}년 동안 쓸 수 있으며, 환불은 결제일 다음 날부터 {환불기간}일째 되는 날까지 크레딧을 1개도 쓰지 않은 경우 가능합니다.$q$],
    ARRAY['{refund_items,2}', $q$문제마켓 자료의 다운로드/열람이 완료된 사용분은 환불이 제한됩니다.$q$,
          $q$문제마켓 자료 환불은 자료를 받지 않았을 때 구매일 다음 날부터 30일째 되는 날까지 신청할 수 있으며, 환불되면 결제에 쓴 크레딧으로 돌아옵니다(자세한 기준은 취소·환불정책).$q$],
    ARRAY['{refund_items,5}', $q$승인된 환불은 결제 당시 사용한 원 결제수단으로 처리되며, 카드·간편결제는 결제사 기준 영업일 2~5일이 소요될 수 있습니다.$q$,
          $q$승인된 환불은 결제 당시 쓴 원 결제수단으로 취소합니다(휴대폰 결제는 결제한 달이 지나면 본인 명의 계좌로 환불). 카드·간편결제는 결제사 기준 영업일 2~5일이 걸릴 수 있습니다.$q$],
    ARRAY['{summary_note}', $q$문제마켓 이용에 쓰는 선불 크레딧입니다. 사용 기한 {사용기한}년, 자동결제 없음. 구매 후 {환불기간}일 안에 1개도 쓰지 않았다면 환불을 요청할 수 있습니다.$q$,
          $q$문제마켓 이용에 쓰는 선불 크레딧입니다. 결제한 때부터 {사용기한}년, 자동결제 없음. 결제일 다음 날부터 {환불기간}일째 되는 날까지 1개도 쓰지 않았다면 환불을 요청할 수 있습니다.$q$]
  ];

  c_old_phrases constant text[] := ARRAY['1년 이내', '결제시점으로부터', '결제일로부터', '구매 후 7일 이내', '구매 후 {환불기간}일', '5절 ⑥'];

  v_footer jsonb;
  v_footer_before jsonb;
  v_pricing_before jsonb;
  v_check jsonb;
  v_pricing jsonb;
  v_pricing_new jsonb;
  v_refund text;
  v_terms text;
  v_privacy text;
  v_refund_new text;
  v_terms_new text;
  v_point_days integer;
  v_market_days integer;
  v_actor uuid;
  v_snap_before integer;
  v_count integer;
  v_text text;
  v_section text;
  v_num text;
  v_orders jsonb;
  i integer;

BEGIN
  -- 0. 9번 DB·8번 DB 가 적용돼 있어야 한다.
  IF to_regclass('public.point_charge_checkout_acks') IS NULL
     OR to_regprocedure('public.point_charge_refund_days()') IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 9 migration not applied';
  END IF;
  v_point_days := public.point_charge_refund_days();
  IF v_point_days IS NULL OR v_point_days > 365 THEN
    RAISE EXCEPTION 'POLICY_TEXT: point_charge_policy.refundDays invalid (%)', v_point_days;
  END IF;
  SELECT (value->>'refundDays')::integer INTO v_market_days FROM public.system_settings WHERE key = 'market_purchase_policy';
  IF v_market_days IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: market_purchase_policy.refundDays missing';
  END IF;

  -- 기록자: 가장 먼저 만든 대표 계정(스크립트 실행 기록 — 사람 ID 를 파일에 적지 않음)
  SELECT id INTO v_actor FROM public.profiles WHERE is_admin IS TRUE AND admin_role = 'owner' ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: owner account not found';
  END IF;

  -- 1. 잠그고 사전 md5
  SELECT value INTO v_footer FROM public.system_settings WHERE key = 'site_footer_content' FOR UPDATE;
  SELECT value INTO v_pricing FROM public.system_settings WHERE key = 'pricing_page_content' FOR UPDATE;
  v_footer_before := v_footer;
  v_pricing_before := v_pricing;
  v_refund := v_footer #>> '{policyDocuments,refundPolicy,content}';
  v_terms := v_footer #>> '{policyDocuments,serviceTerms,content}';
  v_privacy := v_footer #>> '{policyDocuments,privacyPolicy,content}';
  IF md5(v_refund) IS DISTINCT FROM c_refund_md5 OR md5(v_terms) IS DISTINCT FROM c_terms_md5
     OR md5(v_privacy) IS DISTINCT FROM c_privacy_md5 THEN
    RAISE EXCEPTION 'POLICY_TEXT: policy documents changed since dry-run (refund %, terms %, privacy %)',
      md5(v_refund), md5(v_terms), md5(v_privacy);
  END IF;
  IF md5(v_pricing::text) IS DISTINCT FROM c_pricing_md5 THEN
    RAISE EXCEPTION 'POLICY_TEXT: pricing_page_content changed since dry-run (%)', md5(v_pricing::text);
  END IF;

  -- 2. 바꿀 문장이 각각 정확히 1번 있는지 확인한 뒤 바꾼다(앞 교체가 뒤 확인 대상을 건드리지 않게 하나씩 확인·교체).
  v_refund_new := v_refund;
  FOR i IN 1 .. array_length(r_pairs, 1) LOOP
    IF (length(v_refund_new) - length(replace(v_refund_new, r_pairs[i][1], ''))) / length(r_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: refundPolicy fragment % not found exactly once', i;
    END IF;
    v_refund_new := replace(v_refund_new, r_pairs[i][1], r_pairs[i][2]);
  END LOOP;
  -- 2절③ 원래 두 문장이 따로도 1번씩 있었는지(문장 전체 교체 확인)
  IF (length(v_refund) - length(replace(v_refund, '결제일로부터 1년입니다.', ''))) / length('결제일로부터 1년입니다.') <> 1
     OR (length(v_refund) - length(replace(v_refund, '기간이 경과한 크레딧은 사용이 제한될 수 있습니다.', '')))
        / length('기간이 경과한 크레딧은 사용이 제한될 수 있습니다.') <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: refundPolicy 2-3 sentences not found exactly once';
  END IF;

  v_terms_new := v_terms;
  FOR i IN 1 .. array_length(t_pairs, 1) LOOP
    IF (length(v_terms_new) - length(replace(v_terms_new, t_pairs[i][1], ''))) / length(t_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: serviceTerms fragment % not found exactly once', i;
    END IF;
    v_terms_new := replace(v_terms_new, t_pairs[i][1], t_pairs[i][2]);
  END LOOP;

  v_pricing_new := v_pricing;
  FOR i IN 1 .. array_length(p_paths, 1) LOOP
    IF (v_pricing #>> p_paths[i][1]::text[]) IS DISTINCT FROM p_paths[i][2] THEN
      RAISE EXCEPTION 'POLICY_TEXT: pricing_page_content % differs', p_paths[i][1];
    END IF;
    v_pricing_new := jsonb_set(v_pricing_new, p_paths[i][1]::text[], to_jsonb(p_paths[i][3]));
  END LOOP;

  -- 3. 저장(site_footer_content 는 한 번만 UPDATE — 사본 트리거가 문서별 1행)
  SELECT count(*) INTO v_snap_before FROM public.policy_document_snapshots;
  UPDATE public.system_settings
     SET value = jsonb_set(jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund_new)),
                           '{policyDocuments,serviceTerms,content}', to_jsonb(v_terms_new)),
         updated_at = now()
   WHERE key = 'site_footer_content';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: site_footer_content update rows %', v_count;
  END IF;
  UPDATE public.system_settings SET value = v_pricing_new, updated_at = now() WHERE key = 'pricing_page_content';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: pricing_page_content update rows %', v_count;
  END IF;

  -- 4. 작업 기록(바꾸기 전 값 통째로 — 되돌리기 근거). 출시 전 오기 정정: 지금까지의 충전 결제 현황을 근거로 함께 남긴다.
  SELECT jsonb_build_object(
           'by_provider_status', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
               SELECT o.provider || ':' || o.status AS k, count(*) AS n FROM public.payment_orders o
                WHERE o.status IN ('completed', 'refunded', 'manual_review') GROUP BY 1) x), '{}'::jsonb),
           'distinct_payers', (SELECT count(DISTINCT o.user_id) FROM public.payment_orders o WHERE o.status IN ('completed', 'refunded', 'manual_review')))
    INTO v_orders;
  PERFORM public.record_admin_audit(v_actor, 'site_footer_save', 'site_footer', 'site_footer_content', NULL, NULL,
    '출시 전 오기 정정(9번 ④ 충전 환불 기간·이용기간 문구 + 8번 ⑤ 자료 환불 3-2절) — SQL 스크립트 supabase/scripts/20261124_bundle9_policy_text.sql',
    jsonb_build_object('bundle', 'bundle9_policy_text',
      'before', jsonb_build_object('refundPolicy', v_refund, 'serviceTerms', v_terms),
      'before_md5', jsonb_build_object('refundPolicy', md5(v_refund), 'serviceTerms', md5(v_terms), 'privacyPolicy', md5(v_privacy)),
      'after_md5', jsonb_build_object('refundPolicy', md5(v_refund_new), 'serviceTerms', md5(v_terms_new), 'privacyPolicy', md5(v_privacy)),
      'existing_charge_orders', v_orders),
    NULL);
  PERFORM public.record_admin_audit(v_actor, 'pricing_page_content_update', 'pricing_page_content', 'pricing_page_content', NULL, NULL,
    '출시 전 오기 정정(9번 ④ 충전 화면 환불 기간·이용기간 문구) — SQL 스크립트 supabase/scripts/20261124_bundle9_policy_text.sql',
    jsonb_build_object('bundle', 'bundle9_policy_text', 'before', v_pricing, 'after', v_pricing_new,
      'changed_paths', to_jsonb(ARRAY(SELECT p_paths[j][1] FROM generate_subscripts(p_paths, 1) j ORDER BY j))),
    NULL);

  -- 5. VERIFY(④·⑤ 함께) ─────────────────────────────────────────────────────────────────────────────
  SELECT value INTO v_footer FROM public.system_settings WHERE key = 'site_footer_content';
  SELECT value INTO v_pricing FROM public.system_settings WHERE key = 'pricing_page_content';
  v_refund := v_footer #>> '{policyDocuments,refundPolicy,content}';
  v_terms := v_footer #>> '{policyDocuments,serviceTerms,content}';
  IF v_refund IS DISTINCT FROM v_refund_new OR v_terms IS DISTINCT FROM v_terms_new
     OR md5(v_footer #>> '{policyDocuments,privacyPolicy,content}') <> c_privacy_md5 THEN
    RAISE EXCEPTION 'VERIFY: saved documents differ';
  END IF;

  -- 5-1. 옛 표현 0건(환불정책·이용약관·충전 화면)
  FOR i IN 1 .. array_length(c_old_phrases, 1) LOOP
    IF position(c_old_phrases[i] IN v_refund) > 0 OR position(c_old_phrases[i] IN v_terms) > 0
       OR position(c_old_phrases[i] IN v_pricing::text) > 0 THEN
      RAISE EXCEPTION 'VERIFY: old phrase remains: %', c_old_phrases[i];
    END IF;
  END LOOP;

  -- 5-2. '1년을 넘지 않습니다' 는 범위 문장으로만 1번
  IF (length(v_refund) - length(replace(v_refund, '1년을 넘지 않습니다', ''))) / length('1년을 넘지 않습니다') <> 1
     OR position('모두 결제한 때부터 1년을 넘지 않습니다(자료 환불로 다시 받은 크레딧의 이용기간은 3-2절 ⑥' IN v_refund) = 0
     OR position('1년을 넘지 않습니다' IN v_terms) > 0 THEN
    RAISE EXCEPTION 'VERIFY: scope sentence';
  END IF;

  -- 5-3. 범위 문장이 가리키는 3-2절 ⑥ 이 있고, 그 ⑥ 에 다시 지급한 크레딧의 유효기간 문장이 있다
  IF (length(v_refund) - length(replace(v_refund, E'\n## 3-2. 문제마켓 자료 환불\n', ''))) / length(E'\n## 3-2. 문제마켓 자료 환불\n') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: section 3-2 missing';
  END IF;
  v_section := split_part(substr(v_refund, position(E'\n## 3-2. 문제마켓 자료 환불\n' IN v_refund) + 1), E'\n## ', 1);
  IF position(E'\n⑥ 환불은 결제에 쓴 크레딧으로 돌려드립니다.' IN v_section) = 0
     OR position('구매할 때 남아 있던 기간만큼 쓸 수 있는 크레딧으로 다시 지급합니다' IN v_section) = 0
     OR position('원래 충전 크레딧과 같게 봅니다' IN v_section) = 0 THEN
    RAISE EXCEPTION 'VERIFY: section 3-2 ⑥';
  END IF;
  IF position('3-2. 문제마켓 자료 환불''에 따릅니다' IN v_refund) = 0 THEN
    RAISE EXCEPTION 'VERIFY: 3-③ reference to 3-2';
  END IF;

  -- 5-4. 약관의 일수 = DB 값(충전: '결제일 다음 날부터 N일째', 자료: '구매일 다음 날부터 N일째')
  SELECT count(*) INTO v_count FROM regexp_matches(v_refund || E'\n' || v_terms, '결제일 다음 날부터 ([0-9]+)일째', 'g') m;
  IF v_count < 4 THEN
    RAISE EXCEPTION 'VERIFY: point charge day sentences % (expected >= 4)', v_count;
  END IF;
  FOR v_num IN SELECT m[1] FROM regexp_matches(v_refund || E'\n' || v_terms, '결제일 다음 날부터 ([0-9]+)일째', 'g') m LOOP
    IF v_num::integer <> v_point_days THEN
      RAISE EXCEPTION 'VERIFY: point charge days in terms % <> refundDays %', v_num, v_point_days;
    END IF;
  END LOOP;
  FOR v_num IN SELECT m[1] FROM regexp_matches(v_refund || E'\n' || v_pricing::text, '구매일 다음 날부터 ([0-9]+)일째', 'g') m LOOP
    IF v_num::integer <> v_market_days THEN
      RAISE EXCEPTION 'VERIFY: material refund days % <> market refundDays %', v_num, v_market_days;
    END IF;
  END LOOP;
  IF position('{환불기간}일째' IN v_pricing::text) = 0 THEN
    RAISE EXCEPTION 'VERIFY: pricing refund placeholder';
  END IF;

  -- 5-5. 고친 곳 밖은 그대로(약관 묶음의 다른 키·문서, 충전 화면의 다른 키)
  IF (v_footer #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,serviceTerms,content}')
     IS DISTINCT FROM (v_footer_before #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,serviceTerms,content}') THEN
    RAISE EXCEPTION 'VERIFY: unrelated footer content changed';
  END IF;
  v_check := v_pricing;
  FOR i IN 1 .. array_length(p_paths, 1) LOOP
    IF (v_pricing #>> p_paths[i][1]::text[]) IS DISTINCT FROM p_paths[i][3] THEN
      RAISE EXCEPTION 'VERIFY: pricing % not saved', p_paths[i][1];
    END IF;
    v_check := jsonb_set(v_check, p_paths[i][1]::text[], to_jsonb(p_paths[i][2]));
  END LOOP;
  IF v_check IS DISTINCT FROM v_pricing_before THEN
    RAISE EXCEPTION 'VERIFY: unrelated pricing content changed';
  END IF;

  -- 5-6. 사본: refundPolicy·serviceTerms 1행씩만 늘고, 최신 사본 = 새 본문
  SELECT count(*) INTO v_count FROM public.policy_document_snapshots;
  IF v_count - v_snap_before <> 2 THEN
    RAISE EXCEPTION 'VERIFY: snapshots added % (expected 2)', v_count - v_snap_before;
  END IF;
  IF (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'refundPolicy' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_refund_new, 'UTF8')), 'hex')
     OR (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'serviceTerms' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_terms_new, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'VERIFY: latest snapshots differ';
  END IF;
END;
$policy_text$;

COMMIT;
