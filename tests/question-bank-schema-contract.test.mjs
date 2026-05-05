import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const mainMigrationName = '20260504000000_create_question_bank_random_exam_schema.sql'
const uniqueIndexMigrationName = '20260504000001_add_question_bank_saved_unique_index.sql'
const task0Migrations = [
  '20260208000000_create_is_admin_helper.sql',
  '20260209_create_user_roles.sql',
  '20260210000000_restrict_is_admin_public_policies.sql'
]
const rpcNames = [
  'get_question_bank_availability',
  'create_random_bank_exam_paper',
  'create_admin_bank_question',
  'create_admin_bank_questions_bulk',
  'update_admin_bank_question',
  'backfill_question_bank_metadata',
  'admin_audit_question_bank_metadata',
  'admin_list_question_bank_backfill_candidates',
  'copy_admin_questions_to_user_bank',
  'admin_list_bank_questions'
]
const fixedErrorMessages = [
  'AUTH_REQUIRED',
  'ADMIN_REQUIRED',
  'INVALID_SCOPE',
  'INACTIVE_DIMENSION',
  'INVALID_SOURCE',
  'DUPLICATE_TYPE',
  'COUNT_LIMIT_EXCEEDED',
  'INSUFFICIENT_QUESTIONS',
  'NO_METADATA',
  'DUPLICATE_BACKFILL_TARGET',
  'BACKFILL_BATCH_TOO_LARGE',
  'BULK_UPLOAD_BATCH_TOO_LARGE',
  'DUPLICATE_SAVED_QUESTIONS_EXIST',
  'SERVICE_ROLE_REQUIRED'
]

const migrationFilenames = readdirSync(migrationsDir).sort()
const readMigration = (filename) => readFileSync(new URL(filename, migrationsDir), 'utf8')
const readIfExists = (filename) => existsSync(new URL(filename, migrationsDir)) ? readMigration(filename) : ''
const mainSql = readIfExists(mainMigrationName)
const uniqueSql = readIfExists(uniqueIndexMigrationName)

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const withoutComments = (sql) => sql
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const findCreateTableBlock = (sql, tableName) => {
  const match = sql.match(new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${tableName}\\s*\\([\\s\\S]*?\\);`, 'i'))
  return match?.[0] ?? ''
}

const findFunctionBlock = (sql, functionName) => {
  const escapedName = escapeRegExp(functionName)
  const match = sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escapedName}\\s*\\([\\s\\S]*?\\$\\$\\s*;`, 'i'))
  return match?.[0] ?? ''
}

const assertPolicy = (sql, tableName, pattern, message) => {
  const blocks = sql.match(new RegExp(`create\\s+policy\\s+"[^"]+"\\s+on\\s+public\\.${tableName}\\b[\\s\\S]*?;`, 'gi')) ?? []
  assert.ok(blocks.some((block) => pattern.test(block)), message)
}

const assertBefore = (text, earlierPattern, laterPattern, message) => {
  const earlierIndex = text.search(earlierPattern)
  const laterIndex = text.search(laterPattern)

  assert.notEqual(earlierIndex, -1, `${message}: missing validation pattern`)
  assert.notEqual(laterIndex, -1, `${message}: missing cast pattern`)
  assert.ok(earlierIndex < laterIndex, message)
}

test('Task 0 prerequisite migrations exist before Task 1 and Task 1 documents ownership', () => {
  assert.equal(existsSync(new URL(mainMigrationName, migrationsDir)), true)

  for (const filename of task0Migrations) {
    assert.equal(existsSync(new URL(filename, migrationsDir)), true, `${filename} should exist`)
    assert.ok(filename < mainMigrationName, `${filename} should sort before ${mainMigrationName}`)
    assert.ok(
      migrationFilenames.indexOf(filename) < migrationFilenames.indexOf(mainMigrationName),
      `${filename} should run before ${mainMigrationName}`
    )
  }

  assert.match(mainSql, /Task 1 does not redefine public\.is_admin\(\)/i)
  assert.match(mainSql, /Task 0 owns prerequisite\/remediation migrations/i)
})

