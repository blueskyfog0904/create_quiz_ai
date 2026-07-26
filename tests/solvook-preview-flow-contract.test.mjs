import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const previewRoot = new URL('../src/app/preview/solvook-concept/', import.meta.url)
const homePagePath = new URL('page.tsx', previewRoot)
const boardPagePath = new URL('boards/[slug]/page.tsx', previewRoot)
const detailPagePath = new URL('boards/[slug]/posts/[postId]/page.tsx', previewRoot)
const previewLayoutPath = new URL('layout.tsx', previewRoot)
const previewHeaderPath = new URL('_components/preview-header.tsx', previewRoot)
const previewFooterPath = new URL('_components/preview-footer.tsx', previewRoot)
const sampleDataPath = new URL('_data/sample-data.json', previewRoot)
const sampleDataModulePath = new URL('_data/sample-data.ts', previewRoot)
const pathAwareChromePath = new URL(
  '../src/components/layout/path-aware-site-chrome.tsx',
  import.meta.url
)
const rootTemplatePath = new URL('../src/app/template.tsx', import.meta.url)
const scholarlyPreviewPath = new URL(
  '../src/app/preview/scholarly-library/page.tsx',
  import.meta.url
)
const brandMarkPath = new URL(
  '../public/preview/solvook-concept/brand-mark.svg',
  import.meta.url
)

function assertFileExists(file, label) {
  assert.ok(existsSync(file), `${label} should exist at ${file.pathname}`)
}

function readUtf8(file, label) {
  assertFileExists(file, label)
  return readFileSync(file, 'utf8')
}

function readSampleData() {
  const source = readUtf8(sampleDataPath, 'sample data')
  const data = JSON.parse(source)
  assert.ok(data && typeof data === 'object', 'sample data should be an object')
  return data
}

function getBoards(data) {
  if (Array.isArray(data.boards)) return data.boards
  return data.board ? [data.board] : []
}

function getRepresentativePost(data) {
  const post = data.posts?.find(
    (candidate) =>
      candidate.id === 'jingsori-2027' &&
      candidate.boardSlug === 'ebs-literature'
  )
  assert.ok(post, 'representative post jingsori-2027 should exist')
  return post
}

function collectSourceFiles(directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) return collectSourceFiles(entryUrl)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryUrl] : []
  })
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0
}

test('the home, board, and detail route files exist', () => {
  assertFileExists(homePagePath, 'preview home route')
  assertFileExists(boardPagePath, 'preview board route')
  assertFileExists(detailPagePath, 'preview detail route')
})

test('the preview layout and shared preview header and footer exist', () => {
  assertFileExists(previewLayoutPath, 'preview layout')
  assertFileExists(previewHeaderPath, 'preview header')
  assertFileExists(previewFooterPath, 'preview footer')
})

test('the shared preview chrome opts into the reference gutter without changing board content gutters', () => {
  const header = readUtf8(previewHeaderPath, 'preview header')
  const footer = readUtf8(previewFooterPath, 'preview footer')

  assert.match(header, /<header className="[^"]*studio-reference-gutter[^"]*"/)
  assert.match(footer, /<footer className="[^"]*studio-reference-gutter[^"]*"/)
})

test('sample data contains the representative board slug and post id', () => {
  const data = readSampleData()
  assert.ok(
    getBoards(data).some((board) => board.slug === 'ebs-literature'),
    'representative board ebs-literature should exist'
  )
  getRepresentativePost(data)
})

test('the representative post owns exactly one passage', () => {
  const post = getRepresentativePost(readSampleData())
  assert.equal(post.passages?.length, 1)
})

test('the representative post owns exactly seven questions', () => {
  const post = getRepresentativePost(readSampleData())
  assert.equal(post.questions?.length, 7)
})

test('the representative passage segment labels are exactly A, B, and C', () => {
  const post = getRepresentativePost(readSampleData())
  assert.deepEqual(
    post.passages[0].segments.map((segment) => segment.label),
    ['A', 'B', 'C']
  )
})

test('every question references a passage owned by its post', () => {
  const { posts } = readSampleData()
  assert.ok(Array.isArray(posts) && posts.length > 0, 'posts should be non-empty')

  for (const post of posts) {
    const passageIds = new Set(post.passages.map((passage) => passage.id))
    for (const question of post.questions) {
      assert.ok(
        passageIds.has(question.passageId),
        `${post.id}/${question.id} should reference an owned passage`
      )
    }
  }
})

