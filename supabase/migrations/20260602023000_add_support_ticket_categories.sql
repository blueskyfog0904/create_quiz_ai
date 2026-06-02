create table if not exists public.support_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text null,
  help_text text null,
  guide_items jsonb not null default '[]'::jsonb,
  subject_placeholder text null,
  message_placeholder text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamp with time zone null,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint support_ticket_categories_slug_key unique (slug),
  constraint support_ticket_categories_guide_items_array check (jsonb_typeof(guide_items) = 'array')
);

create index if not exists idx_support_ticket_categories_active_order
  on public.support_ticket_categories(is_active, deleted_at, sort_order);

alter table public.support_ticket_categories enable row level security;

drop policy if exists "Users can read active support ticket categories" on public.support_ticket_categories;
drop policy if exists "Admins can read support ticket categories" on public.support_ticket_categories;
drop policy if exists "Admins can insert support ticket categories" on public.support_ticket_categories;
drop policy if exists "Admins can update support ticket categories" on public.support_ticket_categories;
drop policy if exists "Admins can delete support ticket categories" on public.support_ticket_categories;

create policy "Users can read active support ticket categories"
  on public.support_ticket_categories
  for select
  using (is_active is true and deleted_at is null);

create policy "Admins can read support ticket categories"
  on public.support_ticket_categories
  for select
  using (public.is_admin());

create policy "Admins can insert support ticket categories"
  on public.support_ticket_categories
  for insert
  with check (public.is_admin());

create policy "Admins can update support ticket categories"
  on public.support_ticket_categories
  for update
  using (public.is_admin())
  with check (public.is_admin());

alter table public.support_tickets
  add column if not exists category_id uuid references public.support_ticket_categories(id) on delete set null,
  add column if not exists category_snapshot jsonb null;

create index if not exists idx_support_tickets_category_id
  on public.support_tickets(category_id);

create index if not exists idx_support_tickets_category_status_created
  on public.support_tickets(category_id, status, created_at desc);

drop policy if exists "Users can insert their own tickets" on public.support_tickets;
drop policy if exists "Users can insert own tickets" on public.support_tickets;
drop policy if exists "Users can update own tickets" on public.support_tickets;

