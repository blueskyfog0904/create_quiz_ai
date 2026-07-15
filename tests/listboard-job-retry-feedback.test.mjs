import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const jobStatusClientSource = readFileSync(
  new URL('../src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx', import.meta.url),
  'utf8'
)
const retryRouteSource = readFileSync(
  new URL('../src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts', import.meta.url),
  'utf8'
)
const saveRouteSource = readFileSync(
  new URL('../src/app/api/generate/listboard-jobs/[jobId]/save/route.ts', import.meta.url),
  'utf8'
)

test('retry route returns remaining retry outcome counts for UI feedback', () => {
  assert.match(retryRouteSource, /remainingCompletedCount: completedCount/)
  assert.match(retryRouteSource, /remainingFailedCount: failedCount/)
})

test('save route returns partial-save accounting fields', () => {
  assert.match(saveRouteSource, /requestedCount: jobItemIds\.length/)
  assert.match(saveRouteSource, /saveableCount: saveCandidates\.length/)
  assert.match(saveRouteSource, /skippedCount: Math\.max\(jobItemIds\.length - saveCandidates\.length, 0\)/)
})

test('job status client surfaces retry outcome feedback and grouped failure reasons', () => {
  assert.match(jobStatusClientSource, /남은 실패 \$\{data\.data\.remainingFailedCount\}건의 사유를 확인해주세요/)
  assert.match(jobStatusClientSource, /const failedReasonGroups = useMemo\(\(\) =>/)
  assert.match(jobStatusClientSource, /자세한 실패 내용/)
  assert.match(jobStatusClientSource, /실패 항목 다시 생성/)
  assert.match(jobStatusClientSource, /요청한 \$\{data\.data\.requestedCount\}건 중 \$\{data\.data\.skippedCount\}건은 이미 저장되었거나 저장 대상이 아니어서 건너뛰었습니다/)
})
