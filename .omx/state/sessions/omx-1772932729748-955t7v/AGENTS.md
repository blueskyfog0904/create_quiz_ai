# Repository Guidelines

## Project Structure & Module Organization
- This project is an AI English quiz platform: passage registration/OCR, question generation, exam assembly, and export.
- `src/app` is organized by route groups:
  - `src/app/(dashboard)`: user flows (`generate`, `bank`, `library/exam-papers`, `mypage`)
  - `src/app/(admin)`: admin settings (problem types, prompts, users, credits, refunds, source configs)
  - `src/app/api`: Route Handlers for AI, credits/payments, admin CRUD, and support
- `src/components/ui` contains shared shadcn UI primitives; `src/components/features` contains domain features.
- `src/lib/ai` wraps Gemini/OpenAI providers; export logic is in `src/lib/export-utils.ts` and `src/lib/hwpx-generator.ts`.
- DB migrations live in `supabase/migrations`; Supabase generated types are in `src/types/supabase.ts`.
- HWPX templates are in `public/templates` (`exam_template_single.hwpx`, `exam_template_double.hwpx`).

## Core Architecture Flow
- Question generation: `passages` -> `problem_types` + selected model (`ai_models`/`providers`) -> save to `questions`.
- Exam assembly: select from bank -> create `exam_papers` + ordered `exam_paper_items`.
- Export: from exam-paper detail page, generate PDF/Word/HWPX with 1-column/2-column options.
- Credit/payment domain uses `pricing_plans`, `credit_sources`, `credit_consumption`, `credit_transactions`, `payment_history`, `refund_requests`.

## Build, Test, and Development Commands
- `npm run dev`: start local server on port `4000`.
- `npm run build`: production build.
- `npm run start`: run built app on port `4000`.
- `npm run lint`: run ESLint (Next.js + TypeScript rules).
- `npx supabase db push`: apply migrations.
- `npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts`: sync DB types after schema updates.

## Coding Style & Naming Conventions
- TypeScript-first; default to Server Components. Use `'use client'` only when needed.
- Follow existing style: 2-space indent, single quotes, no semicolons.
- Naming: component files `PascalCase.tsx`, utility files `camelCase.ts`, DB schema `snake_case`.
- Reuse `src/components/ui` primitives before introducing new base UI elements.

## Testing, Security, and PR Guidelines
- No dedicated test runner is configured; minimum checks are `npm run lint` + manual validation of affected routes/APIs.
- All new DB tables must keep RLS enabled and policy-safe defaults (exception handling must be explicit).
- Keep commits atomic and prefer `type: description` (`feat:`, `fix:`, `refactor:`).
- PRs should include: scope, changed routes/APIs, migration notes, env var changes, and screenshots for UI changes.

<!-- OMX:RUNTIME:START -->
<session_context>
**Session:** omx-1772932729748-955t7v | 2026-03-08T01:18:54.636Z

**Codebase Map:**
  src/: middleware
  src/app/: credits-client, grant-credit-dialog, page, dashboard-client, page, layout, page, model-settings, page, page
  src/components/: model-selector, provider-selector, question-list, credit-confirmation-dialog, ai-generator, ocr-preview-stage, ocr-result-view, passage-detail-modal, passage-filter-bar, passage-list
  src/lib/: gemini, openai, types, auth, passage-categories, credits, display-labels, export-utils, hwpx-generator
  src/types/: supabase
  scripts/: run-migration
  (root): debug_models, eslint.config, list_models, next.config, postcss.config

**Compaction Protocol:**
Before context compaction, preserve critical state:
1. Write progress checkpoint via state_write MCP tool
2. Save key decisions to notepad via notepad_write_working
3. If context is >80% full, proactively checkpoint state
</session_context>
<!-- OMX:RUNTIME:END -->
