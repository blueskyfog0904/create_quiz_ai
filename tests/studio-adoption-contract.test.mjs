import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const previewRoot = new URL(
  '../src/app/preview/solvook-concept/',
  import.meta.url
)
const homePageUrl = new URL('page.tsx', previewRoot)
const boardPageUrl = new URL('boards/[slug]/page.tsx', previewRoot)
const detailPageUrl = new URL(
  'boards/[slug]/posts/[postId]/page.tsx',
  previewRoot
)
const layoutUrl = new URL('layout.tsx', previewRoot)
const boardControllerUrl = new URL(
  '_components/board/board-list-controller.tsx',
  previewRoot
)
const boardDialogUrl = new URL(
  '_components/board/sample-preview-dialog.tsx',
  previewRoot
)
const materialDetailUrl = new URL(
  '_components/detail/material-detail.tsx',
  previewRoot
)
const detailDialogUrl = new URL(
  '_components/detail/sample-preview-dialog.tsx',
  previewRoot
)
const sampleDataUrl = new URL('_data/sample-data.json', previewRoot)
const marketListboardServerUrl = new URL(
  '../src/app/(dashboard)/market/[slug]/market-listboard.tsx',
  import.meta.url
)
const marketListboardClientUrl = new URL(
  '../src/app/(dashboard)/market/[slug]/market-listboard-client.tsx',
  import.meta.url
)

const legacyPreviewTokenConsumers = [
  '_components/board/board-list-controller.tsx',
  '_components/board/sample-preview-dialog.tsx',
  '_components/detail/detail-actions.tsx',
  '_components/detail/detail-tabs.tsx',
  '_components/detail/document-preview-pages.tsx',
  '_components/detail/material-detail.tsx',
  '_components/detail/passage-structure.tsx',
  '_components/detail/question-list.tsx',
  '_components/detail/sample-preview-dialog.tsx',
  '_components/home/campaign-hero.tsx',
  '_components/home/home-material-sections.tsx',
  '_components/home/section-heading.tsx',
  '_components/preview-footer.tsx',
  '_components/preview-header.tsx',
  'boards/[slug]/page.tsx',
  'layout.tsx',
]

const materialCoverPath = '_components/home/material-cover.tsx'
const materialCoverPalette = [
  '#382582',
  '#5741bb',
  '#826bf2',
  '#9af0d6',
  '#f2efff',
  '#155e63',
  '#278c88',
  '#63cdb7',
  '#ffd789',
  '#e9fffa',
  '#8f342e',
  '#cf5549',
  '#f38a6c',
  '#ffe38c',
  '#fff0ec',
  '#172541',
  '#273c65',
  '#476490',
  '#b3d8ff',
  '#edf4ff',
]

const studioCoreHexValues = new Set([
  '#f7f8fa',
  '#ffffff',
  '#1c1f2e',
  '#3b4054',
  '#6a708a',
  '#e1e4ed',
  '#7f8499',
  '#6950e5',
  '#5940d8',
  '#63cdb7',
  '#f46d5e',
])

function readRequiredFile(url, label) {
  assert.equal(existsSync(url), true, `${label} must exist`)
  return readFileSync(url, 'utf8')
}

