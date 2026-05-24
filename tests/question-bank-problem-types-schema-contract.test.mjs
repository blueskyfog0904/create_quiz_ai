import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const migrationDir = path.join(repoRoot, 'supabase/migrations')
const schemaMigrationPath = path.join(migrationDir, '20260512090000_create_question_bank_problem_types.sql')
const rpcMigrationPath = path.join(migrationDir, '20260512091000_switch_question_bank_problem_type_rpcs.sql')
const enforceMigrationPath = path.join(migrationDir, '20260512092000_enforce_question_bank_problem_type_metadata.sql')
const metadataReadPolicyMigrationPath = path.join(migrationDir, '20260512093000_allow_bank_metadata_read_for_admin_uploaded_questions.sql')

const readIfExists = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
const schemaSql = readIfExists(schemaMigrationPath)
const rpcSql = readIfExists(rpcMigrationPath)
const enforceSql = readIfExists(enforceMigrationPath)
const metadataReadPolicySql = readIfExists(metadataReadPolicyMigrationPath)

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
  assert.match(enforceSql, /idx_qb_metadata_bank_type_workspace[\s\S]*bank_problem_type_id[\s\S]*workspace_subject/i)
})

test('authenticated users can read metadata for visible admin-uploaded bank questions', () => {
  assert.match(metadataReadPolicySql, /create\s+policy\s+"Authenticated users can view admin uploaded question bank metadata"/i)
  assert.match(metadataReadPolicySql, /on\s+public\.question_bank_question_metadata/i)
  assert.match(metadataReadPolicySql, /for\s+select\s+to\s+authenticated/i)
  assert.match(metadataReadPolicySql, /q\.id\s*=\s*question_bank_question_metadata\.question_id/i)
  assert.match(metadataReadPolicySql, /q\.source\s*=\s*'admin_uploaded'/i)
  assert.match(metadataReadPolicySql, /q\.workspace_subject\s*=\s*question_bank_question_metadata\.workspace_subject/i)
  assert.doesNotMatch(metadataReadPolicySql, /for\s+(insert|update|delete|all)\s+to\s+authenticated/i)
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
  assert.match(rpcSql, /create\s+or\s+replace\s+function\s+public\.admin_audit_question_bank_metadata/i)
  assert.match(rpcSql, /create\s+or\s+replace\s+function\s+public\.admin_list_question_bank_backfill_candidates/i)
  assert.match(rpcSql, /m\.bank_problem_type_id/i)
  assert.match(rpcSql, /join\s+public\.question_bank_problem_types\s+qbpt/i)
  assert.doesNotMatch(rpcSql, /group\s+by\s+q\.problem_type_id/i)
  assert.doesNotMatch(rpcSql, /partition\s+by\s+q\.problem_type_id/i)
  assert.match(rpcSql, /admin_audit_question_bank_metadata[\s\S]*m\.bank_problem_type_id/i)
  assert.match(rpcSql, /admin_list_question_bank_backfill_candidates[\s\S]*m\.bank_problem_type_id/i)
})

test('enforcement migration audits null bank types before making metadata strict', () => {
  assert.match(enforceSql, /raise\s+exception\s+'BANK_PROBLEM_TYPE_BACKFILL_REQUIRED'/i)
  assert.match(enforceSql, /alter\s+table\s+public\.question_bank_question_metadata[\s\S]*alter\s+column\s+bank_problem_type_id\s+set\s+not\s+null/i)
})
