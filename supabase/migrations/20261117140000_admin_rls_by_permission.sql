-- 관리자 RLS를 계정별 권한에 맞춘다(계획 4-1절 "RLS", DB-P3, 단위 U3-8).
-- 배경: 관리자용 정책이 모두 is_admin()(또는 같은 뜻의 EXISTS(profiles.is_admin = true))이라, 권한이 적은 일반 관리자(staff)도
--       자기 로그인 세션으로 PostgREST에 직접 요청하면 요금제·시스템 설정(기능 차단 설정 포함)·상품 등을 바꿀 수 있었다.
--       앱의 화면·API·서버 액션 가드(U3-3)는 DB 직접 요청을 막지 못한다. 이 파일이 그 아래 칸을 막는다.
-- 원칙:
--   - 대표(owner)의 동작은 바뀌지 않는다: 새 조건은 is_owner() 또는 has_admin_permission(...)이고, 둘 다 대표에게는 참이다.
--     (예외: 돈 표의 관리자 "쓰기" 정책은 대표 것도 없앤다. 앱은 그 표를 service role로만 쓴다 — 아래 1절.)
--   - 회원·비로그인(anon)의 정책(공개 조회, 본인 행, 회원 정책 안의 "OR is_admin()")은 건드리지 않는다. 관리자 전용 정책만 바꾼다.
--   - 조회 정책은 권한별로 나누지 않는다(계획 4-1절): 문의·환불·주문·크레딧 화면과 대시보드 건수(admin-work-summary-server.ts)가
--     관리자 세션으로 profiles·support_tickets·market_refund_requests를 읽어, 권한별로 바꾸면 오류 없이 0건·빈 이메일이 된다.
--     예외: 꺼 둔 기능의 표(AI 연결 키 포함)는 조회까지 대표 전용, admin_events는 이벤트의 required_permission으로 거른다.
--   - 새 정책은 모두 TO authenticated, 함수는 (SELECT …)로 감싸 문장당 한 번만 계산한다(Supabase RLS 성능 권고).
--     admin_events만 행의 열(required_permission)을 인자로 받아 행마다 계산한다(이벤트는 하루 수십 건 규모).
--   - has_admin_permission()은 "함께 필요한 권한"을 보지 않는다. 그래서 의존이 있는 권한은 의존 권한까지 함께 적는다
--     (products.delete → products.edit, credits.grant → members.view·credits.view. 목록은 src/lib/admin-permissions.ts).
-- 표 → 권한(앱 가드 tests/admin-guard-coverage-contract.test.mjs와 같은 대응):
--   1. 돈      credit_sources, payment_history, refund_requests, market_purchases      관리자 쓰기 제거, 조회는 is_admin() 유지
--              market_entitlements, market_purchase_orders, market_purchase_lines,
--              market_refund_requests                                                  관리자 ALL 제거(조회는 회원 정책의 "OR is_admin()")
--              → 앱의 쓰기는 모두 service role(credits.ts, market-items-server.ts, market-refunds.ts, payment-*-server.ts).
--   2. 상품    market_items 외 8개                                                     쓰기는 products.edit (market_items DELETE는 products.edit + products.delete)
--              → 앱은 service role로만 쓴다(market-items-server.ts 등). 정책은 대표·상품 권한자의 직접 쓰기만 남긴다.
--              → 조회는 is_admin() 유지: 환불 화면(admin/refunds/page.tsx)이 관리자 세션으로 market_refund_requests에
--                market_items(title)을 조인한다. 상품 조회를 products.edit로 좁히면 상품 권한이 없는 staff(예: 'CS 기본')에게
--                숨김·초안·삭제 상품 이름이 오류 없이 빈칸이 된다.
--   3. 문의    support_tickets UPDATE, support_ticket_categories INSERT·UPDATE          support.manage (관리자 세션으로 씀: api/admin/support/**)
--      알림    notifications INSERT                                                    support.manage 또는 credits.grant(+의존)
--              → 관리자 세션 INSERT 2곳(api/admin/support/tickets/[id]/route.ts:60, api/admin/users/credits/route.ts:62)이 남아 있어
--                정책을 없애지 못한다. 두 곳을 service role로 옮기면(코드 먼저) 이 정책을 지운다.
--   4. 설정    pricing_plans                                                           pricing.manage (관리자 세션으로 씀: admin/pricing/actions.ts)
--              system_settings UPDATE, workspace_settings                             대표 전용 — 바닥글(site.manage)·로고(site.manage)·홈 광고(storefront.edit)
--                                                                                     ·사이드바 메뉴 이름(site.manage)·랜딩 저장은 service role이라 영향 없음.
--                                                                                     세션으로 쓰는 곳은 api/admin/settings/actions.ts(대표 전용, 꺼진 기능)뿐.
--                                                                                     admin_alert_settings 행의 제한 정책(RESTRICTIVE)은 그대로 둔다.
--   5. 알림    admin_events SELECT                                                     대표, 또는 required_permission 권한자('owner' 이벤트는 대표만)
--   6. 꺼진 기능·옛 기능 user_roles, ai_*, providers, problem_type*, question_bank_*, generate_*, display_labels, source_configs, system_prompts
--                                                                                     대표 전용(조회 포함) — 화면·액션이 모두 대표 전용(4-2절)
--   7. 표 권한: 돈 표의 TRUNCATE(RLS를 타지 않는다)와 쓰기 경로가 없는 권한, 설정 표·요금제의 anon 쓰기 권한을 걷는다.
-- 바꾸지 않는 것(보고서의 "남는 빈틈"): profiles·support_tickets·credit_transactions·market_*·상품 표 조회(관리자면 누구나),
--   회원 정책, storage(정책 0개 — service role 전용), 꺼진 기능 표의 anon 표 권한(정책이 막는다).
-- 선행: 20261116110000_admin_permissions_base(함수), U3-3 코드(120479b) 배포. U3-3 전 코드는 화면이 is_admin만 보므로,
--       이 파일을 먼저 적용하면 staff가 화면은 열고 저장은 RLS 오류를 받는다(지금은 staff 계정이 없어 실제 영향은 없다).
--       20261117130000(DB-P2), 20261117110000·20261117120000(작업 기록·권한 부여 함수)과는 서로 기대지 않는다.
-- 잠금: 정책을 바꾸는 표마다 ACCESS EXCLUSIVE를 잡고 커밋까지 유지한다(45개 표). 표마다 최대 3초 대기, 넘기면 전체 취소.
--       적용 중에는 그 표의 모든 조회가 잠깐 멈춘다. 출시 전이라 한 파일로 두었다 — 나눠야 하면 절 단위로 자른다(보고서의 분할안).
-- 적용: 반드시 한 트랜잭션으로 실행한다(supabase db push 또는 BEGIN … COMMIT으로 감싸기). SQL 편집기에 BEGIN 없이 붙여 넣으면
--       SET LOCAL lock_timeout이 걸리지 않고, 중간 문장이 실패할 때 앞부분만 적용된 채 남을 수 있다.
-- 되돌리기: supabase/rollback/20261117140000_admin_rls_by_permission_down.sql (적용 직전 정의를 2026-11-17 운영 카탈로그에서 옮겼다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 돈 ---------------------------------------------------------------------------------------------------------
-- 관리자 세션의 쓰기 정책을 없앤다. anon·authenticated는 이 표들에 쓰기 표 권한도 없거나(아래 7절에서 정리) 처음부터 없다.
DROP POLICY "Admins can manage all credit sources" ON public.credit_sources;
CREATE POLICY credit_sources_admin_select ON public.credit_sources
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

-- payment_history·refund_requests는 anon·authenticated 표 권한이 없어 지금도 service role 전용이다. 정책은 조회만 남긴다.
DROP POLICY "Admins can manage all payments" ON public.payment_history;
CREATE POLICY payment_history_admin_select ON public.payment_history
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY "Admins can manage all refund requests" ON public.refund_requests;
CREATE POLICY refund_requests_admin_select ON public.refund_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY "Admins can manage market purchases" ON public.market_purchases;
CREATE POLICY market_purchases_admin_select ON public.market_purchases
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

-- 아래 넷은 회원 조회 정책에 "OR is_admin()"이 들어 있어 관리자 조회가 그대로 유지된다. 관리자 ALL만 없앤다.
DROP POLICY "Admins can manage market entitlements" ON public.market_entitlements;
DROP POLICY "Admins can manage market purchase orders" ON public.market_purchase_orders;
DROP POLICY "Admins can manage market purchase lines" ON public.market_purchase_lines;
DROP POLICY "Admins can manage market refund requests" ON public.market_refund_requests;

-- 2. 상품 -------------------------------------------------------------------------------------------------------
-- 조회는 관리자면 누구나(is_admin, 원래와 같다), 쓰기만 권한별이다. 하위 표의 쓰기 정책은 FOR ALL이라 SELECT도 포함하지만
-- products.edit 보유자는 관리자이므로 조회 범위는 is_admin 정책과 같다.
-- 상품 완전 삭제(market_items DELETE)만 products.delete. 하위 표의 행 삭제(샘플 페이지·파일 등)는 상품 수정 화면의 일이라 products.edit.
DROP POLICY "Admins can manage market items" ON public.market_items;
CREATE POLICY market_items_admin_select ON public.market_items
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_items_admin_insert ON public.market_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));
CREATE POLICY market_items_admin_update ON public.market_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));
CREATE POLICY market_items_admin_delete ON public.market_items
  FOR DELETE TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')) AND (SELECT public.has_admin_permission('products.delete')));

DROP POLICY "Admins can manage market subproducts" ON public.market_item_subproducts;
CREATE POLICY market_item_subproducts_admin_select ON public.market_item_subproducts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_item_subproducts_admin_write ON public.market_item_subproducts
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market item files" ON public.market_item_files;
CREATE POLICY market_item_files_admin_select ON public.market_item_files
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_item_files_admin_write ON public.market_item_files
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market item sample pages" ON public.market_item_sample_pages;
CREATE POLICY market_item_sample_pages_admin_select ON public.market_item_sample_pages
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_item_sample_pages_admin_write ON public.market_item_sample_pages
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market item bundle options" ON public.market_item_bundle_options;
CREATE POLICY market_item_bundle_options_admin_select ON public.market_item_bundle_options
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_item_bundle_options_admin_write ON public.market_item_bundle_options
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market subproduct files" ON public.market_subproduct_files;
CREATE POLICY market_subproduct_files_admin_select ON public.market_subproduct_files
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_subproduct_files_admin_write ON public.market_subproduct_files
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market subproduct categories" ON public.market_subproduct_categories;
CREATE POLICY market_subproduct_categories_admin_select ON public.market_subproduct_categories
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_subproduct_categories_admin_write ON public.market_subproduct_categories
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market file types" ON public.market_file_types;
CREATE POLICY market_file_types_admin_select ON public.market_file_types
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_file_types_admin_write ON public.market_file_types
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

DROP POLICY "Admins can manage market menu entries" ON public.market_menu_entries;
CREATE POLICY market_menu_entries_admin_select ON public.market_menu_entries
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));
CREATE POLICY market_menu_entries_admin_write ON public.market_menu_entries
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('products.edit')))
  WITH CHECK ((SELECT public.has_admin_permission('products.edit')));

-- 3. 문의 · 알림 ------------------------------------------------------------------------------------------------
-- support_tickets UPDATE는 열 권한(status, admin_response, responded_at, updated_at)으로 이미 좁혀져 있다(DB-S1).
DROP POLICY "Admins can update tickets" ON public.support_tickets;
CREATE POLICY support_tickets_admin_update ON public.support_tickets
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')))
  WITH CHECK ((SELECT public.has_admin_permission('support.manage')));

DROP POLICY "Admins can insert support ticket categories" ON public.support_ticket_categories;
CREATE POLICY support_ticket_categories_admin_insert ON public.support_ticket_categories
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_admin_permission('support.manage')));

DROP POLICY "Admins can update support ticket categories" ON public.support_ticket_categories;
CREATE POLICY support_ticket_categories_admin_update ON public.support_ticket_categories
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')))
  WITH CHECK ((SELECT public.has_admin_permission('support.manage')));

-- 문의 답변 알림(support.manage)과 크레딧 지급 알림(credits.grant)이 관리자 세션으로 INSERT한다. 두 곳을 service role로 옮기면 지운다.
DROP POLICY "Admins can insert notifications" ON public.notifications;
CREATE POLICY notifications_admin_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_admin_permission('support.manage'))
    OR (
      (SELECT public.has_admin_permission('credits.grant'))
      AND (SELECT public.has_admin_permission('members.view'))
      AND (SELECT public.has_admin_permission('credits.view'))
    )
  );

-- 4. 요금제 · 설정 ----------------------------------------------------------------------------------------------
DROP POLICY "Admins can manage pricing plans" ON public.pricing_plans;
CREATE POLICY pricing_plans_admin_all ON public.pricing_plans
  FOR ALL TO authenticated
  USING ((SELECT public.has_admin_permission('pricing.manage')))
  WITH CHECK ((SELECT public.has_admin_permission('pricing.manage')));

-- system_settings에는 기능 차단(admin_disabled_features·site_disabled_features), 권한 묶음(admin_permission_presets),
-- 헤더·랜딩·AI 설정이 섞여 있다. 키별로 나누기보다 대표 전용으로 둔다: 운영 기능 중 세션으로 쓰는 곳이 없다(service role).
-- 원래 정책에 WITH CHECK가 없어(= USING과 같음) 새 정책도 같은 조건을 쓴다.
DROP POLICY "Admins can update system settings" ON public.system_settings;
CREATE POLICY system_settings_owner_update ON public.system_settings
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

-- workspace_settings는 앱이 service role로 읽고 쓴다(market-home-server.ts, workspace-settings.ts — 사이드바 메뉴 이름(site.manage)·
-- 홈 진열 등). workspace-settings.ts는 service role 환경변수가 없을 때만 세션으로 떨어지는데, 그 경우 staff 저장이 막힌다(운영은 해당 없음).
-- 네 정책을 대표 전용 하나로 합친다.
DROP POLICY "Admins can view workspace settings" ON public.workspace_settings;
DROP POLICY "Admins can insert workspace settings" ON public.workspace_settings;
DROP POLICY "Admins can update workspace settings" ON public.workspace_settings;
DROP POLICY "Admins can delete workspace settings" ON public.workspace_settings;
CREATE POLICY workspace_settings_owner_all ON public.workspace_settings
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

-- 5. 관리자 알림 ------------------------------------------------------------------------------------------------
-- 화면 목록(admin-alerts-server.ts)과 Realtime 구독(admin-alert-context.tsx) 모두 이 정책으로 걸러진다.
-- 'owner' 이벤트(판매 중지 등)는 대표만. has_admin_permission('owner')는 grants에 'owner' 행이 있으면 참이 되므로 따로 막는다.
DROP POLICY admin_events_select_admin ON public.admin_events;
CREATE POLICY admin_events_select_by_permission ON public.admin_events
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_owner())
    OR (required_permission <> 'owner' AND public.has_admin_permission(required_permission))
  );

-- 6. 꺼진 기능 · 옛 기능(대표 전용) ----------------------------------------------------------------------------
-- 화면·액션은 모두 대표 전용이고 미들웨어가 먼저 404로 막는다(4-2절). 회원 쪽 공개·본인 정책은 그대로 둔다.
DROP POLICY "Admins can manage roles" ON public.user_roles;
CREATE POLICY user_roles_owner_all ON public.user_roles
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage AI models" ON public.ai_models;
CREATE POLICY ai_models_owner_all ON public.ai_models
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

-- AI 연결(키)은 조회도 대표만. 앱은 service role로만 읽는다(lib/ai/provider-connections.ts).
DROP POLICY "Admins can manage AI provider connections" ON public.ai_provider_connections;
DROP POLICY "Admins can view AI provider connections" ON public.ai_provider_connections;
CREATE POLICY ai_provider_connections_owner_all ON public.ai_provider_connections
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage AI question generation runs" ON public.ai_question_generation_runs;
CREATE POLICY ai_question_generation_runs_owner_all ON public.ai_question_generation_runs
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Only admins can modify display labels" ON public.display_labels;
CREATE POLICY display_labels_owner_all ON public.display_labels
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage generate listboard generation job events" ON public.generate_listboard_generation_job_events;
CREATE POLICY generate_listboard_generation_job_events_owner_all ON public.generate_listboard_generation_job_events
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage generate listboard generation job items" ON public.generate_listboard_generation_job_items;
CREATE POLICY generate_listboard_generation_job_items_owner_all ON public.generate_listboard_generation_job_items
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage generate listboard generation jobs" ON public.generate_listboard_generation_jobs;
CREATE POLICY generate_listboard_generation_jobs_owner_all ON public.generate_listboard_generation_jobs
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage generate listboard post items" ON public.generate_listboard_post_items;
CREATE POLICY generate_listboard_post_items_owner_all ON public.generate_listboard_post_items
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage generate listboard posts" ON public.generate_listboard_posts;
CREATE POLICY generate_listboard_posts_owner_all ON public.generate_listboard_posts
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage generate menu entries" ON public.generate_menu_entries;
CREATE POLICY generate_menu_entries_owner_all ON public.generate_menu_entries
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage problem type default prompts" ON public.problem_type_default_prompts;
CREATE POLICY problem_type_default_prompts_owner_all ON public.problem_type_default_prompts
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage problem type test runs" ON public.problem_type_test_runs;
CREATE POLICY problem_type_test_runs_owner_all ON public.problem_type_test_runs
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can insert/update problem types" ON public.problem_types;
CREATE POLICY problem_types_owner_all ON public.problem_types
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage providers" ON public.providers;
CREATE POLICY providers_owner_all ON public.providers
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage question bank books" ON public.question_bank_books;
CREATE POLICY question_bank_books_owner_all ON public.question_bank_books
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage question bank problem types" ON public.question_bank_problem_types;
CREATE POLICY question_bank_problem_types_owner_all ON public.question_bank_problem_types
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage question bank metadata" ON public.question_bank_question_metadata;
CREATE POLICY question_bank_question_metadata_owner_all ON public.question_bank_question_metadata
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage question bank years" ON public.question_bank_years;
CREATE POLICY question_bank_years_owner_all ON public.question_bank_years
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can manage source configs" ON public.source_configs;
CREATE POLICY source_configs_owner_all ON public.source_configs
  FOR ALL TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

-- system_prompts는 원래 명령별 세 정책(INSERT·SELECT·UPDATE, DELETE 없음)이라 그 모양을 지킨다.
DROP POLICY "Admins can insert system prompts" ON public.system_prompts;
CREATE POLICY system_prompts_owner_insert ON public.system_prompts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_owner()));

DROP POLICY "Admins can view system prompts" ON public.system_prompts;
CREATE POLICY system_prompts_owner_select ON public.system_prompts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_owner()));

DROP POLICY "Admins can update system prompts" ON public.system_prompts;
CREATE POLICY system_prompts_owner_update ON public.system_prompts
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

-- 7. 표 권한 ----------------------------------------------------------------------------------------------------
-- TRUNCATE는 RLS를 타지 않는다(PostgREST로는 부를 수 없지만 돈 표에는 남겨 둘 이유가 없다).
REVOKE TRUNCATE ON TABLE public.credit_sources FROM anon, authenticated;
REVOKE TRUNCATE ON TABLE public.credit_transactions FROM anon, authenticated;
REVOKE TRUNCATE ON TABLE public.credit_consumption FROM anon, authenticated;
-- 마켓 환불 요청은 회원 접수·관리자 처리 모두 service role(market-refunds.ts)이다. 회원 조회(SELECT)만 남긴다.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.market_refund_requests FROM anon, authenticated;
-- 요금제: 관리자 세션 저장(pricing.manage)에 authenticated INSERT·UPDATE·DELETE가 필요하다. anon 쓰기와 TRUNCATE만 걷는다.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pricing_plans FROM anon;
REVOKE TRUNCATE ON TABLE public.pricing_plans FROM authenticated;
-- 시스템 설정: 세션 쓰기는 대표의 UPDATE(api/admin/settings/actions.ts)뿐이다. INSERT·DELETE 정책은 원래 없다.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.system_settings FROM anon;
REVOKE INSERT, DELETE, TRUNCATE ON TABLE public.system_settings FROM authenticated;
-- 과목별 설정: anon 쓰기와 TRUNCATE만 걷는다(대표 세션의 쓰기 권한은 정책과 함께 남긴다).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.workspace_settings FROM anon;
REVOKE TRUNCATE ON TABLE public.workspace_settings FROM authenticated;

NOTIFY pgrst, 'reload schema';
