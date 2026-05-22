import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const itemPage = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx', import.meta.url),
  'utf8'
)
const itemActions = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
  'utf8'
)

test('market item detail keeps a consistent product header and meta layout', () => {
  assert.match(itemPage, /<Card className="overflow-hidden border-slate-200 pt-0">/)
  assert.match(itemPage, /bg-gradient-to-br from-slate-950/)
  assert.match(itemPage, /샘플 제공/)
  assert.match(itemPage, /구매 완료 \{ownedCount\}건/)
  assert.match(itemPage, /MetaSummaryItem/)
  assert.match(itemPage, /lg:sticky lg:top-24/)
})

test('market item detail consolidates sample preview pdf hwp into one file option panel', () => {
  assert.match(itemPage, /파일 선택/)
  assert.match(itemPage, /샘플을 확인한 뒤 필요한 파일만 구매하세요/)
  assert.match(itemActions, /function FileOptionRow/)
  assert.match(itemActions, /샘플 미리보기/)
  assert.match(itemActions, /1~3페이지 JPG/)
  assert.match(itemActions, /PDF 구매하기/)
  assert.match(itemActions, /HWP & PDF 구매하기/)
  assert.match(itemActions, /영어 라이브러리 &gt; 구매자료/)
})

test('market item detail action states and failure messages are explicit', () => {
  assert.match(itemActions, /OptionState = 'instant' \| 'owned' \| 'available' \| 'unavailable' \| 'checking' \| 'processing'/)
  assert.match(itemActions, /status === 401/)
  assert.match(itemActions, /status === 402/)
  assert.match(itemActions, /status === 409/)
  assert.match(itemActions, /status >= 500/)
})

test('market item downloads preserve existing paid file API URLs', () => {
  assert.match(itemActions, /\/api\/market\/items\/\$\{itemId\}\/download\?assetKind=\$\{assetKind\}/)
  assert.doesNotMatch(itemActions, /buildDownloadUrl\(itemId, 'sample'\)/)
  assert.match(itemActions, /\/api\/market\/items\/\$\{itemId\}\/purchase/)
})

test('market item sample preview prefetch intent is wired only for eligible users', () => {
  assert.match(itemActions, /onIntent\?: \(\) => void/)
  assert.match(itemActions, /onFocus=\{onIntent\}/)
  assert.match(itemActions, /onMouseEnter=\{onIntent\}/)
  assert.match(itemActions, /onTouchStart=\{onIntent\}/)
  assert.match(itemActions, /const \[samplePreviewPrefetchKey, setSamplePreviewPrefetchKey\] = useState\(0\)/)
  assert.match(itemActions, /const prefetchSamplePreview = \(\) => \{/)
  assert.match(itemActions, /!isLoggedIn \|\| !hasSamplePages/)
  assert.match(itemActions, /setSamplePreviewPrefetchKey\(\(value\) => value \+ 1\)/)
  assert.match(itemActions, /onIntent=\{hasSamplePages \? prefetchSamplePreview : undefined\}/)
  assert.match(itemActions, /prefetchKey=\{samplePreviewPrefetchKey\}/)
})
