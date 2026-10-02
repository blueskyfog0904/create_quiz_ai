import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

import {
  DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG,
  resolveAdminSidebarMenuItems,
} from '../src/lib/admin-sidebar.ts'
import {
  MARKET_IMAGE_MAX_FILES_PER_UPLOAD,
  MARKET_IMAGE_MAX_INPUT_BYTES,
  chunkArray,
  chunkMarketImageUploads,
  formatMarketImageBytes,
} from '../src/lib/market-images.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(admin)/admin/market/images/page.tsx')
const library = read('src/components/admin/market-image-library.tsx')
const picker = read('src/components/admin/market-image-picker.tsx')
const uploadLib = read('src/lib/market-images-upload.ts')

test('sidebar lists 문제마켓 이미지 관리 right after 문제마켓 상품 관리', () => {
  const items = DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items
  assert.equal(items.indexOf('/admin/market/images'), items.indexOf('/admin/market/products') + 1)
  for (const subject of ['english', 'korean']) {
    const entry = resolveAdminSidebarMenuItems(subject).find((item) => item.href === '/admin/market/images')
    assert.equal(entry?.name, '문제마켓 이미지 관리')
    assert.equal(entry?.icon, 'images')
  }
})

test('library page is admin-guarded and renders the manage mode library', () => {
  assert.match(page, /await requireAdmin\('\/admin\/market\/images'\)/)
  assert.match(page, /<MarketImageLibrary mode="manage" \/>/)
  assert.match(page, /문제마켓 이미지 관리/)
})

test('picker wraps select mode in a Dialog and closes after selecting', () => {
  assert.match(picker, /^'use client'/)
  assert.match(picker, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/)
  assert.match(picker, /mode="select"/)
  assert.match(picker, /onSelect\(image\)\n\s+onOpenChange\(false\)/)
  assert.match(picker, /<DialogTitle>/)
})

test('upload hashes the bytes it will send, checks first, then uploads only unknown files in limited batches', () => {
  const upload = uploadLib.match(/export async function uploadMarketImageFiles[\s\S]+?\n}\n/)[0]
  const prepare = upload.indexOf('await deps.prepare(original)')
  const hash = upload.indexOf('await deps.hash(file)')
  const check = upload.indexOf("'/api/admin/market/images/check'")
  const post = upload.indexOf("request('/api/admin/market/images', { method: 'POST', body })")
  assert.ok(prepare > 0 && prepare < hash && hash < check && check < post)
  assert.match(upload, /chunkArray\(\[\.\.\.new Set\(prepared\.map\(\(entry\) => entry\.hash\)\)\], MARKET_IMAGE_MAX_CHECK_HASHES\)/)
  assert.match(upload, /for \(const batch of chunkMarketImageUploads\(pending\)\)/)
  assert.match(uploadLib, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(library, /uploadMarketImageFiles\(targets, uploadFolderId, \{ prepare: shrinkForUpload, hash: sha256HexOfBlob \}\)/)
  assert.match(library, /if \(!isManage && outcome\.images\[0\]\) onSelect\?\.\(outcome\.images\[0\]\)/)
  assert.match(library, /if \(file\.size <= MARKET_IMAGE_MAX_INPUT_BYTES\) return file/)
  assert.match(library, /for \(const type of \['image\/webp', 'image\/jpeg'\]\)/)
  assert.match(library, /blob && blob\.type === type && blob\.size <= MARKET_IMAGE_MAX_INPUT_BYTES/)
  assert.match(library, /이미 등록된 이미지를 재사용했습니다/)
})

