-- 20261117100000_pricing_plan_display_fields 되돌리기: pricing_plans의 표시용 열 3개(badge_text·is_highlighted·discount_text)를 없앤다.
-- 먼저 이 열들을 쓰는 앱 코드(관리자 요금제 화면의 저장)를 되돌린다. 열이 없는데 저장하면 "열을 찾지 못했다"는 오류로 저장이 실패한다.
-- 회원용 충전 상품 화면은 열이 없어도 깨지지 않는다(배지·강조·할인 문구 없이 그린다).
-- 사라지는 것: 관리자가 입력한 배지 문구·강조 여부·할인 문구 전부. 상품의 이름·가격·크레딧·판매 상태는 그대로다.
-- pricing_plans에서 열을 뺄 때 ACCESS EXCLUSIVE 잠금을 잠깐 잡는다(최대 3초 대기).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.pricing_plans
  DROP CONSTRAINT pricing_plans_discount_text_check,
  DROP CONSTRAINT pricing_plans_badge_text_check,
  DROP COLUMN discount_text,
  DROP COLUMN is_highlighted,
  DROP COLUMN badge_text;

NOTIFY pgrst, 'reload schema';
