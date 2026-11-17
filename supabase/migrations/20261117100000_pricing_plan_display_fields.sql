-- 충전 상품 화면(/pricing)의 표시 항목을 관리자가 고칠 수 있게 pricing_plans에 열 3개를 더한다.
-- 배경: 지금은 화면 코드가 정한다. "가장 인기"는 이름이 'Basic'인 상품, "최고 가성비"는 크레딧당 가격이 가장 싼 상품,
--       "N% 할인"은 맨 앞 상품 대비 자동 계산(1,000원 test 상품이 기준이 되어 Basic에 "91% 할인"이 잘못 나온다).
-- 만드는 것:
--   badge_text      카드 위 배지 문구. NULL이면 배지 없음. 앞뒤 공백 없는 1~20자.
--   is_highlighted  강조 카드(파란 테두리·강조 버튼) 여부. 기본 false.
--   discount_text   가격 아래 초록 배지 문구. NULL이면 없음. 앞뒤 공백 없는 1~20자.
-- 초기값: 지금 화면을 유지한다. 이름이 'Basic'인 행은 '가장 인기' + 강조, 크레딧당 가격이 가장 싼 활성 행은 '최고 가성비'
--         (Basic과 겹치면 Basic 우선). 할인 문구는 비워 둔다(자동 계산 값이 틀렸으므로). 이후 값은 관리자 요금제 화면에서 고친다.
-- 권한: anon·authenticated·service_role에 표 단위 SELECT/INSERT/UPDATE가 있어 새 열에 따로 GRANT하지 않는다. RLS 정책은 그대로다
--       (관리자만 쓰기, 활성 상품은 누구나 읽기).
-- 영향 없음: 결제 주문 생성은 id·name·price·credits만 읽고, get_my_payment_history()는 pp.name만 읽는다.
-- 잠금: 열과 CHECK를 더할 때 ACCESS EXCLUSIVE 잠금을 잡아 이 트랜잭션이 끝날 때까지 유지한다(표를 다시 쓰지 않아 짧다. 최대 3초 대기).
-- 되돌리기: supabase/rollback/20261117100000_pricing_plan_display_fields_down.sql (입력한 배지·강조·할인 문구가 모두 사라진다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.pricing_plans
  ADD COLUMN badge_text text,
  ADD COLUMN is_highlighted boolean NOT NULL DEFAULT false,
  ADD COLUMN discount_text text,
  ADD CONSTRAINT pricing_plans_badge_text_check
    CHECK (badge_text IS NULL OR (char_length(badge_text) BETWEEN 1 AND 20 AND badge_text !~ '^\s|\s$')),
  ADD CONSTRAINT pricing_plans_discount_text_check
    CHECK (discount_text IS NULL OR (char_length(discount_text) BETWEEN 1 AND 20 AND discount_text !~ '^\s|\s$'));

COMMENT ON COLUMN public.pricing_plans.badge_text IS '충전 상품 카드 위 배지 문구(예: 가장 인기). NULL이면 배지 없음.';
COMMENT ON COLUMN public.pricing_plans.is_highlighted IS '충전 상품 화면에서 강조 카드(파란 테두리·강조 버튼)로 보일지 여부.';
COMMENT ON COLUMN public.pricing_plans.discount_text IS '충전 상품 카드의 가격 아래 초록 배지 문구(예: 10% 추가 적립). NULL이면 없음.';

-- 초기값 ----------------------------------------------------------------------------------------------------------
UPDATE public.pricing_plans
   SET badge_text = '가장 인기',
       is_highlighted = true
 WHERE name = 'Basic';

UPDATE public.pricing_plans
   SET badge_text = '최고 가성비'
 WHERE is_active IS TRUE
   AND badge_text IS NULL
   AND credits > 0
   AND price::numeric / credits = (
         SELECT min(p.price::numeric / p.credits)
           FROM public.pricing_plans p
          WHERE p.is_active IS TRUE
            AND p.credits > 0
       );

NOTIFY pgrst, 'reload schema';
