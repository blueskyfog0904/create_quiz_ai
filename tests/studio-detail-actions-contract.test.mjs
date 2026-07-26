import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const detailActionsSource = readFileSync(
  new URL(
    '../src/app/preview/solvook-concept/_components/detail/detail-actions.tsx',
    import.meta.url
  ),
  'utf8'
)
const materialDetailSource = readFileSync(
  new URL(
    '../src/app/preview/solvook-concept/_components/detail/material-detail.tsx',
    import.meta.url
  ),
  'utf8'
)
const sampleDialogSource = readFileSync(
  new URL(
    '../src/app/preview/solvook-concept/_components/detail/sample-preview-dialog.tsx',
    import.meta.url
  ),
  'utf8'
)

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0
}

test('detail actions share one provider-owned state and one controlled action dialog', () => {
  assert.match(
    detailActionsSource,
    /export\s+function\s+DetailActionsProvider\b/
  )
  assert.match(detailActionsSource, /createContext/)
  assert.match(detailActionsSource, /useContext/)
  assert.equal(
    countMatches(detailActionsSource, /\buseState(?:<[^>]+>)?\s*\(/g),
    1,
    'feedback and action dialog state must share one provider-owned state object'
  )
  assert.equal(
    countMatches(detailActionsSource, /<SamplePreviewDialog\b/g),
    1,
    'the provider must own exactly one action sample dialog tree'
  )
  assert.match(detailActionsSource, /open=\{[^}]*sampleOpen[^}]*\}/)
  assert.match(detailActionsSource, /onOpenChange=\{[^}]+\}/)
  assert.match(detailActionsSource, /showTrigger=\{false\}/)

  const detailActionsBody = detailActionsSource.slice(
    detailActionsSource.indexOf('export function DetailActions(')
  )
  assert.doesNotMatch(detailActionsBody, /\buseState(?:<[^>]+>)?\s*\(/)
  assert.doesNotMatch(detailActionsBody, /<SamplePreviewDialog\b/)
  assert.match(detailActionsBody, /useDetailActions\s*\(/)
})

test('the action dialog restores focus to the exact responsive trigger that opened it', () => {
  assert.equal(
    countMatches(detailActionsSource, /\buseRef(?:<[^>]+>)?\s*\(/g),
    1,
    'the provider must own one action trigger ref'
  )
  assert.match(
    detailActionsSource,
    /openSample:\s*\(trigger:\s*HTMLButtonElement\)\s*=>\s*void/
  )
  assert.match(
    detailActionsSource,
    /function\s+openSample\(trigger:\s*HTMLButtonElement\)[\s\S]*?sampleTriggerRef\.current\s*=\s*trigger/
  )
  assert.equal(
    countMatches(
      detailActionsSource,
      /onClick=\{\(event\)\s*=>\s*openSample\(event\.currentTarget\)\}/g
    ),
    2,
    'desktop and mobile sample buttons must save their own trigger element'
  )
  assert.match(
    detailActionsSource,
    /returnFocusRef=\{sampleTriggerRef\}/
  )
})

test('the material detail wraps both responsive action views in one provider', () => {
  assert.match(
    materialDetailSource,
    /import\s*\{[^}]*\bDetailActionsProvider\b[^}]*\}\s*from\s*['"]\.\/detail-actions['"]/s
  )
  assert.equal(
    countMatches(materialDetailSource, /<DetailActionsProvider\b/g),
    1
  )
  assert.equal(countMatches(materialDetailSource, /<DetailActions\b/g), 2)
  assert.match(
    materialDetailSource,
    /<DetailActionsProvider[\s\S]*?<StudioDetailPageFrame[\s\S]*?<\/DetailActionsProvider>/
  )
})

test('the detail sample dialog supports controlled open state and an optional trigger', () => {
  assert.match(sampleDialogSource, /open\?:\s*boolean/)
  assert.match(
    sampleDialogSource,
    /onOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/
  )
  assert.match(sampleDialogSource, /showTrigger\?:\s*boolean/)
  assert.match(
    sampleDialogSource,
    /returnFocusRef\?:\s*RefObject<HTMLButtonElement\s*\|\s*null>/
  )
  assert.match(
    sampleDialogSource,
    /<Dialog\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}>/
  )
  assert.match(sampleDialogSource, /\{showTrigger\s*\?\s*\(/)
  assert.match(
    sampleDialogSource,
    /if\s*\(!returnFocusRef\?\.current\)\s*return/
  )
  assert.match(sampleDialogSource, /event\.preventDefault\(\)/)
  assert.match(sampleDialogSource, /returnFocusRef\.current\.focus\(\)/)
  assert.match(
    sampleDialogSource,
    /<StudioDialogContent\b[^>]*onCloseAutoFocus=\{handleCloseAutoFocus\}/s
  )
  assert.doesNotMatch(sampleDialogSource, /<DialogHeader\b[^>]*\bpr-(?:8|12)\b/)
})