test('requests never throw on network errors and the library always refreshes after uploads', () => {
  assert.match(uploadLib, /catch \{\n\s+return \{ ok: false, result: \{ success: false, error: \{ code: 'NETWORK_ERROR'/)
  assert.doesNotMatch(library, /await fetch\(/)
  assert.match(library, /finally \{\n\s+setIsUploading\(false\)\n\s+await refresh\(\)/)
})

test('paste and file drop guards only act while mounted and leave text inputs and dialogs alone', () => {
  assert.match(library, /target\?\.closest\('input, textarea, \[role="alertdialog"\]'\)/)
  assert.match(library, /target\.isContentEditable/)
  assert.match(library, /isFailureDialogOpenRef\.current \|\| \/<table\/i\.test\(event\.clipboardData\?\.getData\('text\/html'\) \?\? ''\)/)
  assert.doesNotMatch(library, /getData\('text\/plain'\)/)
  assert.match(library, /document\.removeEventListener\('paste', onPaste\)/)
  assert.match(library, /document\.removeEventListener\('drop', blockFileDrop\)/)
  assert.match(library, /event\.dataTransfer\?\.types\.includes\('Files'\)/)
})

test('selection resets with folder, query and sort; load more dedupes; detail panel refetches and scrolls below xl', () => {
  assert.equal((library.match(/setSelectedIds\(new Set\(\)\)/g) ?? []).length >= 5, true)
  assert.match(library, /setQuery\(queryDraft\.trim\(\)\)\n\s+setSelectedIds\(new Set\(\)\)/)
  assert.match(library, /setSort\(value as SortKey\)\n\s+setSelectedIds\(new Set\(\)\)/)
  assert.match(library, /items\.filter\(\(image\) => !loadedIds\.has\(image\.id\)\)/)
  assert.match(library, /\}, \[imageId, revision\]\)/)
  assert.match(library, /setDetailRevision\(\(current\) => current \+ 1\)/)
  assert.match(library, /matchMedia\('\(min-width: 1280px\)'\)/)
  assert.match(library, /headingRef\.current\?\.scrollIntoView/)
  assert.match(library, /headingRef\.current\?\.focus\(\)/)
  assert.match(library, /if \(serverValuesRef\.current\?\.name !== name\) setNameDraft\(name\)/)
  assert.match(library, /detailOpenerRef\.current = event\.currentTarget/)
  assert.match(library, /onClose=\{closeDetail\}/)
  assert.match(library, /requestAnimationFrame\(\(\) => opener\.focus\(\)\)/)
})

test('bulk move is split by the move limit and delete reports IN_USE usage', () => {
  assert.match(library, /chunkArray\(imageIds, MARKET_IMAGE_MAX_MOVE_IDS\)/)
  assert.match(library, /'\/api\/admin\/market\/images\/move'/)
  assert.match(library, /error\?\.code === 'IN_USE' \? \{ items: error\.items \?\? \[\], categoryItems: error\.categoryItems \?\? \[\] \}/)
  assert.match(library, /disabled=\{isWorking \|\| usageCount > 0\}/)
})

test('folder delete is disabled while images remain and shows the planned message', () => {
  assert.match(library, /disabled=\{isWorking \|\| currentFolder\.imageCount > 0\}/)
  assert.match(library, /이미지 \{currentFolder\.imageCount\}장이 남아 있어 삭제할 수 없습니다\. 이미지를 이동하거나 삭제한 뒤 다시 시도하세요\./)
})

test('library covers folders, totals, search, sort, paging, paste/drop and remembers the last folder safely', () => {
  for (const label of ['전체', '미분류', '새 폴더', '이름 변경', '폴더 삭제', '파일 선택', '새로 업로드', '폴더로 이동', '더 보기']) {
    assert.ok(library.includes(label), label)
  }
  assert.match(library, /총 \{totals\.count\}장 · \{formatMarketImageBytes\(totals\.bytes\)\}/)
  assert.match(library, /params\.set\('cursor', cursor\)/)
  assert.match(library, /document\.addEventListener\('paste', onPaste\)/)
  assert.match(library, /onDrop=\{onDrop\}/)
  assert.match(library, /try \{\n\s+return window\.localStorage\.getItem\(LAST_FOLDER_STORAGE_KEY\)\n\s+\} catch/)
  assert.match(library, /try \{\n\s+window\.localStorage\.setItem\(LAST_FOLDER_STORAGE_KEY, folder\)\n\s+\} catch/)
})

test('library and picker are accessible and follow admin style rules', () => {
  for (const source of [library, picker, page, uploadLib]) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, 'raw hex color')
    assert.doesNotMatch(source, /rounded-\[/, 'arbitrary radius')
    assert.doesNotMatch(source, /thumbnail_url|thumbnailUrl/)
  }
  assert.match(library, /aria-label=\{`\$\{image\.displayName\} 선택`\}/)
  assert.match(library, /aria-current=\{folderFilter === folder\.value \? 'true' : undefined\}/)
  assert.match(library, /aria-live="polite"/)
  assert.ok((library.match(/min-h-11/g) ?? []).length >= 15)
  assert.doesNotMatch(library, /main-ad-images|market-files/)
})

test('upload batches never exceed the file count or byte limits', () => {
  const MB = 1024 * 1024
  const many = Array.from({ length: 45 }, () => ({ size: 10 }))
  assert.deepEqual(chunkMarketImageUploads(many).map((batch) => batch.length), [20, 20, 5])
  assert.equal(MARKET_IMAGE_MAX_FILES_PER_UPLOAD, 20)
  const sized = [1.5, 1.5, 1.5, 3, 0.5, 4].map((mb) => ({ size: mb * MB }))
  const batches = chunkMarketImageUploads(sized)
  assert.deepEqual(batches.map((batch) => batch.map((file) => file.size / MB)), [[1.5, 1.5], [1.5], [3, 0.5], [4]])
  for (const batch of batches) assert.ok(batch.reduce((sum, file) => sum + file.size, 0) <= MARKET_IMAGE_MAX_INPUT_BYTES)
  assert.deepEqual(chunkMarketImageUploads([{ size: 5 * MB }, { size: 1 }]).map((batch) => batch.length), [1, 1])
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.equal(formatMarketImageBytes(512), '512B')
  assert.equal(formatMarketImageBytes(2048), '2.0KB')
  assert.equal(formatMarketImageBytes(3 * MB), '3.0MB')
})
