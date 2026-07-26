# Repository Guidelines

## Instruction Loading Requirement

- 모든 코딩/분석/수정 작업을 시작할 때는 먼저 이 `AGENTS.md`의 적용 범위와 지침을 파악한 뒤 진행한다.
- 하위 디렉터리에 추가 `AGENTS.md`가 있으면, 해당 파일이 더 구체적인 지침으로 우선한다.
- 작업 중 새로 확인한 사용자 지시가 이 파일과 충돌하면, 시스템/개발자/사용자 지시의 우선순위를 따른다.
- 작업 보고 시에는 변경이 이 지침을 어떻게 만족했는지 검증 결과와 함께 간단히 명시한다.

## Codex Coding Discipline

`CLAUDE.md`에 정의된 작업 규율을 Codex 작업에도 동일하게 적용한다. 이 섹션은 프로젝트별 지침과 병합해서 따른다.

### 1. Think Before Coding

- 가정하지 않는다. 혼란을 숨기지 않는다. 트레이드오프를 드러낸다.
- 구현 전에 명확한 가정과 불확실성을 확인한다.
- 여러 해석이 가능하면 조용히 하나를 고르지 말고, 필요한 경우 해석 차이를 드러낸다.
- 더 단순한 접근이 있으면 먼저 제시한다.
- 요구사항이 불명확하고 합리적 추정이 위험하면, 무엇이 불명확한지 짚고 질문한다.

### 2. Simplicity First

- 요청된 문제를 해결하는 최소 코드만 작성한다.
- 요청되지 않은 기능, 추상화, 유연성, 설정 가능성을 추가하지 않는다.
- 단일 사용처를 위한 새 abstraction을 만들지 않는다.
- 불가능하거나 현재 범위를 벗어난 시나리오를 위한 과도한 error handling을 추가하지 않는다.
- 구현이 불필요하게 커졌다면 더 작은 해결책으로 줄인다.

### 3. Surgical Changes

- 반드시 필요한 파일과 라인만 수정한다.
- 인접 코드, 주석, 포맷을 임의로 개선하지 않는다.
- 깨지지 않은 코드를 리팩터링하지 않는다.
- 기존 스타일을 따른다. 개인 선호로 스타일을 바꾸지 않는다.
- 관련 없는 dead code를 발견하면 보고만 하고, 요청 없이는 삭제하지 않는다.
- 이번 변경으로 새로 unused가 된 import/변수/함수는 정리한다.
- 변경된 모든 라인은 사용자의 요청과 직접 연결되어야 한다.

### 4. Goal-Driven Execution

- 작업을 검증 가능한 목표로 바꾼 뒤 진행한다.
- 버그 수정은 가능한 한 재현 테스트를 먼저 작성하고 실패를 확인한 뒤 통과시키는 흐름으로 진행한다.
- 리팩터링/정리는 변경 전후 동작을 검증할 수 있는 테스트 또는 명시적 검증 조건을 둔다.
- 다단계 작업은 간단한 계획을 세우고 각 단계마다 검증 방법을 둔다.
- 검증 조건이 약하거나 모호하면 구현을 멈추고 조건을 명확히 한다.

### 5. Verification Discipline

- 완료를 주장하기 전에 실제 검증 명령을 실행하고 출력/종료 코드를 확인한다.
- 테스트, 린트, 빌드 중 일부만 실행했다면 “부분 검증”이라고 명확히 말한다.
- 실패가 기존 unrelated 문제라면, 이번 변경 대상 검증 결과와 기존 실패를 분리해서 보고한다.
- “될 것 같다”, “아마” 같은 추정으로 완료를 보고하지 않는다.

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
- 생성된 plan을 구현할 때는 각 phase마다 먼저 해당 phase의 계획과 검증 기준을 파악한 뒤, **계획 파악 → 구현 → 검증 → (검증 미통과 시 문제 분석 → 재구현)** loop로 진행한다. 각 phase loop는 검증 통과 전에는 종료하지 않는다.
- 구현 loop는 각 단위 검증을 통과했을 때만 다음 단위로 진행하며, **검증 실패 상태로 종료하지 않는다.**
- 앞으로 이 저장소에서 작성하는 계획 문서는 기본적으로 **한글**로 작성한다. 사용자가 다른 언어를 명시하면 그 지시를 따른다.
- 신규 UI 작업 전 `DESIGN.md`와 `/preview/design-system`을 확인한다.
- 기존 primitive, pattern, template을 우선 사용한다.
- Studio core 값을 raw hex로 작성하거나 임의의 container 너비와 radius를 추가하는 것을 금지한다.
- 새 공통 abstraction은 실제 consumer 2개 이상이 있거나 승인된 template 역할인 경우에만 만든다.
