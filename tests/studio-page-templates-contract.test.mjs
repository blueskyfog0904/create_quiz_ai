import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const templateUrls = {
  StudioBoardPageFrame: new URL(
    '../src/components/page-templates/studio-board-page-frame.tsx',
    import.meta.url
  ),
  StudioDetailPageFrame: new URL(
    '../src/components/page-templates/studio-detail-page-frame.tsx',
    import.meta.url
  ),
  StudioLandingPageFrame: new URL(
    '../src/components/page-templates/studio-landing-page-frame.tsx',
    import.meta.url
  ),
  pageTemplatesIndex: new URL(
    '../src/components/page-templates/index.ts',
    import.meta.url
  ),
}

function readTemplate(name) {
  const url = templateUrls[name]
  assert.equal(
    existsSync(url),
    true,
    `src/components/page-templates/${url.pathname.split('/').at(-1)} must exist`
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

function assertLayoutOnly(source, templateName) {
  assert.doesNotMatch(
    source,
    /supabase|purchase|credit|useRouter|sample-data|preview/i,
    `${templateName} must remain domain independent`
  )
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${templateName} must not fetch`)
  assert.doesNotMatch(source, /useState|useEffect|useReducer|useSearchParams/)
  assert.doesNotMatch(source, /from\s+['"]next\/(?:navigation|link)['"]/)
}

test('StudioBoardPageFrame owns only header, optional filters, and results layout', () => {
  const source = readTemplate('StudioBoardPageFrame')

  assert.match(source, /export\s+function\s+StudioBoardPageFrame\b/)
  assert.deepEqual(extractInterfaceKeys(source, 'StudioBoardPageFrameProps'), [
    'header',
    'filters',
    'results',
  ])
  for (const slot of ['header', 'filters', 'results']) {
    assert.match(source, new RegExp(`\\{${slot}\\}`), `${slot} must render`)
  }
  assert.match(source, /StudioContainer/)
  assert.match(source, /className="studio-theme/)
  assertLayoutOnly(source, 'StudioBoardPageFrame')
})

test('StudioDetailPageFrame owns responsive main, aside, tabs, and mobile action layout', () => {
  const source = readTemplate('StudioDetailPageFrame')

  assert.match(source, /export\s+function\s+StudioDetailPageFrame\b/)
  assert.deepEqual(extractInterfaceKeys(source, 'StudioDetailPageFrameProps'), [
    'header',
    'main',
    'aside',
    'tabs',
    'mobileActions',
  ])
  for (const slot of ['header', 'main', 'aside', 'tabs', 'mobileActions']) {
    assert.match(source, new RegExp(`\\{${slot}\\}`), `${slot} must render`)
  }
  assert.match(source, /StudioContainer/)
  assert.match(source, /const\s+hasAside\s*=\s*aside\s*!=\s*null/)
  assert.match(
    source,
    /const\s+hasMobileActions\s*=\s*mobileActions\s*!=\s*null/
  )
  assert.match(source, /className=\{cn\(/)
  assert.match(source, /hasMobileActions\s*&&\s*['"][^'"]*pb-\d+[^'"]*lg:pb-0/)
  assert.match(source, /hasAside\s*&&\s*['"][^'"]*lg:grid-cols-/)
  assert.match(source, /\{hasAside\s*\?\s*<aside\b/)
  assert.doesNotMatch(source, /className="[^"]*lg:grid-cols-/)
  assert.doesNotMatch(source, /<main\b/)
  assert.match(source, /data-slot="studio-detail-main"/)
  assert.match(
    source,
    /data-slot="studio-detail-mobile-actions"[^>]*className="[^"]*fixed[^"]*inset-x-0[^"]*bottom-0[^"]*z-40[^"]*lg:hidden/
  )
  assert.match(source, /env\(safe-area-inset-bottom\)/)
  assertLayoutOnly(source, 'StudioDetailPageFrame')
})

test('StudioLandingPageFrame stacks only hero and children sections', () => {
  const source = readTemplate('StudioLandingPageFrame')

  assert.match(source, /export\s+function\s+StudioLandingPageFrame\b/)
  assert.deepEqual(
    extractInterfaceKeys(source, 'StudioLandingPageFrameProps'),
    ['hero', 'children']
  )
  assert.match(source, /\{hero\}/)
  assert.match(source, /\{children\}/)
  assert.match(source, /StudioContainer/)
  assert.match(
    source,
    /className="studio-theme studio-reference-gutter min-h-screen overflow-x-hidden"/
  )
  assertLayoutOnly(source, 'StudioLandingPageFrame')
})

test('page-template barrel exports only the approved frames', () => {
  const source = readTemplate('pageTemplatesIndex')

  for (const path of [
    './studio-board-page-frame',
    './studio-detail-page-frame',
    './studio-landing-page-frame',
  ]) {
    assert.match(source, new RegExp(`export \\* from ['"]${path}['"]`))
  }
  assert.doesNotMatch(source, /material-card|sticky-action-panel/i)
  assertLayoutOnly(source, 'page-templates index')
})