function collectTsxFiles(directory, relativeDirectory = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}${entry.name}`
      const entryUrl = new URL(
        entry.name + (entry.isDirectory() ? '/' : ''),
        directory
      )

      if (entry.isDirectory()) {
        return collectTsxFiles(entryUrl, `${relativePath}/`)
      }

      if (!entry.name.endsWith('.tsx')) return []

      return [
        {
          relativePath,
          source: readFileSync(entryUrl, 'utf8'),
        },
      ]
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function extractHexValues(source) {
  return source.match(/#[\da-f]{6}\b/gi) ?? []
}

function assertImportsAndRenders(source, component, label) {
  const publicImports = [
    ...source.matchAll(
      /import\s*\{([\s\S]*?)\}\s*from\s*['"]@\/components\/(?:design-system|page-templates)(?:\/[^'"]*)?['"]/g
    ),
  ]
  assert.ok(
    publicImports.some((match) =>
      new RegExp(`\\b${component}\\b`).test(match[1])
    ),
    `${label} must import ${component} from the Studio public surface`
  )
  assert.ok(
    new RegExp(`<${component}\\b`).test(source),
    `${label} must render ${component}`
  )
}

test('the preview-token RED baseline is locked to the planned sixteen-file scope', () => {
  const sourceFiles = collectTsxFiles(previewRoot)
  const currentConsumers = sourceFiles
    .filter(({ source }) => source.includes('--preview-'))
    .map(({ relativePath }) => relativePath)
  const plannedConsumers = [...legacyPreviewTokenConsumers].sort()

  assert.equal(legacyPreviewTokenConsumers.length, 16)
  assert.equal(new Set(legacyPreviewTokenConsumers).size, 16)
  for (const relativePath of legacyPreviewTokenConsumers) {
    assert.ok(
      sourceFiles.some((file) => file.relativePath === relativePath),
      `${relativePath} must remain in the explicit migration inventory`
    )
  }

  assert.ok(
    currentConsumers.length === 0 ||
      JSON.stringify(currentConsumers) === JSON.stringify(plannedConsumers),
    `preview-token consumers must be either the exact RED inventory or fully migrated; found ${JSON.stringify(currentConsumers)}`
  )
})

test('the Solvook layout uses the Studio theme without inline preview tokens', () => {
  const layout = readRequiredFile(layoutUrl, 'the Solvook preview layout')

  assert.equal(
    /\bpreviewTokens\b/.test(layout),
    false,
    'the inline previewTokens object must be removed'
  )
  assert.equal(
    /style=\{[^}]*previewTokens[^}]*\}/.test(layout),
    false,
    'the preview shell must not receive the legacy inline style object'
  )
  assert.ok(
    /className=['"][^'"]*studio-theme/.test(layout),
    'the preview shell must enter the Studio theme'
  )
})

test('no Solvook TSX file defines or references a legacy preview token', () => {
  const violations = collectTsxFiles(previewRoot).flatMap(
    ({ relativePath, source }) =>
      [...source.matchAll(/--preview-[\w-]+/g)].map((match) => ({
        file: relativePath,
        token: match[0],
      }))
  )

  const summary = violations.reduce((files, violation) => {
    const tokens = files.get(violation.file) ?? new Set()
    tokens.add(violation.token)
    files.set(violation.file, tokens)
    return files
  }, new Map())

  assert.equal(
    violations.length,
    0,
    `all --preview-* definitions and references must migrate to Studio semantics; remaining ${JSON.stringify(
      [...summary].map(([file, tokens]) => [file, [...tokens].sort()])
    )}`
  )
})

test('Studio core hex values do not leak into Solvook consumers outside the exact cover palette allowlist', () => {
  const sourceFiles = collectTsxFiles(previewRoot)
  const materialCover = sourceFiles.find(
    ({ relativePath }) => relativePath === materialCoverPath
  )
  assert.ok(materialCover, 'the allowlisted MaterialCover source must exist')
  assert.deepEqual(
    [...new Set(extractHexValues(materialCover.source).map((hex) => hex.toLowerCase()))].sort(),
    [...materialCoverPalette].sort(),
    'the decorative MaterialCover allowlist must remain exact'
  )

  const allowedCoverValues = new Set(materialCoverPalette)
  const violations = sourceFiles.flatMap(({ relativePath, source }) =>
    extractHexValues(source)
      .map((hex) => hex.toLowerCase())
      .filter((hex) => studioCoreHexValues.has(hex))
      .filter(
        (hex) =>
          relativePath !== materialCoverPath || !allowedCoverValues.has(hex)
      )
      .map((hex) => ({ file: relativePath, hex }))
  )

  const summary = violations.reduce((files, violation) => {
    const values = files.get(violation.file) ?? new Set()
    values.add(violation.hex)
    files.set(violation.file, values)
    return files
  }, new Map())

  assert.equal(
    violations.length,
    0,
    `Studio core colors must be consumed through semantic tokens or variants; remaining ${JSON.stringify(
      [...summary].map(([file, values]) => [file, [...values].sort()])
    )}`
  )
})

test('home, board, and detail use their canonical Studio page frames', () => {
  assertImportsAndRenders(
    readRequiredFile(homePageUrl, 'the Solvook home route'),
    'StudioLandingPageFrame',
    'the Solvook home route'
  )
  assertImportsAndRenders(
    readRequiredFile(boardControllerUrl, 'the Solvook board controller'),
    'StudioBoardPageFrame',
    'the Solvook board controller'
  )
  assertImportsAndRenders(
    readRequiredFile(materialDetailUrl, 'the Solvook material detail'),
    'StudioDetailPageFrame',
    'the Solvook material detail'
  )
})

test('the board uses the canonical Studio filter, result, pagination, empty, and Select patterns', () => {
  const boardController = readRequiredFile(
    boardControllerUrl,
    'the Solvook board controller'
  )

  for (const component of [
    'StudioSelectContent',
    'StudioFilterPanel',
    'StudioBoardShell',
    'StudioPagination',
    'StudioEmptyState',
  ]) {
    assertImportsAndRenders(
      boardController,
      component,
      'the Solvook board controller'
    )
  }
  assert.doesNotMatch(
    boardController,
    /<SelectContent\b/,
    'all Solvook board Select portals must use StudioSelectContent'
  )
})

test('both Solvook sample dialogs use the Studio portal-safe Dialog content', () => {
  for (const [url, label] of [
    [boardDialogUrl, 'the board sample dialog'],
    [detailDialogUrl, 'the detail sample dialog'],
  ]) {
    const source = readRequiredFile(url, label)
    assertImportsAndRenders(source, 'StudioDialogContent', label)
    assert.doesNotMatch(source, /<DialogContent\b/)
  }
})

test('the existing Solvook route, representative data, and single main ownership stay intact', () => {
  for (const [url, label] of [
    [homePageUrl, 'the Solvook home route'],
    [boardPageUrl, 'the Solvook board route'],
    [detailPageUrl, 'the Solvook detail route'],
  ]) {
    assert.equal(existsSync(url), true, `${label} must exist`)
  }

  const sampleData = JSON.parse(
    readRequiredFile(sampleDataUrl, 'the Solvook sample data')
  )
  const representativePost = sampleData.posts?.find(
    (post) =>
      post.id === 'jingsori-2027' && post.boardSlug === 'ebs-literature'
  )
  assert.equal(sampleData.posts?.length, 12)
  assert.ok(representativePost, 'the representative post must remain present')
  assert.equal(representativePost.passages?.length, 1)
  assert.equal(representativePost.questions?.length, 7)

  const layout = readRequiredFile(layoutUrl, 'the Solvook preview layout')
  assert.equal(layout.match(/<main\b/g)?.length ?? 0, 1)
  for (const routeUrl of [homePageUrl, boardPageUrl, detailPageUrl]) {
    assert.equal(
      readRequiredFile(routeUrl, 'a Solvook route').match(/<main\b/g)?.length ?? 0,
      0
    )
  }
})

test('the market pilot adopts the canonical Studio board composition without moving domain behavior', () => {
  const server = readRequiredFile(
    marketListboardServerUrl,
    'the market listboard server component'
  )
  const client = readRequiredFile(
    marketListboardClientUrl,
    'the market listboard client component'
  )

  for (const component of [
    'StudioBoardPageFrame',
    'StudioPageHeader',
    'StudioFilterPanel',
    'StudioBoardShell',
  ]) {
    assertImportsAndRenders(server, component, 'the market listboard server component')
  }

  for (const component of ['StudioPagination', 'StudioEmptyState']) {
    assertImportsAndRenders(client, component, 'the market listboard client component')
  }

  assert.match(server, /<MarketListboardClient\b/)
  assert.match(client, /MarketSamplePreviewDialog/)
  assert.match(client, /const prefetchSamplePreview = \(itemId: string\) => \{/)
  assert.match(client, /const openSamplePreview = \(itemId: string, trigger: HTMLButtonElement\) => \{/)
  assert.match(
    client,
    /const href = `\/market\/\$\{categorySlug\}\/items\/\$\{row\.itemId\}`/
  )
  assert.doesNotMatch(
    `${server}\n${client}`,
    /MarketItemActions|CreditConfirmationDialog|market-item-actions|createClient|supabase|fetch\s*\(|\/api\/market\//,
    'Studio adoption must remain appearance-only and leave detail, purchase, database, and API behavior outside the pilot'
  )
})
