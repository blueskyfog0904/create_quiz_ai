import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const boardControllerUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/board-list-controller.tsx',
  import.meta.url
)
const boardDialogUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/sample-preview-dialog.tsx',
  import.meta.url
)

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0
}

test('the board mounts one filter tree and delegates its live region to StudioBoardShell', () => {
  const source = readFileSync(boardControllerUrl, 'utf8')

  assert.equal(
    countMatches(source, /renderFilterPanel\(\s*['"]/g),
    1,
    'responsive styling must not mount separate mobile and desktop filter forms'
  )
  assert.match(source, /renderFilterPanel\(\s*['"]board-title-search['"]\s*\)/)
  assert.doesNotMatch(
    source,
    /aria-live=/,
    'StudioBoardShell must be the only owner of the result live region'
  )
})

test('the board owns one controlled sample dialog outside responsive result slots', () => {
  const source = readFileSync(boardControllerUrl, 'utf8')

  assert.equal(
    countMatches(source, /<SamplePreviewDialog\b/g),
    1,
    'desktop and mobile rows must share one dialog instance'
  )
  assert.match(source, /useState<SampleMaterialPost\s*\|\s*null>\(null\)/)
  assert.match(source, /useState\(false\)/)
  assert.match(
    source,
    /useRef<HTMLButtonElement\s*\|\s*null>\(null\)/
  )
  assert.ok(
    countMatches(source, /onClick=\{\(event\) => openSampleDialog\(event, post\)\}/g) >=
      2,
    'both desktop and mobile sample actions must capture their trigger'
  )
  assert.match(source, /sampleTriggerRef\.current\s*=\s*event\.currentTarget/)
  assert.match(source, /setSelectedSamplePost\(post\)[\s\S]*setSampleDialogOpen\(true\)/)
  assert.match(source, /<SamplePreviewDialog[\s\S]*?open=\{sampleDialogOpen\}/)
  assert.match(source, /<SamplePreviewDialog[\s\S]*?onOpenChange=/)
  assert.match(
    source,
    /<SamplePreviewDialog[\s\S]*?returnFocusRef=\{sampleTriggerRef\}/
  )
  assert.match(source, /handleSampleDialogOpenChange[\s\S]*setSampleDialogOpen\(open\)/)
  assert.doesNotMatch(
    source,
    /handleSampleDialogOpenChange[\s\S]{0,180}setSelectedSamplePost\(null\)/,
    'closing must keep the selected post mounted for exit and focus restoration'
  )

  const dialogPosition = source.indexOf('<SamplePreviewDialog')
  const responsiveSlotsPosition = source.indexOf('mobileResults=')
  assert.ok(
    dialogPosition > responsiveSlotsPosition,
    'the shared dialog must render after the responsive result slots'
  )
})

test('the mobile cards preserve the desktop row information without duplicating dialog state', () => {
  const source = readFileSync(boardControllerUrl, 'utf8')
  const mobileResultsStart = source.indexOf('mobileResults=')
  const paginationStart = source.indexOf('pagination={', mobileResultsStart)

  assert.ok(mobileResultsStart >= 0, 'the mobile result slot must exist')
  assert.ok(
    paginationStart > mobileResultsStart,
    'the pagination slot must follow the mobile result slot'
  )

  const mobileResults = source.slice(mobileResultsStart, paginationStart)
  const sharedRowFields = [
    'post.workType',
    'post.title',
    'post.authorLabel',
    'post.textbook',
    'post.year',
    'post.grade',
    'post.passages.length',
    'post.questions.length',
    'post.viewCount',
    'post.publishedAt',
  ]

  for (const field of sharedRowFields) {
    assert.ok(
      mobileResults.includes(field),
      `mobile cards must include the desktop row field ${field}`
    )
  }

  assert.equal(countMatches(source, /<SamplePreviewDialog\b/g), 1)
  assert.equal(
    countMatches(
      source,
      /const \[selectedSamplePost, setSelectedSamplePost\] =\s*useState/g
    ),
    1
  )
})

test('the board sample dialog supports controlled use without duplicating the shared close gutter', () => {
  const source = readFileSync(boardDialogUrl, 'utf8')

  assert.match(source, /trigger\?:\s*ReactElement/)
  assert.match(source, /open\?:\s*boolean/)
  assert.match(source, /onOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/)
  assert.match(source, /returnFocusRef\?:\s*RefObject<HTMLElement\s*\|\s*null>/)
  assert.match(source, /<Dialog\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}>/)
  assert.match(source, /\{trigger\s*\?\s*\(/)
  assert.match(
    source,
    /onCloseAutoFocus=\{handleCloseAutoFocus\}/
  )
  assert.match(
    source,
    /handleCloseAutoFocus[\s\S]*event\.preventDefault\(\)[\s\S]*returnFocusRef\.current\.focus\(\)/
  )
  assert.doesNotMatch(source, /\bpr-12\b/)
})

test('the board keeps its query, sort, pagination, detail route, and sample selection behavior local', () => {
  const source = readFileSync(boardControllerUrl, 'utf8')

  assert.match(
    source,
    /const supportedSorts = \['latest', 'views', 'questions'\] as const/
  )
  for (const key of ['q', 'year', 'textbook', 'workType', 'grade']) {
    assert.match(source, new RegExp(`searchParams\\.get\\('${key}'\\)`))
  }
  assert.match(source, /router\.replace\(query \? `\$\{pathname\}\?\$\{query\}` : pathname/)
  assert.match(source, /filteredPosts\.slice\(/)
  assert.match(source, /replaceQuery\(\{ page: page === 1 \? null : page \}\)/)
  assert.match(source, /const detailHref = `\$\{pathname\}\/posts\/\$\{post\.id\}`/)
  assert.match(source, /onClick=\{\(event\) => openSampleDialog\(event, post\)\}/)
})
