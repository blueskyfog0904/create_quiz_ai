-- 관리자 상품 이미지 라이브러리 M1 (docs/admin-product-image-library-plan.md 2절, 6절 M1)
-- - 공개 버킷 market-images (2MB, image/webp)
-- - market_image_folders (1단계 폴더), market_images (내용 해시 기준 이미지 행)
-- - 두 테이블 RLS 활성 + 정책 없음 + public/anon/authenticated 권한 회수 (서비스 롤 전용)
--
-- 트랜잭션: 파일 안에 BEGIN/COMMIT을 두지 않는다(20260930020304_market_cart_checkout와 같은 이유).
-- 재실행 안전: ON CONFLICT DO UPDATE / IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.

-- 1. 버킷 (D5). storage.objects에 anon/authenticated 쓰기 정책을 만들지 않는다.
--    쓰기·삭제는 관리자 API가 서비스 롤로만 한다.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'market-images',
  'market-images',
  true,
  2097152,
  array['image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. 폴더 (Q1 1단계). 이름은 앞뒤 공백 없이 1~60자로 저장하고 대소문자 무시 중복을 막는다.
create table if not exists public.market_image_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_image_folders_name_check
    check (name = btrim(name) and char_length(name) between 1 and 60)
);

comment on table public.market_image_folders is '문제마켓 상품 이미지 폴더(1단계, 논리 구조만). 서비스 롤 전용';

create unique index if not exists uq_market_image_folders_name_lower
  on public.market_image_folders(lower(name));

-- updated_at 트리거 (테이블별 함수, search_path 고정 — 기존 관례)
create or replace function public.set_market_image_folders_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_market_image_folders_updated_at on public.market_image_folders;
create trigger set_market_image_folders_updated_at
  before update on public.market_image_folders
  for each row execute function public.set_market_image_folders_updated_at();

-- 3. 이미지 (D1·D2·D4). folder_id NULL = 미분류, 이미지가 있는 폴더는 삭제 불가(Q2, restrict).
--    content_sha256: 정규화 WebP 바이트 해시(권위 키, 저장 경로 파일명)
--    source_sha256: 서버가 받은 바이트 해시(사전 확인용, 비유니크)
create table if not exists public.market_images (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.market_image_folders(id) on delete restrict,
  display_name text not null,
  storage_path text not null,
  content_sha256 text not null,
  source_sha256 text not null,
  width integer not null,
  height integer not null,
  bytes integer not null,
  mime_type text not null default 'image/webp',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint market_images_storage_path_key unique (storage_path),
  constraint market_images_content_sha256_key unique (content_sha256),
  constraint market_images_content_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint market_images_source_sha256_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint market_images_size_check check (width > 0 and height > 0 and bytes > 0),
  constraint market_images_mime_type_check check (mime_type = 'image/webp')
);

comment on table public.market_images is '문제마켓 상품 이미지(market-images 버킷 객체 1개당 1행). 서비스 롤 전용';

create index if not exists idx_market_images_folder_created_at
  on public.market_images(folder_id, created_at desc);

create index if not exists idx_market_images_source_sha256
  on public.market_images(source_sha256);

-- 4. 권한 (2절 권한 규칙). 기본 ACL이 anon/authenticated에 전 권한을 주므로 생성 직후 회수한다.
--    정책은 만들지 않는다: RLS 켠 채 정책 없음 = 서비스 롤 외 전부 거부(권한 회수와 이중 방어).
alter table public.market_image_folders enable row level security;
alter table public.market_images enable row level security;

revoke all on table public.market_image_folders from public, anon, authenticated;
revoke all on table public.market_images from public, anon, authenticated;