test('every question segment reference names a segment owned by its passage', () => {
  const { posts } = readSampleData()
  assert.ok(Array.isArray(posts) && posts.length > 0, 'posts should be non-empty')

  for (const post of posts) {
    const passages = new Map(
      post.passages.map((passage) => [
        passage.id,
        new Set(passage.segments.map((segment) => segment.label)),
      ])
    )

    for (const question of post.questions) {
      const labels = passages.get(question.passageId)
      assert.ok(labels, `${post.id}/${question.id} should reference an owned passage`)
      for (const segmentRef of question.segmentRefs) {
        assert.ok(
          labels.has(segmentRef),
          `${post.id}/${question.id} should reference an owned segment`
        )
      }
    }
  }
})

test('passage and question counts are derived from arrays instead of stored in JSON', () => {
  const data = readSampleData()
  const dataModule = readUtf8(sampleDataModulePath, 'sample data module')

  for (const post of data.posts) {
    assert.equal(
      Object.hasOwn(post, 'passageCount'),
      false,
      `${post.id} should not store passageCount`
    )
    assert.equal(
      Object.hasOwn(post, 'questionCount'),
      false,
      `${post.id} should not store questionCount`
    )
  }

  assert.match(dataModule, /\.passages\.length/)
  assert.match(dataModule, /\.questions\.length/)
})

test('sample data contains exactly twelve posts', () => {
  const { posts } = readSampleData()
  assert.equal(posts?.length, 12)
})

test('year, textbook, work type, and grade each have at least two values', () => {
  const { posts } = readSampleData()

  for (const field of ['year', 'textbook', 'workType', 'grade']) {
    assert.ok(
      new Set(posts.map((post) => post[field])).size >= 2,
      `${field} should contain at least two distinct values`
    )
  }
})

test('published date, view count, and question count can produce distinct sorts', () => {
  const { posts } = readSampleData()
  assert.ok(new Set(posts.map((post) => post.publishedAt)).size >= 2)
  assert.ok(new Set(posts.map((post) => post.viewCount)).size >= 2)
  assert.ok(new Set(posts.map((post) => post.questions.length)).size >= 2)
})

test('at least one post explicitly has no sample', () => {
  const { posts } = readSampleData()
  assert.ok(posts.some((post) => post.hasSample === false))
})

test('the fixed positive and zero-result multi-filter cases are deterministic', () => {
  const data = readSampleData()
  const expectedCases = {
    'positive-multi-filter': {
      year: '2027',
      textbook: 'EBS 수능특강',
      workType: '현대 소설',
      grade: '고3',
    },
    'zero-result-multi-filter': {
      year: '2026',
      textbook: 'EBS 수능특강',
      workType: '고전 시가',
      grade: '고1',
    },
  }

  for (const [id, expected] of Object.entries(expectedCases)) {
    const filterCase = data.filterCases?.find((candidate) => candidate.id === id)
    assert.ok(filterCase, `${id} should exist`)
    assert.deepEqual(
      {
        year: filterCase.year,
        textbook: filterCase.textbook,
        workType: filterCase.workType,
        grade: filterCase.grade,
      },
      expected
    )

    const results = data.posts.filter((post) =>
      Object.entries(expected).every(([field, value]) => post[field] === value)
    )
    assert.equal(
      results.length > 0,
      id === 'positive-multi-filter',
      `${id} should have the planned result shape`
    )
  }
})

test('pagination supports page sizes five and ten and defaults to five', () => {
  const { pagination } = readSampleData()
  assert.deepEqual(pagination?.pageSizes, [5, 10])
  assert.equal(pagination?.defaultPageSize, 5)
})

