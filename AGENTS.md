# Repository Guidelines

## Project Structure & Module Organization

- This project is an AI English quiz platform: passage registration/OCR, question generation, exam assembly, and export.
- `src/app` is organized by route groups:
  - `src/app/(dashboard)`: user flows (`generate`, `bank`, `library/exam-papers`, `mypage`)
  - `src/app/(admin)`: admin settings (problem types, prompts, users, credits, refunds, source configs)
  - `src/app/api`: Route Handlers for AI, credits/payments, admin CRUD, and support
- `src/components/ui` contains shared shadcn UI primitives; `src/components/features` contains domain features.
- `src/lib/ai` wraps Gemini/OpenAI providers; export logic is in `src/lib/export-utils.ts` and `src/lib/hwpx-generator.ts`.
- DB migrations live in `supabase/migrations`; Supabase generated types are in `src/types/supabase.ts`.
- HWPX templates are in `public/templates` (`exam_template_single.hwpx`, `exam_template_double.hwpx`).

## Core Architecture Flow

- Question generation: `passages` -&gt; `problem_types` + selected model (`ai_models`/`providers`) -&gt; save to `questions`.
- Exam assembly: select from bank -&gt; create `exam_papers` + ordered `exam_paper_items`.
- Export: from exam-paper detail page, generate PDF/Word/HWPX with 1-column/2-column options.
- Credit/payment domain uses `pricing_plans`, `credit_sources`, `credit_consumption`, `credit_transactions`, `payment_history`, `refund_requests`.

## Build, Test, and Development Commands

- `npm run dev`: start local server on port `4000`.
- `npm run build`: production build.
- `npm run start`: run built app on port `4000`.
- `npm run lint`: run ESLint (Next.js + TypeScript rules).
- `npx supabase db push`: apply migrations.
- `npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts`: sync DB types after schema updates.

## Coding Style & Naming Conventions

- TypeScript-first; default to Server Components. Use `'use client'` only when needed.
- Follow existing style: 2-space indent, single quotes, no semicolons.
- Naming: component files `PascalCase.tsx`, utility files `camelCase.ts`, DB schema `snake_case`.
- Reuse `src/components/ui` primitives before introducing new base UI elements.

## Testing, Security, and PR Guidelines

- No dedicated test runner is configured; minimum checks are `npm run lint` + manual validation of affected routes/APIs.
- All new DB tables must keep RLS enabled and policy-safe defaults (exception handling must be explicit).
- Do not auto-commit after tasks. The user reviews results and handles git commits manually.
- If the user explicitly asks for commit guidance, suggest an appropriate commit message instead of creating the commit automatically.
- PRs should include: scope, changed routes/APIs, migration notes, env var changes, and screenshots for UI changes.

## Workflow Preferences

- 사용자가 **plan / 계획 수립**을 요청하면, 가능한 경우 팀 기반 분석을 먼저 수행하고 **분석 → 계획 수립 → 검증** loop 형태로 계획을 만든다.
- 계획 단계는 검증 기준이 명확해야 하며, **검증 조건이 정의되지 않은 계획은 미완료**로 본다.
- 사용자가 **생성된 plan의 구현**을 요청하면, 구현은 가능한 한 작은 단위로 나누고 **구현 → 검증 → (검증 미통과 시 문제 분석 → 재구현)** loop 형태로 진행한다.
- 구현 loop는 각 단위 검증을 통과했을 때만 다음 단위로 진행하며, **검증 실패 상태로 종료하지 않는다.**
- 앞으로 이 저장소에서 작성하는 계획 문서는 기본적으로 **한글**로 작성한다. 사용자가 다른 언어를 명시하면 그 지시를 따른다.