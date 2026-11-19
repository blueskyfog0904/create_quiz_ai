-- 20261120110000_storefront_header_links 되돌리기: 헤더 링크 설정 행을 지운다.
-- 관리자가 그 뒤에 고친 링크도 함께 지워진다. 지우면 회원 헤더 오른쪽에 링크(크레딧 충전 포함)가 보이지 않는다.
DELETE FROM public.system_settings WHERE key = 'storefront_header_links';
