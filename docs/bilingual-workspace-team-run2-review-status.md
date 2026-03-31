# Bilingual Workspace Team Run 2 Review Status

Date: 2026-03-31

## Current Review Snapshot
Team Run 2 is still **in progress** because the generate lane has not been reported complete yet.
This snapshot documents the completed lanes that are already available for review in local git history and the constraints that still block final closeout.

## Completed Lanes Reviewed So Far

### Passages lane
- Commit: `4b22abd` — `Keep passage flows inside their active workspace`
- Review doc: `docs/bilingual-workspace-passages-review.md`
- Summary:
  - passage CRUD and tag lookup now respect `workspace_subject`
  - passage revalidation moved to `workspaceRevalidatePaths('libraryMypassages')`
  - passage UI derives workspace from route params/pathname using the Team Run 1 helper contract

### Market lane
- Commit: `8d38f75` — `Prevent market workspace leakage before bilingual route cutover`
- Summary:
  - market catalog/item/purchase/download surfaces were updated across dashboard pages, server helpers, and API routes
  - storage handling and purchase/view endpoints were included in the isolation pass

### Bank / purchased / exam-papers lane
- Commit: `7bd3758` — `Prevent bank and exam-paper flows from crossing workspace boundaries`
- Summary:
  - bank, purchased, and exam-paper pages plus API routes were updated to reject or avoid cross-workspace reads
  - question detail and save-from-community routes were also included in the subject-boundary hardening

### Auth / revalidation lane
- Commit: `68dd943` — `Preserve workspace-safe auth redirects and scoped cache invalidation`
- Summary:
  - auth/login/signup/callback routing was updated to preserve workspace-aware redirects
  - scoped cache invalidation landed across affected mutations, including passages and admin actions

## Remaining Blocker For Final Review
- Generate lane completion is still pending.
- Until that lane is complete or declared blocked, Team Run 2 review cannot be treated as final because the plan explicitly requires all subject-facing loaders/mutations to be scoped before shutdown.

## Review Constraints
- Stay inside Team Run 2 scope only.
- Do **not** start public cutover, admin subject split, or fallback removal from this review task.
- Reuse the Team Run 1 foundation contract (`workspace_subject`, workspace helpers, workspace settings helpers) instead of inventing alternate review criteria.
