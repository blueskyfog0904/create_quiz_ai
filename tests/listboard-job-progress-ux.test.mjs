import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const jobStatusClientSource = readFileSync(
  new URL('../src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx', import.meta.url),
  'utf8'
)
const batchPreviewSource = readFileSync(
  new URL('../src/components/features/quiz/batch-question-preview-card.tsx', import.meta.url),
  'utf8'
)
const purchasedClientSource = readFileSync(
  new URL('../src/app/(dashboard)/library/purchased/purchased-client.tsx', import.meta.url),
  'utf8'
)

test('job progress uses teacher-friendly labels and an accessible live progress bar', () => {
  assert.match(jobStatusClientSource, /AI가 문제를 만들고 있어요/)
  assert.match(jobStatusClientSource, /완성된 문제는 아래에서 먼저 검토하고 저장할 수 있습니다/)
  assert.match(jobStatusClientSource, /const currentRunningItem = items\.find/)
  assert.match(jobStatusClientSource, /role="progressbar"/)
  assert.match(jobStatusClientSource, /aria-valuenow=\{progressPercent\}/)
  assert.doesNotMatch(jobStatusClientSource, />\{isStartingRun \? 'running' : job\.status\}</)
  assert.doesNotMatch(jobStatusClientSource, />\{item\.status\}</)
})

test('save actions appear only after a reviewable result exists', () => {
  assert.match(jobStatusClientSource, /const hasReviewableResults = completedPreviewItems\.length > 0/)
  assert.match(jobStatusClientSource, /const hasSaveActivity = hasReviewableResults \|\| savedCount > 0/)
  assert.match(jobStatusClientSource, /\{hasSaveActivity \? \(/)
  assert.match(jobStatusClientSource, /선택한 \{selectedItemIds\.length\}개 저장/)
})

test('saving gives explicit next actions and preserves workspace subject', () => {
  assert.match(jobStatusClientSource, /showSaveSuccessDialog/)
  assert.match(jobStatusClientSource, /계속 검토하기/)
  assert.match(jobStatusClientSource, /영어문제 관리에서 보기/)
  assert.match(jobStatusClientSource, /const purchasedParams = new URLSearchParams/)
  assert.match(jobStatusClientSource, /jobId: job\.id/)
  assert.match(jobStatusClientSource, /subject: workspaceSubject/)
  assert.match(jobStatusClientSource, /const purchasedHref = `\/library\/purchased\?\$\{purchasedParams\.toString\(\)\}`/)
})

test('raw generation and save statuses are never rendered directly', () => {
  assert.doesNotMatch(jobStatusClientSource, />\{isStartingRun \? 'running' : job\.status\}</)
  assert.doesNotMatch(jobStatusClientSource, />\{item\.status\}</)
  assert.doesNotMatch(jobStatusClientSource, />\{item\.save_status\}</)
})

test('terminal generation states render inline banners instead of a completion dialog', () => {
  assert.match(jobStatusClientSource, /문제 .*개가 모두 생성되었습니다/)
  assert.match(jobStatusClientSource, /다시 생성 필요/)
  assert.match(jobStatusClientSource, /생성된 문제가 없습니다/)
  assert.doesNotMatch(jobStatusClientSource, /showCompleteDialog/)
  assert.doesNotMatch(jobStatusClientSource, /setShowCompleteDialog/)
})

test('saved items stay excluded from save candidates', () => {
  assert.match(jobStatusClientSource, /\['unsaved', 'save_failed'\]\.includes\(item\.save_status\)/)
  assert.match(batchPreviewSource, /const isSaved = saveStatus === 'saved'/)
  assert.match(batchPreviewSource, /disabled=\{disableActions \|\| isSaved \|\| isSaving\}/)
})

test('preview card exposes accessible checkbox rating tag controls and save-status copy', () => {
  assert.match(batchPreviewSource, /aria-label=\{`\$\{questionNumber\}번 \$\{problemTypeName\} 문제 선택`\}/)
  assert.match(batchPreviewSource, /aria-label=\{`별점 \$\{star\}점 선택`\}/)
  assert.match(batchPreviewSource, /aria-pressed=\{rating === star\}/)
  assert.match(batchPreviewSource, /aria-label=\{`\$\{tag\} 태그 삭제`\}/)
  assert.match(batchPreviewSource, /focus-visible:opacity-100/)
  assert.match(batchPreviewSource, /저장 재시도 필요/)
})

test('purchased banner describes the whole generation job, not only the latest save request', () => {
  assert.match(purchasedClientSource, /이 생성 작업에서 저장한 문제 \{highlightedSavedCount\}개를 표시 중입니다/)
  assert.doesNotMatch(purchasedClientSource, /방금 저장한 문제 \{highlightedSavedCount\}개/)
})
