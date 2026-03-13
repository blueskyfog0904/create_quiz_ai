# Migration Spec — Generate Menu Sync-Safe Foundation

## Goal
문제생성 2단계 메뉴를 `system_settings.header_navigation` JSON에서 분리해, DB-backed source of truth로 전환하기 위한 기초 스키마를 추가한다.

## New Tables
### 1. `public.generate_menu_entries`
문제생성 2단계 메뉴 원본

#### Columns
- `id uuid pk`
- `entry_key text unique not null`
- `slug text unique not null`
- `title text not null`
- `entry_type text not null check (entry_type in ('personal_generate', 'listboard'))`
- `description text null`
- `sort_order integer not null default 0`
- `is_visible boolean not null default true`
- `is_active boolean not null default true`
- `search_config jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz null`

#### Seed rows
- `personal`
  - `entry_type = 'personal_generate'`
  - `slug = 'personal'`
  - `title = '개인지문'`
- `mock-exams`
  - `entry_type = 'listboard'`
  - `slug = 'mock-exams'`
  - `title = '모의고사'`

### 2. `public.generate_listboard_posts`
listboard 글 원본

#### Columns
- `id uuid pk`
- `menu_entry_id uuid not null references public.generate_menu_entries(id)`
- `title text not null`
- `passage_text text not null`
- `exam_year integer null`
- `exam_month integer null`
- `grade_level text null`
- `source_type text null`
- `source_1 text null`
- `source_2 text null`
- `source_3 text null`
- `source_4 text null`
- `status text not null default 'draft' check (status in ('draft', 'published', 'archived'))`
- `is_active boolean not null default true`
- `published_at timestamptz null`
- `created_by uuid null references public.profiles(id)`
- `updated_by uuid null references public.profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz null`

## Invariants
### Post-to-menu invariant
`generate_listboard_posts.menu_entry_id`는 반드시 `generate_menu_entries.entry_type = 'listboard'`인 row만 참조해야 한다.

#### Enforcement
- app/service validation
- DB trigger validation

## Indexes
### `generate_menu_entries`
- unique(`entry_key`)
- unique(`slug`)
- index(`sort_order`)
- index(`is_visible`, `is_active`, `deleted_at`)

### `generate_listboard_posts`
- index(`menu_entry_id`, `status`)
- index(`menu_entry_id`, `exam_year`, `exam_month`, `grade_level`)
- index(`is_active`, `deleted_at`)

## Triggers / Functions
### Updated-at triggers
- `set_generate_menu_entries_updated_at`
- `set_generate_listboard_posts_updated_at`

### Validation trigger
- `validate_generate_listboard_post_menu_entry()`
  - reject if referenced menu entry is not `listboard`

## RLS
### `generate_menu_entries`
- authenticated users: read only active/visible/non-deleted rows
- admins: full manage

### `generate_listboard_posts`
- authenticated users: read only `published` + active + non-deleted rows
- admins: full manage

## Rollout Notes
1. 이 migration은 기존 `system_settings.header_navigation`을 삭제하거나 변경하지 않는다.
2. phase 1에서는 기존 JSON child와 DB rows가 잠시 공존할 수 있다.
3. cutover 이전에는 JSON fallback이 남아 있으므로 seed row가 반드시 들어가야 한다.

## Backfill Scope
- 기존 `/generate` 하위 child menu 중 운영 대상만 `generate_menu_entries`로 이관
- phase 1 최소 범위:
  - `개인지문`
  - `모의고사`

## Out of Scope
- route 구현
- admin UI 구현
- header merge 구현
- redirect alias table
