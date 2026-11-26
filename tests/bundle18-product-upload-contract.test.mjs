import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyUploadEvent,
  createUploadEntries,
  describeUploadEntry,
  formatUploadLimitText,
  nextUploadEntry,
  summarizeUploads,
  updateUploadEntry,
} from '../src/lib/admin-upload-queue.ts'
import {
  CATEGORY_SEARCH_LIMIT,
  flattenCategoryPaths,
  parseRecentCategories,
  pushRecentCategory,
  searchCategoryPaths,
} from '../src/lib/admin-category-search.ts'
import { buildPublishChecks, isPublishBlockedByChecks, missingPublishChecks, PUBLISH_CHECK_TARGET_IDS } from '../src/lib/admin-market-publish-checks.ts'
import { buildSignedUploadUrl } from '../src/lib/admin-signed-upload.ts'
import { MARKET_ITEM_DUPLICATE_ERROR_MESSAGES, MARKET_ITEM_DUPLICATE_MODES, extractMarketItemDuplicateError } from '../src/lib/market-item-duplicate.ts'
import { readProductAdminFile, readProductAdminSource } from './helpers/product-admin-sources.mjs'

// 18번 2단계(상품 업로드 개선) 계약: 계획 docs/plan-bundle18-product-upload.md 6·7·8·11-2절.
const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/20261220100000_bundle18_product_duplicate.sql')
const DOWN = read('supabase/rollback/20261220100000_bundle18_product_duplicate_down.sql')
const ROUTE = read('src/app/api/admin/market/items/[id]/duplicate/route.ts')
const client = readProductAdminSource()
const sqlNoComments = (sql) => sql.replace(/--[^\n]*/g, '')
const MB = 1024 * 1024

// ── 공개 전 점검 ─────────────────────────────────────────────────────────────────────────────
// 1단계까지 편집 부품에 있던 식(옮기기 전 출력 스냅샷 — 같은 입력이면 key·label·done·required 가 같아야 한다)
function originalPublishChecks({ categoryItemId, title, subproducts, filesBySubproductId, bundleEnabled, bundlePrice, thumbnailImageId, defaultImage, samplePageCount }) {
  const activeSubproducts = subproducts.filter((subproduct) => subproduct.is_active)
  return [
    { key: 'category', label: '카테고리 선택', done: Boolean(categoryItemId), required: true },
    { key: 'title', label: '제목 입력', done: Boolean(title.trim()), required: true },
    { key: 'subproduct', label: '판매할 서브상품 1개 이상', done: activeSubproducts.length > 0, required: true },
    {
      key: 'files',
      label: '모든 서브상품에 파일 업로드',
      done: activeSubproducts.length > 0 && activeSubproducts.every((subproduct) => (filesBySubproductId.get(subproduct.id) || []).length > 0),
      required: true,
    },
    ...(bundleEnabled ? [{ key: 'bundle', label: '전체구매 가격 입력', done: bundlePrice > 0, required: true }] : []),
    { key: 'price', label: '서브상품 가격 입력(0 크레딧 없음)', done: activeSubproducts.length > 0 && activeSubproducts.every((subproduct) => subproduct.price_credits > 0), required: false },
    { key: 'image', label: '상품 이미지(없으면 카테고리 기본 이미지)', done: Boolean(thumbnailImageId || defaultImage), required: false },
    { key: 'sample', label: '샘플 이미지', done: samplePageCount > 0, required: false },
  ]
}

const SNAPSHOT_CASES = [
  { categoryItemId: '', title: '', subproducts: [], filesBySubproductId: new Map(), bundleEnabled: false, bundlePrice: 0, thumbnailImageId: null, defaultImage: null, samplePageCount: 0 },
  { categoryItemId: 'c1', title: ' 제목 ', subproducts: [{ id: 's1', is_active: true, price_credits: 0 }, { id: 's2', is_active: false, price_credits: 100 }],
    filesBySubproductId: new Map([['s1', [{}]]]), bundleEnabled: true, bundlePrice: 0, thumbnailImageId: null, defaultImage: { id: 'img' }, samplePageCount: 2 },
  { categoryItemId: 'c1', title: '제목', subproducts: [{ id: 's1', is_active: true, price_credits: 500 }, { id: 's3', is_active: true, price_credits: 700 }],
    filesBySubproductId: new Map([['s1', [{}]]]), bundleEnabled: true, bundlePrice: 1000, thumbnailImageId: 'i1', defaultImage: null, samplePageCount: 0 },
]

