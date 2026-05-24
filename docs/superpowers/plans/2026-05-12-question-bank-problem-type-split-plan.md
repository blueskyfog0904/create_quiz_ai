# 영어문제생성/문제은행 문제유형 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영어문제생성에서 쓰는 AI 생성 문제유형과 영어문제은행에서 쓰는 분류 문제유형을 DB/RPC/API/UI 전 구간에서 독립 운영한다.

**Architecture:** 기존 `public.problem_types`는 AI 생성용 테이블로 유지하고, 새 `public.question_bank_problem_types`를 문제은행 전용 테이블로 추가한다. 문제은행 문항의 유형 기준은 `questions.problem_type_id`가 아니라 `question_bank_question_metadata.bank_problem_type_id`로 전환하며, 백필 → dual-read/write → RPC/UI 전환 → legacy fallback 제거 순서로 안전하게 진행한다.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres/RLS/RPC, Supabase generated types, Node.js built-in test runner, ESLint.

---

## 계획 작성/검증 loop 결과

- 1차 분석: 현재 `problem_types`가 AI 생성 설정과 문제은행 분류를 동시에 담당하는 것을 확인했다.
- 1차 계획: `question_bank_problem_types` 별도 테이블 + `question_bank_question_metadata.bank_problem_type_id` 전환안을 작성했다.
- 1차 검증: architect/planner는 PASS, critic은 “FK/업로드/RPC/copy/템플릿 보완 필요”로 FAIL 판정했다.
- 2차 계획 보완: critic 지적 5개를 모두 반영했다.
- 2차 검증: critic 최종 PASS. 남은 blocker 없음. 구현 단계에서는 백필 감사 0건, RPC 권한/active 검증, legacy fallback 제거 테스트를 반드시 포함한다.


---

## 구현 완료 메모 (2026-05-12)

- 계획-검증 loop 중 원격 DB 검증에서 `question_bank_question_metadata(bank_problem_type_id, workspace_subject)` FK 보조 인덱스 누락과 backfill helper 2개의 legacy 기준 사용을 발견했고, 로컬 마이그레이션/계약 테스트/원격 DB에 모두 보강했다.
- 최종 critic 검증에서 일반 사용자의 `/bank` 화면이 `admin_uploaded` 문항 metadata를 RLS 때문에 읽지 못하는 blocker를 발견했다. `20260512093000_allow_bank_metadata_read_for_admin_uploaded_questions.sql`로 admin_uploaded 문항에 한정한 metadata SELECT 정책을 추가했고, 원격 DB와 계약 테스트에 반영한 뒤 critic 재검증 PASS를 받았다.
- 실제 구현은 기존 화면 props shape를 최대한 유지하는 최소 변경으로 진행했다. 따라서 별도 helper 파일(`src/lib/question-bank/problem-types.ts`)과 일부 client 직접 수정은 만들지 않았고, 서버 page/API에서 `question_bank_problem_types` 값을 기존 client가 받는 shape로 overlay했다.
- 최종 검증 기준은 아래 명령과 원격 Supabase audit으로 확인했다: 문제은행 계약 테스트, TypeScript, 변경 TS/TSX targeted ESLint, production build, 원격 metadata audit/RPC definition 검사.

## 현재 구조 근거

- `supabase/migrations/0000_initial_schema.sql:24-35` — `problem_types`는 `provider`, `model_name`, `prompt_template`을 가진 AI 생성 설정 테이블이다.
- `supabase/migrations/0000_initial_schema.sql:38-49` — `questions.problem_type_id`가 `problem_types.id`를 참조한다.
- `src/app/(dashboard)/generate/page.tsx:16-22` — AI 생성 화면이 `problem_types`를 조회하고 `model_name != 'admin'`으로 은행용 유형을 제외한다.
- `src/app/api/questions/generate/route.ts:159-277` — 생성 API가 `problem_types.prompt_template/provider/model_name`으로 AI 호출을 구성한다.
- `src/app/(dashboard)/bank/page.tsx:44-50` — 문제은행 필터도 같은 `problem_types`를 조회한다.
- `src/app/(dashboard)/library/purchased/page.tsx:84-89` — 영어문제 관리 화면도 같은 `problem_types`를 조회한다.
- `supabase/migrations/20260504000000_create_question_bank_random_exam_schema.sql:186-198` — availability RPC가 현재 `q.problem_type_id`로 그룹핑한다.
- `supabase/migrations/20260504000000_create_question_bank_random_exam_schema.sql:336-357` — 랜덤 출제 RPC가 현재 `q.problem_type_id`로 후보를 선별한다.
- `supabase/migrations/20260504000000_create_question_bank_random_exam_schema.sql:1231-1270` — 사용자 저장 복사 RPC가 현재 원본 `q.problem_type_id`를 복사한다.

---

## 파일 구조

### 새로 만들 파일

- `supabase/migrations/20260512090000_create_question_bank_problem_types.sql`
  - `question_bank_problem_types` 테이블, RLS, 인덱스, `question_bank_question_metadata.bank_problem_type_id` nullable 컬럼, 기존 은행 문항 백필을 담당한다.
- `supabase/migrations/20260512091000_switch_question_bank_problem_type_rpcs.sql`
  - 문제은행 RPC를 `bank_problem_type_id` 기준으로 전환한다.
- `supabase/migrations/20260512092000_enforce_question_bank_problem_type_metadata.sql`
  - 전환 검증 후 `bank_problem_type_id` not null/FK/cleanup 제약을 강화한다.
- `src/app/api/admin/question-bank/problem-types/route.ts`
  - 관리자 문제은행 문제유형 목록/생성 API.
- `src/app/api/admin/question-bank/problem-types/[id]/route.ts`
  - 관리자 문제은행 문제유형 수정/비활성화 API.
- `src/app/(admin)/admin/question-bank/problem-types/page.tsx`
  - 관리자 문제은행 문제유형 관리 페이지.
- `src/app/(admin)/admin/question-bank/problem-types/question-bank-problem-types-client.tsx`
  - 문제은행 문제유형 관리 클라이언트 UI.
