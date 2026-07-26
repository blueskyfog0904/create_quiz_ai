import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const pageUrl = new URL(
  '../src/app/preview/design-system/page.tsx',
  import.meta.url
)
const interactionsUrl = new URL(
  '../src/app/preview/design-system/showcase-interactions.tsx',
  import.meta.url
)

function readRequiredFile(url, label) {
  assert.equal(existsSync(url), true, `${label} must exist`)
  return readFileSync(url, 'utf8')
}

test('the Studio showcase is a wired noindex server route without a second main landmark', () => {
  const page = readRequiredFile(pageUrl, 'the /preview/design-system route')
  const interactions = readRequiredFile(
    interactionsUrl,
    'the showcase interaction examples'
  )

  assert.doesNotMatch(page, /^['"]use client['"]/m)
  assert.match(page, /export\s+const\s+metadata\s*(?::[^=]+)?=\s*\{[\s\S]*?robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false/s)
  assert.match(page, /className="[^"]*studio-theme/)
  assert.match(page, /<StudioContainer\b/)
  assert.match(
    page,
    /import\s*\{\s*ShowcaseInteractions\s*\}\s*from\s*['"]\.\/showcase-interactions['"]/
  )
  assert.match(page, /<ShowcaseInteractions\s*\/>/)
  assert.doesNotMatch(page, /<main\b/)
  assert.match(page, /data-slot="studio-showcase-content"/)
  assert.match(interactions, /^['"]use client['"]/m)
})

test('the Studio showcase renders the complete static component and state inventory', () => {
  const page = readRequiredFile(pageUrl, 'the /preview/design-system route')
  const interactions = readRequiredFile(
    interactionsUrl,
    'the showcase interaction examples'
  )
  const source = `${page}\n${interactions}`

  for (const heading of [
    'Colors',
    'Typography',
    'Buttons',
    'Forms',
    'Cards',
    'Board',
    'States',
    'Dialog',
    'Select',
  ]) {
    const literalHeading = new RegExp(
      `<h[2-6][^>]*>\\s*${heading}\\s*</h[2-6]>`
    )
    const delegatedHeading = new RegExp(
      `<SectionHeading[\\s\\S]*?title=['"]${heading}['"]`
    )
    assert.ok(
      literalHeading.test(source) || delegatedHeading.test(source),
      `${heading} section heading must be rendered`
    )
  }

  for (const variant of ['brand', 'brandOutline', 'brandGhost']) {
    assert.match(source, new RegExp(`variant=['"]${variant}['"]`))
  }

  for (const component of [
    'StudioPageHeader',
    'StudioFilterPanel',
    'StudioBoardShell',
    'StudioEmptyState',
    'StudioPagination',
    'StudioDialogContent',
    'StudioSelectContent',
  ]) {
    assert.match(source, new RegExp(`<${component}\\b`), `${component} must be exercised`)
  }

  assert.match(page, /<Button\b(?=[^>]*variant=['"]brand['"])(?=[^>]*\bdisabled\b)[^>]*>/)
  assert.match(page, /<Input\b(?=[^>]*\bdisabled\b)[^>]*>/s)
  assert.match(
    page,
    /<Input\b(?=[^>]*className=['"][^'"]*border-\[var\(--studio-control-border\)\])[^>]*>/s
  )
  assert.match(
    page,
    /<Textarea\b(?=[^>]*className=['"][^'"]*border-\[var\(--studio-control-border\)\])[^>]*>/s
  )
  for (const state of ['Loading', 'Error', 'Success']) {
    assert.match(
      page,
      new RegExp(`<CardTitle\\b[\\s\\S]*?>\\s*${state}\\s*</CardTitle>`),
      `${state} card must remain visible in the showcase`
    )
  }
  assert.doesNotMatch(
    page,
    /\baria-busy\s*=|\brole\s*=\s*['"](?:alert|status)['"]/
  )
  assert.match(page, /motion-reduce:animate-none/)
  assert.doesNotMatch(
    source,
    /supabase|createClient|fetch\s*\(|\/api\/|sample-data/i,
    'the showcase must not depend on production data, APIs, Supabase, or preview sample data'
  )
})

test('the Studio showcase portal and pagination examples expose labelled 44px controls', () => {
  const interactions = readRequiredFile(
    interactionsUrl,
    'the showcase interaction examples'
  )

  assert.match(interactions, /<Dialog\b/)
  assert.match(interactions, /<DialogTitle\b/)
  assert.match(interactions, /<DialogDescription\b/)
  assert.match(interactions, /<StudioDialogContent\b/)
  assert.match(interactions, /<Select\b/)
  assert.match(interactions, /<StudioSelectContent\b/)
  assert.match(
    interactions,
    /<Label\b[^>]*htmlFor=['"]showcase-level['"][^>]*>\s*난이도\s*<\/Label>/
  )
  assert.match(
    interactions,
    /<SelectTrigger\b(?=[^>]*id=['"]showcase-level['"])(?=[^>]*className=['"][^'"]*min-h-11)(?=[^>]*border-\[var\(--studio-control-border\)\])[^>]*>/s
  )
  for (const [id, title] of [
    ['showcase-dialog-heading', 'Dialog'],
    ['showcase-select-heading', 'Select'],
    ['showcase-pagination-heading', 'Controlled pagination'],
  ]) {
    assert.match(
      interactions,
      new RegExp(`<section\\b[^>]*aria-labelledby=['"]${id}['"][^>]*>`)
    )
    assert.match(
      interactions,
      new RegExp(`<h2\\b[^>]*id=['"]${id}['"][^>]*>\\s*${title}\\s*</h2>`)
    )
  }
})