test('the detail route calls notFound for invalid board slugs or post ids', () => {
  const detailPage = readUtf8(detailPagePath, 'preview detail route')

  assert.match(detailPage, /import\s*\{\s*notFound\s*\}\s*from\s*['"]next\/navigation['"]/)
  assert.match(detailPage, /\bslug\b/)
  assert.match(detailPage, /\bpostId\b/)
  assert.match(detailPage, /\bboard\b/)
  assert.match(detailPage, /\bpost\b/)
  assert.ok(
    countMatches(detailPage, /\bnotFound\(\)/g) >= 1,
    'invalid board or post lookup should call notFound()'
  )
  assert.match(
    detailPage,
    /if\s*\([\s\S]{0,240}(?:!board|!post)[\s\S]{0,240}\)\s*(?:\{[\s\S]{0,80})?notFound\(\)/
  )
})

test('preview source has no direct Supabase, purchase, or credit API dependency', () => {
  const sourceFiles = collectSourceFiles(previewRoot)
  assert.ok(sourceFiles.length > 0, 'preview source files should exist')

  for (const sourceFile of sourceFiles) {
    const source = readFileSync(sourceFile, 'utf8')
    assert.doesNotMatch(source, /from\s+['"][^'"]*supabase[^'"]*['"]/i)
    assert.doesNotMatch(source, /\bcreateClient\s*\(/)
    assert.doesNotMatch(source, /['"`]\/api\/(?:market|credits?)(?:\/|['"`])/i)
    assert.doesNotMatch(
      source,
      /from\s+['"]@\/lib\/(?:market(?:-|\/)|credits?(?:-|\/))[^'"]*['"]/i
    )
  }
})

test('the preview header matches the requested Solvook navigation scope', () => {
  const header = readUtf8(previewHeaderPath, 'preview header')

  assert.match(header, />카테고리</)
  assert.match(header, />영어</)
  assert.match(header, />국어</)
  assert.match(header, /\/login\?next=/)
  assert.match(header, /\/signup\?next=/)
  assert.match(header, /href="\/pricing"/)
  assert.match(header, />캐시 충전</)
  assert.doesNotMatch(header, /선생님/)
  assert.doesNotMatch(header, /학생/)
  assert.doesNotMatch(header, /AI 문제생성/)
  assert.doesNotMatch(header, /문제은행/)
  assert.doesNotMatch(header, /라이브러리/)
})

test('path-aware chrome excludes only the exact Solvook concept preview subtree', () => {
  const rootTemplate = readUtf8(rootTemplatePath, 'root template')
  const pathAwareChrome = readUtf8(pathAwareChromePath, 'path-aware site chrome')

  assert.match(rootTemplate, /PathAwareSiteChrome/)
  assert.match(
    pathAwareChrome,
    /export\s+function\s+isSolvookConceptPreviewPath/
  )
  assert.match(pathAwareChrome, /['"]\/preview\/solvook-concept['"]/)
  assert.doesNotMatch(
    pathAwareChrome,
    /startsWith\(\s*['"]\/preview\/?['"]\s*\)/
  )
  assert.doesNotMatch(pathAwareChrome, /scholarly-library/)
})

test('a similar preview prefix is not classified as the Solvook concept preview', () => {
  const pathAwareChrome = readUtf8(pathAwareChromePath, 'path-aware site chrome')

  const hasExactRootCheck =
    /pathname\s*===\s*(?:[A-Za-z_$][\w$]*|['"]\/preview\/solvook-concept['"])/.test(
      pathAwareChrome
    )
  const hasSegmentBoundaryCheck =
    /pathname\.startsWith\(\s*(?:`\$\{[A-Za-z_$][\w$]*\}\/`|['"]\/preview\/solvook-concept\/['"])\s*\)/.test(
      pathAwareChrome
    )

  assert.ok(
    hasExactRootCheck && hasSegmentBoundaryCheck,
    'preview matching should require the exact root or the root followed by a slash'
  )
  assert.doesNotMatch(
    pathAwareChrome,
    /pathname\.startsWith\(\s*[A-Za-z_$][\w$]*\s*\)/
  )
})

test('normal and preview shells each have exactly one main owner', () => {
  const rootTemplate = readUtf8(rootTemplatePath, 'root template')
  const pathAwareChrome = readUtf8(pathAwareChromePath, 'path-aware site chrome')
  const previewLayout = readUtf8(previewLayoutPath, 'preview layout')

  assert.equal(countMatches(rootTemplate, /<main\b/g), 0)
  assert.equal(countMatches(pathAwareChrome, /<main\b/g), 1)
  assert.equal(countMatches(previewLayout, /<main\b/g), 1)
  assert.equal(countMatches(rootTemplate, /<Header\b/g), 1)
  assert.equal(countMatches(rootTemplate, /<Footer\b/g), 1)
  assert.equal(countMatches(pathAwareChrome, /\{header\}/g), 1)
  assert.equal(countMatches(pathAwareChrome, /\{footer\}/g), 1)
  assert.equal(countMatches(previewLayout, /<PreviewHeader\b/g), 1)
  assert.equal(countMatches(previewLayout, /<PreviewFooter\b/g), 1)
})

test('the existing scholarly library preview remains present', () => {
  assertFileExists(scholarlyPreviewPath, 'scholarly library preview')
})

test('the preview uses an original local SVG brand mark', () => {
  const brandMark = readUtf8(brandMarkPath, 'preview brand mark')
  assert.match(brandMark, /<svg\b/)
  assert.doesNotMatch(brandMark, /solvook/i)
})