- `src/lib/question-bank/problem-types.ts`
  - 문제은행 문제유형 타입/정규화 helper.
- `tests/question-bank-problem-types-schema-contract.test.mjs`
  - 새 DB schema/RPC 전환 계약 테스트.
- `tests/question-bank-problem-types-api-contract.test.mjs`
  - API/UI가 새 테이블을 사용하는지 확인하는 계약 테스트.

### 수정할 파일

- `src/types/supabase.ts`
  - Supabase generated types 재생성.
- `src/app/api/admin/questions/upload/route.ts`
  - 단건/일괄 업로드 payload를 `bankProblemTypeId` 기준으로 전환.
- `src/app/api/admin/questions/bulk-upload/route.ts`
  - 템플릿 파싱에서 `bankProblemTypeId`를 primary로 사용하고 `문제유형`은 unique fallback으로 사용.
- `src/app/api/admin/questions/template/route.ts`
  - 템플릿에 `bankProblemTypeId` 컬럼과 `문제은행유형목록` 시트를 추가.
- `src/app/api/admin/questions/[id]/route.ts`
  - 관리자 문제 수정에서 `bankProblemTypeId`를 PATCH payload로 전달.
- `src/app/(admin)/admin/questions/upload/admin-upload-client.tsx`
  - 문제유형 select를 `question_bank_problem_types`로 전환.
- `src/app/(admin)/admin/questions/[id]/edit-question-client.tsx`
  - 수정 화면에서 `bankProblemTypeId`를 표시/저장한다.
- `src/app/(admin)/admin/questions/page.tsx` 및 관련 client
  - 관리자 문제은행 목록 필터가 bank type을 사용하게 한다.
- `src/app/(dashboard)/bank/page.tsx`
  - 문제은행 필터와 질문 join을 bank type 기준으로 전환.
- `src/app/(dashboard)/bank/bank-client.tsx`
  - 필터/카드 표시 유형명을 bank type label로 전환.
- `src/app/(dashboard)/library/purchased/page.tsx`
  - mixed source 화면에서 AI 생성 문항은 `problem_types`, 은행 문항은 `question_bank_problem_types` label을 함께 가져온다.
- `src/app/(dashboard)/library/purchased/purchased-client.tsx`
  - source별 유형 필터/표시를 분기한다.
- `src/components/features/question-bank/random-exam-dialog.tsx`
  - 랜덤 문제지 유형 목록이 bank type만 받도록 props/type을 정리한다.
- `src/app/api/question-bank/options/route.ts`
  - year/book과 함께 active bank problem types를 같은 응답의 `problemTypes` 배열로 반환한다.
- `src/app/api/question-bank/availability/route.ts`
  - 반환값은 `bankProblemTypeId` 의미를 갖는 `problemTypeId`를 유지하되 내부 기준은 metadata로 전환한다.
- `src/app/api/exam-papers/random-bank/route.ts`
  - request `typeCounts.problemTypeId`를 bank type ID로 검증한다.
- `tests/question-bank-schema-contract.test.mjs`
  - 기존 random/upload RPC 계약에 bank type 기준을 추가한다.
- `tests/question-bank-upload-metadata-contract.test.mjs`
  - 업로드/템플릿 계약을 `bankProblemTypeId` 기준으로 갱신한다.
- `tests/question-bank-random-dialog-contract.test.mjs`
  - random dialog가 bank type 목록을 사용하는지 갱신한다.
- `tests/question-bank-rpc-integration.test.mjs`
  - integration env가 있을 때 bank type negative/positive case를 검증한다.

---

## Task 1: 실패하는 schema/API 계약 테스트 작성

**Files:**
- Create: `tests/question-bank-problem-types-schema-contract.test.mjs`
- Create: `tests/question-bank-problem-types-api-contract.test.mjs`
- Modify: `tests/question-bank-upload-metadata-contract.test.mjs`
- Modify: `tests/question-bank-random-dialog-contract.test.mjs`

- [ ] **Step 1: schema contract 테스트 파일을 추가한다**

Create `tests/question-bank-problem-types-schema-contract.test.mjs` with this content:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const migrationDir = path.join(repoRoot, 'supabase/migrations')
const schemaMigrationPath = path.join(migrationDir, '20260512090000_create_question_bank_problem_types.sql')
const rpcMigrationPath = path.join(migrationDir, '20260512091000_switch_question_bank_problem_type_rpcs.sql')
const enforceMigrationPath = path.join(migrationDir, '20260512092000_enforce_question_bank_problem_type_metadata.sql')

const readIfExists = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
const schemaSql = readIfExists(schemaMigrationPath)
const rpcSql = readIfExists(rpcMigrationPath)
const enforceSql = readIfExists(enforceMigrationPath)

