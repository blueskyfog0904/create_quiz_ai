-- 21번 묶음 6절 '문구': 관리자 대시보드의 정의 말풍선·빈 상태 문구(계획 docs/plan-bundle21-dashboard.md 6·7절).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤).
-- 언제: 21번 마이그레이션(20261223100000) 적용 뒤, push 전(11절 4). 행이 이미 있으면 그대로 둔다(ON CONFLICT DO NOTHING — 고친 문구를 덮지 않음).
-- 관리자 안내라 편집 화면이 없다. 문구를 고칠 때는 이 행의 value 를 SQL 로 바꾸고 revision 을 1 올린다.
-- 이 행은 로그인 회원 누구나 읽을 수 있는 system_settings 에 있으므로 내부 절차·계좌·담당자 정보를 넣지 않는다.
-- 키(src/lib/admin-dashboard-fields.ts DASHBOARD_CONTENT_KEYS 와 같은 목록): 값은 비지 않은 한 줄 글 1~300자.
--   help*  : 카드 정의 말풍선. 없거나 형식이 틀리면 그 말풍선만 숨긴다.
--   empty* : 빈 상태 문구. 없으면 빈 상태에 숫자만 보인다. publishedCount 의 {count} 는 공개 상품 수로 바뀐다.
-- 되돌리기: DELETE FROM public.system_settings WHERE key = 'admin_dashboard_content';(코드는 행이 없어도 화면을 그린다)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- [본문] 시작 (리허설이 이 구역만 떼어 돌린다) ---------------------------------------------------------------------------
INSERT INTO public.system_settings (key, value, description)
VALUES ('admin_dashboard_content', $json_bundle21_content$
{
  "revision": 1,
  "helpCharge": "실결제 충전의 결제 금액에서 같은 기간 환불 금액을 뺀 값입니다(부가세 포함). 결제는 승인 시각, 환불은 결제사 취소 시각(없으면 처리 시각) 기준이며 매출·정산 CSV 요약과 같은 정의입니다. 충전에는 과목이 없어 과목 선택과 무관합니다.",
  "helpMarket": "자료 구매 주문 기준입니다. 구매 시각 기준 사용 크레딧(뒤에 환불된 것 포함)에서 같은 기간에 승인된 자료 환불 크레딧을 뺀 값입니다. 매출·정산 CSV 의 '자료 구매 사용'은 크레딧 원장 기준이라 이 숫자와 다를 수 있습니다.",
  "helpSignups": "기간 안에 가입한 회원 수입니다(관리자 제외, 나중에 탈퇴한 회원도 가입 시점에는 셉니다). 회원에는 과목이 없어 과목 선택과 무관합니다.",
  "helpDownloads": "구매한 파일을 내려받은 횟수입니다. 샘플 내려받기는 기록되지 않아 들어가지 않습니다.",
  "emptyChargeChart": "이 기간 충전 결제 없음",
  "emptyMarketChart": "이 기간 판매 없음",
  "emptySignupsChart": "이 기간 가입 없음",
  "emptyDownloadsChart": "이 기간 다운로드 없음",
  "emptyDonut": "데이터 없음",
  "emptyOrdersRanking": "판매된 상품 없음",
  "emptyDownloadsRanking": "다운로드된 상품 없음",
  "publishedCount": "공개 상품 {count}개"
}
$json_bundle21_content$::jsonb, '21번: 관리자 대시보드 정의 말풍선·빈 상태 문구(SQL 로 고침, 회원도 읽을 수 있는 행 — 내부 정보 금지)')
ON CONFLICT (key) DO NOTHING;

DO $verify_bundle21_dashboard_content$
DECLARE
  v_value jsonb;
  v_key text;
BEGIN
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'admin_dashboard_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: admin_dashboard_content shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['helpCharge', 'helpMarket', 'helpSignups', 'helpDownloads', 'emptyChargeChart', 'emptyMarketChart',
                               'emptySignupsChart', 'emptyDownloadsChart', 'emptyDonut', 'emptyOrdersRanking', 'emptyDownloadsRanking',
                               'publishedCount'] LOOP
    IF jsonb_typeof(v_value -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value ->> v_key) = '' OR char_length(v_value ->> v_key) > 300
       OR (v_value ->> v_key) ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'VERIFY: admin_dashboard_content.%', v_key;
    END IF;
  END LOOP;
END;
$verify_bundle21_dashboard_content$;
-- [본문] 끝 -----------------------------------------------------------------------------------------------------------

SELECT key, value ->> 'revision' AS revision FROM public.system_settings WHERE key = 'admin_dashboard_content';
COMMIT;
