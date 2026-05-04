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
  'DUPLICATE_SAVED_QUESTIONS_EXIST'
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

  const metadataTable = withoutComments(findCreateTableBlock(mainSql, 'question_bank_question_metadata'))
  assert.ok(metadataTable.length > 0, 'metadata table block should be present')
  assert.doesNotMatch(metadataTable, /\bproblem_type_id\b/i)

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
    assert.match(block, /auth\.uid\s*\(\s*\)/i, `${name} should check auth.uid()`)
    assert.match(mainSql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)\\s+from\\s+public`, 'i'), `${name} should revoke public execute`)
    assert.match(mainSql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)\\s+to\\s+authenticated`, 'i'), `${name} should grant authenticated execute`)
  }
})

test('random exam RPC uses current table contracts and fixed constraints', () => {
  const block = findFunctionBlock(mainSql, 'create_random_bank_exam_paper')

  assert.match(block, /MAX_RANDOM_EXAM_QUESTION_COUNT/i)
  assert.match(block, /insert\s+into\s+public\.exam_papers[\s\S]*paper_title[\s\S]*generation_mode[\s\S]*generation_criteria/i)
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
