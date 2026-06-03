import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const adminProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)
const adminSamplePagesRoute = readFileSync(
  new URL('../src/app/api/admin/market/items/[id]/sample-pages/route.ts', import.meta.url),
  'utf8'
)
const samplePagesServer = readFileSync(
  new URL('../src/lib/market-sample-pages-server.ts', import.meta.url),
  'utf8'
)
const dialogPath = new URL('../src/app/(admin)/admin/market/products/admin-market-sample-preview-dialog.tsx', import.meta.url)
const dialog = existsSync(dialogPath) ? readFileSync(dialogPath, 'utf8') : ''

function extractBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `${start} should exist`)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(endIndex, -1, `${end} should exist after ${start}`)
  return source.slice(startIndex, endIndex)
}

test('admin product upload area exposes a generated sample preview action', () => {
  assert.match(adminProductsClient, /AdminMarketSamplePreviewDialog/)
  assert.match(adminProductsClient, /isSamplePreviewOpen/)
  assert.match(adminProductsClient, /samplePreviewItemId/)
  assert.match(adminProductsClient, /샘플 확인/)
  assert.match(adminProductsClient, /샘플 생성 중/)
  assert.match(adminProductsClient, /샘플 없음/)
  assert.match(adminProductsClient, /samplePages\.length/)
  assert.match(adminProductsClient, /샘플 이미지 생성/)
  assert.match(adminProductsClient, /selectedSampleSourceFile/)
  assert.match(adminProductsClient, /handleGenerateSampleImages/)
  assert.match(adminProductsClient, /handleSelectSampleSourceFile/)
  assert.match(adminProductsClient, /pdfjs-dist/)
  assert.match(adminProductsClient, /GlobalWorkerOptions\.workerSrc/)
  assert.match(adminProductsClient, /canvas\.toBlob/)
  assert.match(adminProductsClient, /image\/jpeg/)
  assert.match(adminProductsClient, /uploadToSignedUrl/)
  assert.match(adminProductsClient, /createBrowserSupabaseClient|createClient as createBrowserSupabaseClient/)
  assert.match(adminProductsClient, /finalize_upload/)
  assert.match(adminProductsClient, /cleanup_upload_batch/)
  assert.match(adminProductsClient, /sample-pages\/source\/finalize/)
  assert.match(adminProductsClient, /PDF 렌더링 중|업로드 중|저장 중/)
  assert.match(adminProductsClient, /브라우저에서 샘플 JPG를 생성/)
  assert.match(adminProductsClient, /onDrop/)
  assert.match(adminProductsClient, /draftToken/)
  assert.match(adminProductsClient, /isSampleSourceUploading/)
  assert.match(adminProductsClient, /samplePageSelection/)
  assert.match(adminProductsClient, /샘플 이미지 전체 삭제/)
  assert.match(adminProductsClient, /handleDeleteAllSamplePages/)
  assert.match(adminProductsClient, /handleMoveSamplePage/)
  assert.match(adminProductsClient, /samplePageDragId/)
  assert.match(adminProductsClient, /draggable/)
  assert.match(adminProductsClient, /persistSamplePageOrder/)
  assert.match(adminProductsClient, /body: JSON\.stringify\(\{ pageIds: samplePages\.map\(\(page\) => page\.id\) \}\)/)

  const selectSampleSourceFileHandler = extractBetween(
    adminProductsClient,
    'const handleSelectSampleSourceFile',
    'const handleGenerateSampleImages'
  )
  assert.doesNotMatch(selectSampleSourceFileHandler, /fetch\(/)
  assert.doesNotMatch(selectSampleSourceFileHandler, /ensureDraftItemForUpload/)
  assert.match(selectSampleSourceFileHandler, /setSelectedSampleSourceFile\(null\)/)

  const sampleDropHandler = extractBetween(
    adminProductsClient,
    'onDrop={(event) => {',
    'className={`flex min-h-24'
  )
  assert.match(sampleDropHandler, /handleSelectSampleSourceFile\(event\.dataTransfer\.files\?\.\[0\]\)/)
  assert.doesNotMatch(sampleDropHandler, /handleGenerateSampleImages/)
  assert.match(adminProductsClient, /current\.filter\(\(currentPage\) => currentPage\.draftToken\)/)

  const generateSampleImagesHandler = extractBetween(
    adminProductsClient,
    'const handleGenerateSampleImages',
    'const handleDeleteSamplePage'
  )
  assert.doesNotMatch(generateSampleImagesHandler, /new FormData\(\)/)
  assert.doesNotMatch(generateSampleImagesHandler, /formData\.append\('file', selectedSampleSourceFile\)/)
  assert.doesNotMatch(generateSampleImagesHandler, /body: formData/)

  const refreshEditingFilesHandler = extractBetween(
    adminProductsClient,
    'const refreshEditingFiles',
    'const buildRequestBody'
  )
  assert.doesNotMatch(refreshEditingFilesHandler, /setSamplePages/)
})

test('admin sample pages can persist manual thumbnail order', () => {
  assert.match(adminSamplePagesRoute, /export async function PATCH/)
  assert.match(adminSamplePagesRoute, /pageIds/)
  assert.match(adminSamplePagesRoute, /updateMarketItemSamplePageDisplayOrder/)
  assert.match(samplePagesServer, /export async function updateMarketItemSamplePageDisplayOrder/)
  assert.match(samplePagesServer, /display_order: index \+ 1/)
  assert.match(samplePagesServer, /\.order\('display_order'/)
})

test('admin product file draft drop zones show larger red empty state before upload', () => {
  assert.match(adminProductsClient, /min-h-32/)
  assert.match(adminProductsClient, /isUploading[\s\S]+\? 'cursor-not-allowed border-emerald-300 bg-emerald-50 text-emerald-700'/)
  assert.match(adminProductsClient, /!selectedFileType[\s\S]+\? 'cursor-not-allowed border-red-200 bg-red-50\/40 text-red-700'/)
  assert.match(adminProductsClient, /border-red-200 bg-red-50\/40/)
  assert.match(adminProductsClient, /hover:border-red-300 hover:bg-red-50/)
  assert.match(adminProductsClient, /isUploading \? 'text-emerald-900' : 'text-red-900'/)
  assert.match(adminProductsClient, /isUploading \? 'text-emerald-700' : 'text-red-700'/)
  assert.match(adminProductsClient, /selectedFileType/)
  assert.match(adminProductsClient, /업로드된 파일/)
  assert.match(adminProductsClient, /handleRemoveSubproductFileDraft/)
})

test('admin sample preview dialog fetches fresh admin signed sample urls', () => {
  assert.ok(existsSync(dialogPath), 'admin sample preview dialog should exist')
  assert.match(dialog, /\/api\/admin\/market\/items\/\$\{itemId\}\/sample-pages/)
  assert.match(dialog, /withAdminWorkspaceSubject/)
  assert.match(dialog, /cache: 'no-store'/)
  assert.match(dialog, /샘플 JPG 확인/)
  assert.match(dialog, /샘플 이미지를 불러오는 중입니다/)
  assert.match(dialog, /다시 불러오기/)
  assert.match(dialog, /aria-pressed/)
  assert.match(dialog, /id: string/)
  assert.match(dialog, /originalFileName: string \| null/)
  assert.match(dialog, /formatSamplePageLabel/)
  assert.match(dialog, /formatSamplePageLabel\(page\)/)
  assert.match(dialog, /formatSamplePageLabel\(selectedPage\)/)
  assert.match(dialog, /getSampleSourceDisplayFileName/)
  assert.match(dialog, /SAMPLE_PAGE_GENERATED_FILE_NAME_SUFFIX_PATTERN/)
  assert.match(dialog, /replace\(SAMPLE_PAGE_GENERATED_FILE_NAME_SUFFIX_PATTERN, ''\)/)
  assert.match(dialog, /SAMPLE_FILE_GROUP_STYLES/)
  assert.match(dialog, /buildSampleFileGroupMeta/)
  assert.match(dialog, /getSampleFileGroupStyle/)
  assert.match(dialog, /sampleFileGroupMetaByName/)
  assert.match(dialog, /파일 \{sampleFileGroupMeta\.groupNumber\}/)
  assert.match(dialog, /sampleFileGroupStyle\.barClassName/)
  assert.match(dialog, /sampleFileGroupStyle\.labelClassName/)
  assert.match(dialog, /sampleFileGroupStyle\.badgeClassName/)
  assert.match(dialog, /border-l-sky-400/)
  assert.match(dialog, /bg-sky-50/)
  assert.match(dialog, /bg-emerald-50/)
  assert.match(dialog, /bg-amber-50/)
  assert.match(dialog, /bg-amber-100/)
  assert.match(dialog, /text-amber-900/)
  assert.match(dialog, /font-semibold/)
  assert.match(dialog, /selectedPageId/)
  assert.match(dialog, /key=\{page\.id\}/)
  assert.match(dialog, /aria-pressed=\{selectedPageId === page\.id\}/)
  assert.doesNotMatch(dialog, /key=\{page\.pageNumber\}/)
  assert.doesNotMatch(dialog, /selectedPageNumber/)
  assert.match(dialog, /page\.signedUrl/)
  assert.match(dialog, /<img/)
  assert.match(dialog, /fileSizeBytes/)
  assert.match(dialog, /widthPx/)
  assert.match(dialog, /heightPx/)
  assert.doesNotMatch(dialog, /첫 1~3페이지/)
  assert.match(dialog, /new Map<string, SampleFileGroupMeta>\(\)/)
})
