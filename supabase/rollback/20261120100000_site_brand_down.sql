-- 20261120100000_site_brand 되돌리기: 사이트 이름 설정 행을 지운다.
-- 관리자가 그 뒤에 고친 값도 함께 지워진다. 지우면 헤더에 사이트 이름이 보이지 않고, 탭 제목은 화면 이름만 남는다.
DELETE FROM public.system_settings WHERE key = 'site_brand';