test('schema migration creates question_bank_problem_types with RLS and workspace constraints', () => {
  assert.match(schemaSql, /create\s+table\s+if\s+not\s+exists\s+public\.question_bank_problem_types/i)
  assert.match(schemaSql, /workspace_subject\s+text\s+not\s+null\s+check\s*\(\s*workspace_subject\s+in\s*\(\s*'english'\s*,\s*'korean'\s*\)/i)
  assert.match(schemaSql, /constraint\s+question_bank_problem_types_workspace_type_name_key\s+unique\s*\(\s*workspace_subject\s*,\s*type_name\s*\)/i)
  assert.match(schemaSql, /constraint\s+question_bank_problem_types_id_workspace_subject_key\s+unique\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)
  assert.match(schemaSql, /alter\s+table\s+public\.question_bank_problem_types\s+enable\s+row\s+level\s+security/i)
  assert.match(schemaSql, /for\s+select\s+to\s+authenticated[\s\S]*is_active\s*=\s*true/i)
  assert.match(schemaSql, /for\s+all\s+to\s+authenticated[\s\S]*public\.is_admin\s*\(\s*\)/i)
})

test('metadata stores bank_problem_type_id with composite workspace FK and lookup index', () => {
  assert.match(schemaSql, /alter\s+table\s+public\.question_bank_question_metadata[\s\S]*add\s+column\s+if\s+not\s+exists\s+bank_problem_type_id\s+uuid/i)
  assert.match(enforceSql, /foreign\s+key\s*\(\s*bank_problem_type_id\s*,\s*workspace_subject\s*\)[\s\S]*references\s+public\.question_bank_problem_types\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)
  assert.match(schemaSql + enforceSql, /idx_qb_metadata_scope_type_lookup[\s\S]*workspace_subject[\s\S]*year_id[\s\S]*book_id[\s\S]*bank_problem_type_id[\s\S]*question_id/i)
})

test('backfill maps only admin_uploaded and from_community questions from legacy problem_types', () => {
  assert.match(schemaSql, /q\.source\s+in\s*\(\s*'admin_uploaded'\s*,\s*'from_community'\s*\)/i)
  assert.match(schemaSql, /join\s+public\.problem_types\s+pt\s+on\s+pt\.id\s*=\s*q\.problem_type_id/i)
  assert.match(schemaSql, /insert\s+into\s+public\.question_bank_problem_types/i)
  assert.match(schemaSql, /update\s+public\.question_bank_question_metadata\s+m[\s\S]*bank_problem_type_id/i)
})

test('question bank RPCs use metadata bank_problem_type_id instead of q.problem_type_id for bank behavior', () => {
  assert.match(rpcSql, /create\s+or\s+replace\s+function\s+public\.get_question_bank_availability/i)
  assert.match(rpcSql, /create\s+or\s+replace\s+function\s+public\.create_random_bank_exam_paper/i)
  assert.match(rpcSql, /create\s+or\s+replace\s+function\s+public\.admin_list_bank_questions/i)
  assert.match(rpcSql, /m\.bank_problem_type_id/i)
  assert.match(rpcSql, /join\s+public\.question_bank_problem_types\s+qbpt/i)
  assert.doesNotMatch(rpcSql, /group\s+by\s+q\.problem_type_id/i)
  assert.doesNotMatch(rpcSql, /partition\s+by\s+q\.problem_type_id/i)
})

test('enforcement migration audits null bank types before making metadata strict', () => {
  assert.match(enforceSql, /raise\s+exception\s+'BANK_PROBLEM_TYPE_BACKFILL_REQUIRED'/i)
  assert.match(enforceSql, /alter\s+table\s+public\.question_bank_question_metadata[\s\S]*alter\s+column\s+bank_problem_type_id\s+set\s+not\s+null/i)
})
```

- [ ] **Step 2: API contract 테스트 파일을 추가한다**

Create `tests/question-bank-problem-types-api-contract.test.mjs` with this content:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
const readIfExists = (relativePath) => {
  const filePath = path.join(repoRoot, relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

test('admin bank problem type APIs use question_bank_problem_types', () => {
  const listRoute = readIfExists('src/app/api/admin/question-bank/problem-types/route.ts')
  const idRoute = readIfExists('src/app/api/admin/question-bank/problem-types/[id]/route.ts')

  assert.match(listRoute, /from\('question_bank_problem_types'\)/)
  assert.match(listRoute, /resolveAdminWorkspaceSubject/)
  assert.match(idRoute, /from\('question_bank_problem_types'\)/)
  assert.match(idRoute, /is_active:\s*false|\.update\(\{[\s\S]*is_active\s*:/)
})

test('admin upload route sends bankProblemTypeId to question-bank RPCs', () => {
  const route = read('src/app/api/admin/questions/upload/route.ts')

  assert.match(route, /bankProblemTypeId/)
  assert.match(route, /create_admin_bank_question/)
  assert.match(route, /create_admin_bank_questions_bulk/)
  assert.doesNotMatch(route, /problem_type_id:\s*sanitized\.problem_type_id/)
})

test('bulk upload parser treats bankProblemTypeId as primary and problem type name as fallback', () => {
  const route = read('src/app/api/admin/questions/bulk-upload/route.ts')

  assert.match(route, /bankProblemTypeId/)
  assert.match(route, /from\('question_bank_problem_types'\)/)
  assert.match(route, /문제유형/)
  assert.match(route, /type_name/)
})

test('template route exposes bankProblemTypeId and question bank type list', () => {
  const route = read('src/app/api/admin/questions/template/route.ts')

  assert.match(route, /bankProblemTypeId/)
  assert.match(route, /question_bank_problem_types/)
  assert.match(route, /문제은행유형목록|은행문제유형목록/)
})

test('random exam and availability APIs keep request field name but use bank type semantics', () => {
  const randomRoute = read('src/app/api/exam-papers/random-bank/route.ts')
  const availabilityRoute = read('src/app/api/question-bank/availability/route.ts')

  assert.match(randomRoute, /typeCounts/)
  assert.match(randomRoute, /problemTypeId/)
  assert.match(randomRoute, /create_random_bank_exam_paper/)
  assert.match(availabilityRoute, /get_question_bank_availability/)
  assert.match(availabilityRoute, /problemTypeId/)
})
```

- [ ] **Step 3: 기존 upload/random contract 테스트를 bank type 기준으로 확장한다**

Modify `tests/question-bank-upload-metadata-contract.test.mjs` by adding assertions to the existing upload/template tests:

```js
assert.match(uploadRoute, /bankProblemTypeId/)
assert.match(bulkUploadRoute, /bankProblemTypeId/)
assert.match(templateRoute, /question_bank_problem_types/)
assert.match(templateRoute, /bankProblemTypeId/)
```

Modify `tests/question-bank-random-dialog-contract.test.mjs` by adding assertions:

```js
assert.match(source, /problemTypes:/)
assert.match(source, /problemTypeId/)
assert.match(source, /availableCount/)
```

- [ ] **Step 4: 테스트가 실패하는지 확인한다**

Run:

```bash
node --test tests/question-bank-problem-types-schema-contract.test.mjs tests/question-bank-problem-types-api-contract.test.mjs tests/question-bank-upload-metadata-contract.test.mjs tests/question-bank-random-dialog-contract.test.mjs
```

Expected:

```text
FAIL
```

Failure reason should mention missing files, missing `question_bank_problem_types`, or missing `bankProblemTypeId` references.

---

## Task 2: DB schema/backfill 1차 마이그레이션 작성

**Files:**
- Create: `supabase/migrations/20260512090000_create_question_bank_problem_types.sql`
- Test: `tests/question-bank-problem-types-schema-contract.test.mjs`

- [ ] **Step 1: schema/backfill migration을 추가한다**

Create `supabase/migrations/20260512090000_create_question_bank_problem_types.sql` with this SQL skeleton, preserving exact table/constraint names:

```sql
create table if not exists public.question_bank_problem_types (
  id uuid default uuid_generate_v4() primary key,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  type_name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint question_bank_problem_types_workspace_type_name_key unique (workspace_subject, type_name),
  constraint question_bank_problem_types_id_workspace_subject_key unique (id, workspace_subject)
);

comment on table public.question_bank_problem_types is 'Question-bank-only problem type catalog. AI generation types remain in public.problem_types.';
comment on column public.question_bank_problem_types.type_name is '문제은행에서 문제 등록/필터/랜덤 출제에 사용하는 문제유형명';

alter table public.question_bank_problem_types enable row level security;

drop policy if exists "Authenticated users can view active question bank problem types" on public.question_bank_problem_types;
create policy "Authenticated users can view active question bank problem types"
  on public.question_bank_problem_types
  for select to authenticated
  using (is_active = true);

drop policy if exists "Admins can manage question bank problem types" on public.question_bank_problem_types;
create policy "Admins can manage question bank problem types"
  on public.question_bank_problem_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists idx_question_bank_problem_types_workspace_active
  on public.question_bank_problem_types(workspace_subject, is_active, sort_order, type_name);

alter table public.question_bank_question_metadata
  add column if not exists bank_problem_type_id uuid;

create index if not exists idx_qb_metadata_scope_type_lookup
  on public.question_bank_question_metadata(workspace_subject, year_id, book_id, bank_problem_type_id, question_id);

with legacy_bank_types as (
  select distinct
    q.workspace_subject,
    pt.type_name,
    pt.description
  from public.questions q
  join public.question_bank_question_metadata m on m.question_id = q.id
  join public.problem_types pt on pt.id = q.problem_type_id
  where q.source in ('admin_uploaded', 'from_community')
    and q.problem_type_id is not null
    and m.bank_problem_type_id is null
), inserted as (
  insert into public.question_bank_problem_types(workspace_subject, type_name, description, sort_order, is_active)
  select
    lbt.workspace_subject,
    lbt.type_name,
    lbt.description,
    row_number() over (partition by lbt.workspace_subject order by lbt.type_name),
    true
  from legacy_bank_types lbt
  on conflict (workspace_subject, type_name) do update
  set description = coalesce(public.question_bank_problem_types.description, excluded.description),
      updated_at = timezone('utc'::text, now())
  returning id, workspace_subject, type_name
)
update public.question_bank_question_metadata m
set bank_problem_type_id = qbpt.id,
    updated_at = timezone('utc'::text, now())
from public.questions q
join public.problem_types pt on pt.id = q.problem_type_id
join public.question_bank_problem_types qbpt
  on qbpt.workspace_subject = q.workspace_subject
 and qbpt.type_name = pt.type_name
where m.question_id = q.id
  and q.source in ('admin_uploaded', 'from_community')
  and m.bank_problem_type_id is null;
```

- [ ] **Step 2: schema contract 일부를 통과시키는지 확인한다**

Run:

```bash
node --test tests/question-bank-problem-types-schema-contract.test.mjs
```

Expected:

```text
FAIL
```

Only RPC/enforcement migration 관련 assertions should still fail. Table/RLS/backfill assertions should pass.

---

## Task 3: 문제은행 RPC를 bank_problem_type_id 기준으로 전환

**Files:**
- Create: `supabase/migrations/20260512091000_switch_question_bank_problem_type_rpcs.sql`
- Modify: `tests/question-bank-schema-contract.test.mjs`
- Test: `tests/question-bank-problem-types-schema-contract.test.mjs`

- [ ] **Step 1: RPC migration을 추가한다**

Create `supabase/migrations/20260512091000_switch_question_bank_problem_type_rpcs.sql`.

The migration must redefine these functions with the same public signatures unless a route update explicitly changes the payload:

```sql
-- Required function names in this migration:
-- public.get_question_bank_availability(text, uuid, uuid)
-- public.create_random_bank_exam_paper(text, text, uuid, uuid, jsonb)
-- public.create_admin_bank_question(text, jsonb, uuid, uuid)
-- public.create_admin_bank_questions_bulk(text, jsonb)
-- public.update_admin_bank_question(uuid, text, jsonb, uuid, uuid)
-- public.copy_admin_questions_to_user_bank(text, uuid[], uuid)
-- public.admin_list_bank_questions(text, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer)
```

- [ ] **Step 2: `get_question_bank_availability`를 metadata 기준으로 바꾼다**

Inside the function, replace the current `q.problem_type_id` grouping with:

```sql
return query
select m.bank_problem_type_id as problem_type_id, count(*)::integer as available_count
from public.questions q
join public.question_bank_question_metadata m on m.question_id = q.id
join public.question_bank_problem_types qbpt
  on qbpt.id = m.bank_problem_type_id
 and qbpt.workspace_subject = m.workspace_subject
where q.user_id = v_user_id
  and q.source = 'from_community'
  and q.shared_question_id is not null
  and q.workspace_subject = p_workspace_subject
  and m.workspace_subject = p_workspace_subject
  and m.year_id = p_year_id
  and m.book_id = p_book_id
  and qbpt.is_active = true
group by m.bank_problem_type_id;
```

- [ ] **Step 3: `create_random_bank_exam_paper`를 bank type 기준으로 바꾼다**

Before availability check, validate requested bank type IDs:

```sql
if exists (
  with requested as (
    select (value->>'problemTypeId')::uuid as bank_problem_type_id
    from jsonb_array_elements(p_type_counts) value
  )
  select 1
  from requested r
  left join public.question_bank_problem_types qbpt
    on qbpt.id = r.bank_problem_type_id
   and qbpt.workspace_subject = p_workspace_subject
   and qbpt.is_active = true
  where qbpt.id is null
) then
  raise exception 'INVALID_BANK_PROBLEM_TYPE';
end if;
```

Use `m.bank_problem_type_id` in available and selected candidate CTEs:

```sql
available as (
  select m.bank_problem_type_id, count(*)::integer as available_count
  from public.questions q
  join public.question_bank_question_metadata m on m.question_id = q.id
  where q.user_id = v_user_id
    and q.source = 'from_community'
    and q.shared_question_id is not null
    and q.workspace_subject = p_workspace_subject
    and m.workspace_subject = p_workspace_subject
    and m.year_id = p_year_id
    and m.book_id = p_book_id
  group by m.bank_problem_type_id
)
```

For random ranking:

```sql
row_number() over (partition by m.bank_problem_type_id order by random()) as candidate_rank
```

- [ ] **Step 4: admin create/bulk/update RPC payload를 `bankProblemTypeId` 기준으로 전환한다**

For single create, read the bank type ID from either new primary field or legacy fallback:

```sql
v_bank_problem_type_id := coalesce(
  nullif(p_question->>'bankProblemTypeId', '')::uuid,
  nullif(p_question->>'bank_problem_type_id', '')::uuid,
  nullif(p_question->>'problem_type_id', '')::uuid
);
```

Validate active/scope:

```sql
if not exists (
  select 1
  from public.question_bank_problem_types qbpt
  where qbpt.id = v_bank_problem_type_id
    and qbpt.workspace_subject = p_workspace_subject
    and qbpt.is_active = true
) then
  raise exception 'INVALID_BANK_PROBLEM_TYPE';
end if;
```

Insert the question with `problem_type_id = null` for bank-source rows:

```sql
insert into public.questions(
  user_id,
  source,
  workspace_subject,
  question_text,
  question_text_forward,
  question_text_backward,
  choices,
  answer,
  explanation,
  passage_text,
  grade_level,
  difficulty,
  problem_type_id,
  source_type,
  source_1,
  source_2,
  source_3,
  source_4,
  tags,
  rating,
  raw_ai_response
)
values (
  v_user_id,
  'admin_uploaded',
  p_workspace_subject,
  coalesce(p_question->>'question_text', ''),
  p_question->>'question_text_forward',
  p_question->>'question_text_backward',
  coalesce(p_question->'choices', '[]'::jsonb),
  coalesce(p_question->>'answer', ''),
  p_question->>'explanation',
  p_question->>'passage_text',
  p_question->>'grade_level',
  p_question->>'difficulty',
  null,
  p_question->>'source_type',
  p_question->>'source_1',
  p_question->>'source_2',
  p_question->>'source_3',
  p_question->>'source_4',
  case when p_question ? 'tags' then array(select jsonb_array_elements_text(p_question->'tags')) else null end,
  coalesce(nullif(p_question->>'rating', '')::smallint, 0),
  p_question->>'raw_ai_response'
)
returning id into v_question_id;
```

Insert metadata with bank type:

```sql
insert into public.question_bank_question_metadata(
  question_id,
  workspace_subject,
  year_id,
  book_id,
  bank_problem_type_id
)
values (v_question_id, p_workspace_subject, p_year_id, p_book_id, v_bank_problem_type_id);
```

Apply the same rule to bulk and update. `update_admin_bank_question` must update both original and existing `from_community` copy metadata using the same `bank_problem_type_id`.

- [ ] **Step 5: copy RPC copies metadata bank type, not `questions.problem_type_id`**

In `copy_admin_questions_to_user_bank`, set copied question `problem_type_id` to null and copy metadata like this:

```sql
insert into public.question_bank_question_metadata(
  question_id,
  workspace_subject,
  year_id,
  book_id,
  bank_problem_type_id
)
select
  v_saved_question_id,
  m.workspace_subject,
  m.year_id,
  m.book_id,
  m.bank_problem_type_id
from public.question_bank_question_metadata m
where m.question_id = v_admin_question_id;
```

- [ ] **Step 6: admin list RPC joins bank types**

Replace `left join public.problem_types pt on pt.id = q.problem_type_id` with:

```sql
left join public.question_bank_question_metadata m on m.question_id = q.id
left join public.question_bank_problem_types qbpt
  on qbpt.id = m.bank_problem_type_id
 and qbpt.workspace_subject = m.workspace_subject
```

Return `problem_type_id` as `m.bank_problem_type_id` and `problem_types` JSON from `qbpt` to minimize frontend breakage during transition:

```sql
m.bank_problem_type_id as problem_type_id,
case when m.bank_problem_type_id is null then null else jsonb_build_object(
  'id', m.bank_problem_type_id,
  'type_name', qbpt.type_name,
  'description', qbpt.description
) end as problem_types
```

- [ ] **Step 7: RPC contract tests를 통과시킨다**

Run:

```bash
node --test tests/question-bank-problem-types-schema-contract.test.mjs tests/question-bank-schema-contract.test.mjs
```

Expected:

```text
PASS for RPC usage assertions; enforcement migration assertions may fail until Task 8.
```

---

## Task 4: 문제은행 문제유형 관리자 API/UI 추가

**Files:**
- Create: `src/lib/question-bank/problem-types.ts`
- Create: `src/app/api/admin/question-bank/problem-types/route.ts`
- Create: `src/app/api/admin/question-bank/problem-types/[id]/route.ts`
- Create: `src/app/(admin)/admin/question-bank/problem-types/page.tsx`
- Create: `src/app/(admin)/admin/question-bank/problem-types/question-bank-problem-types-client.tsx`
- Test: `tests/question-bank-problem-types-api-contract.test.mjs`

- [ ] **Step 1: shared helper를 추가한다**

Create `src/lib/question-bank/problem-types.ts`:

```ts
export type QuestionBankProblemType = {
  id: string
  workspace_subject: 'english' | 'korean'
  type_name: string
  description: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export function normalizeQuestionBankProblemType(row: QuestionBankProblemType) {
  return {
    id: row.id,
    typeName: row.type_name,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}
```

- [ ] **Step 2: 관리자 list/create API를 추가한다**

Create `src/app/api/admin/question-bank/problem-types/route.ts` with the same admin-auth shape used by `src/app/api/admin/question-bank/books/route.ts`. Core query must be:

```ts
const { data: types, error } = await supabase
  .from('question_bank_problem_types')
  .select('*')
  .eq('workspace_subject', workspaceSubject)
  .order('sort_order', { ascending: true })
  .order('type_name', { ascending: true })
```

Create payload:

```ts
const payload = {
  workspace_subject: workspaceSubject,
  type_name: validatedData.typeName,
  description: validatedData.description || null,
  sort_order: validatedData.sortOrder ?? 0,
  is_active: validatedData.isActive ?? true,
}
```

- [ ] **Step 3: 관리자 update/deactivate API를 추가한다**

Create `src/app/api/admin/question-bank/problem-types/[id]/route.ts`. Use update instead of hard delete:

```ts
await supabase
  .from('question_bank_problem_types')
  .update({ is_active: false, updated_at: new Date().toISOString() })
  .eq('id', id)
  .eq('workspace_subject', workspaceSubject)
```

- [ ] **Step 4: 관리자 페이지와 client를 추가한다**

Create page `src/app/(admin)/admin/question-bank/problem-types/page.tsx` that checks admin status and renders the client.

Client responsibilities:

- list active/inactive bank problem types
- create type
- edit name/description/sort/is_active
- deactivate instead of physical delete

UI must reuse existing `Button`, `Input`, `Textarea`, `Switch`/checkbox, `Card` primitives already used in admin pages.

- [ ] **Step 5: API contract 테스트를 통과시킨다**

Run:

```bash
node --test tests/question-bank-problem-types-api-contract.test.mjs
```

Expected:

```text
PASS
```

---

## Task 5: 관리자 문제 업로드/템플릿을 bankProblemTypeId 기준으로 전환

**Files:**
- Modify: `src/app/api/admin/questions/upload/route.ts`
- Modify: `src/app/api/admin/questions/bulk-upload/route.ts`
- Modify: `src/app/api/admin/questions/template/route.ts`
- Modify: `src/app/(admin)/admin/questions/upload/admin-upload-client.tsx`
- Modify: `src/app/api/admin/questions/[id]/route.ts`
- Test: `tests/question-bank-upload-metadata-contract.test.mjs`

- [ ] **Step 1: upload route schema를 `bankProblemTypeId`로 바꾼다**

In `src/app/api/admin/questions/upload/route.ts`, replace required `problem_type_id` validation with:

```ts
bankProblemTypeId: z.string().uuid('Invalid bank problem type ID'),
problem_type_id: z.string().uuid('Invalid legacy problem type ID').optional(),
```

In `sanitizeQuestionPayload`, return:

```ts
bankProblemTypeId: sanitized.bankProblemTypeId,
```

Do not write `problem_type_id` for new bank uploads.

- [ ] **Step 2: bulk parser에 `bankProblemTypeId` primary 매핑을 추가한다**

In `src/app/api/admin/questions/bulk-upload/route.ts`, extend `QuestionRow`:

```ts
bankProblemTypeId?: string
문제유형?: string
```

Fetch bank types:

```ts
supabase
  .from('question_bank_problem_types')
  .select('id, type_name, is_active')
  .eq('workspace_subject', workspaceSubject)
  .eq('is_active', true)
```

Resolution order:

```ts
const bankProblemTypeId = typeof row.bankProblemTypeId === 'string' ? row.bankProblemTypeId.trim() : ''
const bankTypeById = bankProblemTypeId ? bankTypes.find((type) => type.id === bankProblemTypeId) : undefined
const bankTypeByName = row.문제유형 ? bankTypes.find((type) => type.type_name === row.문제유형) : undefined
const bankTypeInfo = bankTypeById || bankTypeByName
```

- [ ] **Step 3: template route에 bank type list를 추가한다**

In `src/app/api/admin/questions/template/route.ts`, main sheet headers must include:

```ts
'bankProblemTypeId', '문제유형', 'year', '교재명'
```

Add a sheet named `문제은행유형목록` containing:

```ts
['bankProblemTypeId', '문제유형', 'is_active']
```

Fetch source data from `question_bank_problem_types`.

- [ ] **Step 4: upload client가 bank type API를 사용하게 바꾼다**

In `admin-upload-client.tsx`, replace the problem type fetch for upload form with admin bank type endpoint:

```ts
fetch(withAdminWorkspaceSubject('/api/admin/question-bank/problem-types', workspaceSubject))
```

Form state should use:

```ts
bankProblemTypeId: ''
```

Submit payload should include:

```ts
bankProblemTypeId: formData.bankProblemTypeId
```

- [ ] **Step 5: edit route가 bankProblemTypeId를 patch한다**

In `src/app/api/admin/questions/[id]/route.ts`, schema should accept:

```ts
bankProblemTypeId: z.string().uuid('Bank problem type is required')
```

Patch payload to RPC:

```ts
bankProblemTypeId: validatedData.bankProblemTypeId
```

- [ ] **Step 6: upload metadata contract 테스트를 통과시킨다**

Run:

```bash
node --test tests/question-bank-upload-metadata-contract.test.mjs tests/question-bank-problem-types-api-contract.test.mjs
```

Expected:

```text
PASS
```

---

## Task 6: 문제은행 사용자 화면과 랜덤 문제지 UI를 bank type 기준으로 전환

**Files:**
- Modify: `src/app/api/question-bank/options/route.ts`
- Modify: `src/app/api/question-bank/availability/route.ts`
- Modify: `src/app/api/exam-papers/random-bank/route.ts`
- Modify: `src/components/features/question-bank/random-exam-dialog.tsx`
- Modify: `src/app/(dashboard)/bank/page.tsx`
- Modify: `src/app/(dashboard)/bank/bank-client.tsx`
- Modify: `src/app/(dashboard)/library/purchased/page.tsx`
- Modify: `src/app/(dashboard)/library/purchased/purchased-client.tsx`
- Test: `tests/question-bank-random-dialog-contract.test.mjs`

- [ ] **Step 1: user options API가 bank problem types를 반환하게 한다**

In `src/app/api/question-bank/options/route.ts`, add third query:

```ts
supabase
  .from('question_bank_problem_types')
  .select('id, type_name, description, sort_order, is_active')
  .eq('workspace_subject', workspaceSubject)
  .eq('is_active', true)
  .order('sort_order', { ascending: true })
  .order('type_name', { ascending: true })
```

Return:

```ts
return NextResponse.json({ years, books, problemTypes })
```

- [ ] **Step 2: random dialog consumes bank types from options API**

In `random-exam-dialog.tsx`, remove reliance on parent-provided AI problem types for bank random creation. Use `data.problemTypes` from `/api/question-bank/options` and normalize rows into:

```ts
type ProblemType = {
  id: string
  type_name: string
  is_active?: boolean | null
}
```

Keep the request payload field name `problemTypeId` for compatibility, but document in code comment that it now means `question_bank_problem_types.id`.

- [ ] **Step 3: bank page uses bank type labels**

In `src/app/(dashboard)/bank/page.tsx`, fetch admin questions through `admin_list_bank_questions` or select metadata with `question_bank_problem_types`. If direct Supabase relational select is used, prefer:

```ts
.select(`
  *,
  question_bank_question_metadata(
    bank_problem_type_id,
    question_bank_problem_types(id, type_name)
  )
`)
```

Fetch filters from `question_bank_problem_types`, not `problem_types`.

- [ ] **Step 4: purchased page handles mixed source labels**

In `src/app/(dashboard)/library/purchased/page.tsx`, keep AI label for `ai_generated` from `problem_types`, and add bank label for `from_community` via metadata. The client row type must expose a display label helper:

```ts
const getQuestionTypeName = (question: DBQuestion) => {
  if (question.source === 'from_community') {
    return question.question_bank_question_metadata?.question_bank_problem_types?.type_name || '미분류'
  }

  return question.problem_types?.type_name || '미분류'
}
```

- [ ] **Step 5: random dialog contract 테스트를 통과시킨다**

Run:

```bash
node --test tests/question-bank-random-dialog-contract.test.mjs tests/question-bank-problem-types-api-contract.test.mjs
```

Expected:

```text
PASS
```

---

## Task 7: AI 생성 경로가 기존 problem_types만 사용함을 명시적으로 잠근다

**Files:**
- Modify: `src/app/(dashboard)/generate/page.tsx`
- Modify: `src/app/(dashboard)/generate/personal/page.tsx`
- Modify: `src/app/(dashboard)/generate/[typeId]/page.tsx`
- Modify: `src/app/api/questions/generate/route.ts`
- Modify: `src/app/api/questions/route.ts`
- Modify: `src/app/api/generate/listboard-jobs/route.ts`
- Modify: `src/app/api/generate/listboard-jobs/[jobId]/run/route.ts`
- Modify: `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts`
- Test: `tests/question-bank-problem-types-api-contract.test.mjs`

- [ ] **Step 1: AI 생성 조회에서 admin hack을 보조 조건으로만 남긴다**

For generation pages/API, continue using `problem_types`, and ensure bank type table is never queried. In routes that fetch AI types, keep this condition until all old admin rows are cleaned:

```ts
.neq('model_name', 'admin')
```

Also add explicit provider guard in `src/app/api/questions/generate/route.ts` after fetching `problemType`:

```ts
if (problemType.provider === 'admin' || problemType.model_name === 'admin') {
  return jsonWithBalance(
    { success: false, error: { code: 'INVALID_TYPE_SCOPE', message: 'AI 생성용 문제 유형이 아닙니다.' } },
    400,
    await getCurrentBalance(user.id)
  )
}
```

- [ ] **Step 2: AI 저장 route는 기존 `problem_type_id`만 유지한다**

`src/app/api/questions/route.ts` should not accept `bankProblemTypeId`. It should continue storing AI generated questions with:

```ts
problem_type_id: problemTypeId,
source: 'ai_generated',
```

- [ ] **Step 3: listboard generation job은 기존 `problem_types`만 유지한다**

Do not change `generate_listboard_generation_job_items.problem_type_id`; it remains AI generation type ID. Ensure all listboard type fetches still use `problem_types` and do not query `question_bank_problem_types`.

- [ ] **Step 4: targeted typecheck를 실행한다**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected:

```text
exit code 0
```

---

## Task 8: Supabase 타입 재생성과 TypeScript 정리

**Files:**
- Modify: `src/types/supabase.ts`
- Modify: any TypeScript file with type errors from new table/column

- [ ] **Step 1: Supabase 타입을 재생성한다**

Run after DB migration is applied to the target Supabase project:

```bash
npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts
```

Expected:

```text
src/types/supabase.ts contains question_bank_problem_types and bank_problem_type_id
```

- [ ] **Step 2: generated type 확인 명령을 실행한다**

Run:

```bash
rg -n "question_bank_problem_types|bank_problem_type_id" src/types/supabase.ts
```

Expected:

```text
matches for table rows, inserts, updates, relationships, and metadata column
```

- [ ] **Step 3: TypeScript 오류를 정리한다**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected:

```text
exit code 0
```

If errors mention missing relation names, adjust local row types in affected clients instead of weakening types to `any`.

---

## Task 9: enforcement/cleanup 마이그레이션 추가

**Files:**
- Create: `supabase/migrations/20260512092000_enforce_question_bank_problem_type_metadata.sql`
- Test: `tests/question-bank-problem-types-schema-contract.test.mjs`

- [ ] **Step 1: enforcement migration을 추가한다**

Create `supabase/migrations/20260512092000_enforce_question_bank_problem_type_metadata.sql`:

```sql
do $$
begin
  if exists (
    select 1
    from public.questions q
    join public.question_bank_question_metadata m on m.question_id = q.id
    where q.source in ('admin_uploaded', 'from_community')
      and m.bank_problem_type_id is null
  ) then
    raise exception 'BANK_PROBLEM_TYPE_BACKFILL_REQUIRED';
  end if;
end $$;

alter table public.question_bank_question_metadata
  alter column bank_problem_type_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'question_bank_metadata_bank_type_workspace_fkey'
      and conrelid = 'public.question_bank_question_metadata'::regclass
  ) then
    alter table public.question_bank_question_metadata
      add constraint question_bank_metadata_bank_type_workspace_fkey
      foreign key (bank_problem_type_id, workspace_subject)
      references public.question_bank_problem_types(id, workspace_subject)
      on delete restrict;
  end if;
end $$;

update public.questions q
set problem_type_id = null,
    updated_at = timezone('utc'::text, now())
where q.source in ('admin_uploaded', 'from_community')
  and q.problem_type_id is not null
  and exists (
    select 1
    from public.question_bank_question_metadata m
    where m.question_id = q.id
      and m.bank_problem_type_id is not null
  );
```

- [ ] **Step 2: enforcement contract 테스트를 통과시킨다**

Run:

```bash
node --test tests/question-bank-problem-types-schema-contract.test.mjs
```

Expected:

```text
PASS
```

---

## Task 10: 전체 검증과 수동 smoke 검증

**Files:**
- No code changes unless verification exposes a scoped issue.

- [ ] **Step 1: question-bank 관련 테스트를 실행한다**

Run:

```bash
node --test tests/question-bank-*.test.mjs tests/question-bank-problem-types-*.test.mjs
```

Expected:

```text
PASS or existing env-gated integration tests SKIP only
```

- [ ] **Step 2: TypeScript 검증을 실행한다**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected:

```text
exit code 0
```

- [ ] **Step 3: targeted ESLint를 실행한다**

Run:

```bash
npx eslint src/app/api/admin/question-bank/problem-types/route.ts src/app/api/admin/question-bank/problem-types/[id]/route.ts src/app/api/admin/questions/upload/route.ts src/app/api/admin/questions/bulk-upload/route.ts src/app/api/admin/questions/template/route.ts src/components/features/question-bank/random-exam-dialog.tsx
```

Expected:

```text
exit code 0, allowing only existing browserslist warning
```

- [ ] **Step 4: production build를 실행한다**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 5: DB 감사 쿼리를 실행한다**

Run in Supabase SQL editor or MCP execute_sql after migrations:

```sql
select count(*) as missing_bank_problem_type_count
from public.questions q
join public.question_bank_question_metadata m on m.question_id = q.id
where q.source in ('admin_uploaded', 'from_community')
  and m.bank_problem_type_id is null;

select count(*) as legacy_bank_question_problem_type_count
from public.questions q
where q.source in ('admin_uploaded', 'from_community')
  and q.problem_type_id is not null;
```

Expected:

```text
missing_bank_problem_type_count = 0
legacy_bank_question_problem_type_count = 0
```

- [ ] **Step 6: localhost 수동 smoke를 수행한다**

Run:

```bash
npm run dev
```

Open these pages on `http://localhost:4000` with an admin/user session:

```text
/admin/question-bank/problem-types?subject=english
/admin/question-bank/options?subject=english
/admin/questions/upload?subject=english
/bank?subject=english
/library/purchased?subject=english
/generate?subject=english
/generate/personal?subject=english
```

Manual acceptance:

- 문제은행 문제유형 관리에서 추가/수정/비활성화가 된다.
- 문제 업로드에서 새 은행 문제유형만 보인다.
- 템플릿 다운로드에 `bankProblemTypeId`와 `문제은행유형목록`이 있다.
- 문제은행에서 저장한 문제가 `/library/purchased`에 표시된다.
- 랜덤 문제지 생성 dialog에서 은행 문제유형별 최대 개수가 표시된다.
- `/generate`에는 은행 문제유형이 노출되지 않는다.

---

## 구현 중 결정 고정 사항

1. `problem_types`는 AI 생성 전용으로 유지한다.
2. `question_bank_problem_types`는 문제은행 전용이다.
3. 문제은행 기능의 read/write 기준은 `question_bank_question_metadata.bank_problem_type_id`이다.
4. `questions.problem_type_id`는 AI 생성 문제와 legacy 호환용이며, 최종 상태에서 은행 문항은 이 컬럼을 사용하지 않는다.
5. 사용자 저장 복사본은 원본의 year/book/type metadata를 복사하고, 관리자 원본 수정 시 기존 정책처럼 복사본 metadata도 전파한다.
6. 업로드 템플릿은 `bankProblemTypeId`를 primary 식별자로 사용하고 `문제유형` 이름은 unique fallback으로만 사용한다.
7. active 검증은 FK가 아니라 RPC/API에서 수행한다.
8. cleanup 전까지만 legacy fallback을 허용하고, 최종 검증에서 fallback 의존이 0건이어야 한다.

---

## 최종 완료 기준

- `question_bank_problem_types` RLS가 켜져 있다.
- `question_bank_question_metadata.bank_problem_type_id`가 FK로 보호된다.
- `admin_uploaded/from_community` 문항의 missing bank type이 0건이다.
- 문제은행 RPC가 `q.problem_type_id` 기준으로 random/availability/filter하지 않는다.
- AI 생성 경로는 기존 `problem_types`만 사용한다.
- 문제은행 경로는 `question_bank_problem_types`만 사용한다.
- Supabase generated types가 새 테이블/컬럼을 포함한다.
- `node --test tests/question-bank-*.test.mjs tests/question-bank-problem-types-*.test.mjs` 통과 또는 env-gated integration skip만 존재한다.
- `npx tsc --noEmit --pretty false` 통과.
- targeted ESLint 통과.
- `npm run build` 통과.

---

## 계획 자체 검증 체크리스트

- 요구사항 “영어문제생성/영어문제은행 문제유형 독립 운영”은 Task 2~9가 다룬다.
- DB 설계 핵심인 새 테이블, metadata FK, RLS, 백필, enforcement가 포함되어 있다.
- RPC 전환 핵심인 availability/random/admin upload/copy/admin list가 포함되어 있다.
- UI/API 전환 핵심인 업로드, 템플릿, 문제은행, 구매 라이브러리, random dialog, 생성 경로 분리가 포함되어 있다.
- 검증 loop는 Task별 테스트 명령과 최종 smoke 기준으로 정의되어 있다.
