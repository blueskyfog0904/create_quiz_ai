import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const dialog = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx', import.meta.url),
  'utf8'
)

test('market sample preview uses ttl-aware in-memory cache and in-flight dedupe', () => {
  assert.match(dialog, /fileSizeBytes: number \| null/)
  assert.match(dialog, /expiresAt\?: string/)
  assert.match(dialog, /SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS/)
  assert.match(dialog, /samplePagePreviewCache/)
  assert.match(dialog, /samplePagePreviewRequests/)
  assert.match(dialog, /function buildSamplePageCacheKey/)
  assert.match(dialog, /`\$\{workspaceSubject\}:\$\{itemId\}`/)
  assert.match(dialog, /function getCachedSamplePages/)
  assert.match(dialog, /async function fetchSamplePages/)
  assert.match(dialog, /finally\(\(\) => \{\s*samplePagePreviewRequests\.delete\(cacheKey\)/s)
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
  assert.match(dialog, /loading=\{index === 0 \? 'eager' : 'lazy'\}/)
  assert.match(dialog, /decoding="async"/)
  assert.match(dialog, /fetchPriority=\{index === 0 \? 'high' : 'low'\}/)
})
