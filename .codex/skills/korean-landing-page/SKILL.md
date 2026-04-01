---
name: korean-landing-page
description: Use when the user needs a Korean landing page actually implemented in this create_quiz_ai repo with Next.js pages and components, not just copywriting guidance.
---

# Korean Landing Page

## Overview
This skill is for **real implementation work**: building Korean landing pages in `create_quiz_ai` with Next.js App Router code.
It is not a copy-only skill. Use it when the request should end in page/component files and verification evidence.

## Use When
- A user asks for a Korean landing page to be made or redesigned in this repo
- The request needs an actual route/page, section components, CTA blocks, or responsive page structure
- The output should follow existing `create_quiz_ai` patterns instead of creating a standalone prototype

## Do Not Use When
- The user only wants slogans, copy variations, or a text draft
- The task is only a tiny text edit on an existing page
- The user wants a broad multi-page product redesign rather than a focused landing page

## Repo-Specific Rules
- Use `src/app` App Router pages first
- Reuse `src/components/ui` before inventing new primitives
- Use `src/components/features` when section extraction improves clarity
- Prefer Server Components; use `'use client'` only for real interactivity
- Follow repo style: 2-space indent, single quotes, no semicolons
- Do not add new dependencies

## First Files to Inspect
- `AGENTS.md`
- `package.json`
- nearby routes in `src/app`
- shared UI in `src/components/ui`
- relevant feature sections in `src/components/features`

## Recommended Execution Flow
1. Read the request and identify the landing page goal, route, audience, and CTA.
2. Inspect nearby pages/layout patterns in `src/app`.
3. Decide the minimal implementation shape:
   - page only, or
   - page + extracted section components
4. Implement Korean-first sections such as:
   - hero
   - value proposition / feature grid
   - trust/proof/metrics
   - process/FAQ
   - final CTA
5. Reuse existing shared UI primitives.
6. Run verification before claiming completion.

## Preferred Agent
When delegating this task, use the local agent:
- `.codex/agents/korean-landing-builder.toml`

Read the canonical detailed prompt first:
- `.codex/prompts/korean-landing-builder.md`

## Verification
Default verification set for implementation work:
- `git diff --check`
- `npx tsc --noEmit`
- `npm run build`
- targeted lint when useful for touched files

## Final Output Expectations
Report these clearly:
- changed files
- implemented landing-page structure
- reused shared UI/patterns
- verification evidence
- remaining risks or follow-up polish items

## Anti-Patterns
- Delivering only copy without code
- Adding a new design system instead of reusing repo UI
- Making the whole page client-side for static content
- Skipping verification
