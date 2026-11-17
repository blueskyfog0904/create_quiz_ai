-- 20261117140000_admin_rls_by_permission 되돌리기: 관리자 정책을 적용 직전 정의(관리자면 누구나, is_admin())로 되돌린다.
-- 정의는 2026-11-17 운영 DB의 pg_policies에서 그대로 옮겼다(이름·명령·역할·USING·WITH CHECK). 역할이 public이던 정책은 public으로,
-- WITH CHECK가 없던 정책은 없이 만든다. 인라인 EXISTS(profiles.is_admin = true) 정책도 원래 모양 그대로다.
-- 되돌린 뒤에는 staff가 자기 세션으로 요금제·시스템 설정·상품·돈 표(표 권한이 있는 곳)를 직접 바꿀 수 있는 상태로 돌아간다.
-- 표 권한도 적용 직전 값으로 다시 준다.
-- 잠금: 정책을 바꾸는 표마다 ACCESS EXCLUSIVE(45개 표), 표마다 최대 3초 대기.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 7. 표 권한 ----------------------------------------------------------------------------------------------------
GRANT TRUNCATE ON TABLE public.credit_sources TO anon, authenticated;
GRANT TRUNCATE ON TABLE public.credit_transactions TO anon, authenticated;
GRANT TRUNCATE ON TABLE public.credit_consumption TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.market_refund_requests TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pricing_plans TO anon;
GRANT TRUNCATE ON TABLE public.pricing_plans TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.system_settings TO anon;
GRANT INSERT, DELETE, TRUNCATE ON TABLE public.system_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.workspace_settings TO anon;
GRANT TRUNCATE ON TABLE public.workspace_settings TO authenticated;

-- 1. 돈 ---------------------------------------------------------------------------------------------------------
DROP POLICY credit_sources_admin_select ON public.credit_sources;
CREATE POLICY "Admins can manage all credit sources" ON public.credit_sources
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY payment_history_admin_select ON public.payment_history;
CREATE POLICY "Admins can manage all payments" ON public.payment_history
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY refund_requests_admin_select ON public.refund_requests;
CREATE POLICY "Admins can manage all refund requests" ON public.refund_requests
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY market_purchases_admin_select ON public.market_purchases;
CREATE POLICY "Admins can manage market purchases" ON public.market_purchases
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage market entitlements" ON public.market_entitlements
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage market purchase orders" ON public.market_purchase_orders
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage market purchase lines" ON public.market_purchase_lines
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage market refund requests" ON public.market_refund_requests
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2. 상품 -------------------------------------------------------------------------------------------------------
DROP POLICY market_items_admin_select ON public.market_items;
DROP POLICY market_items_admin_insert ON public.market_items;
DROP POLICY market_items_admin_update ON public.market_items;
DROP POLICY market_items_admin_delete ON public.market_items;
CREATE POLICY "Admins can manage market items" ON public.market_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_item_subproducts_admin_select ON public.market_item_subproducts;
DROP POLICY market_item_subproducts_admin_write ON public.market_item_subproducts;
CREATE POLICY "Admins can manage market subproducts" ON public.market_item_subproducts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_item_files_admin_select ON public.market_item_files;
DROP POLICY market_item_files_admin_write ON public.market_item_files;
CREATE POLICY "Admins can manage market item files" ON public.market_item_files
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_item_sample_pages_admin_select ON public.market_item_sample_pages;
DROP POLICY market_item_sample_pages_admin_write ON public.market_item_sample_pages;
CREATE POLICY "Admins can manage market item sample pages" ON public.market_item_sample_pages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_item_bundle_options_admin_select ON public.market_item_bundle_options;
DROP POLICY market_item_bundle_options_admin_write ON public.market_item_bundle_options;
CREATE POLICY "Admins can manage market item bundle options" ON public.market_item_bundle_options
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_subproduct_files_admin_select ON public.market_subproduct_files;
DROP POLICY market_subproduct_files_admin_write ON public.market_subproduct_files;
CREATE POLICY "Admins can manage market subproduct files" ON public.market_subproduct_files
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_subproduct_categories_admin_select ON public.market_subproduct_categories;
DROP POLICY market_subproduct_categories_admin_write ON public.market_subproduct_categories;
CREATE POLICY "Admins can manage market subproduct categories" ON public.market_subproduct_categories
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_file_types_admin_select ON public.market_file_types;
DROP POLICY market_file_types_admin_write ON public.market_file_types;
CREATE POLICY "Admins can manage market file types" ON public.market_file_types
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY market_menu_entries_admin_select ON public.market_menu_entries;
DROP POLICY market_menu_entries_admin_write ON public.market_menu_entries;
CREATE POLICY "Admins can manage market menu entries" ON public.market_menu_entries
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. 문의 · 알림 ------------------------------------------------------------------------------------------------
DROP POLICY support_tickets_admin_update ON public.support_tickets;
CREATE POLICY "Admins can update tickets" ON public.support_tickets
  FOR UPDATE TO public
  USING (public.is_admin());

DROP POLICY support_ticket_categories_admin_insert ON public.support_ticket_categories;
CREATE POLICY "Admins can insert support ticket categories" ON public.support_ticket_categories
  FOR INSERT TO public
  WITH CHECK (public.is_admin());

