# Route Spec — Generate Personal vs Listboard Split

## Goal
기존 개인지문 생성 흐름은 유지하고, 비개인 문제생성 메뉴는 listboard-first 구조로 분리한다.

## Phase 1 Route Rules
### Personal flow
- menu entry: `entry_type = 'personal_generate'`
- menu href: `/generate`
- actual generation path:
  - `/generate`
  - user selects problem type
  - `/generate/[typeId]`

### Non-personal flow
- menu entry: `entry_type = 'listboard'`
- menu href: `/generate/boards/[slug]`
- post detail/generate path candidates:
  - `/generate/boards/[slug]`
  - `/generate/boards/[slug]/posts/[postId]`
  - `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`

## Route Ownership
### Existing routes kept
- `src/app/(dashboard)/generate/page.tsx`
- `src/app/(dashboard)/generate/[typeId]/page.tsx`
- `src/app/(dashboard)/generate/[typeId]/generate-client.tsx`

### New routes
- `src/app/(dashboard)/generate/boards/[slug]/page.tsx`
- optional: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/page.tsx`

## Why Namespace Split Is Required
현재 `/generate/[typeId]`는 `problem_types.id` UUID 전제다.

따라서 slug 기반 메뉴를 같은 segment에 섞으면:
- UUID lookup 충돌
- fallback 오동작
- routing ambiguity

그래서 phase 1에서는 반드시 `/generate/boards/*` namespace를 쓴다.

## Route-to-Component Map
### `/generate`
- existing generate home 유지
- `personal_generate`의 공식 진입점

### `/generate/[typeId]`
- existing `GenerateClient`
- personal flow only

### `/generate/boards/[slug]`
- `TextbookListboardPage`
- 상단: `문제 검색`
- filters:
  - 년도
  - 월
  - 학년
  - 제목 keyword

### `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`
- `TextbookGeneratePage`
- source passage = selected post `passage_text`
- base behavior = copied/trimmed version of existing generate client

## Access Rules
- generate area remains authenticated-only
- unpublished / archived posts are not user-visible
- invalid slug -> board not found UX
- invalid postId under slug -> post not found UX

## Active Sidebar Rules
- sidebar items come from resolved header config
- active match rules:
  - `/generate` matches personal flow only
  - `/generate/boards/[slug]` matches listboard flow
  - nested `/posts/*` routes should still highlight the same `[slug]` board item

## Phase 1 UX Notes
- personal menu label: `개인지문`
- first listboard target: `모의고사`
- `TextbookGenerate` in phase 1 can be a copied component from existing generate client with:
  - no passage selector modal
  - no manual personal passage fetch button
  - selected post metadata display

## Out of Scope
- redirect support for slug rename
- board alias routing
- full post detail viewer if generate can open directly from listboard
