-- Tighten v2 market helper function search_path and add covering indexes for FK checks.

create or replace function public.set_market_subproduct_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create index if not exists idx_market_item_subproducts_item_workspace
  on public.market_item_subproducts(item_id, workspace_subject);
create index if not exists idx_market_item_subproducts_category_workspace
  on public.market_item_subproducts(category_id, workspace_subject);

create index if not exists idx_market_subproduct_files_item_workspace
  on public.market_subproduct_files(item_id, workspace_subject);
create index if not exists idx_market_subproduct_files_subproduct_workspace
  on public.market_subproduct_files(subproduct_id, workspace_subject);
create index if not exists idx_market_subproduct_files_type_workspace
  on public.market_subproduct_files(file_type_id, workspace_subject);
create index if not exists idx_market_subproduct_files_created_by
  on public.market_subproduct_files(created_by);

create index if not exists idx_market_item_bundle_options_item_workspace
  on public.market_item_bundle_options(item_id, workspace_subject);

create index if not exists idx_market_purchase_orders_item_workspace
  on public.market_purchase_orders(item_id, workspace_subject);
create index if not exists idx_market_purchase_orders_user
  on public.market_purchase_orders(user_id);
create index if not exists idx_market_purchase_orders_legacy_purchase
  on public.market_purchase_orders(legacy_purchase_id);

create index if not exists idx_market_purchase_lines_order_workspace
  on public.market_purchase_lines(order_id, workspace_subject);
create index if not exists idx_market_purchase_lines_item_workspace
  on public.market_purchase_lines(item_id, workspace_subject);
create index if not exists idx_market_purchase_lines_subproduct_workspace
  on public.market_purchase_lines(subproduct_id, workspace_subject);
create index if not exists idx_market_purchase_lines_bundle_workspace
  on public.market_purchase_lines(bundle_option_id, workspace_subject);

create index if not exists idx_market_entitlements_item_workspace
  on public.market_entitlements(item_id, workspace_subject);
create index if not exists idx_market_entitlements_subproduct_workspace
  on public.market_entitlements(subproduct_id, workspace_subject);
create index if not exists idx_market_entitlements_file_workspace
  on public.market_entitlements(file_id, workspace_subject);
create index if not exists idx_market_entitlements_order_workspace
  on public.market_entitlements(source_order_id, workspace_subject);
create index if not exists idx_market_entitlements_user
  on public.market_entitlements(user_id);
create index if not exists idx_market_entitlements_source_purchase
  on public.market_entitlements(source_purchase_id);
