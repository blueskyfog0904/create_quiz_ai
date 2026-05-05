import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const apiRoute = readSource('src/app/api/admin/questions/route.ts')
const page = readSource('src/app/(admin)/admin/questions/page.tsx')
const client = readSource('src/app/(admin)/admin/questions/questions-client.tsx')

function functionBlock(source, name) {
  const start = source.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `${name} export not found`)

  const signatureEnd = source.indexOf(') {', start)
  assert.notEqual(signatureEnd, -1, `${name} signature did not terminate`)
  const braceStart = signatureEnd + 2
  let depth = 0

  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') depth--
    if (depth === 0) return source.slice(start, i + 1)
  }

  throw new Error(`${name} block did not terminate`)
}

const getBlock = functionBlock(apiRoute, 'GET')

function constFunctionBlock(source, name) {
  const start = source.indexOf(`const ${name} =`)
  assert.notEqual(start, -1, `${name} function not found`)
  const nextConst = source.indexOf('\n  const ', start + 1)
  assert.notEqual(nextConst, -1, `${name} function did not terminate before next const`)
  return source.slice(start, nextConst)
}

test('admin questions API delegates list retrieval to admin_list_bank_questions RPC', () => {
  assert.match(getBlock, /auth\.getUser\(\)/)
  assert.match(getBlock, /select\('is_admin'\)/)
  assert.match(getBlock, /\.rpc\('admin_list_bank_questions',\s*\{[\s\S]*p_workspace_subject:\s*workspaceSubject[\s\S]*\}\)/)
  assert.doesNotMatch(getBlock, /\.from\('questions'\)[\s\S]*?\.select\(/)
  assert.doesNotMatch(getBlock, /question_bank_question_metadata[\s\S]*\.select\(/)
})

test('admin questions API forwards bank filters, type, subject, and pagination args', () => {
  assert.match(getBlock, /searchParams\.get\('year_id'\)|searchParams\.get\('yearId'\)/)
  assert.match(getBlock, /searchParams\.get\('book_id'\)|searchParams\.get\('bookId'\)/)
  assert.match(getBlock, /p_year_id:\s*yearId\s*\|\|\s*null/)
  assert.match(getBlock, /p_book_id:\s*bookId\s*\|\|\s*null/)
  assert.match(getBlock, /p_problem_type_id:\s*problemTypeId\s*\|\|\s*null/)
  assert.match(getBlock, /p_workspace_subject:\s*workspaceSubject/)
  assert.match(getBlock, /p_limit:\s*limit/)
  assert.match(getBlock, /p_offset:\s*offset/)
  assert.match(getBlock, /total_count/)
  assert.match(getBlock, /pagination:\s*\{[\s\S]*totalPages:/)
})

test('admin questions API sanitizes pagination before RPC and response metadata', () => {
  assert.match(getBlock, /Number\.isFinite/)
  assert.match(getBlock, /Math\.max\(1/)
  assert.match(getBlock, /Math\.min\(200/)
  assert.doesNotMatch(getBlock, /const page = parseInt/)
  assert.doesNotMatch(getBlock, /const limit = parseInt/)
})

test('admin questions API rejects malformed UUID-ish filter params before RPC', () => {
  assert.match(apiRoute, /isUuidishString/)
  assert.match(getBlock, /problemTypeId[\s\S]*isUuidishString/)
  assert.match(getBlock, /yearId[\s\S]*isUuidishString/)
  assert.match(getBlock, /bookId[\s\S]*isUuidishString/)
  assert.match(getBlock, /status:\s*400/)
})

test('admin questions API recovers total_count for empty out-of-range RPC pages via minimal fallback RPC', () => {
  assert.match(getBlock, /bankQuestionRows\.length === 0[\s\S]*offset > 0|offset > 0[\s\S]*bankQuestionRows\.length === 0/)
  assert.match(getBlock, /\.rpc\('admin_list_bank_questions',\s*\{[\s\S]*p_limit:\s*1[\s\S]*p_offset:\s*0[\s\S]*\}\)/)
  assert.doesNotMatch(getBlock, /\.from\('questions'\)[\s\S]*count/)
})

test('admin questions page fetches active workspace question-bank year and book options for client props', () => {
  assert.match(page, /\.from\('question_bank_years'\)[\s\S]*\.eq\('workspace_subject',\s*workspaceSubject\)[\s\S]*\.eq\('is_active',\s*true\)/)
  assert.match(page, /\.from\('question_bank_books'\)[\s\S]*\.eq\('workspace_subject',\s*workspaceSubject\)[\s\S]*\.eq\('is_active',\s*true\)/)
  assert.match(page, /questionBankYears=\{questionBankYears\s*\|\|\s*\[\]\}/)
  assert.match(page, /questionBankBooks=\{questionBankBooks\s*\|\|\s*\[\]\}/)
})

test('questions client renders year/book filters, sends params, and resets pagination on filter changes', () => {
  assert.match(client, /questionBankYears/)
  assert.match(client, /questionBankBooks/)
  assert.match(client, /연도/)
  assert.match(client, /교재/)
  assert.match(client, /전체 연도/)
  assert.match(client, /전체 교재/)
  assert.match(client, /params\.set\('year_id',\s*yearId\)/)
  assert.match(client, /params\.set\('book_id',\s*bookId\)/)
  assert.match(client, /setPagination\(prev\s*=>\s*\(\{\s*\.\.\.prev,\s*page:\s*1\s*\}\)\)/)
  assert.match(client, /onValueChange=\{\(v\)\s*=>\s*handleFilterChange\('yearId'/)
  assert.match(client, /onValueChange=\{\(v\)\s*=>\s*handleFilterChange\('bookId'/)
})

test('questions client search submit only resets page and lets effect fetch with fresh state', () => {
  const handleSearchBlock = constFunctionBlock(client, 'handleSearch')

  assert.match(handleSearchBlock, /setPagination\(prev\s*=>\s*\(\{\s*\.\.\.prev,\s*page:\s*1\s*\}\)\)/)
  assert.doesNotMatch(handleSearchBlock, /fetchQuestions\(\)/)
})

test('questions client preview edit preserves admin workspace subject', () => {
  assert.match(client, /router\.push\(withAdminWorkspaceSubject\(`\/admin\/questions\/\$\{previewDialog\.question\?\.id\}`,\s*workspaceSubject\)\)/)
})

test('questions client displays question-bank year and book metadata in rows and preview', () => {
  assert.match(client, /year_label/)
  assert.match(client, /book_name/)
  assert.match(client, /question\.year_label[\s\S]*question\.year_label/)
  assert.match(client, /question\.book_name[\s\S]*question\.book_name/)
  assert.match(client, /previewDialog\.question\.year_label[\s\S]*previewDialog\.question\.year_label/)
  assert.match(client, /previewDialog\.question\.book_name[\s\S]*previewDialog\.question\.book_name/)
})
