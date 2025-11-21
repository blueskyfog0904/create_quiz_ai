# Development Guidelines

## Project Overview
**AI English Quiz Platform**: A Next.js web application for generating English quizzes using OpenAI, managing them in a Supabase database, and exporting to PDF/Word.
**Tech Stack**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Supabase (Auth/DB/Storage), OpenAI API.

## Code Standards

### Naming & Structure
- **Files**: Use `PascalCase.tsx` for components, `camelCase.ts` for utilities.
- **Directories**: Use `kebab-case` for standard folders, `(group)` for route groups.
- **Database**: **MUST** use `snake_case` for all table names and columns.
- **Variables**: Use `camelCase` for TS/JS variables.
- **Interfaces**: Prefix with `I` is **PROHIBITED**. Use named interfaces (e.g., `interface UserProfile`).

### Implementation Rules
- **Server Components**: **DEFAULT** to Server Components. Use `'use client'` only when interactivity (hooks, event listeners) is required.
- **Type Safety**: **MUST** use strict TypeScript types. `any` is **PROHIBITED** without explicit justification.
- **UI Components**: **MUST** use `shadcn/ui` components from `components/ui` where applicable. **DO NOT** reinvent basic UI elements.

## Database & Auth Standards (Supabase)

### Schema Design
- **Profiles Table**: **MUST** exist as `public.profiles` and link 1:1 with `auth.users` via `id`.
- **Foreign Keys**: **MUST** use `ON DELETE CASCADE` or `SET NULL` appropriately to maintain referential integrity.

### Security (RLS)
- **RLS Enforcement**: **MUST** enable Row Level Security (RLS) on ALL created tables.
- **Policies**:
  - Users can only `SELECT`, `UPDATE`, `DELETE` their own data (`user_id = auth.uid()`).
  - Public read access is allowed only for `problem_types` (if applicable).
  - Service role bypass is allowed only in secure server-side contexts.

### Authentication
- **Session**: **MUST** rely on Supabase Auth session.
- **Kakao Login**: Handle OAuth tokens temporarily; exchange for Supabase session immediately.

## AI Integration Standards (OpenAI)

### API Usage
- **Server-Side Only**: OpenAI API calls **MUST** happen in Server Actions or API Routes (`app/api/...`). **NEVER** call OpenAI from client components.
- **Secrets**: **NEVER** hardcode API keys. Use `process.env.OPENAI_API_KEY`.
- **Response Format**: **MUST** request/parse JSON output from AI. Use Zod for schema validation of AI responses.

## Workflow & File Interactions

### Supabase Types
- **Type Generation**: When DB schema changes, **MUST** run type generation (or mock it if CLI unavailable) and update `types/supabase.ts`.
- **Usage**: **MUST** import DB types from `types/supabase.ts` instead of manually defining duplicates.

### Commit Standards
- **Atomic Commits**: **MUST** commit after completing a distinct feature or fix.
- **Message Format**: `type: description` (e.g., `feat: add login page`, `fix: resolve RLS issue`).

## Prohibited Actions
- **NO** `pages/` directory usage (App Router enforced).
- **NO** direct database connection strings in client code.
- **NO** inline styles (use Tailwind classes).
- **NO** removing user content without confirmation.

