import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const uploadRoute = readSource('src/app/api/admin/questions/upload/route.ts')
const bulkUploadRoute = readSource('src/app/api/admin/questions/bulk-upload/route.ts')
const templateRoute = readSource('src/app/api/admin/questions/template/route.ts')
const editRoute = readSource('src/app/api/admin/questions/[id]/route.ts')
const uploadClient = readSource('src/app/(admin)/admin/questions/upload/admin-upload-client.tsx')
const editClient = readSource('src/app/(admin)/admin/questions/[id]/edit-question-client.tsx')

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

const editPatchBlock = functionBlock(editRoute, 'PATCH')
const editGetBlock = functionBlock(editRoute, 'GET')

test('admin upload route writes through metadata RPCs with sanitized question payloads', () => {
  assert.match(uploadRoute, /auth\.getUser\(\)/)
  assert.match(uploadRoute, /select\('is_admin'\)/)

  assert.match(uploadRoute, /yearId: z\.string\(\)\.uuid/)
  assert.match(uploadRoute, /bookId: z\.string\(\)\.uuid/)
  assert.match(uploadRoute, /\.rpc\('create_admin_bank_question',\s*\{[\s\S]*p_workspace_subject:[\s\S]*p_question:[\s\S]*p_year_id:\s*yearId[\s\S]*p_book_id:\s*bookId/s)
  assert.match(uploadRoute, /\.rpc\('create_admin_bank_questions_bulk',\s*\{[\s\S]*p_workspace_subject:[\s\S]*p_questions:/s)
  assert.match(uploadRoute, /clientRowId/)
  assert.match(uploadRoute, /sanitizeQuestionPayload/)
  assert.match(uploadRoute, /user_id|userId/)
  assert.match(uploadRoute, /delete\s+sanitized\.user_id|\{\s*user_id:/)
  assert.doesNotMatch(uploadRoute, /\.from\('questions'\)\s*\n\s*\.insert/)
  assert.doesNotMatch(uploadRoute, /\.from\('questions'\)\s*\n\s*\.update/)
  assert.doesNotMatch(uploadRoute, /\.from\('question_bank_question_metadata'\)\s*\n\s*\.(insert|upsert)/)
  assert.doesNotMatch(uploadRoute, /create_admin_bank_question[\s\S]*for\s*\(/)
})

test('admin upload route maps RPC error contracts to HTTP statuses', () => {
  assert.match(uploadRoute, /AUTH_REQUIRED[\s\S]*401/)
  assert.match(uploadRoute, /ADMIN_REQUIRED[\s\S]*403/)
  assert.match(uploadRoute, /INVALID_SCOPE[\s\S]*400/)
  assert.match(uploadRoute, /INACTIVE_DIMENSION[\s\S]*400/)
  assert.match(uploadRoute, /BULK_UPLOAD_BATCH_TOO_LARGE[\s\S]*400/)
  assert.match(uploadRoute, /23505[\s\S]*409|409[\s\S]*23505/)
})

test('bulk upload route remains parse-only and resolves active year/book metadata', () => {
  assert.doesNotMatch(bulkUploadRoute, /\.rpc\('create_admin_bank_question/)
  assert.doesNotMatch(bulkUploadRoute, /\.from\('questions'\)\s*\n\s*\.insert/)
  assert.match(bulkUploadRoute, /interface QuestionRow[\s\S]*yearId[\s\S]*bookId[\s\S]*bookSlug[\s\S]*year[\s\S]*book/s)
  assert.match(bulkUploadRoute, /interface ParsedQuestion[\s\S]*yearId[\s\S]*bookId[\s\S]*clientRowId/s)
  assert.match(bulkUploadRoute, /\.from\('question_bank_years'\)/)
  assert.match(bulkUploadRoute, /\.from\('question_bank_books'\)/)
  assert.match(bulkUploadRoute, /is_active/)
  assert.match(bulkUploadRoute, /resolveQuestionBankMetadata/)
  assert.match(bulkUploadRoute, /let resolvedYear/)
  assert.match(bulkUploadRoute, /let resolvedBook/)
  assert.match(bulkUploadRoute, /if \(yearId\)[\s\S]*else[\s\S]*yearValue/)
  assert.match(bulkUploadRoute, /if \(bookId\)[\s\S]*else[\s\S]*bookValue/)
  assert.match(bulkUploadRoute, /errorMessage/)
})

test('template route documents year and book columns with active reference sheets', () => {
  assert.match(templateRoute, /'year'/)
  assert.match(templateRoute, /'bookSlug'/)
  assert.match(templateRoute, /question_bank_years/)
  assert.match(templateRoute, /question_bank_books/)
  assert.match(templateRoute, /is_active/)
  assert.match(templateRoute, /연도목록|교재목록/)
  assert.match(templateRoute, /XLSX\.utils\.aoa_to_sheet\(\[mainSheetHeaders,\s*sampleData\]\)/)
  assert.doesNotMatch(templateRoute, /aoa_to_sheet\(\[mainSheetHeaders,\s*sampleData,\s*\[\],\s*\.\.\.guidanceData\]\)/)
  assert.match(templateRoute, /guidanceSheet/)
  assert.match(templateRoute, /book_append_sheet\(workbook,\s*guidanceSheet,\s*'작성안내'\)/)
})

test('edit route reads metadata and patches through update_admin_bank_question RPC', () => {
  assert.match(editGetBlock, /question_bank_question_metadata/)
  assert.match(editGetBlock, /const questionBankMetadata = metadata \? \{[\s\S]*yearId:[\s\S]*bookId:/)
  assert.match(editRoute, /yearId: z\.string\(\)\.uuid/)
  assert.match(editRoute, /bookId: z\.string\(\)\.uuid/)
  assert.match(editPatchBlock, /\.rpc\('update_admin_bank_question',\s*\{[\s\S]*p_question_id:\s*id[\s\S]*p_workspace_subject:[\s\S]*p_question_patch:[\s\S]*p_year_id:\s*yearId[\s\S]*p_book_id:\s*bookId/s)
  assert.match(editPatchBlock, /copied_updated_count/)
  assert.doesNotMatch(editPatchBlock, /\.from\('questions'\)\s*\n\s*\.update/)
  assert.doesNotMatch(editPatchBlock, /\.from\('question_bank_question_metadata'\)\s*\n\s*\.upsert/)
  assert.doesNotMatch(editRoute, /\n\s*source:\s*z\.string\(\)/)
  assert.match(editRoute, /source_type: z\.string\(\)\.nullable\(\)\.optional\(\)/)
})

test('upload client requires active year/book metadata and saves bulk rows in one request', () => {
  assert.match(uploadClient, /\/api\/admin\/question-bank\/years/)
  assert.match(uploadClient, /\/api\/admin\/question-bank\/books/)
  assert.match(uploadClient, /is_active\s*!==\s*false|\.filter\([^)]*is_active/)
  assert.match(uploadClient, /yearId:\s*''/)
  assert.match(uploadClient, /bookId:\s*''/)
  assert.match(uploadClient, /연도 \*/)
  assert.match(uploadClient, /교재 \*/)
  assert.match(uploadClient, /yearId[\s\S]*bookId/)
  assert.match(uploadClient, /JSON\.stringify\(\{\s*questions:\s*validQuestions\.map/s)
  assert.doesNotMatch(uploadClient, /for \(const question of validQuestions\)[\s\S]*fetch\(withAdminWorkspaceSubject\('\/api\/admin\/questions\/upload'/)
})

test('edit client loads active year/book metadata and sends required IDs in PATCH', () => {
  assert.match(editClient, /\/api\/admin\/question-bank\/years/)
  assert.match(editClient, /\/api\/admin\/question-bank\/books/)
  assert.match(editClient, /questionBankMetadata/)
  assert.match(editClient, /yearId:\s*''/)
  assert.match(editClient, /bookId:\s*''/)
  assert.match(editClient, /연도 \*/)
  assert.match(editClient, /교재 \*/)
  assert.match(editClient, /yearId:\s*formData\.yearId/)
  assert.match(editClient, /bookId:\s*formData\.bookId/)
  assert.doesNotMatch(editClient, /<SelectItem value="">/)
  assert.match(editClient, /NONE_SELECT_VALUE/)
  assert.match(editClient, /value === NONE_SELECT_VALUE \? '' : value/)
  assert.doesNotMatch(editClient, /source:\s*formData\.source/)
  assert.doesNotMatch(editClient, /fetchedQuestion\.source\s*\|\|/)
  assert.match(editClient, /source_type:\s*formData\.source_type/)
  assert.match(editClient, /source_4:\s*formData\.source_4/)
})
