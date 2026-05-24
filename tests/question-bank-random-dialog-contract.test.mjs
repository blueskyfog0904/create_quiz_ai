import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const dialogPath = new URL('../src/components/features/question-bank/random-exam-dialog.tsx', import.meta.url)
const purchasedPath = new URL('../src/app/(dashboard)/library/purchased/purchased-client.tsx', import.meta.url)

function readSource(path, label) {
  assert.equal(existsSync(path), true, `${label} must exist`)
  return readFileSync(path, 'utf8')
}

function assertEndpointWithParams(source, endpoint, params) {
  assert.match(source, new RegExp(endpoint.replaceAll('/', String.raw`\/`)), `${endpoint} endpoint must be used`)

  for (const param of params) {
    assert.match(source, new RegExp(String.raw`[?&]${param}=|\.set\(\s*['"]${param}['"]`), `${endpoint} must send ${param}`)
  }
}

test('RandomExamDialog component exists and receives purchased-page integration props', () => {
  const source = readSource(dialogPath, 'random exam dialog component')

  assert.match(source, /export\s+function\s+RandomExamDialog\s*\(/)
  assert.match(source, /interface\s+RandomExamDialogProps\s*\{[\s\S]*open:/)
  assert.match(source, /onOpenChange:/)
  assert.match(source, /problemTypes:/)
  assert.match(source, /workspaceSubject:/)
})

test('RandomExamDialog loads options and scoped availability without creating until submit', () => {
  const source = readSource(dialogPath, 'random exam dialog component')

  assertEndpointWithParams(source, '/api/question-bank/options', ['subject'])
  assertEndpointWithParams(source, '/api/question-bank/availability', ['subject', 'yearId', 'bookId'])
  assert.match(source, /useEffect\([\s\S]*open[\s\S]*fetchOptions/)
  assert.match(source, /useEffect\([\s\S]*selectedYearId[\s\S]*selectedBookId[\s\S]*fetchAvailability/)
  assert.match(source, /optionsResponse\.ok|response\.ok/)
  assert.match(source, /availabilityResponse\.ok|response\.ok/)
  assert.doesNotMatch(
    source.slice(0, source.indexOf('const handleSubmit')),
    /\/api\/exam-papers\/random-bank/,
    'creation endpoint must only be called from submit handling'
  )
})

test('RandomExamDialog displays bounded max availability and count controls per active problem type', () => {
  const source = readSource(dialogPath, 'random exam dialog component')

  assert.match(source, /problemTypes\.filter\([\s\S]*is_active|activeProblemTypes/)
  assert.match(source, /problemTypeId/)
  assert.match(source, /availableCount/)
  assert.match(source, /getMaxCountForProblemType\(/)
  assert.match(source, /최대\s*\{[^}]+\}\s*문항|`최대 \$\{[^}]+\}문항`/)
  assert.match(source, /aria-label=\{`[^`]*감소[^`]*`\}|aria-label="[^"]*감소[^"]*"/)
  assert.match(source, /aria-label=\{`[^`]*증가[^`]*`\}|aria-label="[^"]*증가[^"]*"/)
  assert.match(source, /type="number"/)
  assert.match(source, /min=\{0\}|min="0"/)
  assert.match(source, /max=\{maxCount\}|max=\{availableCount\}/)
  assert.match(source, /disabled=\{[\s\S]*(maxCount|availableCount)\s*===\s*0/)
  assert.match(source, /MAX_RANDOM_EXAM_QUESTION_COUNT/)
  assert.match(source, /Math\.min\([\s\S]*Math\.max\([\s\S]*0/)
})

test('RandomExamDialog validates and posts random-bank payload before navigating to detail', () => {
  const source = readSource(dialogPath, 'random exam dialog component')

  assert.match(source, /validateRandomExamRequest\(/)
  assert.match(source, /typeCounts\.filter\([\s\S]*count\s*>\s*0/)
  assert.match(source, /fetch\(\s*['"]\/api\/exam-papers\/random-bank['"][\s\S]*method:\s*['"]POST['"]/)
  assert.match(source, /JSON\.stringify\(\s*\{[\s\S]*title[\s\S]*yearId[\s\S]*bookId[\s\S]*typeCounts[\s\S]*workspaceSubject[\s\S]*\}\s*\)/)
  assert.match(source, /data\.examPaperId/)
  assert.match(source, /router\.push\(\s*`\/library\/exam-papers\/\$\{data\.examPaperId\}\?subject=\$\{workspaceSubject\}`\s*\)/)
  assert.match(source, /toast\.success\([^)]*랜덤 문제지/)
  assert.match(source, /message\s*\?\?|error\s*\?\?|message\s*\|\|\s*error/)
})

test('PurchasedClient renders the 랜덤 문제지 생성 button and dialog without replacing selected-question flow', () => {
  const source = readSource(purchasedPath, 'purchased client')

  assert.match(source, /import\s+\{\s*RandomExamDialog\s*\}\s+from\s+['"]@\/components\/features\/question-bank\/random-exam-dialog['"]/)
  assert.match(source, /isRandomExamDialogOpen/)
  assert.match(source, /랜덤 문제지 생성/)
  assert.match(source, /setIsRandomExamDialogOpen\(true\)/)
  assert.match(source, /<RandomExamDialog[\s\S]*open=\{isRandomExamDialogOpen\}[\s\S]*problemTypes=\{problemTypes\}[\s\S]*workspaceSubject=\{workspaceSubject\}/)
  assert.match(source, /<CreateExamDialog[\s\S]*onConfirm=\{handleCreateExamPaper\}/)
  assert.match(source, /<QuestionActionBar[\s\S]*onCreateExamPaper=\{\(\) => setIsExamDialogOpen\(true\)\}/)
})
