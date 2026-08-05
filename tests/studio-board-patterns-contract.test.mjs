import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const componentUrls = {
  StudioFilterPanel: new URL(
    '../src/components/design-system/studio-filter-panel.tsx',
    import.meta.url
  ),
  StudioBoardShell: new URL(
    '../src/components/design-system/studio-board-shell.tsx',
    import.meta.url
  ),
  StudioPagination: new URL(
    '../src/components/design-system/studio-pagination.tsx',
    import.meta.url
  ),
  designSystemIndex: new URL(
    '../src/components/design-system/index.ts',
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

function assertDomainIndependent(source, componentName) {
  assert.doesNotMatch(
    source,
    /supabase|purchase|credit|useRouter|sample-data|preview/i,
    `${componentName} must remain domain independent`
  )
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(/,
    `${componentName} must not fetch data`
  )
  assert.doesNotMatch(
    source,
    /from\s+['"](?:next\/navigation|@\/app\/|@\/lib\/(?:supabase|credits?))/,
    `${componentName} must not import router or domain modules`
  )
}

function extractOpeningTagBySlot(source, slot) {
  const marker = `data-slot="${slot}"`
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `${slot} must identify its wrapper`)
  const openingIndex = source.lastIndexOf('<', markerIndex)
  const closingIndex = source.indexOf('>', markerIndex)
  assert.notEqual(openingIndex, -1)
  assert.notEqual(closingIndex, -1)
  return source.slice(openingIndex, closingIndex + 1)
}

function extractStringConstant(source, name) {
  const declaration = source.match(
    new RegExp(`const\\s+${name}\\s*=\\s*\\n?\\s*(['"])([\\s\\S]*?)\\1`)
  )
  assert.ok(declaration, `${name} must define a shared selector contract`)
  return declaration[2]
}

function assertSharedControlClass(source, slot, constantName) {
  const openingTag = extractOpeningTagBySlot(source, slot)
  assert.ok(
    openingTag.includes(constantName),
    `${slot} must apply ${constantName}`
  )
}

test('StudioFilterPanel exposes controlled display slots with direct 44px controls', () => {
  const source = readComponent('StudioFilterPanel')

  assert.match(source, /export\s+function\s+StudioFilterPanel\b/)
  assert.match(
    source,
    /Nested native inputs, selects, and textareas plus shadcn input, select-trigger, and textarea descendants inherit the hit-area contract/
  )
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioFilterPanelProps').sort(),
    ['fields', 'activeFilters', 'actions'].sort()
  )
  for (const slot of ['fields', 'activeFilters', 'actions']) {
    assert.match(source, new RegExp(`\\{${slot}\\}`), `${slot} must render`)
  }

  const fieldClasses = extractStringConstant(
    source,
    'filterFieldControlClasses'
  )
  for (const suffix of [
    'min-h-11',
    'min-w-11',
    'border-[var(--studio-control-border)]',
    'outline-none',
    'focus-visible:ring-2',
    'focus-visible:ring-[var(--studio-focus-ring)]',
  ]) {
    assert.ok(
      fieldClasses.includes(
        `[&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:${suffix}`
      ),
      `nested native and shadcn input, select, and textarea controls must receive ${suffix}`
    )
  }
  assertSharedControlClass(
    source,
    'studio-filter-fields',
    'filterFieldControlClasses'
  )

  const actionClasses = extractStringConstant(
    source,
    'directActionControlClasses'
  )
  for (const suffix of [
    'min-h-11',
    'min-w-11',
    'outline-none',
    'focus-visible:ring-2',
    'focus-visible:ring-[var(--studio-focus-ring)]',
  ]) {
    assert.ok(
      actionClasses.includes(
        `[&>:is(a,button,[role=button])]:${suffix}`
      ),
      `direct active-filter and action controls must receive ${suffix}`
    )
  }
  assertSharedControlClass(
    source,
    'studio-filter-active-filters',
    'directActionControlClasses'
  )
  assertSharedControlClass(
    source,
    'studio-filter-actions',
    'directActionControlClasses'
  )
  assert.doesNotMatch(
    fieldClasses,
    /\[&_\*\]|\[&_(?:a|button|\[role=button\])/,
    'field selectors must not recursively style arbitrary descendants'
  )
  assert.doesNotMatch(source, /<form\b/)
  assert.doesNotMatch(source, /onSubmit/)
  assertDomainIndependent(source, 'StudioFilterPanel')
})

test('StudioBoardShell supports mutually exclusive single and split result modes', () => {
  const source = readComponent('StudioBoardShell')

  assert.match(source, /export\s+function\s+StudioBoardShell\b/)
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioBoardShellBaseProps').sort(),
    ['summary', 'toolbar', 'pagination'].sort()
  )
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioBoardShellSingleResultsProps').sort(),
    ['results', 'desktopResults', 'mobileResults'].sort()
  )
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioBoardShellSplitResultsProps').sort(),
    ['results', 'desktopResults', 'mobileResults'].sort()
  )
  assert.match(source, /type\s+StudioBoardShellProps\s*=\s*[\s\S]*StudioBoardShellBaseProps\s*&\s*\([\s\S]*StudioBoardShellSingleResultsProps\s*\|\s*StudioBoardShellSplitResultsProps[\s\S]*\)/)
  assert.match(source, /results:\s*ReactNode/)
  assert.match(source, /desktopResults\?:\s*never/)
  assert.match(source, /mobileResults\?:\s*never/)
  assert.match(source, /results\?:\s*never/)
  for (const slot of ['summary', 'toolbar', 'pagination']) {
    assert.match(source, new RegExp(`\\{${slot}\\}`), `${slot} must render`)
  }
  assert.match(source, /\{props\.results\}/)
  assert.match(source, /\{props\.desktopResults\}/)
  assert.match(source, /\{props\.mobileResults\}/)
  assert.match(
    source,
    /\/\*\*[\s\S]*?Presentation-only[\s\S]*?state, effects, and portals[\s\S]*?\*\/[\s\S]*?desktopResults:\s*ReactNode/
  )
  assert.match(
    source,
    /desktopResults:\s*ReactNode[\s\S]*?\/\*\*[\s\S]*?Presentation-only[\s\S]*?state, effects, and portals[\s\S]*?\*\/[\s\S]*?mobileResults:\s*ReactNode/
  )
  assert.match(
    source,
    /data-slot="studio-board-results"[^>]*className="[^"]*mt-4/
  )
  assert.match(
    source,
    /data-slot="studio-board-desktop-results"[^>]*className="[^"]*hidden[^"]*md:block/
  )
  assert.match(
    source,
    /data-slot="studio-board-mobile-results"[^>]*className="[^"]*md:hidden/
  )
  assertDomainIndependent(source, 'StudioBoardShell')
})

