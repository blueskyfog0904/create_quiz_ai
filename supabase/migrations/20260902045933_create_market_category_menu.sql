-- 헤더 메가메뉴용 카테고리 계층 (2단계 그룹 / 3단계 항목) + 상품 연결
-- 3단계 항목은 /categories/[id] 전용 페이지를 가지며, 상품(market_items)이 카테고리에 등록된다.

create table if not exists public.market_category_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  title text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_category_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.market_category_groups(id) on delete cascade,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  title text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 상품 FK가 (id, workspace_subject) 복합 참조로 과목 교차 등록을 막을 수 있게 한다
  constraint market_category_items_id_subject_key unique (id, workspace_subject)
);

create index if not exists market_category_items_group_id_idx
  on public.market_category_items(group_id);

-- updated_at 트리거 (테이블별 함수, search_path 고정 — 기존 관례)
create or replace function public.set_market_category_groups_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_market_category_items_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_market_category_groups_updated_at on public.market_category_groups;
create trigger set_market_category_groups_updated_at
  before update on public.market_category_groups
  for each row execute function public.set_market_category_groups_updated_at();

drop trigger if exists set_market_category_items_updated_at on public.market_category_items;
create trigger set_market_category_items_updated_at
  before update on public.market_category_items
  for each row execute function public.set_market_category_items_updated_at();

-- RLS: 활성 행 공개 읽기, 쓰기는 service role 전용
alter table public.market_category_groups enable row level security;
alter table public.market_category_items enable row level security;

revoke all on table public.market_category_groups from anon, authenticated;
revoke all on table public.market_category_items from anon, authenticated;
grant select on table public.market_category_groups to anon, authenticated;
grant select on table public.market_category_items to anon, authenticated;

drop policy if exists "Active market category groups are publicly readable" on public.market_category_groups;
create policy "Active market category groups are publicly readable"
  on public.market_category_groups for select
  using (is_active);

drop policy if exists "Active market category items are publicly readable" on public.market_category_items;
create policy "Active market category items are publicly readable"
  on public.market_category_items for select
  using (is_active);

-- 상품 ↔ 카테고리 연결: 복합 FK로 과목 일치 강제, 카테고리 삭제 시 연결만 해제
alter table public.market_items
  add column if not exists category_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_items_category_item_subject_fkey'
  ) then
    alter table public.market_items
      add constraint market_items_category_item_subject_fkey
      foreign key (category_item_id, workspace_subject)
      references public.market_category_items(id, workspace_subject)
      on delete set null (category_item_id);
  end if;
end;
$$;

create index if not exists market_items_category_item_id_idx
  on public.market_items(category_item_id);

-- 국어 초기 시드 (idempotent: where not exists)
insert into public.market_category_groups (workspace_subject, title, sort_order)
select v.subject, v.title, v.sort_order
from (values
  ('korean', '교과서', 10),
  ('korean', 'EBS', 20),
  ('korean', '문학작품 분석', 30),
  ('korean', '약술형 논술', 40),
  ('korean', '모의고사/대수능/평가원', 50)
) as v(subject, title, sort_order)
where not exists (
  select 1 from public.market_category_groups g
  where g.workspace_subject = v.subject and g.title = v.title
);

insert into public.market_category_items (group_id, workspace_subject, title, sort_order)
select g.id, 'korean', v.title, v.sort_order
from (values
  ('교과서', '공통국어1 동아(최)', 10),
  ('교과서', '공통국어1 비상(강)', 20),
  ('교과서', '공통국어2 동아(최)', 30),
  ('교과서', '공통국어2 비상(강)', 40),
  ('교과서', '22개정 문학 동아(최)', 50),
  ('교과서', '22개정 문학 미래엔(방)', 60),
  ('교과서', '22개정 문학 비상(강)', 70),
  ('교과서', '22개정 문학 지학(정)', 80),
  ('교과서', '22개정 문학 해냄(조)', 90),
  ('교과서', '22개정 독서와 작문 비상(최)', 100),
  ('교과서', '22개정 독서와 작문 창비(이)', 110),
  ('교과서', '22개정 독서와 작문 천재(천)', 120),
  ('교과서', '22개정 독서와 작문 해냄(송)', 130),
  ('교과서', '22개정 화법과 언어 비상(이)', 140),
  ('교과서', '22개정 화법과 언어 동아(양)', 150),
  ('EBS', '수능특강 독서 워크북(&OX)', 10),
  ('EBS', '수능특강 독서 변형문제', 20),
  ('EBS', '수능특강 문학 분석&OX', 30),
  ('EBS', '수능특강 문학 변형문제', 40),
  ('EBS', '수능완성 워크북&분석&OX', 50),
  ('EBS', '수능완성 변형문제', 60),
  ('문학작품 분석', '고전시가', 10),
  ('문학작품 분석', '고전산문', 20),
  ('문학작품 분석', '현대산문', 30),
  ('문학작품 분석', '현대시', 40),
  ('문학작품 분석', '희곡/시나리오/드라마대본', 50),
  ('약술형 논술', '2027학년도 약술형 논술 모의고사', 10),
  ('약술형 논술', '2027학년도 약술형 논술 진도별', 20),
  ('모의고사/대수능/평가원', '1학년 모의고사 분석&OX&변형', 10),
  ('모의고사/대수능/평가원', '2학년 모의고사 분석&OX&변형', 20),
  ('모의고사/대수능/평가원', '3학년 모의고사 분석&OX&변형', 30),
  ('모의고사/대수능/평가원', '대수능/평가원 분석&OX&변형', 40)
) as v(group_title, title, sort_order)
join public.market_category_groups g
  on g.workspace_subject = 'korean' and g.title = v.group_title
where not exists (
  select 1 from public.market_category_items i
  where i.group_id = g.id and i.title = v.title
);
