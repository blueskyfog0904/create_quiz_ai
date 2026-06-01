import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')
const generateRouteSource = readSource('src/app/api/questions/generate/route.ts')
const saveRouteSource = readSource('src/app/api/questions/route.ts')
const listboardJobRouteSource = readSource('src/app/api/generate/listboard-jobs/route.ts')
const listboardRunRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/run/route.ts')
const listboardRetryRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts')
const listboardSaveRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/save/route.ts')
const adminTestRouteSource = readSource('src/app/api/admin/problem-types/[id]/test/route.ts')
const publicBoardPostClientSource = readSource('src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/board-post-client.tsx')
const adminTestClientSource = readSource('src/app/(admin)/admin/problem-types/[id]/test/problem-type-test-client.tsx')
const singleGenerateClientSource = readSource('src/app/(dashboard)/generate/[typeId]/generate-client.tsx')
const multiGenerateClientSource = readSource('src/app/(dashboard)/generate/multi/multi-generate-client.tsx')
const textbookGenerateClientSource = readSource('src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/textbook-generate-client.tsx')
const jobStatusClientSource = readSource('src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx')

const assertNoGradeDifficultyPayload = (source, label) => {
  assert.doesNotMatch(source, /gradeLevel\s*[,}]/, `${label} should not send or pass gradeLevel`)
  assert.doesNotMatch(source, /difficulty\s*[,}]/, `${label} should not send or pass difficulty`)
}

test('AI generation workflow no longer injects grade or difficulty into generation/review prompts', () => {
  assert.doesNotMatch(workflowSource, /getGradeLevelKorean/)
  assert.doesNotMatch(workflowSource, /getDifficultyKorean/)
  assert.doesNotMatch(workflowSource, /학년의 난이도|문제의 난이도|\b학년:\s*\$\{|\b난이도:\s*\$\{/)
  assert.doesNotMatch(workflowSource, /gradeLevel:/)
  assert.doesNotMatch(workflowSource, /difficulty:/)
})

test('AI generation and admin test APIs do not require or forward grade/difficulty', () => {
  for (const [source, label] of [
    [generateRouteSource, 'questions generate route'],
    [listboardJobRouteSource, 'listboard job create route'],
    [listboardRunRouteSource, 'listboard run route'],
    [listboardRetryRouteSource, 'listboard retry route'],
    [adminTestRouteSource, 'admin problem type test route'],
  ]) {
    assert.doesNotMatch(source, /gradeLevel:\s*z\.string\(\)/, `${label} should not require gradeLevel`)
    assert.doesNotMatch(source, /difficulty:\s*z\.string\(\)/, `${label} should not require difficulty`)
    assertNoGradeDifficultyPayload(source, label)
  }
})

test('saved AI-generated questions store no grade/difficulty metadata', () => {
  assert.doesNotMatch(saveRouteSource, /gradeLevel:\s*z\.string\(\)/)
  assert.doesNotMatch(saveRouteSource, /difficulty:\s*z\.string\(\)/)
  assert.match(saveRouteSource, /grade_level:\s*null/)
  assert.match(saveRouteSource, /difficulty:\s*null/)
  assert.doesNotMatch(listboardSaveRouteSource, /grade_level:\s*job\.grade_level/)
  assert.doesNotMatch(listboardSaveRouteSource, /difficulty:\s*job\.difficulty/)
  assert.match(listboardSaveRouteSource, /grade_level:\s*null/)
  assert.match(listboardSaveRouteSource, /difficulty:\s*null/)
})

test('AI generation UIs hide grade/difficulty controls and do not send those fields', () => {
  for (const [source, label] of [
    [publicBoardPostClientSource, 'listboard post generation page'],
    [adminTestClientSource, 'admin problem type test page'],
    [singleGenerateClientSource, 'single generation page'],
    [multiGenerateClientSource, 'multi generation page'],
    [textbookGenerateClientSource, 'textbook generation page'],
    [jobStatusClientSource, 'listboard job status page'],
  ]) {
    assert.doesNotMatch(source, /setGradeLevel|setDifficulty|GRADE_OPTIONS|DIFFICULTY_OPTIONS/, `${label} should not keep grade/difficulty state`)
    assertNoGradeDifficultyPayload(source, label)
  }

  assert.doesNotMatch(publicBoardPostClientSource, /<CardTitle>생성 옵션<\/CardTitle>/)
  assert.doesNotMatch(adminTestClientSource, /<Label>학년<\/Label>|<Label>난이도<\/Label>/)
  assert.doesNotMatch(singleGenerateClientSource, /<Label htmlFor="grade">학년<\/Label>|<Label htmlFor="difficulty">난이도<\/Label>/)
  assert.doesNotMatch(multiGenerateClientSource, /<Label htmlFor="grade">학년<\/Label>|<Label htmlFor="difficulty">난이도<\/Label>/)
  assert.doesNotMatch(textbookGenerateClientSource, /<Label htmlFor="grade-level">학년<\/Label>|<Label htmlFor="difficulty">난이도<\/Label>/)
})
