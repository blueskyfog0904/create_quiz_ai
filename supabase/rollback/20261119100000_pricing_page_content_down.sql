-- 20261119100000_pricing_page_content 되돌리기: 충전 화면 문구 설정 행을 지운다.
-- 관리자가 그 뒤에 고친 문구도 함께 지워진다. 지우면 충전 화면에서 배너·확인 사항·환불 정책이 보이지 않는다.
DELETE FROM public.system_settings WHERE key = 'pricing_page_content';
