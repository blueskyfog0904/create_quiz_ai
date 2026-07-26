import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
const expectedPrefixHash = readFileSync(
  new URL('./fixtures/agents-generated-prefix.sha256', import.meta.url),
  'utf8'
).trim()
const projectDocDelimiter = '--- project-doc ---'
const delimiterIndex = agents.indexOf(projectDocDelimiter)
const workflowHeading = '## Workflow Preferences'
const workflowIndex = agents.indexOf(workflowHeading)
const protectedPrefixEnd = delimiterIndex === -1 ? workflowIndex : delimiterIndex
const protectedPrefix = agents.slice(0, protectedPrefixEnd)
const projectDoc = delimiterIndex === -1
  ? agents
  : agents.slice(delimiterIndex + projectDocDelimiter.length)

function count(source, value) {
  return source.split(value).length - 1
}

function countMarkerLines(source, marker) {
  return source
    .split('\n')
    .filter((line) => line.trim() === marker)
    .length
}

test('the generated or user-only protected AGENTS prefix remains byte-for-byte unchanged', () => {
  assert.notEqual(workflowIndex, -1)
  assert.ok(protectedPrefix.length > 0)
  const actualHash = createHash('sha256').update(protectedPrefix).digest('hex')

  assert.equal(actualHash, expectedPrefixHash)
})

test('project-doc delimiter and generated marker structure remain valid', () => {
  const delimiterCount = count(agents, projectDocDelimiter)
  assert.ok(delimiterCount === 0 || delimiterCount === 1)

  const generatedMarkerCount = countMarkerLines(
    protectedPrefix,
    '<!-- omx:generated:agents-md -->'
  )
  const runtimeStartCount = countMarkerLines(
    protectedPrefix,
    '<!-- OMX:RUNTIME:START -->'
  )
  const runtimeEndCount = countMarkerLines(
    protectedPrefix,
    '<!-- OMX:RUNTIME:END -->'
  )
  const teamStartCount = countMarkerLines(
    protectedPrefix,
    '<!-- OMX:TEAM:WORKER:START -->'
  )
  const teamEndCount = countMarkerLines(
    protectedPrefix,
    '<!-- OMX:TEAM:WORKER:END -->'
  )

  assert.equal(generatedMarkerCount, delimiterCount)
  assert.equal(runtimeStartCount, runtimeEndCount)
  assert.equal(teamStartCount, teamEndCount)
  assert.ok(runtimeStartCount <= 1)
  assert.ok(teamStartCount <= 1)
})

test('Studio generation guidance lives in the user-managed Workflow Preferences', () => {
  const projectWorkflowIndex = projectDoc.indexOf(workflowHeading)
  assert.notEqual(projectWorkflowIndex, -1)
  const workflowPreferences = projectDoc.slice(projectWorkflowIndex)

  assert.match(workflowPreferences, /신규 UI[\s\S]*`DESIGN\.md`/)
  assert.match(workflowPreferences, /신규 UI[\s\S]*`\/preview\/design-system`/)
  assert.match(workflowPreferences, /기존[\s\S]*(?:primitive|프리미티브)[\s\S]*(?:pattern|패턴)[\s\S]*(?:template|템플릿)[\s\S]*우선/)
  assert.match(workflowPreferences, /core[\s\S]*raw hex[\s\S]*임의[\s\S]*container[\s\S]*radius[\s\S]*금지/i)
  assert.match(workflowPreferences, /공통 abstraction[\s\S]*실제 consumer 2개 이상[\s\S]*승인된 template 역할/)

  assert.equal(protectedPrefix.includes('DESIGN.md'), false)
  assert.equal(protectedPrefix.includes('/preview/design-system'), false)
})
