import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const componentUrls = {
  StudioContainer: new URL(
    '../src/components/design-system/studio-container.tsx',
    import.meta.url
  ),
  StudioPageHeader: new URL(
    '../src/components/design-system/studio-page-header.tsx',
    import.meta.url
  ),
  StudioEmptyState: new URL(
    '../src/components/design-system/studio-empty-state.tsx',
    import.meta.url
  ),
}

function readComponent(name) {
  const url = componentUrls[name]
  assert.equal(
    existsSync(url),
    true,
    `src/components/design-system/${url.pathname.split('/').at(-1)} must exist`
  )
  return readFileSync(url, 'utf8')
}

function extractInterfaceKeys(source, interfaceName) {
  const declaration = source.match(
    new RegExp(`interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`)
  )
  assert.ok(declaration, `${interfaceName} must be declared explicitly`)

  return [...declaration[1].matchAll(/^\s*(\w+)\??\s*:/gm)].map(
    (match) => match[1]
  )
}

function assertExportedFunction(source, name) {
  assert.match(source, new RegExp(`export\\s+function\\s+${name}\\b`))
}

function extractOpeningTagByDataSlot(source, dataSlot) {
  const marker = `data-slot="${dataSlot}"`
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `${dataSlot} must identify its action wrapper`)

  const openingIndex = source.lastIndexOf('<', markerIndex)
  assert.notEqual(openingIndex, -1, `${dataSlot} must be on a JSX element`)

  let quote = null
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '>') return source.slice(openingIndex, index + 1)
  }

  assert.fail(`${dataSlot} opening tag must close`)
}

function assertActionSlotHitArea(source, componentName, dataSlot) {
  const openingTag = extractOpeningTagByDataSlot(source, dataSlot)
  const className = openingTag.match(/className=(['"])([\s\S]*?)\1/)
  assert.ok(className, `${dataSlot} must own a static className`)

  const directFocusableSelector =
    '[&>:is(a,button,input,select,[role=button])]'
  for (const classSuffix of [
    'min-h-11',
    'min-w-11',
    'outline-none',
    'focus-visible:ring-2',
    'focus-visible:ring-[var(--studio-focus-ring)]',
  ]) {
    assert.ok(
      className[2].includes(`${directFocusableSelector}:${classSuffix}`),
      `${componentName} action wrapper must apply ${classSuffix} to direct focusable children`
    )
  }
  assert.doesNotMatch(
    className[2],
    /\[&_[^\]]/,
    `${componentName} action wrapper must not style recursively nested controls`
  )
  assert.doesNotMatch(
    source,
    /cloneElement/,
    `${componentName} must not mutate an arbitrary action ReactNode`
  )
}

function assertDomainIndependent(source, componentName) {
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  )
  for (const importPath of imports) {
    assert.ok(
      ['react', '@/lib/utils', './studio-container'].includes(importPath),
      `${componentName} must not import domain, router, data, or preview modules: ${importPath}`
    )
  }
  assert.doesNotMatch(source, /solvook|sample-data|supabase/i)
}

test('StudioContainer exports the tokenized responsive content boundary and forwards div props', () => {
  const source = readComponent('StudioContainer')

  assertExportedFunction(source, 'StudioContainer')
  assert.match(source, /React\.ComponentProps<['"]div['"]>/)
  assert.match(source, /\{\s*className\s*,\s*\.\.\.props\s*\}/)
  assert.match(
    source,
    /mx-auto w-full max-w-\[var\(--studio-content-width,75rem\)\] px-4 sm:px-6/
  )
  assert.match(source, /data-slot="studio-container"/)
  assert.match(source, /className=\{cn\([\s\S]*?className[\s\S]*?\)\}/)
  assert.match(source, /\{\s*\.\.\.props\s*\}/)
  assertDomainIndependent(source, 'StudioContainer')
})

test('StudioPageHeader exposes only the approved display slots and wraps actions accessibly', () => {
  const source = readComponent('StudioPageHeader')

  assertExportedFunction(source, 'StudioPageHeader')
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioPageHeaderProps').sort(),
    ['breadcrumbs', 'eyebrow', 'title', 'description', 'meta', 'actions'].sort()
  )
  for (const slot of [
    'breadcrumbs',
    'eyebrow',
    'title',
    'description',
    'meta',
    'actions',
  ]) {
    assert.match(source, new RegExp(`\\{${slot}\\}`), `${slot} must render`)
  }
  assert.match(source, /<header\b/)
  assert.match(source, /<h1\b/)
  const actionOpeningTag = extractOpeningTagByDataSlot(
    source,
    'studio-page-header-actions'
  )
  for (const layoutClass of ['w-full', 'min-w-0', 'max-w-full', 'md:w-auto']) {
    assert.ok(
      actionOpeningTag.includes(layoutClass),
      `StudioPageHeader action wrapper must include ${layoutClass}`
    )
  }
  assertActionSlotHitArea(
    source,
    'StudioPageHeader',
    'studio-page-header-actions'
  )
  assert.match(source, /<nav\s+aria-label=['"]Breadcrumb['"]/)
  assert.match(source, /md:flex-row/)
  assert.doesNotMatch(source, /sm:flex-row/)
  assertDomainIndependent(source, 'StudioPageHeader')
})

test('StudioEmptyState exposes icon, copy, and action slots without owning domain state', () => {
  const source = readComponent('StudioEmptyState')

  assertExportedFunction(source, 'StudioEmptyState')
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioEmptyStateProps').sort(),
    ['icon', 'title', 'description', 'action'].sort()
  )
  assert.match(source, /title:\s*string/)
  assert.match(source, /description:\s*string/)
  for (const slot of ['icon', 'title', 'description', 'action']) {
    assert.match(source, new RegExp(`\\{${slot}\\}`), `${slot} must render`)
  }
  assert.match(source, /var\(--studio-surface\)/)
  assert.match(source, /var\(--studio-border\)/)
  assertActionSlotHitArea(
    source,
    'StudioEmptyState',
    'studio-empty-state-action'
  )
  assert.match(source, /<p\b[^>]*>\s*\{title\}\s*<\/p>/s)
  assert.doesNotMatch(source, /<h[1-6]\b[^>]*>\s*\{title\}/s)
  assertDomainIndependent(source, 'StudioEmptyState')
})
