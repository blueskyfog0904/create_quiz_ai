-- 사용자 쪽 옛 기능을 닫는다. 사용자 결정 2026-11-13: 문제마켓만 운영하고, 옛 사이트는 전체를 닫아 둔다(나중에 이어서 구현할 수 있게 코드·데이터는 그대로).
-- 묶음과 경로의 대응은 코드(src/lib/site-features.ts), 닫힌 묶음 목록은 이 행이다.
--   site_generate AI 문제 생성 / site_question_bank 문제은행 / site_exam_papers 시험지 / site_passages 지문 만들기·내 지문
--   site_legacy_library 옛 보관함 / site_legacy_mypage 옛 마이페이지 / site_legacy_landing 옛 첫 화면(/korean, /english, /legacy)
--   site_preview 디자인 시안 화면(/preview/*)
-- 닫힌 묶음의 페이지는 문제마켓의 대응 화면으로 이동(307)하고, API는 404, AI를 부르는 서버 액션은 실패한다.
-- 묶음끼리의 의존(다시 켤 때):
--   site_generate는 site_legacy_library(생성 결과 저장·확인)가 함께 켜져 있어야 한다.
--   관리자 ai_generation(문제 유형 테스트 화면)의 지문 수정·삭제는 site_passages가 켜져 있어야 한다.
-- 순서: 묶음을 읽는 코드가 배포된 뒤에 적용한다(행이 없으면 아무것도 닫지 않는다). 적용 후 최대 60초 안에 반영된다.
-- 다시 켜기: features 배열에서 해당 묶음을 뺀다. 되돌리기: supabase/rollback/20261113160000_site_disabled_features_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'site_disabled_features',
  '{"features": ["site_generate", "site_question_bank", "site_exam_papers", "site_passages", "site_legacy_library", "site_legacy_mypage", "site_legacy_landing", "site_preview"]}'::jsonb,
  '닫아 둔 사용자 쪽 옛 기능 묶음(페이지는 문제마켓으로 이동, API·AI 액션 차단). 묶음 정의: src/lib/site-features.ts'
)
ON CONFLICT (key) DO NOTHING;