drop function if exists public.create_support_ticket(uuid, text, text);
create or replace function public.create_support_ticket(
  p_category_id uuid,
  p_subject text,
  p_message text
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_category public.support_ticket_categories%rowtype;
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then
    raise exception '인증이 필요합니다.' using errcode = '28000';
  end if;

  if v_subject is null or v_message is null then
    raise exception '제목과 내용을 모두 입력해주세요.' using errcode = '22023';
  end if;

  select *
    into v_category
  from public.support_ticket_categories
  where id = p_category_id
    and is_active is true
    and deleted_at is null;

  if not found then
    raise exception '유효한 문의 카테고리를 선택해주세요.' using errcode = '22023';
  end if;

  insert into public.support_tickets (
    user_id,
    category_id,
    category_snapshot,
    subject,
    message,
    status,
    admin_response,
    responded_at,
    is_deleted_by_user
  ) values (
    v_user_id,
    v_category.id,
    jsonb_build_object(
      'id', v_category.id,
      'slug', v_category.slug,
      'name', v_category.name,
      'description', v_category.description,
      'help_text', v_category.help_text
    ),
    v_subject,
    v_message,
    'pending',
    null,
    null,
    false
  ) returning * into v_ticket;

  return v_ticket;
end;
$$;

revoke all on function public.create_support_ticket(uuid, text, text) from public;
grant execute on function public.create_support_ticket(uuid, text, text) to authenticated;

drop function if exists public.update_own_pending_support_ticket(uuid, uuid, text, text);
create or replace function public.update_own_pending_support_ticket(
  p_ticket_id uuid,
  p_category_id uuid,
  p_subject text,
  p_message text
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_category public.support_ticket_categories%rowtype;
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then
    raise exception '인증이 필요합니다.' using errcode = '28000';
  end if;

  if v_subject is null or v_message is null then
    raise exception '제목과 내용을 모두 입력해주세요.' using errcode = '22023';
  end if;

  select *
    into v_category
  from public.support_ticket_categories
  where id = p_category_id
    and is_active is true
    and deleted_at is null;

  if not found then
    raise exception '유효한 문의 카테고리를 선택해주세요.' using errcode = '22023';
  end if;

  update public.support_tickets
  set
    category_id = v_category.id,
    category_snapshot = jsonb_build_object(
      'id', v_category.id,
      'slug', v_category.slug,
      'name', v_category.name,
      'description', v_category.description,
      'help_text', v_category.help_text
    ),
    subject = v_subject,
    message = v_message,
    updated_at = timezone('utc'::text, now())
  where id = p_ticket_id
    and user_id = v_user_id
    and status = 'pending'
    and coalesce(is_deleted_by_user, false) is false
  returning * into v_ticket;

  if not found then
    raise exception '수정 가능한 문의를 찾을 수 없습니다.' using errcode = '22023';
  end if;

  return v_ticket;
end;
$$;

revoke all on function public.update_own_pending_support_ticket(uuid, uuid, text, text) from public;
grant execute on function public.update_own_pending_support_ticket(uuid, uuid, text, text) to authenticated;

drop function if exists public.soft_delete_own_support_ticket(uuid);
create or replace function public.soft_delete_own_support_ticket(
  p_ticket_id uuid
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then
    raise exception '인증이 필요합니다.' using errcode = '28000';
  end if;

  update public.support_tickets
  set
    is_deleted_by_user = true,
    updated_at = timezone('utc'::text, now())
  where id = p_ticket_id
    and user_id = v_user_id
    and coalesce(is_deleted_by_user, false) is false
  returning * into v_ticket;

  if not found then
    raise exception '삭제 가능한 문의를 찾을 수 없습니다.' using errcode = '22023';
  end if;

  return v_ticket;
end;
$$;

revoke all on function public.soft_delete_own_support_ticket(uuid) from public;
grant execute on function public.soft_delete_own_support_ticket(uuid) to authenticated;

insert into public.support_ticket_categories (
  slug,
  name,
  description,
  help_text,
  guide_items,
  subject_placeholder,
  message_placeholder,
  sort_order,
  is_active
) values
  (
    'market_refund',
    '문제마켓 환불 요청',
    '구매한 문제마켓 자료의 환불 가능 여부를 확인하고 요청합니다.',
    '구매 자료명, 구매일, 다운로드 여부를 함께 작성해주세요.',
    '["구매한 자료명", "구매일", "다운로드 여부", "환불 요청 사유"]'::jsonb,
    '예: 문제마켓 자료 환불을 요청합니다',
    '예)\n- 구매한 자료명:\n- 구매일:\n- 다운로드 여부:\n- 환불 요청 사유:',
    10,
    true
  ),
  (
    'credit_refund',
    '크레딧/결제 환불 요청',
    '크레딧 충전, 결제, 요금제 환불과 관련된 문의입니다.',
    '결제 일시와 결제 금액을 함께 작성하면 확인이 빨라집니다.',
    '["결제 일시", "결제 금액", "결제 수단", "환불 요청 사유"]'::jsonb,
    '예: 크레딧 환불 요청드립니다',
    '예)\n- 결제 일시:\n- 결제 금액:\n- 결제 수단:\n- 환불 요청 사유:',
    20,
    true
  ),
  (
    'credit_error',
    '크레딧 차감 오류',
    '문제 생성 또는 구매 과정에서 크레딧이 잘못 차감된 경우 선택합니다.',
    '오류가 발생한 시간과 작업 내용을 함께 작성해주세요.',
    '["오류 발생 시간", "작업 내용", "차감된 크레딧", "기대했던 결과"]'::jsonb,
    '예: 크레딧이 중복 차감되었습니다',
    '예)\n- 오류 발생 시간:\n- 작업 내용:\n- 차감된 크레딧:\n- 기대했던 결과:',
    30,
    true
  ),
  (
    'ai_generation_error',
    'AI 문제 생성 오류',
    'AI 문제 생성이 멈추거나 결과가 이상할 때 선택합니다.',
    '사용한 지문, 선택한 문제 유형, 오류 화면을 함께 알려주세요.',
    '["사용한 지문 또는 자료", "선택한 문제 유형", "오류 발생 시간", "기대했던 결과"]'::jsonb,
    '예: AI 문제 생성 중 오류가 발생했습니다',
    '예)\n- 사용한 지문:\n- 선택한 문제 유형:\n- 발생한 문제:\n- 기대했던 결과:',
    40,
    true
  ),
  (
    'download_error',
    '자료/다운로드 오류',
    '구매 자료 다운로드, 파일 열람, PDF/HWP 파일 관련 오류입니다.',
    '자료명과 파일 형식을 함께 작성해주세요.',
    '["자료명", "파일 형식", "오류 메시지", "시도한 시간"]'::jsonb,
    '예: 구매 자료 다운로드가 되지 않습니다',
    '예)\n- 자료명:\n- 파일 형식:\n- 오류 메시지:\n- 시도한 시간:',
    50,
    true
  ),
  (
    'account',
    '계정/로그인/권한 문제',
    '로그인, 회원정보, 접근 권한과 관련된 문의입니다.',
    '사용 중인 계정 이메일과 문제가 발생한 화면을 알려주세요.',
    '["계정 이메일", "문제가 발생한 화면", "오류 메시지"]'::jsonb,
    '예: 로그인 또는 접근 권한 문제가 있습니다',
    '예)\n- 계정 이메일:\n- 문제가 발생한 화면:\n- 오류 메시지:',
    60,
    true
  ),
  (
    'suggestion',
    '기능 개선/제안',
    '서비스 이용 중 필요한 개선 사항이나 새로운 기능 제안입니다.',
    '불편한 점과 원하는 개선 방향을 구체적으로 작성해주세요.',
    '["불편한 점", "원하는 개선 방향", "사용 상황"]'::jsonb,
    '예: 기능 개선을 제안합니다',
    '예)\n- 불편한 점:\n- 원하는 개선 방향:\n- 사용 상황:',
    70,
    true
  ),
  (
    'etc',
    '기타 문의',
    '위 항목에 해당하지 않는 일반 문의입니다.',
    '문의 내용을 가능한 한 자세히 작성해주세요.',
    '["문의 내용", "관련 화면", "추가 참고 사항"]'::jsonb,
    '예: 기타 문의드립니다',
    '예)\n- 문의 내용:\n- 관련 화면:\n- 추가 참고 사항:',
    80,
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  help_text = excluded.help_text,
  guide_items = excluded.guide_items,
  subject_placeholder = excluded.subject_placeholder,
  message_placeholder = excluded.message_placeholder,
  sort_order = excluded.sort_order,
  is_active = true,
  deleted_at = null,
  updated_at = timezone('utc'::text, now());
