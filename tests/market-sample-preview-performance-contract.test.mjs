import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const dialog = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx', import.meta.url),
  'utf8'
)

test('market sample preview uses ttl-aware in-memory cache and in-flight dedupe', () => {
  assert.match(dialog, /fileSizeBytes: number \| null/)
  assert.match(dialog, /originalFileName: string \| null/)
  assert.match(dialog, /expiresAt\?: string/)
  assert.match(dialog, /SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS/)
  assert.match(dialog, /samplePagePreviewCache/)
  assert.match(dialog, /samplePagePreviewRequests/)
  assert.match(dialog, /function buildSamplePageCacheKey/)
  assert.match(dialog, /`\$\{workspaceSubject\}:\$\{itemId\}`/)
  assert.match(dialog, /function getCachedSamplePages/)
  assert.match(dialog, /async function fetchSamplePages/)
  assert.match(dialog, /finally\(\(\) => \{\s*samplePagePreviewRequests\.delete\(cacheKey\)/s)
  assert.match(dialog, /cache: 'no-store'/)
  assert.doesNotMatch(dialog, /첫 1~3페이지/)
})

test('market sample preview shares loader for open and prefetch intents', () => {
  assert.match(dialog, /prefetchKey: number/)
  assert.match(dialog, /const loadSamplePages = useCallback/)
  assert.match(dialog, /void loadSamplePages\(\)/)
  assert.match(dialog, /void loadSamplePages\(\{ silent: true \}\)/)
  assert.match(dialog, /fetchSamplePages\(itemId, workspaceSubject, cacheKey\)/)
})

test('market sample preview prioritizes the first image only', () => {
  assert.match(dialog, /pages\.map\(\(page, index\)/)
  assert.match(dialog, /key=\{page\.id\}/)
  assert.match(dialog, /formatSamplePageLabel\(page\)/)
  assert.match(dialog, /'\$\{displayFileName\}' 샘플 페이지/)
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
  assert.match(dialog, /text-amber-900/)
  assert.match(dialog, /font-semibold/)
  assert.match(dialog, /page\.signedUrl/)
  assert.match(dialog, /width=\{page\.widthPx \?\? undefined\}/)
  assert.match(dialog, /height=\{page\.heightPx \?\? undefined\}/)
  assert.match(dialog, /loading=\{index === 0 \? 'eager' : 'lazy'\}/)
  assert.match(dialog, /decoding="async"/)
  assert.match(dialog, /fetchPriority=\{index === 0 \? 'high' : 'low'\}/)
})
