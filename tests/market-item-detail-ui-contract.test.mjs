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
  assert.match(itemPage, /getWorkspaceSubjectTheme/)
  assert.match(itemPage, /const subjectTheme = getWorkspaceSubjectTheme\(item\.workspace_subject\)/)
  assert.match(itemPage, /\$\{subjectTheme\.marketHeroClass\}/)
  assert.doesNotMatch(itemPage, /\$\{subjectTheme\.marketHeroMutedTextClass\}/)
  assert.doesNotMatch(itemPage, /bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800/)
  assert.doesNotMatch(itemPage, /<span>문제마켓<\/span>/)
  assert.doesNotMatch(itemPage, /<WorkspaceLink className="hover:text-white" href=\{`\/market\/\$\{category\.slug\}`\}>/)
  assert.doesNotMatch(itemPage, /item\.summary \|\| '샘플을 확인한 뒤 필요한 자료 파일을 선택해 구매할 수 있습니다\.'/)
  assert.doesNotMatch(itemPage, /샘플 제공/)
  assert.doesNotMatch(itemPage, /구매 완료 \{ownedCount\}건/)
  assert.doesNotMatch(itemPage, /<Badge/)
  assert.doesNotMatch(itemPage, /PDF\/HWP 자료/)
  assert.match(itemPage, /MetaSummaryItem/)
  assert.match(itemPage, /lg:sticky lg:top-24/)
})


test('market item detail shows one full-width material information card', () => {
  assert.match(itemPage, /자료 정보/)
  assert.match(itemPage, /과목/)
  assert.match(itemPage, /학년/)
  assert.match(itemPage, /출처/)
  assert.match(itemPage, /자료유형/)
  assert.match(itemPage, /문항 수/)
  assert.match(itemPage, /등록일자/)
  assert.match(itemPage, /const materialInfoRows = \[/)
  assert.match(itemPage, /resolveWorkspaceSubjectLabel\(item\.workspace_subject\)/)
  assert.match(itemPage, /formatSourcesLabel\(sources\)/)
  assert.match(itemPage, /resolveQuestionCountLabel\(item\)/)
  assert.match(itemPage, /item\.question_count/)
  assert.match(itemPage, /item\.source_type \|\| category\.title \|\| '-'/)
  assert.match(itemPage, /formatDate\(item\.created_at\)/)
  assert.match(itemPage, /space-y-5 rounded-2xl bg-white/)
  assert.match(itemPage, /rounded-2xl bg-slate-50 px-5 py-5/)
  assert.match(itemPage, /grid gap-x-10 gap-y-5 md:grid-cols-2/)
  assert.match(itemPage, /min-w-\[72px\] text-gray-500/)
  assert.match(itemPage, /whitespace-pre-line/)
  assert.doesNotMatch(itemPage, /grid gap-3 sm:grid-cols-2 md:grid-cols-3/)
  assert.doesNotMatch(itemPage, /rounded-xl border bg-white px-3 py-3/)
  assert.doesNotMatch(itemPage, /grid gap-4 md:grid-cols-2/)
  assert.doesNotMatch(itemPage, /시험 정보/)
  assert.doesNotMatch(itemPage, /시험 회차/)
  assert.doesNotMatch(itemPage, /출제 타입/)
  assert.doesNotMatch(itemPage, /보유 상태/)
  assert.doesNotMatch(itemPage, /등록된 출처 정보가 없습니다\./)
  assert.doesNotMatch(itemPage, /CardTitle className="text-lg">상세 설명/)
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

test('market item detail hides unavailable paid file rows', () => {
  assert.match(itemActions, /\{\(hasPdf \|\| ownsPdf\) \? \(/)
  assert.match(itemActions, /\{\(hasHwp \|\| ownsHwp\) \? \(/)
  assert.match(itemActions, /\{\(hasZip \|\| ownsZip\) \? \(/)
  assert.doesNotMatch(itemActions, /PDF 없음/)
  assert.doesNotMatch(itemActions, /HWP & PDF 없음/)
  assert.doesNotMatch(itemActions, /ZIP 없음/)
  assert.doesNotMatch(itemActions, /priceLabel=\{hasPdf \? `\$\{formatCredits\(pdfPrice\)\} 크레딧` : '미제공'\}/)
  assert.doesNotMatch(itemActions, /priceLabel=\{hasHwp \? `\$\{formatCredits\(hwpPrice\)\} 크레딧` : '미제공'\}/)
  assert.doesNotMatch(itemActions, /priceLabel=\{hasZip \? `\$\{formatCredits\(zipPrice\)\} 크레딧` : '미제공'\}/)
})


test('market item purchase success uses a centered confirmation dialog instead of a toast', () => {
  assert.match(itemActions, /MarketPurchaseCompleteDialog/)
  assert.match(itemActions, /const \[purchaseCompleteMessage, setPurchaseCompleteMessage\] = useState<string \| null>\(null\)/)
  assert.match(itemActions, /const fallbackMessage = pendingV2PurchaseIntent/)
  assert.match(itemActions, /setPurchaseCompleteMessage\(payload\.message \|\| fallbackMessage\)/)
  assert.doesNotMatch(itemActions, /toast\.success\(payload\.message/)
  assert.match(itemActions, /message=\{purchaseCompleteMessage\}/)
  assert.match(itemActions, /onClose=\{\(\) => setPurchaseCompleteMessage\(null\)\}/)
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
