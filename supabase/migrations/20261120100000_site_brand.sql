-- 사이트 이름·소개 문구를 관리자 "사이트 기본 정보"(/admin/footer)에서 고칠 수 있게, 지금 화면에 쓰는 값을 설정 행으로 처음 넣는다.
-- 키: site_brand (src/lib/site-brand.ts). 이미 있으면 건드리지 않는다(관리자가 고친 값 보존).
-- 헤더 이름, 브라우저 탭 제목(" | 사이트 이름"), 하단 이름(상호명이 비었을 때), 약관 화면이 이 값을 쓴다.
-- 읽기·쓰기는 서버 키(관리자 저장은 site.manage 서버 액션)로 한다. 정책 변경 없음.

INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'site_brand',
  $json${"name": "써머썬 연구소", "description": "영어와 국어 수업 자료를 과목별로 탐색하는 선생님용 문제마켓"}$json$::jsonb,
  'Site brand name and description (header, tab title, footer)',
  now()
)
ON CONFLICT (key) DO NOTHING;