test('StudioPagination is controlled, link-optional, bounded, and accessible', () => {
  const source = readComponent('StudioPagination')

  assert.match(source, /export\s+function\s+StudioPagination\b/)
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioPaginationProps'),
    ['page', 'totalPages', 'onPageChange', 'getPageHref', 'navigationText']
  )
  assert.match(source, /page:\s*number/)
  assert.match(source, /totalPages:\s*number/)
  assert.match(source, /onPageChange:\s*\(page:\s*number\)\s*=>\s*void/)
  assert.match(source, /getPageHref\?:\s*\(page:\s*number\)\s*=>\s*string/)
  assert.match(source, /navigationText\?:\s*StudioPaginationNavigationText/)
  assert.match(source, /const DEFAULT_NAVIGATION_TEXT/)
  assert.match(source, /navigationText \?\? DEFAULT_NAVIGATION_TEXT/)
  assert.match(source, /<nav\b[^>]*aria-label="페이지네이션"/)
  assert.match(source, /aria-current=\{[^}]*['"]page['"]/)
  assert.match(source, /aria-label=\{label\}/)
  for (const label of ['첫 페이지', '이전 페이지', '다음 페이지', '마지막 페이지']) {
    assert.ok(source.includes(`'${label}'`), `${label} label is required`)
  }
  assert.match(
    source,
    /pageCount\s*=\s*Math\.max\(\s*0,\s*Math\.floor\(Number\.isFinite\(totalPages\)\s*\?\s*totalPages\s*:\s*0\)\s*\)/
  )
  assert.match(source, /if\s*\(pageCount\s*===\s*0\)\s*return\s+null/)
  assert.match(
    source,
    /currentPage\s*=\s*Math\.min\(\s*pageCount,\s*Math\.max\(1,\s*Math\.floor\(Number\.isFinite\(page\)\s*\?\s*page\s*:\s*1\)\)\s*\)/
  )
  assert.match(source, /currentPage\s*<=\s*1/)
  assert.match(source, /currentPage\s*>=\s*pageCount/)
  assert.match(source, /Math\.min\(currentPage\s*-\s*2,\s*pageCount\s*-\s*4\)/)
  assert.match(source, /length:\s*Math\.min\(5,\s*pageCount\)/)
  assert.match(source, /targetPage:\s*Math\.max\(1,\s*currentPage\s*-\s*1\)/)
  assert.match(
    source,
    /targetPage:\s*Math\.min\(pageCount,\s*currentPage\s*\+\s*1\)/
  )
  assert.match(source, /targetPage:\s*pageCount/)
  assert.match(source, /current:\s*pageNumber\s*===\s*currentPage/)
  assert.doesNotMatch(source, /page\s*(?:<=|>=)\s*(?:1|totalPages)/)
  assert.doesNotMatch(source, /pageNumber\s*===\s*page\b/)
  assert.match(source, /disabled=\{disabled\}/)
  assert.match(source, /getPageHref\(targetPage\)/)
  assert.match(source, /onPageChange\(targetPage\)/)
  assert.match(source, /event\.defaultPrevented/)
  assert.match(source, /event\.button\s*!==\s*0/)
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.match(source, new RegExp(`event\\.${modifier}`))
  }
  assert.match(
    source,
    /onClick=\{\(event\)\s*=>\s*handleLinkClick\(event,\s*targetPage\)\}/
  )
  assert.match(source, /<a\b[^>]*href=\{href\}/)
  assert.match(source, /<Button\b/)
  assert.match(
    source,
    /paginationControlClassName\s*=\s*['"][^'"]*min-h-11 min-w-11/
  )
  const sharedClassUses =
    source.match(/className=\{paginationControlClassName\}/g)?.length ?? 0
  assert.ok(
    sharedClassUses >= 2,
    'link and button pagination branches must share the 44px control class'
  )
  assertDomainIndependent(source, 'StudioPagination')
})

test('StudioPagination normalization contract covers empty, singleton, and out-of-range inputs', () => {
  const source = readComponent('StudioPagination')
  const normalize = (page, totalPages) => {
    const pageCount = Math.max(
      0,
      Math.floor(Number.isFinite(totalPages) ? totalPages : 0)
    )
    if (pageCount === 0) return null
    return {
      pageCount,
      currentPage: Math.min(
        pageCount,
        Math.max(1, Math.floor(Number.isFinite(page) ? page : 1))
      ),
    }
  }

  assert.equal(normalize(1, 0), null)
  assert.deepEqual(normalize(-20, 1), { pageCount: 1, currentPage: 1 })
  assert.deepEqual(normalize(-20, 8), { pageCount: 8, currentPage: 1 })
  assert.deepEqual(normalize(20, 8), { pageCount: 8, currentPage: 8 })
  assert.deepEqual(normalize(2.9, 8.9), { pageCount: 8, currentPage: 2 })

  assert.match(source, /Number\.isFinite\(totalPages\)/)
  assert.match(source, /Number\.isFinite\(page\)/)
})

test('design-system barrel exports the approved Phase 1 through 5 surface', () => {
  const source = readComponent('designSystemIndex')

  for (const path of [
    './studio-container',
    './studio-page-header',
    './studio-empty-state',
    './studio-portal-surface',
    './studio-filter-panel',
    './studio-board-shell',
    './studio-pagination',
  ]) {
    assert.match(source, new RegExp(`export \\* from ['"]${path}['"]`))
  }
  assert.doesNotMatch(source, /material-card|sticky-action-panel/i)
  assertDomainIndependent(source, 'design-system index')
})