DROP POLICY support_ticket_categories_admin_update ON public.support_ticket_categories;
CREATE POLICY "Admins can update support ticket categories" ON public.support_ticket_categories
  FOR UPDATE TO public
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY notifications_admin_insert ON public.notifications;
CREATE POLICY "Admins can insert notifications" ON public.notifications
  FOR INSERT TO public
  WITH CHECK (public.is_admin());

-- 4. 요금제 · 설정 ----------------------------------------------------------------------------------------------
DROP POLICY pricing_plans_admin_all ON public.pricing_plans;
CREATE POLICY "Admins can manage pricing plans" ON public.pricing_plans
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY system_settings_owner_update ON public.system_settings;
CREATE POLICY "Admins can update system settings" ON public.system_settings
  FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY workspace_settings_owner_all ON public.workspace_settings;
CREATE POLICY "Admins can view workspace settings" ON public.workspace_settings
  FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins can insert workspace settings" ON public.workspace_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update workspace settings" ON public.workspace_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete workspace settings" ON public.workspace_settings
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 5. 관리자 알림 ------------------------------------------------------------------------------------------------
DROP POLICY admin_events_select_by_permission ON public.admin_events;
CREATE POLICY admin_events_select_admin ON public.admin_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

-- 6. 꺼진 기능 · 옛 기능 ----------------------------------------------------------------------------------------
DROP POLICY user_roles_owner_all ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY ai_models_owner_all ON public.ai_models;
CREATE POLICY "Admins can manage AI models" ON public.ai_models
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY ai_provider_connections_owner_all ON public.ai_provider_connections;
CREATE POLICY "Admins can manage AI provider connections" ON public.ai_provider_connections
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));
CREATE POLICY "Admins can view AI provider connections" ON public.ai_provider_connections
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY ai_question_generation_runs_owner_all ON public.ai_question_generation_runs;
CREATE POLICY "Admins can manage AI question generation runs" ON public.ai_question_generation_runs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY display_labels_owner_all ON public.display_labels;
CREATE POLICY "Only admins can modify display labels" ON public.display_labels
  FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY generate_listboard_generation_job_events_owner_all ON public.generate_listboard_generation_job_events;
CREATE POLICY "Admins can manage generate listboard generation job events" ON public.generate_listboard_generation_job_events
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY generate_listboard_generation_job_items_owner_all ON public.generate_listboard_generation_job_items;
CREATE POLICY "Admins can manage generate listboard generation job items" ON public.generate_listboard_generation_job_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY generate_listboard_generation_jobs_owner_all ON public.generate_listboard_generation_jobs;
CREATE POLICY "Admins can manage generate listboard generation jobs" ON public.generate_listboard_generation_jobs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY generate_listboard_post_items_owner_all ON public.generate_listboard_post_items;
CREATE POLICY "Admins can manage generate listboard post items" ON public.generate_listboard_post_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY generate_listboard_posts_owner_all ON public.generate_listboard_posts;
CREATE POLICY "Admins can manage generate listboard posts" ON public.generate_listboard_posts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY generate_menu_entries_owner_all ON public.generate_menu_entries;
CREATE POLICY "Admins can manage generate menu entries" ON public.generate_menu_entries
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY problem_type_default_prompts_owner_all ON public.problem_type_default_prompts;
CREATE POLICY "Admins can manage problem type default prompts" ON public.problem_type_default_prompts
  FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY problem_type_test_runs_owner_all ON public.problem_type_test_runs;
CREATE POLICY "Admins can manage problem type test runs" ON public.problem_type_test_runs
  FOR ALL TO public
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY problem_types_owner_all ON public.problem_types;
CREATE POLICY "Admins can insert/update problem types" ON public.problem_types
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY providers_owner_all ON public.providers;
CREATE POLICY "Admins can manage providers" ON public.providers
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY question_bank_books_owner_all ON public.question_bank_books;
CREATE POLICY "Admins can manage question bank books" ON public.question_bank_books
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY question_bank_problem_types_owner_all ON public.question_bank_problem_types;
CREATE POLICY "Admins can manage question bank problem types" ON public.question_bank_problem_types
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY question_bank_question_metadata_owner_all ON public.question_bank_question_metadata;
CREATE POLICY "Admins can manage question bank metadata" ON public.question_bank_question_metadata
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY question_bank_years_owner_all ON public.question_bank_years;
CREATE POLICY "Admins can manage question bank years" ON public.question_bank_years
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY source_configs_owner_all ON public.source_configs;
CREATE POLICY "Admins can manage source configs" ON public.source_configs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY system_prompts_owner_insert ON public.system_prompts;
CREATE POLICY "Admins can insert system prompts" ON public.system_prompts
  FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY system_prompts_owner_select ON public.system_prompts;
CREATE POLICY "Admins can view system prompts" ON public.system_prompts
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

DROP POLICY system_prompts_owner_update ON public.system_prompts;
CREATE POLICY "Admins can update system prompts" ON public.system_prompts
  FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

NOTIFY pgrst, 'reload schema';