test('creates question bank dimension and metadata tables with expected RLS shape', () => {
  for (const tableName of [
    'question_bank_years',
    'question_bank_books',
    'question_bank_question_metadata'
  ]) {
    assert.match(mainSql, new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${tableName}\\b`, 'i'))
    assert.match(mainSql, new RegExp(`alter\\s+table\\s+public\\.${tableName}\\s+enable\\s+row\\s+level\\s+security`, 'i'))
  }

  const yearsTable = withoutComments(findCreateTableBlock(mainSql, 'question_bank_years'))
  const booksTable = withoutComments(findCreateTableBlock(mainSql, 'question_bank_books'))
  const metadataTable = withoutComments(findCreateTableBlock(mainSql, 'question_bank_question_metadata'))

  assert.ok(yearsTable.length > 0, 'years table block should be present')
  assert.match(yearsTable, /id\s+uuid[\s\S]*primary\s+key/i)
  assert.match(yearsTable, /workspace_subject\s+text\s+not\s+null\s+check\s*\(\s*workspace_subject\s+in\s*\(\s*'english'\s*,\s*'korean'\s*\)\s*\)/i)
  assert.match(yearsTable, /year\s+integer\s+not\s+null\s+check\s*\(\s*year\s+between\s+2000\s+and\s+2100\s*\)/i)
  assert.match(yearsTable, /label\s+text\s+not\s+null/i)
  assert.match(yearsTable, /unique\s*\(\s*workspace_subject\s*,\s*year\s*\)/i)
  assert.match(yearsTable, /unique\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)

  assert.ok(booksTable.length > 0, 'books table block should be present')
  assert.match(booksTable, /id\s+uuid[\s\S]*primary\s+key/i)
  assert.match(booksTable, /workspace_subject\s+text\s+not\s+null\s+check\s*\(\s*workspace_subject\s+in\s*\(\s*'english'\s*,\s*'korean'\s*\)\s*\)/i)
  assert.match(booksTable, /name\s+text\s+not\s+null/i)
  assert.match(booksTable, /slug\s+text\s+not\s+null\s+check\s*\(\s*slug\s*~\s*'\^\[a-z0-9\]\[a-z0-9-\]\*\$'\s*\)/i)
  assert.match(booksTable, /description\s+text/i)
  assert.match(booksTable, /unique\s*\(\s*workspace_subject\s*,\s*name\s*\)/i)
  assert.match(booksTable, /unique\s*\(\s*workspace_subject\s*,\s*slug\s*\)/i)
  assert.match(booksTable, /unique\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)
  assert.doesNotMatch(booksTable, /label\s+text\s+not\s+null/i)

  assert.ok(metadataTable.length > 0, 'metadata table block should be present')
  assert.match(metadataTable, /question_id\s+uuid\s+not\s+null[\s\S]*primary\s+key/i)
  assert.doesNotMatch(metadataTable, /\bid\s+uuid\b/i)
  assert.doesNotMatch(metadataTable, /\bsource_question_id\b/i)
  assert.doesNotMatch(metadataTable, /\bproblem_type_id\b/i)
  assert.match(metadataTable, /foreign\s+key\s*\(\s*question_id\s*,\s*workspace_subject\s*\)\s+references\s+public\.questions\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)
  assert.match(metadataTable, /foreign\s+key\s*\(\s*year_id\s*,\s*workspace_subject\s*\)\s+references\s+public\.question_bank_years\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)
  assert.match(metadataTable, /foreign\s+key\s*\(\s*book_id\s*,\s*workspace_subject\s*\)\s+references\s+public\.question_bank_books\s*\(\s*id\s*,\s*workspace_subject\s*\)/i)

  assertPolicy(mainSql, 'question_bank_years', /for\s+select\s+to\s+authenticated[\s\S]*\bis_active\s*=\s*true/i, 'years need authenticated active-only select policy')
  assertPolicy(mainSql, 'question_bank_books', /for\s+select\s+to\s+authenticated[\s\S]*\bis_active\s*=\s*true/i, 'books need authenticated active-only select policy')
  assertPolicy(mainSql, 'question_bank_years', /for\s+all\s+to\s+authenticated[\s\S]*public\.is_admin\s*\(/i, 'years need admin manage policy')
  assertPolicy(mainSql, 'question_bank_books', /for\s+all\s+to\s+authenticated[\s\S]*public\.is_admin\s*\(/i, 'books need admin manage policy')
  assertPolicy(mainSql, 'question_bank_question_metadata', /for\s+select\s+to\s+authenticated[\s\S]*(auth\.uid\s*\(\s*\)|user_id)/i, 'metadata need own-question select policy')
  assertPolicy(mainSql, 'question_bank_question_metadata', /for\s+all\s+to\s+authenticated[\s\S]*public\.is_admin\s*\(/i, 'metadata need admin manage policy')

  assert.doesNotMatch(mainSql, /create\s+policy\s+"[^"]*user[^"]*insert[^"]*"\s+on\s+public\.question_bank_question_metadata/i)
  assert.doesNotMatch(mainSql, /create\s+policy\s+"[^"]*user[^"]*update[^"]*"\s+on\s+public\.question_bank_question_metadata/i)
  assert.doesNotMatch(mainSql, /create\s+policy\s+"[^"]*user[^"]*delete[^"]*"\s+on\s+public\.question_bank_question_metadata/i)
})

test('extends existing tables and creates required lookup indexes', () => {
  assert.match(mainSql, /alter\s+table\s+public\.questions[\s\S]*add\s+column\s+if\s+not\s+exists\s+question_text_forward\s+text/i)
  assert.match(mainSql, /alter\s+table\s+public\.questions[\s\S]*add\s+column\s+if\s+not\s+exists\s+question_text_backward\s+text/i)
  assert.match(mainSql, /questions_workspace_subject_unique/i)
  assert.match(mainSql, /alter\s+table\s+public\.exam_papers[\s\S]*add\s+column\s+if\s+not\s+exists\s+generation_mode\s+text/i)
  assert.match(mainSql, /alter\s+table\s+public\.exam_papers[\s\S]*add\s+column\s+if\s+not\s+exists\s+generation_criteria\s+jsonb/i)
  assert.match(mainSql, /idx_questions_bank_candidate_lookup[\s\S]*on\s+public\.questions\s*\(\s*workspace_subject\s*,\s*user_id\s*,\s*source\s*,\s*problem_type_id\s*,\s*id\s*\)/i)
  assert.match(mainSql, /idx_qb_metadata_scope_lookup[\s\S]*on\s+public\.question_bank_question_metadata\s*\(\s*workspace_subject\s*,\s*year_id\s*,\s*book_id\s*,\s*question_id\s*\)/i)
})

test('uses existing public.is_admin helper without redefining it', () => {
  assert.doesNotMatch(mainSql, /create\s+(?:or\s+replace\s+)?function\s+public\.is_admin\s*\(/i)
  assert.match(mainSql, /public\.is_admin\s*\(\s*\)/i)

  for (const name of [
    'create_admin_bank_question',
    'create_admin_bank_questions_bulk',
    'update_admin_bank_question',
    'backfill_question_bank_metadata',
    'admin_audit_question_bank_metadata',
    'admin_list_question_bank_backfill_candidates',
    'admin_list_bank_questions'
  ]) {
    assert.match(findFunctionBlock(mainSql, name), /public\.is_admin\s*\(\s*\)/i, `${name} should call public.is_admin()`)
  }
})

test('defines all RPCs with security-definer auth and function grants', () => {
  for (const name of rpcNames) {
    const block = findFunctionBlock(mainSql, name)
    assert.ok(block.length > 0, `${name} should be defined`)
    assert.match(block, /security\s+definer/i, `${name} should be security definer`)
    assert.match(block, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `${name} should pin search_path`)
    assert.match(mainSql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)\\s+from\\s+public`, 'i'), `${name} should revoke public execute`)

    if (name === 'copy_admin_questions_to_user_bank') {
      assert.match(block, /p_target_user_id\s+uuid/i, `${name} should receive a server-controlled target user`)
      assert.match(block, /auth\.role\s*\(\s*\)\s*<>\s*'service_role'/i, `${name} should require service role callers`)
      assert.match(block, /SERVICE_ROLE_REQUIRED/i, `${name} should reject direct authenticated callers`)
      assert.match(mainSql, /grant\s+execute\s+on\s+function\s+public\.copy_admin_questions_to_user_bank\s*\(\s*text\s*,\s*uuid\[\]\s*,\s*uuid\s*\)\s+to\s+service_role/i)
      assert.doesNotMatch(mainSql, /grant\s+execute\s+on\s+function\s+public\.copy_admin_questions_to_user_bank\s*\(\s*text\s*,\s*uuid\[\]\s*,\s*uuid\s*\)\s+to\s+authenticated/i)
    } else {
      assert.match(block, /auth\.uid\s*\(\s*\)/i, `${name} should check auth.uid()`)
      assert.match(mainSql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)\\s+to\\s+authenticated`, 'i'), `${name} should grant authenticated execute`)
    }
  }
})

test('random exam RPC uses current table contracts and fixed constraints', () => {
  const block = findFunctionBlock(mainSql, 'create_random_bank_exam_paper')

  assert.match(block, /MAX_RANDOM_EXAM_QUESTION_COUNT/i)
  assert.match(block, /insert\s+into\s+public\.exam_papers[\s\S]*paper_title[\s\S]*generation_mode[\s\S]*generation_criteria/i)
  assert.match(block, /'random_bank'/i)
  assert.doesNotMatch(block, /'question_bank_random'/i)
  assert.match(block, /insert\s+into\s+public\.exam_paper_items[\s\S]*number[\s\S]*order_index[\s\S]*workspace_subject/i)
  assert.match(block, /source\s*=\s*'from_community'/i)
  assert.match(block, /shared_question_id/i)

  for (const message of [
    'DUPLICATE_TYPE',
    'COUNT_LIMIT_EXCEEDED',
    'INSUFFICIENT_QUESTIONS'
  ]) {
    assert.match(block, new RegExp(message, 'i'))
  }
})


test('admin list RPC returns book_name from question_bank_books.name', () => {
  const block = findFunctionBlock(mainSql, 'admin_list_bank_questions')

  assert.match(block, /book_name\s+text/i)
  assert.match(block, /b\.name\s+as\s+book_name/i)
  assert.doesNotMatch(block, /book_label\s+text/i)
  assert.doesNotMatch(block, /b\.label\s+as\s+book_label/i)
})

test('main migration contains required constants, error messages, and bank visibility policy', () => {
  for (const token of [
    'MAX_RANDOM_EXAM_QUESTION_COUNT',
    'BACKFILL_BATCH_SIZE',
    'BULK_UPLOAD_BATCH_SIZE',
    ...fixedErrorMessages
  ]) {
    assert.match(mainSql, new RegExp(token, 'i'), `${token} should be documented or enforced`)
  }

  assertPolicy(mainSql, 'questions', /for\s+select\s+to\s+authenticated[\s\S]*source\s*=\s*'admin_uploaded'[\s\S]*workspace_subject/i, 'questions need authenticated read-only admin_uploaded bank policy')
})


test('RPCs validate JSON UUID, integer, rating, and tags before casts', () => {
  const randomBlock = findFunctionBlock(mainSql, 'create_random_bank_exam_paper')
  const createBlock = findFunctionBlock(mainSql, 'create_admin_bank_question')
  const bulkBlock = findFunctionBlock(mainSql, 'create_admin_bank_questions_bulk')
  const updateBlock = findFunctionBlock(mainSql, 'update_admin_bank_question')
  const auditBlock = findFunctionBlock(mainSql, 'admin_audit_question_bank_metadata')
  const candidatesBlock = findFunctionBlock(mainSql, 'admin_list_question_bank_backfill_candidates')

  assert.match(randomBlock, /jsonb_typeof\(value\)\s*<>\s*'object'/i)
  assertBefore(randomBlock, /value->>'problemTypeId'[\s\S]*~\*\s*'\^\[0-9a-f\]\{8\}/i, /value->>'problemTypeId'\)::uuid/i, 'p_type_counts problemTypeId must be uuid-validated before cast')
  assertBefore(randomBlock, /value->>'count'[\s\S]*~\s*'\^\[0-9\]\+\$'/i, /value->>'count'\)::integer/i, 'p_type_counts count must be integer-validated before cast')

  assert.match(createBlock, /p_question\s*\?\s*'problem_type_id'[\s\S]*not[\s\S]*~\*/i)
  assert.match(createBlock, /p_question\s*\?\s*'rating'[\s\S]*not[\s\S]*~\s*'\^\[0-9\]\+\$'/i)
  assert.match(createBlock, /p_question\s*\?\s*'tags'[\s\S]*jsonb_typeof\(p_question->'tags'\)\s*<>\s*'array'/i)
  assertBefore(createBlock, /p_question\s*\?\s*'tags'[\s\S]*jsonb_typeof\(p_question->'tags'\)\s*<>\s*'array'/i, /jsonb_array_elements_text\(p_question->'tags'\)/i, 'create question tags must be array-validated before expansion')

  assert.match(bulkBlock, /v_item->>'yearId'[\s\S]*~\*/i)
  assert.match(bulkBlock, /v_item->>'bookId'[\s\S]*~\*/i)
  assert.match(bulkBlock, /v_question\s*\?\s*'tags'[\s\S]*jsonb_typeof\(v_question->'tags'\)\s*<>\s*'array'/i)
  assertBefore(bulkBlock, /v_item->>'yearId'[\s\S]*~\*/i, /v_item->>'yearId'\)::uuid/i, 'bulk yearId must be uuid-validated before cast')
  assertBefore(bulkBlock, /v_item->>'bookId'[\s\S]*~\*/i, /v_item->>'bookId'\)::uuid/i, 'bulk bookId must be uuid-validated before cast')

  assert.match(updateBlock, /p_question_patch\s*\?\s*'problem_type_id'[\s\S]*not[\s\S]*~\*/i)
  assert.match(updateBlock, /p_question_patch\s*\?\s*'rating'[\s\S]*not[\s\S]*~\s*'\^\[0-9\]\+\$'/i)
  assert.match(updateBlock, /p_question_patch\s*\?\s*'tags'[\s\S]*jsonb_typeof\(p_question_patch->'tags'\)\s*<>\s*'array'/i)

  assert.match(auditBlock, /p_filter->>'yearId'[\s\S]*~\*/i)
  assert.match(auditBlock, /p_filter->>'bookId'[\s\S]*~\*/i)
  assert.match(auditBlock, /p_filter->>'problemTypeId'[\s\S]*~\*/i)
  assertBefore(auditBlock, /p_filter->>'problemTypeId'[\s\S]*~\*/i, /p_filter->>'problemTypeId'\s*,\s*''\)::uuid/i, 'audit problemTypeId must be uuid-validated before cast')
  assert.match(auditBlock, /q\.problem_type_id\s*=\s*nullif\(p_filter->>'problemTypeId'/i)
  assert.match(candidatesBlock, /p_filter->>'yearId'[\s\S]*~\*/i)
  assert.match(candidatesBlock, /p_filter->>'bookId'[\s\S]*~\*/i)
  assert.match(candidatesBlock, /p_filter->>'problemTypeId'[\s\S]*~\*/i)
  assertBefore(candidatesBlock, /p_filter->>'problemTypeId'[\s\S]*~\*/i, /p_filter->>'problemTypeId'\s*,\s*''\)::uuid/i, 'candidate problemTypeId must be uuid-validated before cast')
  assert.match(candidatesBlock, /q\.problem_type_id\s*=\s*nullif\(p_filter->>'problemTypeId'/i)
})

test('saved-copy unique index lives in separate migration with executable duplicate preflight', () => {
  assert.equal(existsSync(new URL(uniqueIndexMigrationName, migrationsDir)), true)
  assert.match(uniqueSql, /do\s+\$\$/i)
  assert.match(uniqueSql, /source\s*=\s*'from_community'\s+and\s+shared_question_id\s+is\s+not\s+null/i)
  assert.match(uniqueSql, /group\s+by\s+user_id\s*,\s*workspace_subject\s*,\s*shared_question_id/i)
  assert.match(uniqueSql, /having\s+count\s*\(\s*\*\s*\)\s*>\s*1/i)
  assert.match(uniqueSql, /raise\s+exception\s+using\s+errcode\s*=\s*'23505'\s*,\s*message\s*=\s*'DUPLICATE_SAVED_QUESTIONS_EXIST'/i)
  assert.match(uniqueSql, /cleanup/i)
  assert.match(uniqueSql, /create\s+unique\s+index\s+if\s+not\s+exists\s+idx_questions_from_community_unique_saved\s+on\s+public\.questions\s*\(\s*user_id\s*,\s*workspace_subject\s*,\s*shared_question_id\s*\)[\s\S]*where\s+source\s*=\s*'from_community'\s+and\s+shared_question_id\s+is\s+not\s+null/i)
})
