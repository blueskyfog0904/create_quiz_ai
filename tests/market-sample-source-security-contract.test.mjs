import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const downloadRoute = readFileSync(new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url), 'utf8')
const sampleSourceRoutePath = new URL('../src/app/api/admin/market/items/[id]/sample-pages/source/route.ts', import.meta.url)
const sampleSourceFinalizeRoutePath = new URL('../src/app/api/admin/market/items/[id]/sample-pages/source/finalize/route.ts', import.meta.url)
const sampleSourceRoute = existsSync(sampleSourceRoutePath) ? readFileSync(sampleSourceRoutePath, 'utf8') : ''
const sampleSourceFinalizeRoute = existsSync(sampleSourceFinalizeRoutePath) ? readFileSync(sampleSourceFinalizeRoutePath, 'utf8') : ''
const sampleApiRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/sample-pages/route.ts', import.meta.url), 'utf8')
const marketStorage = readFileSync(new URL('../src/lib/market-storage.ts', import.meta.url), 'utf8')
const samplePagesServer = readFileSync(new URL('../src/lib/market-sample-pages-server.ts', import.meta.url), 'utf8')
const cleanupCronRoute = readFileSync(new URL('../src/app/api/cron/market/cleanup-auto-upload-drafts/route.ts', import.meta.url), 'utf8')

test('legacy sample files do not drive user-facing sample availability', () => {
  assert.doesNotMatch(itemsServer, /samplePages\.length > 0 \|\| filesForItem\.sample !== null/)
  assert.match(itemsServer, /sample:\s*\{\s*available:\s*samplePages\.length > 0/)
})

test('public download route no longer serves legacy sample files', () => {
  assert.doesNotMatch(downloadRoute, /assetKind !== 'sample'/)
  assert.match(downloadRoute, /assetKind는 pdf\/hwp\/zip 중 하나여야 합니다|pdf\/hwp\/zip/)
})

test('admin sample source upload does not store source pdf as an active market item file', () => {
  assert.ok(existsSync(sampleSourceRoutePath), 'sample source signed upload target route should exist')
  assert.match(sampleSourceRoute, /requireAdminUser/)
  assert.match(sampleSourceRoute, /resolveAdminWorkspaceSubject/)
  assert.match(sampleSourceRoute, /createSignedUploadUrl/)
  assert.match(sampleSourceRoute, /recordManualSampleUploadTargetsForCleanup/)
  assert.match(sampleSourceRoute, /MARKET_SAMPLE_PAGE_MIME_TYPE/)
  assert.match(sampleSourceRoute, /buildMarketManualSamplePageStoragePath/)
  assert.doesNotMatch(sampleSourceRoute, /replaceMarketItemFile/)
  assert.doesNotMatch(sampleSourceRoute, /request\.formData\(\)/)
  assert.doesNotMatch(sampleSourceRoute, /Buffer\.from/)
  assert.doesNotMatch(sampleSourceRoute, /generateMarketPdfSamplePages/)
  assert.doesNotMatch(sampleSourceRoute, /\.upload\(/)
  assert.match(sampleApiRoute, /id:/)
})

test('manual sample storage paths normalize repeated dots before finalize safety checks', () => {
  assert.match(marketStorage, /function normalizeFileName/)
  assert.match(marketStorage, /replace\(\/\\\.\+\/g, '\.'\)/)
  assert.match(marketStorage, /replace\(\/\^\\\.\+\|\\\.\+\$\/g, ''\)/)
  assert.match(marketStorage, /\|\| 'file'/)
  assert.match(marketStorage, /storagePath\.includes\('\.\.'\)/)
})

test('admin sample finalize validates exact server paths and cleanup cannot delete arbitrary storage', () => {
  assert.ok(existsSync(sampleSourceFinalizeRoutePath), 'sample source finalize route should exist')
  assert.match(sampleSourceFinalizeRoute, /appendDraftMarketItemSamplePages/)
  assert.match(sampleSourceFinalizeRoute, /deleteRemovedManualSampleUploadTargets/)
  assert.match(sampleSourceFinalizeRoute, /sourceFileId:\s*null/)
  assert.match(sampleSourceFinalizeRoute, /\.info\(/)
  assert.match(sampleSourceFinalizeRoute, /\.download\(/)
  assert.match(sampleSourceFinalizeRoute, /readJpegDimensions/)
  assert.match(sampleSourceFinalizeRoute, /verifiedFileSizeBytes/)
  assert.match(sampleSourceFinalizeRoute, /buildMarketManualSamplePageStoragePath/)
  assert.match(sampleSourceFinalizeRoute, /expectedStoragePath/)
  assert.match(sampleSourceFinalizeRoute, /storagePath !== expectedStoragePath/)
  assert.match(sampleSourceFinalizeRoute, /cleanup_upload_batch/)
  assert.match(sampleSourceFinalizeRoute, /sourceBatchId/)
  assert.match(sampleSourceFinalizeRoute, /isSafeManualSampleStoragePath/)
  assert.match(sampleSourceFinalizeRoute, /\.\./)
  assert.match(sampleSourceFinalizeRoute, /hasActiveOrDraftMarketItemSamplePageStoragePath/)
  assert.match(sampleSourceFinalizeRoute, /markDraftMarketItemSamplePagesAsRemoved/)
  assert.match(sampleSourceFinalizeRoute, /createdBy/)
  assert.doesNotMatch(sampleSourceFinalizeRoute, /replaceMarketItemFile/)
})

test('manual sample upload targets are tracked for server-side orphan cleanup', () => {
  assert.match(samplePagesServer, /recordManualSampleUploadTargetsForCleanup/)
  assert.match(samplePagesServer, /cleanupRemovedManualSampleUploadTargets/)
  assert.match(samplePagesServer, /status:\s*'removed'/)
  assert.match(samplePagesServer, /deleted_at/)
  assert.match(samplePagesServer, /listReferencedActiveOrDraftStoragePaths/)
  assert.match(samplePagesServer, /sample-pages\/manual/)
  assert.match(cleanupCronRoute, /cleanupRemovedManualSampleUploadTargets/)
  assert.match(cleanupCronRoute, /manualSampleUploadTargets/)
})
