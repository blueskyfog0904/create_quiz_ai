-- 상세페이지 평점·후기 확장: 후기 본문/태그, 태그 사전(어드민 관리), 도움이 됐어요 투표

-- 1) 후기 태그 사전 (어드민 CRUD 대상, 비활성화 시에도 기존 후기 라벨은 유지 표시)
create table if not exists public.market_review_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null default 'english' check (workspace_subject in ('english', 'korean')),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_review_tags_subject_order
  on public.market_review_tags (workspace_subject, sort_order, created_at);

-- 2) 후기 본문/태그 컬럼 확장 (+ DB 레벨 제약)
alter table public.market_item_reviews
  add column if not exists content text,
  add column if not exists tag_ids uuid[] not null default '{}';

alter table public.market_item_reviews
  drop constraint if exists chk_market_item_reviews_content_length;
alter table public.market_item_reviews
  add constraint chk_market_item_reviews_content_length
  check (content is null or char_length(content) <= 1000);

alter table public.market_item_reviews
  drop constraint if exists chk_market_item_reviews_tag_count;
alter table public.market_item_reviews
  add constraint chk_market_item_reviews_tag_count
  check (coalesce(array_length(tag_ids, 1), 0) <= 8);

-- 후기 쓰기는 서버(서비스 롤) 검증 경유만 허용 — 클라이언트 직접 쓰기 grant 회수
-- (앱 코드에 이 테이블을 직접 쓰는 클라이언트 경로 없음 확인)
revoke insert, update, delete on public.market_item_reviews from authenticated;
revoke insert, update, delete on public.market_item_reviews from anon;
drop policy if exists "Purchasers can create market item reviews" on public.market_item_reviews;
drop policy if exists "Purchasers can update own market item reviews" on public.market_item_reviews;
drop policy if exists "Purchasers can delete own market item reviews" on public.market_item_reviews;

-- 3) 도움이 됐어요 투표 (1인 1후기 1투표)
create table if not exists public.market_item_review_votes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.market_item_reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_market_item_review_votes unique (review_id, user_id)
);

create index if not exists idx_market_item_review_votes_review
  on public.market_item_review_votes (review_id);

-- updated_at 트리거 (기존 관례 재사용)
create or replace function public.set_market_review_tags_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_review_tags_updated_at on public.market_review_tags;
create trigger trg_market_review_tags_updated_at
  before update on public.market_review_tags
  for each row execute function public.set_market_review_tags_updated_at();

-- RLS: 읽기는 공개(활성/미삭제), 쓰기는 서버(서비스 롤) 경유만
revoke all on public.market_review_tags from anon, authenticated;
grant select on public.market_review_tags to anon, authenticated;
revoke all on public.market_item_review_votes from anon, authenticated;
grant select on public.market_item_review_votes to authenticated;

alter table public.market_review_tags enable row level security;
drop policy if exists "Anyone can read active review tags" on public.market_review_tags;
create policy "Anyone can read active review tags"
  on public.market_review_tags for select
  using (is_active = true);

alter table public.market_item_review_votes enable row level security;
drop policy if exists "Users can read own review votes" on public.market_item_review_votes;
create policy "Users can read own review votes"
  on public.market_item_review_votes for select
  using (auth.uid() = user_id);

-- 4) 태그 초안 시드 (영어/국어 동일 구성, 이미 존재하면 중복 삽입 방지)
insert into public.market_review_tags (workspace_subject, label, sort_order)
select subject, label, sort_order
from (values
  ('🏆 최상위권 추천', 10),
  ('🥇 1-2등급 추천', 20),
  ('🥈 3-4등급 추천', 30),
  ('✏️ 설명이 자세해서 자습하기 좋아요.', 40),
  ('💫 핵심내용을 잘 짚어줘요.', 50),
  ('📚 내신 복습용으로 쓰기 좋아요.', 60),
  ('🎨 자료의 디자인이 깔끔해요.', 70),
  ('🎲 문제 유형이 다양해요.', 80)
) as seed(label, sort_order)
cross join (values ('english'), ('korean')) as subjects(subject)
where not exists (
  select 1 from public.market_review_tags t
  where t.workspace_subject = subjects.subject and t.label = seed.label
);
