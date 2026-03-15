# PRD — Generate Menu Sync-Safe Rollout

## Goal
Move 문제생성 2단계 메뉴 ownership from `system_settings.header_navigation` JSON to DB-backed `generate_menu_entries`, while preserving personal generate flow and enabling listboard-first flows.

## User Outcomes
- 개인지문 메뉴는 기존과 동일하게 동작한다.
- 모의고사 등 교재형 메뉴는 listboard-first 화면으로 진입한다.
- 관리자 메뉴 생성/수정/삭제가 실제 사용자 화면과 drift하지 않는다.

## Phase 1 Scope
- `generate_menu_entries` + `generate_listboard_posts`
- header resolved composition
- admin menu-management split
- mock-exams listboard flow
- textbook generate MVP
- backfill remaining generate children into DB-backed menu entries
- basic admin CRUD for listboard posts

## Non-goals
- full header normalization
- redirect/alias management UI
- full feature parity with legacy generate client

## Key Constraints
- no dual-write for generate submenu source of truth
- personal flow remains `/generate` -> `/generate/[typeId]`
- slug immutable when linked/published posts exist
- cutover gated by full backfill + fallback safety
