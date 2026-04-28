import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const jobStatusClientSource = readFileSync(
  new URL('../src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx', import.meta.url),
  'utf8'
)

test('job status client keeps completed items saveable even when generation is still active', () => {
  assert.match(jobStatusClientSource, /const canSaveCompletedItems = saveableItemIds\.length > 0 && savingItemIds\.length === 0/)
  assert.match(jobStatusClientSource, /const canOpenPurchased = savedCount > 0/)
  assert.match(jobStatusClientSource, /disabled=\{!canSaveCompletedItems \|\| selectedItemIds\.length === 0\}/)
  assert.match(jobStatusClientSource, /disabled=\{!canOpenPurchased\}/)
  assert.match(jobStatusClientSource, /disableActions=\{savingItemIds\.includes\(item\.id\)\}/)
  assert.doesNotMatch(jobStatusClientSource, /disabled=\{isGenerationInProgress \|\| selectedItemIds\.length === 0 \|\| savingItemIds\.length > 0\}/)
  assert.doesNotMatch(jobStatusClientSource, /disabled=\{isGenerationInProgress \|\| savedCount === 0\}/)
})

test('job status client explains partial success explicitly in dialog and summary', () => {
  assert.match(jobStatusClientSource, /const isPartialSuccess = completedCount > 0 && failedCount > 0/)
  assert.match(jobStatusClientSource, /성공한 문제는 지금 저장할 수 있고, 실패한 문제는 재시도할 수 있습니다/)
  assert.match(jobStatusClientSource, /재시도 중에도 이미 생성된 문제는 계속 저장할 수 있습니다/)
})