function toInput(sample, extra = {}) {
  return {
    categorySelected: Boolean(sample.categoryItemId),
    categoryInactive: false,
    title: sample.title,
    subproducts: sample.subproducts.map((subproduct) => ({ id: subproduct.id, isActive: subproduct.is_active, priceCredits: subproduct.price_credits })),
    fileCounts: new Map([...sample.filesBySubproductId].map(([id, files]) => [id, files.length])),
    bundleEnabled: sample.bundleEnabled,
    bundlePriceCredits: sample.bundlePrice,
    hasImage: Boolean(sample.thumbnailImageId || sample.defaultImage),
    samplePageCount: sample.samplePageCount,
    isPublishedItem: false,
    hasUsageBasis: true,
    ...extra,
  }
}

test('공개 전 점검: 옮기기 전 식과 같은 입력이면 같은 출력(key·label·done·required), 필수 조건은 그대로', () => {
  const ORIGINAL_KEYS = ['category', 'title', 'subproduct', 'files', 'bundle', 'price', 'image', 'sample']
  for (const sample of SNAPSHOT_CASES) {
    const moved = buildPublishChecks(toInput(sample))
      .filter((check) => ORIGINAL_KEYS.includes(check.key))
      .map(({ key, label, done, required }) => ({ key, label, done, required }))
    assert.deepEqual(moved, originalPublishChecks(sample))
  }
})

test('공개 전 점검: 비활성 카테고리는 공개 전 필수·공개 상품은 경고, 이용 근거 미입력은 경고(공개를 막지 않음)', () => {
  const complete = SNAPSHOT_CASES[2]
  const ready = buildPublishChecks(toInput({ ...complete, filesBySubproductId: new Map([['s1', [{}]], ['s3', [{}]]]) }))
  assert.equal(isPublishBlockedByChecks(ready), false)

  const inactiveDraft = buildPublishChecks(toInput({ ...complete, filesBySubproductId: new Map([['s1', [{}]], ['s3', [{}]]]) }, { categoryInactive: true }))
  const inactiveCheck = inactiveDraft.find((check) => check.key === 'category_active')
  assert.equal(inactiveCheck.level, 'required')
  assert.equal(isPublishBlockedByChecks(inactiveDraft), true)

  const inactivePublished = buildPublishChecks(toInput({ ...complete, filesBySubproductId: new Map([['s1', [{}]], ['s3', [{}]]]) }, { categoryInactive: true, isPublishedItem: true }))
  assert.equal(inactivePublished.find((check) => check.key === 'category_active').level, 'warning')
  assert.equal(isPublishBlockedByChecks(inactivePublished), false)

  const noBasis = buildPublishChecks(toInput({ ...complete, filesBySubproductId: new Map([['s1', [{}]], ['s3', [{}]]]) }, { hasUsageBasis: false }))
  const basisCheck = noBasis.find((check) => check.key === 'origin_basis')
  assert.equal(basisCheck.done, false)
  assert.equal(basisCheck.level, 'warning')
  assert.equal(isPublishBlockedByChecks(noBasis), false)

  // 칩 순서: 필수 먼저, 그다음 경고
  const missing = missingPublishChecks(buildPublishChecks(toInput(SNAPSHOT_CASES[1], { hasUsageBasis: false })))
  const firstWarning = missing.findIndex((check) => check.level === 'warning')
  assert.ok(firstWarning > 0 && missing.slice(firstWarning).every((check) => check.level === 'warning'))
})

