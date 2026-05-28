-- 문제마켓 v2 서브상품 카테고리 기본값 보정.
-- 기존 legacy category row는 참조 안정성을 위해 삭제하지 않고 신규 선택지에서 숨긴다.

insert into public.market_subproduct_categories (workspace_subject, name, slug, description, sort_order, is_active, deleted_at)
values
  ('english', '워크북', 'workbook', 'Workbook subproduct category', 10, true, null),
  ('english', '문제(PDF)', 'question_pdf', 'PDF question subproduct category', 20, true, null),
  ('english', '문제(HWP)', 'question_hwp', 'HWP question subproduct category', 30, true, null),
  ('korean', '워크북', 'workbook', 'Workbook subproduct category', 10, true, null),
  ('korean', '문제(PDF)', 'question_pdf', 'PDF question subproduct category', 20, true, null),
  ('korean', '문제(HWP)', 'question_hwp', 'HWP question subproduct category', 30, true, null)
on conflict (workspace_subject, slug) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true,
    deleted_at = null,
    updated_at = now();

update public.market_subproduct_categories
set is_active = false,
    updated_at = now()
where slug in ('legacy_pdf', 'legacy_hwp_bundle', 'legacy_zip')
  and workspace_subject in ('english', 'korean')
  and deleted_at is null;
