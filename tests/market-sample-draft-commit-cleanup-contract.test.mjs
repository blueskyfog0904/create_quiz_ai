import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const helper = readFileSync(new URL('../src/lib/market-sample-pages-server.ts', import.meta.url), 'utf8')

test('sample v2 helper appends draft pages without replacing active samples', () => {
  assert.match(helper, /export async function appendDraftMarketItemSamplePages/)
  const start = helper.indexOf('export async function appendDraftMarketItemSamplePages')
  const source = helper.slice(start, helper.indexOf('\nexport ', start + 1) === -1 ? undefined : helper.indexOf('\nexport ', start + 1))
  assert.match(source, /draftToken/)
  assert.match(source, /sourceBatchId/)
  assert.match(source, /status:\s*'draft'/)
  assert.match(source, /display_order/)
  assert.doesNotMatch(source, /is_active:\s*false[\s\S]*eq\('is_active', true\)/)
})

test('sample v2 helper commits only remaining draft pages for a token', () => {
  assert.match(helper, /export async function commitDraftMarketItemSamplePages/)
  const start = helper.indexOf('export async function commitDraftMarketItemSamplePages')
  const source = helper.slice(start, helper.indexOf('\nexport ', start + 1) === -1 ? undefined : helper.indexOf('\nexport ', start + 1))
  assert.match(source, /draft_token/)
  assert.match(source, /status', 'draft'|status:\s*'active'/)
  assert.match(source, /committed_at/)
  assert.match(source, /is_active:\s*true/)
})

test('sample v2 helper removes draft thumbnails without affecting committed active rows', () => {
  assert.match(helper, /export async function removeDraftMarketItemSamplePage/)
  const start = helper.indexOf('export async function removeDraftMarketItemSamplePage')
  const source = helper.slice(start, helper.indexOf('\nexport ', start + 1) === -1 ? undefined : helper.indexOf('\nexport ', start + 1))
  assert.match(source, /status', 'draft'/)
  assert.match(source, /status:\s*'removed'/)
  assert.match(source, /deleted_at/)
})

test('sample v2 helper can safely rollback only the current draft upload batch', () => {
  assert.match(helper, /export async function markDraftMarketItemSamplePagesAsRemoved/)
  const start = helper.indexOf('export async function markDraftMarketItemSamplePagesAsRemoved')
  const source = helper.slice(start, helper.indexOf('\nexport ', start + 1) === -1 ? undefined : helper.indexOf('\nexport ', start + 1))
  assert.match(source, /itemId/)
  assert.match(source, /workspaceSubject/)
  assert.match(source, /draftToken/)
  assert.match(source, /sourceBatchId/)
  assert.match(source, /createdBy/)
  assert.match(source, /status:\s*'removed'/)
  assert.match(source, /is_active:\s*false/)
  assert.match(source, /deleted_at/)
})

test('sample v2 helper checks active or draft storage path references before cleanup', () => {
  assert.match(helper, /export async function hasActiveOrDraftMarketItemSamplePageStoragePath/)
  const start = helper.indexOf('export async function hasActiveOrDraftMarketItemSamplePageStoragePath')
  const source = helper.slice(start, helper.indexOf('\nexport ', start + 1) === -1 ? undefined : helper.indexOf('\nexport ', start + 1))
  assert.match(source, /itemId/)
  assert.match(source, /workspaceSubject/)
  assert.match(source, /storagePath/)
  assert.match(source, /item_id/)
  assert.match(source, /workspace_subject/)
  assert.match(source, /storage_path/)
  assert.match(source, /status.*draft|status', 'draft'|is_active/)
})
