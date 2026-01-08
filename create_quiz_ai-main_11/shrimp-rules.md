# Development Guidelines

## Project Overview
**AI English Quiz Platform**: A Next.js web application for generating English quizzes using OpenAI/Gemini, managing them in a Supabase database, and exporting to PDF/Word.
**Tech Stack**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Supabase (Auth/DB/Storage), OpenAI/Gemini API.

## Code Standards
### Naming & Structure
- **Files**: `PascalCase.tsx` (Components), `camelCase.ts` (Utils).
- **Database**: `snake_case` for all tables/columns.
- **Variables**: `camelCase`.
- **Interfaces**: Named interfaces (e.g., `UserProfile`), NO `I` prefix.

### Implementation Rules
- **Server Components**: Default choice. Use `'use client'` only for interactivity.
- **Type Safety**: Strict TS. No `any`.
- **UI**: Use `shadcn/ui`.

## Security & Authentication (Critical)
- **Supabase Keys**: 
  - Client: `NEXT_PUBLIC_SUPABASE_ANON_KEY` ONLY.
  - Server: `SUPABASE_SERVICE_ROLE_KEY` ONLY (Never expose to browser).
- **Session Source**: Trust **ONLY** Supabase Auth Session. Kakao is for onboarding/linking only.
- **RLS (Row-Level Security)**: 
  - **MANDATORY** for all tables (`profiles`, `questions`, `exam_papers`).
  - All queries **MUST** filter by `user_id` (e.g., `auth.uid()`).

## Environment & Deployment
- **Env Vars**: Differentiate `NEXT_PUBLIC_` (Client) vs Server keys (OpenAI, Kakao Admin, Service Role).
- **Timeouts**: AI generation and File export APIs **MUST** complete within serverless limits (10-30s). Handle timeouts with user-friendly errors.

## AI Integration & Prompts
- **Response Format**: **MUST** be JSON. Prompt must explicitly request JSON. Handle `JSON.parse` failures gracefully (retry or error).
- **Prompt Management**: **NEVER** hardcode prompts. Fetch from `problem_types.prompt_template` in DB.
- **Adapter Pattern**: Use `lib/ai/` with `provider` (OpenAI/Gemini) abstraction.
- **Input Constraints**: Max 800 chars for passage (Validate on Client AND Server).

## Database Schema Standards
- **Questions Table**:
  - `question_text` (Text)
  - `choices` (JSON Array: `[{ label: "①", text: "..." }]`)
  - `answer` (String)
  - `explanation` (Text)
  - `problem_type_id` (FK -> `problem_types.id`)
- **Exam Papers**: N:N relation via `exam_paper_items` table.

## API & Error Handling
- **Response Format**: `{ success: boolean, data?: any, error?: { code: string, message: string } }`.
- **AI Failures**: Log full error internally (stack trace); Return simple "Temporary Error" to user.
- **File Generation**: Provide retry mechanism if PDF/DOCX fails.

## UX & Frontend
- **Loading States**: **MUST** show spinners/progress for AI generation and File downloads.
- **Validation**: Double validation (Client + Server) for all inputs (Email, Password, Text length).
- **MVP Scope**: Only expose Grade, Difficulty, and Type initially.

## Logging
- **AI Logs**: Record `user_id`, `problem_type_id`, `input_length`, `response_time`, `success/fail` in a log table or system.
- **Error Logs**: Separate internal technical logs from user-facing messages.