test('공개 전 점검: 모든 항목에 이동할 칸 id 가 있고, 화면에 같은 id 가 있다', () => {
  const all = buildPublishChecks(toInput(SNAPSHOT_CASES[1], { hasUsageBasis: false, categoryInactive: true }))
  for (const check of all) assert.ok(check.targetId, check.key)
  for (const targetId of Object.values(PUBLISH_CHECK_TARGET_IDS)) {
    const literal = new RegExp(`id="${targetId}"`)
    const constant = Object.entries(PUBLISH_CHECK_TARGET_IDS).find(([, value]) => value === targetId)[0]
    assert.ok(literal.test(client) || new RegExp(`id=\\{PUBLISH_CHECK_TARGET_IDS\\.${constant}\\}`).test(client), targetId)
  }
  // 칩: 필수 빨강·경고 노랑, 누르면 이동·초점(접힌 칸은 펼침)
  const panel = readProductAdminFile('_editor/publish-summary-panel.tsx')
  assert.match(panel, /onClick=\{\(\) => focusProductField\(check\.targetId\)\}/)
  assert.match(panel, /check\.level === 'required'\n\s+\? 'border-red-200 bg-red-50 text-red-700/)
  assert.match(panel, /: 'border-amber-200 bg-amber-50 text-amber-800/)
  const focus = readProductAdminFile('_lib/focus-field.ts')
  assert.match(focus, /parent instanceof HTMLDetailsElement && !parent\.open\) parent\.open = true/)
  assert.match(focus, /element\.focus\(\{ preventScroll: true \}\)/)
  // 단계 칩은 스크롤해도 위에 붙어 있다
  assert.match(client, /<nav aria-label="상품 등록 단계" className="sticky top-0/)
  // 근거 여부는 17번 근거 카드(관리자 route)가 알려 준 상품 id 집합으로만 본다(공용 select 에 표를 넣지 않음)
  assert.match(client, /hasUsageBasis: Boolean\(form\.id && usageBasisItemIds\.includes\(form\.id\)\)/)
  assert.match(read('src/app/(admin)/admin/market/products/market-item-usage-basis-card.tsx'), /onBasisChange\?\.\(itemId, Boolean\(payload\.data\.basis\)\)/)
})

// ── 카테고리 검색 ─────────────────────────────────────────────────────────────────────────────
const node = (id, title, children = [], isActive = true) => ({ id, title, isActive, children })
const TREE = [
  node('k', '국어', [
    node('k1', '고1 모의고사', [node('k1a', '3월'), node('k1b', '6월 Mock')]),
    node('k2', '수능 기출', [node('k2a', '2025 고1')], false),
  ]),
  node('e', 'English', [node('e1', '고1 Reading')]),
]

test('카테고리 검색: 전체 경로로 찾고 낱말 순서·대소문자·공백 무관, 비활성 조상, 빈 검색어는 빈 목록', () => {
  const paths = flattenCategoryPaths(TREE)
  assert.deepEqual(paths.map((entry) => entry.id), ['k', 'k1', 'k1a', 'k1b', 'k2', 'k2a', 'e', 'e1'])
  assert.equal(paths.find((entry) => entry.id === 'k1a').label, '국어 > 고1 모의고사 > 3월')
  assert.deepEqual(searchCategoryPaths(paths, '3월 국어').map((entry) => entry.id), ['k1a'])
  assert.deepEqual(searchCategoryPaths(paths, '  MOCK   6월 ').map((entry) => entry.id), ['k1b'])
  assert.deepEqual(searchCategoryPaths(paths, 'english reading').map((entry) => entry.id), ['e1'])
  // 비활성 칸·비활성 조상
  const inactive = searchCategoryPaths(paths, '2025')
  assert.deepEqual(inactive.map((entry) => [entry.id, entry.inactive]), [['k2a', true]])
  assert.equal(paths.find((entry) => entry.id === 'k1').inactive, false)
  // 맨 끝 칸 이름에 든 낱말이 많을수록 앞, 같으면 트리 순서
  assert.deepEqual(searchCategoryPaths(paths, '고1').map((entry) => entry.id), ['k1', 'k2a', 'e1', 'k1a', 'k1b'])
  assert.deepEqual(searchCategoryPaths(paths, ''), [])
  assert.deepEqual(searchCategoryPaths(paths, '   '), [])
})

test('카테고리 검색: 결과 상한 20, 최근 칩은 과목별 3개(앞에 넣고 중복 없음, 저장 값이 깨지면 빈 목록)', () => {
  const many = [node('root', '모음', Array.from({ length: 30 }, (_, index) => node(`n${index}`, `단원 ${index}`)))]
  assert.equal(CATEGORY_SEARCH_LIMIT, 20)
  assert.equal(searchCategoryPaths(flattenCategoryPaths(many), '단원').length, 20)
  assert.deepEqual(pushRecentCategory(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  assert.deepEqual(pushRecentCategory(['a', 'b', 'c'], 'd'), ['d', 'a', 'b'])
  assert.deepEqual(parseRecentCategories('not json'), [])
  assert.deepEqual(parseRecentCategories('["x", 1, "y", "z", "w"]'), ['x', 'y', 'z'])
  assert.deepEqual(parseRecentCategories(null), [])
  const field = readProductAdminFile('_editor/category-step.tsx')
  assert.match(field, /`admin-product-recent-categories:\$\{subject\}`/)
  assert.match(field, /role="combobox"/)
  assert.match(field, /event\.key === 'ArrowDown'[\s\S]+event\.key === 'ArrowUp'[\s\S]+event\.key === 'Enter'/)
  assert.match(field, /<summary className="[^"]*">목록에서 고르기<\/summary>/)
  assert.match(field, /\{entry\.inactive \? <span className="shrink-0 text-xs text-gray-400">비활성<\/span> : null\}/)
})

// ── 업로드 진행 ─────────────────────────────────────────────────────────────────────────────
const files = [{ name: 'a.pdf', size: 10 * MB }, { name: 'big.pdf', size: 51 * MB }, { name: 'c.exe', size: 1 * MB }, { name: 'd.hwp', size: 2 * MB }]
const makeEntries = () => createUploadEntries(files, {
  maxBytes: 50 * MB,
  resolveFileTypeId: (file) => (/\.(pdf|hwp)$/.test(file.name) ? file.name.split('.').at(-1) : null),
  makeId: (index) => `e${index}`,
})

test('업로드 상태 전이: 성공 / 50MB 초과·허용 형식 아님은 건너뜀 / 한 번에 1개씩', () => {
  let entries = makeEntries()
  assert.deepEqual(entries.map((entry) => entry.phase), ['waiting', 'skipped', 'skipped', 'waiting'])
  assert.equal(describeUploadEntry(entries[1], 50 * MB), '건너뜀(50MB 초과)')
  assert.equal(describeUploadEntry(entries[2], 50 * MB), '건너뜀(허용 형식 아님)')
  assert.equal(nextUploadEntry(entries).id, 'e0')
  entries = updateUploadEntry(entries, 'e0', { type: 'start' })
  assert.equal(nextUploadEntry(entries), null)
  entries = updateUploadEntry(entries, 'e0', { type: 'prepared', storagePath: 'k/a.pdf' })
  entries = updateUploadEntry(entries, 'e0', { type: 'progress', loaded: 5, total: 10 })
  assert.equal(entries[0].progress, 50)
  entries = updateUploadEntry(entries, 'e0', { type: 'progress', loaded: 10, total: 10 })
  assert.equal(entries[0].progress, 99)
  entries = updateUploadEntry(entries, 'e0', { type: 'uploaded' })
  entries = updateUploadEntry(entries, 'e0', { type: 'registered' })
  assert.equal(entries[0].phase, 'done')
  assert.equal(entries[0].progress, 100)
  assert.equal(nextUploadEntry(entries).id, 'e3')
  assert.equal(summarizeUploads(entries).text, '2개 중 1개 완료 · 건너뜀 2개')
  assert.equal(formatUploadLimitText(['PDF', 'HWP', 'ZIP', 'PDF'], 50 * MB), 'PDF·HWP·ZIP, 파일당 50MB까지')
})

test('업로드 상태 전이: 준비·올리기·등록 실패는 단계와 사유를 남기고, [다시 시도]는 그 파일만 준비부터(완료 파일은 다시 보내지 않음)', () => {
  const base = makeEntries()[0]
  const preparing = applyUploadEvent(base, { type: 'start' })
  const prepareFailed = applyUploadEvent(preparing, { type: 'fail', step: 'prepare', message: '준비 실패' })
  assert.deepEqual([prepareFailed.phase, prepareFailed.failedStep, prepareFailed.error], ['failed', 'prepare', '준비 실패'])
  const uploading = applyUploadEvent(preparing, { type: 'prepared', storagePath: 'k/a.pdf' })
  assert.equal(applyUploadEvent(uploading, { type: 'fail', step: 'upload', message: 'x' }).failedStep, 'upload')
  const registering = applyUploadEvent(uploading, { type: 'uploaded' })
  const completeFailed = applyUploadEvent(registering, { type: 'fail', step: 'complete', message: '등록 실패' })
  assert.equal(completeFailed.failedStep, 'complete')
  // 단계가 맞지 않는 실패는 무시
  assert.equal(applyUploadEvent(uploading, { type: 'fail', step: 'prepare', message: 'x' }), uploading)
  // 다시 시도: 실패 → 대기(진행률 0, 사유 지움). 완료·건너뜀은 그대로.
  const retried = applyUploadEvent(completeFailed, { type: 'retry' })
  assert.deepEqual([retried.phase, retried.progress, retried.failedStep, retried.error], ['waiting', 0, null, null])
  // 등록 실패의 다시 시도는 같은 경로로 등록부터(다시 올리지 않음), 서버에 파일이 없으면(restart) 준비부터
  assert.equal(retried.resumeFromComplete, true)
  const resumed = applyUploadEvent(retried, { type: 'start' })
  assert.deepEqual([resumed.phase, resumed.storagePath], ['registering', 'k/a.pdf'])
  const restarted = applyUploadEvent(resumed, { type: 'restart' })
  assert.deepEqual([restarted.phase, restarted.storagePath, restarted.resumeFromComplete], ['preparing', null, false])
  // 준비·올리기 실패의 다시 시도는 준비부터(경로를 버림)
  const uploadRetry = applyUploadEvent(applyUploadEvent(applyUploadEvent(uploading, { type: 'fail', step: 'upload', message: 'x' }), { type: 'retry' }), { type: 'start' })
  assert.deepEqual([uploadRetry.phase, uploadRetry.storagePath], ['preparing', null])
  const done = applyUploadEvent(applyUploadEvent(registering, { type: 'registered' }), { type: 'retry' })
  assert.equal(done.phase, 'done')
  const entries = [done, { ...completeFailed, id: 'e1' }]
  assert.equal(nextUploadEntry(entries), null)
  const afterRetry = updateUploadEntry(entries, 'e1', { type: 'retry' })
  assert.equal(afterRetry[0], done)
  assert.equal(nextUploadEntry(afterRetry).id, 'e1')
})

test('업로드 처리: 등록 다시 시도는 같은 경로로 complete 만(409 ALREADY_REGISTERED = 완료, UPLOAD_NOT_FOUND 면 준비부터), 처리 중에는 [다시 시도]·[빼기]를 막고, 행은 대기·진행이 없을 때만 닫는다', () => {
  const uploads = readProductAdminFile('_hooks/use-subproduct-uploads.ts')
  assert.match(uploads, /let storagePath = entry\.resumeFromComplete \? entry\.storagePath : null/)
  assert.match(uploads, /if \(\(response\.ok && payload\?\.success\) \|\| errorCode === 'ALREADY_REGISTERED'\) \{/)
  assert.match(uploads, /if \(errorCode === 'UPLOAD_NOT_FOUND' && attempt === 0 && entry\.resumeFromComplete\) \{\n\s+applyUploadQueueEvent\(draftId, entryId, \{ type: 'restart' \}\)/)
  assert.match(uploads, /if \(!summary\.active && summary\.failed === 0 && summary\.skipped === 0\) \{/)
  assert.match(uploads, /if \(drainingDraftIdsRef\.current\.has\(draftId\)\) return/)
  const list = readProductAdminFile('_editor/upload-queue-list.tsx')
  assert.equal((list.match(/disabled=\{busy\}/g) ?? []).length, 2)
  assert.match(readProductAdminFile('_editor/subproduct-table.tsx'), /busy=\{isUploading\}/)
  // 서버 complete 갈래가 이 두 코드를 그대로 돌려준다
  const filesRoute = read('src/app/api/admin/market/items/[id]/subproducts/[subproductId]/files/route.ts')
  assert.match(filesRoute, /code: 'ALREADY_REGISTERED'/)
  assert.match(filesRoute, /code: 'UPLOAD_NOT_FOUND'/)
})

test('카테고리 검색: 한글 입력기 조합 중 키는 고르기로 보지 않는다', () => {
  const field = readProductAdminFile('_editor/category-step.tsx')
  const handler = field.slice(field.indexOf('const handleKeyDown = '), field.indexOf("if (event.key === 'ArrowDown'"))
  assert.match(handler, /if \(event\.nativeEvent\.isComposing \|\| event\.keyCode === 229\) return/)
})

test('저장 뒤 창 [빈 새 상품]: 관리 화면은 등록 화면으로(과목 유지·카테고리 주소로), 등록 화면은 카테고리만 남은 빈 폼', () => {
  const duplicate = readProductAdminFile('_hooks/use-product-duplicate.ts')
  const blank = duplicate.slice(duplicate.indexOf('const handleStartBlankAfterSave = '))
  assert.match(blank, /if \(mode === 'manage'\) \{\n\s+const query = categoryItemId \? `\?categoryId=\$\{encodeURIComponent\(categoryItemId\)\}` : ''\n\s+router\.push\(withAdminWorkspaceSubject\(`\/admin\/market\/products\/new\$\{query\}`, workspaceSubject\)\)\n\s+return\n\s+\}\n\s+if \(form\.id\) resetForm\(categoryItemId\)/)
  const page = read('src/app/(admin)/admin/market/products/new/page.tsx')
  assert.match(page, /const initialCategoryItemId = requestedCategoryId && findCategoryPath\(categoryNodes, requestedCategoryId\) \? requestedCategoryId : ''/)
  assert.match(page, /initialCategoryItemId=\{initialCategoryItemId\}/)
  assert.match(readProductAdminFile('market-products-client.tsx'), /const \[categoryItemId, setCategoryItemId\] = useState\(initialCategoryItemId \?\? ''\)/)
})

test('업로드 화면: 파일마다 진행 막대·상태·[다시 시도]·[빼기], aria-live 요약, 놓는 칸 아래 허용 형식·상한(DB 파일 유형 목록)', () => {
  const list = readProductAdminFile('_editor/upload-queue-list.tsx')
  assert.match(list, /<p aria-live="polite"/)
  assert.match(list, /role="progressbar"/)
  assert.match(list, /다시 시도/)
  assert.match(list, /빼기/)
  const uploads = readProductAdminFile('_hooks/use-subproduct-uploads.ts')
  assert.match(uploads, /formatUploadLimitText\(activeFileTypes\.map\(\(fileType\) => fileType\.label\), MAX_MARKET_SUBPRODUCT_FILE_SIZE\)/)
  assert.match(uploads, /maxBytes: MAX_MARKET_SUBPRODUCT_FILE_SIZE/)
  // 판매 파일은 진행률을 받는 서명 업로드로(샘플 JPG 는 그대로 uploadToSignedUrl)
  assert.match(uploads, /await uploadFileToSignedUrl\(\{ bucket: target\.bucket, storagePath: target\.storagePath, token: target\.token \}, file,/)
  assert.doesNotMatch(uploads, /uploadToSignedUrl\(/)
  assert.match(readProductAdminFile('_editor/subproduct-table.tsx'), /<p className="text-xs text-gray-500">\{uploadLimitText\}<\/p>/)
})

test('진행률 업로드 요청 꼴 = 설치된 @supabase/storage-js uploadToSignedUrl(주소·x-upsert·FormData cacheControl·빈 이름 칸)', () => {
  const storageJs = read('node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.js')
  const upload = storageJs.slice(storageJs.indexOf('uploadToSignedUrl(path, token, fileBody, fileOptions) {'), storageJs.indexOf('createSignedUploadUrl(path, options) {'))
  assert.match(upload, /new URL\(this\.url \+ `\/object\/upload\/sign\/\$\{_path\}`\)/)
  assert.match(upload, /url\.searchParams\.set\('token', token\)/)
  assert.match(upload, /'x-upsert': String\(options\.upsert\)/)
  assert.match(upload, /body\.append\('cacheControl', options\.cacheControl\);\s+body\.append\('', fileBody\);/)
  assert.match(upload, /put\(this\.fetch, url\.toString\(\), body, \{ headers \}\)/)
  assert.match(storageJs, /cacheControl: '3600'/)
  assert.match(storageJs, /upsert: false/)
  const helper = read('src/lib/admin-signed-upload.ts')
  assert.match(helper, /request\.open\('PUT', buildSignedUploadUrl\(supabaseUrl, target\)\)/)
  assert.match(helper, /request\.setRequestHeader\('x-upsert', 'false'\)/)
  assert.match(helper, /body\.append\('cacheControl', DEFAULT_CACHE_CONTROL\)\n\s+body\.append\('', file\)/)
  assert.match(helper, /const DEFAULT_CACHE_CONTROL = '3600'/)
  assert.match(helper, /request\.upload\.onprogress = /)
  assert.equal(
    buildSignedUploadUrl('https://x.supabase.co/', { bucket: 'market-files', storagePath: '/korean//a/b.pdf', token: 't k' }),
    'https://x.supabase.co/storage/v1/object/upload/sign/market-files/korean/a/b.pdf?token=t+k'
  )
})

// ── DB 함수·route ──────────────────────────────────────────────────────────────────────────
test('마이그레이션: 함수 하나·SECURITY DEFINER·search_path·EXECUTE 회수 뒤 service_role 만, 표·트리거·정책 DDL 없음, BEGIN/COMMIT 없음', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.equal((sql.match(/CREATE (OR REPLACE )?FUNCTION/g) ?? []).length, 1)
  assert.match(sql, /CREATE FUNCTION public\.duplicate_market_item\(p_actor_id uuid, p_subject text, p_source_item_id uuid, p_mode text, p_request_meta jsonb\)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.duplicate_market_item\(uuid, text, uuid, text, jsonb\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.duplicate_market_item\(uuid, text, uuid, text, jsonb\) TO service_role;/)
  for (const forbidden of ['CREATE TABLE', 'ALTER TABLE', 'CREATE TRIGGER', 'CREATE POLICY', 'CREATE INDEX', 'DROP ', 'BEGIN;', 'COMMIT']) {
    assert.ok(!sql.includes(forbidden), forbidden)
  }
  assert.match(sql, /SET LOCAL lock_timeout = '3s';/)
  assert.match(sql, /md5\(pg_get_functiondef\(to_regprocedure\('public\.record_admin_audit\(uuid,text,text,text,uuid,integer,text,jsonb,text\)'\)\)\)\n\s+<> 'a42b474d9d95753ffba5041acb0c1c77'/)
  assert.match(sql, /IF NOT public\.market_catalog_actor_allowed\(p_actor_id\) THEN/)
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/)
})

test('복제 함수: 새 상품은 늘 임시저장·manual, 원본 FOR SHARE, 과목은 workspace_subject 로 대조, 파일 표에 쓰지 않음, 기록 1건', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.match(sql, /0, 0, 0, 'draft', 'manual', true, NULL, 0, 0,/)
  assert.doesNotMatch(sql, /'published'/)
  assert.match(sql, /SELECT \* INTO v_src FROM public\.market_items i WHERE i\.id = p_source_item_id FOR SHARE;/)
  assert.match(sql, /IF NOT FOUND OR v_src\.deleted_at IS NOT NULL OR v_src\.workspace_subject <> p_subject THEN\n\s+RAISE EXCEPTION 'MARKET_DUPLICATE_SOURCE_NOT_FOUND';/)
  assert.doesNotMatch(sql, /subject_code\s*<>|subject_code\s*=\s*p_subject/)
  assert.doesNotMatch(sql, /INSERT INTO public\.market_subproduct_files|INSERT INTO public\.market_item_sample_pages|INSERT INTO public\.market_item_usage_bases|storage\./)
  assert.match(sql, /IF p_mode IS NULL OR p_mode NOT IN \('next', 'copy'\) THEN/)
  assert.match(sql, /left\(v_src\.title, c_title_max - char_length\(c_copy_suffix\)\) \|\| c_copy_suffix/)
  assert.match(sql, /c_copy_suffix constant text := ' \(사본\)';/)
  assert.match(sql, /c_title_max constant integer := 120;/)
  assert.match(sql, /ROW_NUMBER\(\) OVER \(ORDER BY s\.sort_order, s\.created_at, s\.id\)/)
  assert.match(sql, /\(10 \* r\.rn\)::integer/)
  assert.match(sql, /AND s\.deleted_at IS NULL AND c\.deleted_at IS NULL/)
  assert.match(sql, /ORDER BY b\.is_active DESC, b\.updated_at DESC, b\.id\n\s+LIMIT 1;/)
  // 작업 기록: 종류 글자 꼴·details 키(리허설 D8 과 같은 목록)
  assert.match(sql, /PERFORM public\.record_admin_audit\(p_actor_id, 'market_item_duplicate', 'market_item', v_new_id::text, NULL, NULL, NULL,/)
  const details = sql.slice(sql.indexOf("'market_item_duplicate'"), sql.indexOf('RETURN jsonb_build_object'))
  const keys = [...details.matchAll(/'([a-z_]+)', /g)].map((match) => match[1]).filter((key) => key !== 'market_item_duplicate' && key !== 'market_item')
  assert.deepEqual([...keys].sort(), ['bundle_copied', 'mode', 'new_item_id', 'request', 'source_item_id', 'subproduct_count'])
})

test('오류 코드 목록 = market-item-duplicate.ts 매핑(마이그레이션 RAISE 코드와 같음), mode 두 값만', () => {
  const raised = new Set([...sqlNoComments(MIGRATION).matchAll(/RAISE EXCEPTION '(MARKET_[A-Z_]+)/g)].map((match) => match[1]))
  assert.deepEqual([...raised].sort(), Object.keys(MARKET_ITEM_DUPLICATE_ERROR_MESSAGES).sort())
  assert.equal(extractMarketItemDuplicateError('ERROR: MARKET_DUPLICATE_INPUT_INVALID:mode (P0001)'), 'MARKET_DUPLICATE_INPUT_INVALID')
  assert.equal(extractMarketItemDuplicateError('MARKET_OPTION_DUPLICATE'), null)
  assert.deepEqual([...MARKET_ITEM_DUPLICATE_MODES], ['next', 'copy'])
})

test('복제 route: products.edit, 과목은 주소에서 정해 DB 함수가 대조, mode 두 값만, 요청 정보 넘김, 공개 목록 캐시 갱신 없음', () => {
  assert.match(ROUTE, /const guard = await requireAdminApiPermission\('products\.edit'\)/)
  assert.match(ROUTE, /const DuplicateSchema = z\.object\(\{ mode: z\.enum\(MARKET_ITEM_DUPLICATE_MODES\) \}\)/)
  assert.match(ROUTE, /const subject = resolveAdminWorkspaceSubject\(new URL\(request\.url\)\.searchParams\.get\('subject'\)\)/)
  assert.match(ROUTE, /callDuplicateMarketItem\(guard\.access\.userId, subject, id, parsed\.data\.mode, adminRequestMeta\(request\)\)/)
  assert.doesNotMatch(ROUTE, /revalidateTag|revalidatePath|subject_code/)
  assert.deepEqual(ROUTE.match(/export async function \w+/g), ['export async function POST'])
  const server = read('src/lib/market-item-duplicate-server.ts')
  assert.match(server, /^import 'server-only'/)
  assert.match(server, /db\.rpc\('duplicate_market_item', \{\n\s+p_actor_id: actorId,\n\s+p_subject: subject,\n\s+p_source_item_id: sourceItemId,\n\s+p_mode: mode,\n\s+p_request_meta: requestMeta,/)
})

test('되돌리기: 함수만 지우고(사본 상품은 남김), 17번 down 은 이 함수가 있으면 멈춘다', () => {
  const down = sqlNoComments(DOWN)
  assert.match(down, /DROP FUNCTION public\.duplicate_market_item\(uuid, text, uuid, text, jsonb\);/)
  assert.equal((down.match(/DROP /g) ?? []).length, 1)
  assert.doesNotMatch(down, /DELETE FROM|UPDATE public\./)
  assert.match(read('supabase/rollback/20261219100000_bundle17_product_info_down.sql'), /v_later_functions text\[\] := ARRAY\['duplicate_market_item', 'reorder_market_item_subproducts'\];/)
})

test('리허설: 생성 파일이 원본과 같고(--check), 모두 BEGIN…ROLLBACK·COMMIT 없음, light 는 이력 표에 쓰지 않음, 시험 계정만', () => {
  execFileSync(process.execPath, [join(ROOT, 'supabase/scripts/bundle18_rehearsal/generate.mjs'), '--check'])
  for (const name of ['a_light.sql', 'b_full.sql']) {
    const sql = read(`supabase/scripts/bundle18_rehearsal/${name}`)
    assert.match(sql, /\nBEGIN;\n/)
    assert.ok(sql.trimEnd().endsWith('ROLLBACK;'), name)
    assert.doesNotMatch(sql, /\bCOMMIT\s*;/)
    assert.match(sql, /u\.email LIKE '%@test\.com'/)
  }
  const light = read('supabase/scripts/bundle18_rehearsal/a_light.sql')
  const lightBody = light.slice(light.indexOf('-- ===== 18번 마이그레이션'))
  assert.doesNotMatch(lightBody.replace(/--[^\n]*/g, ''), /supabase_migrations|ALTER TABLE|CREATE TRIGGER|LOCK TABLE/)
  for (const step of ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']) assert.match(light, new RegExp(`'${step}'`), step)
})

// ── 화면 흐름 ────────────────────────────────────────────────────────────────────────────────
test('저장 뒤 창: 새 상품·최종 등록·이 창 사본의 첫 저장에만(기존 상품 수정 저장 제외), resetForm 블록 밖에서 연다', () => {
  const form = readProductAdminFile('_hooks/use-product-form.ts')
  const save = form.slice(form.indexOf('const handleSave = async'), form.indexOf('const ensureDraftItemForUpload = async'))
  assert.match(save, /const isSessionCopy = sessionCopyItemIds\.includes\(form\.id\)/)
  assert.match(save, /if \(requiresFinalRegistration \|\| isSessionCopy\) \{\n\s+recordRegisteredItem\(result\)\n\s+\}\n\s+if \(requiresFinalRegistration\) \{\n\s+resetForm\(getItemCategoryItemId\(result\)\)\n\s+return\n\s+\}/)
  assert.match(save, /if \(createdItem\) \{\n\s+recordRegisteredItem\(createdItem\)\n\s+resetForm\(getItemCategoryItemId\(createdItem\)\)/)
  assert.match(form, /setAfterSaveItem\(entry\)/)
  const dialog = readProductAdminFile('_editor/after-save-dialog.tsx')
  assert.match(dialog, /같은 구성으로 다음 상품/)
  assert.match(dialog, /빈 새 상품/)
  assert.match(dialog, /\{afterSaveItem && isPublished \? \(/)
  assert.match(dialog, /target="_blank"/)
  assert.match(dialog, /이번에 등록한 상품/)
  assert.match(dialog, /다시 수정/)
  const duplicate = readProductAdminFile('_hooks/use-product-duplicate.ts')
  assert.match(duplicate, /setForm\(\(current\) => \(\{ \.\.\.current, title: '' \}\)\)\n\s+focusProductFieldAfterRender\(PUBLISH_CHECK_TARGET_IDS\.title\)/)
  assert.match(duplicate, /setSessionCopyItemIds\(\(current\) => \[\.\.\.current, result\.itemId\]\)/)
})

test('목록 [복제]: 확인 창 문구 → copy 로 임시저장 사본, 버튼은 행마다', () => {
  const list = readProductAdminFile('_list/product-list.tsx')
  assert.match(list, /aria-label=\{`\$\{item\.title\} 복제`\}[^\n]*onClick=\{\(\) => setDuplicateTarget\(item\)\}/)
  assert.match(list, /임시저장 사본을 만듭니다\. 판매 파일·샘플·이용 근거는 복사하지 않습니다\./)
  assert.match(list, /void handleConfirmDuplicate\(\)/)
  assert.match(readProductAdminFile('_hooks/use-product-duplicate.ts'), /requestDuplicate\(duplicateTarget\.id, 'copy'\)/)
})
