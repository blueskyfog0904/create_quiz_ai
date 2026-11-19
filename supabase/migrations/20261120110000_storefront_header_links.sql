-- 회원 화면 헤더 오른쪽 운영 링크를 관리자 "상단 메뉴"(/admin/storefront-menu)에서 고칠 수 있게, 지금 헤더의 "크레딧 충전" 링크를 설정 행으로 처음 넣는다.
-- 키: storefront_header_links (src/lib/storefront-header-links.ts). 이미 있으면 건드리지 않는다(관리자가 고친 값 보존).
-- 카테고리·국어·영어 탭은 화면 구조라 코드에 둔다. 읽기·쓰기는 서버 키(관리자 저장은 site.manage 서버 액션)로 한다. 정책 변경 없음.

INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'storefront_header_links',
  $json${"links": [{"label": "크레딧 충전", "href": "/pricing", "isActive": true, "emphasis": true}]}$json$::jsonb,
  'Member header (storefront) operator links',
  now()
)
ON CONFLICT (key) DO NOTHING;
