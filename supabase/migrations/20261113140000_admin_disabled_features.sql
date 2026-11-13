-- 운영하지 않는 관리자 기능 묶음을 끈다(계획 U0-5, DB-F1). 사용자 결정 2026-11-13: 메뉴를 숨기고 페이지·API 접근도 막는다.
-- 묶음과 경로의 대응은 코드(src/lib/admin-features.ts), 꺼진 묶음 목록은 이 행이다.
--   question_bank 문제은행 / ai_generation AI 문제 유형·연결·생성 로그 / generate 문제생성 상품 / passages 지문
--   source_configs 출처 관리 / labels 표기값 관리 / signup_roles 회원가입 관리
-- 넣지 않는 묶음:
--   menu_management(메뉴관리): 사이트 로고 설정을 옮기고 결제 화면 헤더를 바꾼 뒤에 끈다(U0-5b).
--   landing_pages(랜딩페이지 관리): 옛 과목별 첫 화면(/korean, /english)과 /legacy가 아직 방문자에게 열려 있고
--     그 내용을 고치는 곳이 이 화면뿐이다(2026-11-13 확인). 그 화면들의 처리가 정해진 뒤에 끈다.
-- 순서: 묶음을 읽는 코드가 배포된 뒤에 적용한다(행이 없으면 아무것도 막지 않는다). 적용 후 최대 60초 안에 반영된다.
-- 다시 켜기: features 배열에서 해당 묶음을 뺀다. 되돌리기: supabase/rollback/20261113140000_admin_disabled_features_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'admin_disabled_features',
  '{"features": ["question_bank", "ai_generation", "generate", "passages", "source_configs", "labels", "signup_roles"]}'::jsonb,
  '운영하지 않는 관리자 기능 묶음(메뉴 숨김 + 페이지·API 차단). 묶음 정의: src/lib/admin-features.ts'
)
ON CONFLICT (key) DO NOTHING;
