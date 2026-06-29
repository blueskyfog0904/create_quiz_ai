import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const lib = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const storage = readFileSync(new URL('../src/lib/market-storage.ts', import.meta.url), 'utf8')
const itemRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/route.ts', import.meta.url), 'utf8')

const subproductsRoutePath = new URL('../src/app/api/admin/market/items/[id]/subproducts/route.ts', import.meta.url)
const subproductRoutePath = new URL('../src/app/api/admin/market/items/[id]/subproducts/[subproductId]/route.ts', import.meta.url)
const filesRoutePath = new URL('../src/app/api/admin/market/items/[id]/subproducts/[subproductId]/files/route.ts', import.meta.url)
const fileRoutePath = new URL('../src/app/api/admin/market/items/[id]/subproducts/[subproductId]/files/[fileId]/route.ts', import.meta.url)
const bundleRoutePath = new URL('../src/app/api/admin/market/items/[id]/bundle-option/route.ts', import.meta.url)

const subproductsRoute = existsSync(subproductsRoutePath) ? readFileSync(subproductsRoutePath, 'utf8') : ''
const subproductRoute = existsSync(subproductRoutePath) ? readFileSync(subproductRoutePath, 'utf8') : ''
const filesRoute = existsSync(filesRoutePath) ? readFileSync(filesRoutePath, 'utf8') : ''
const fileRoute = existsSync(fileRoutePath) ? readFileSync(fileRoutePath, 'utf8') : ''
const bundleRoute = existsSync(bundleRoutePath) ? readFileSync(bundleRoutePath, 'utf8') : ''

test('admin subproduct API exposes guarded CRUD routes below an item', () => {
  assert.notEqual(subproductsRoute, '', 'subproducts collection route should exist')
  assert.notEqual(subproductRoute, '', 'subproduct item route should exist')
  assert.match(subproductsRoute, /export async function GET/)
  assert.match(subproductsRoute, /export async function POST/)
  assert.match(subproductRoute, /export async function PATCH/)
  assert.match(subproductRoute, /export async function DELETE/)
  assert.match(subproductsRoute + subproductRoute, /관리자 권한이 필요합니다/)
  assert.match(subproductsRoute + subproductRoute, /workspaceSubject/)
  assert.match(subproductsRoute + subproductRoute, /getMarketItemById/)
})

test('admin subproduct API derives the subproduct title from its category', () => {
  assert.doesNotMatch(subproductsRoute, /title:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
  assert.doesNotMatch(subproductRoute, /title:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/)
  assert.doesNotMatch(subproductsRoute + subproductRoute, /title:\s*parsed\.data\.title/)
  assert.match(lib, /title:\s*category\.name/)
  assert.match(lib, /payload\.title = category\.name/)
})

test('admin subproduct API accepts editable purchase notice copy', () => {
  assert.match(subproductsRoute, /purchaseNoticeLabel:\s*z\.string\(\)\.trim\(\)\.max\(24\)\.optional\(\)\.nullable\(\)/)
  assert.match(subproductsRoute, /purchaseNoticeText:\s*z\.string\(\)\.trim\(\)\.max\(160\)\.optional\(\)\.nullable\(\)/)
  assert.match(subproductRoute, /purchaseNoticeLabel:\s*z\.string\(\)\.trim\(\)\.max\(24\)\.optional\(\)\.nullable\(\)/)
  assert.match(subproductRoute, /purchaseNoticeText:\s*z\.string\(\)\.trim\(\)\.max\(160\)\.optional\(\)\.nullable\(\)/)

  assert.match(subproductsRoute, /purchaseNoticeLabel:\s*parsed\.data\.purchaseNoticeLabel/)
  assert.match(subproductsRoute, /purchaseNoticeText:\s*parsed\.data\.purchaseNoticeText/)
  assert.match(subproductRoute, /purchaseNoticeLabel:\s*parsed\.data\.purchaseNoticeLabel/)
  assert.match(subproductRoute, /purchaseNoticeText:\s*parsed\.data\.purchaseNoticeText/)

  assert.match(lib, /purchaseNoticeLabel\?: string \| null/)
  assert.match(lib, /purchaseNoticeText\?: string \| null/)
  assert.match(lib, /purchase_notice_label:\s*normalizeNullableText\(input\.purchaseNoticeLabel\)/)
  assert.match(lib, /purchase_notice_text:\s*normalizeNullableText\(input\.purchaseNoticeText\)/)
  assert.match(lib, /input\.purchaseNoticeLabel !== undefined[\s\S]+payload\.purchase_notice_label = normalizeNullableText\(input\.purchaseNoticeLabel\)/)
  assert.match(lib, /input\.purchaseNoticeText !== undefined[\s\S]+payload\.purchase_notice_text = normalizeNullableText\(input\.purchaseNoticeText\)/)
})

test('admin subproduct file API uploads through v2 storage and cleans up metadata on delete', () => {
  assert.notEqual(filesRoute, '', 'subproduct files collection route should exist')
  assert.notEqual(fileRoute, '', 'subproduct file item route should exist')
  assert.match(filesRoute, /export async function GET/)
  assert.match(filesRoute, /export async function POST/)
  assert.match(fileRoute, /export async function DELETE/)
  assert.match(filesRoute, /assertMarketSubproductUploadIsAllowed/)
  assert.match(filesRoute, /buildMarketSubproductStoragePath/)
  assert.match(filesRoute, /replaceMarketSubproductFile/)
  assert.match(filesRoute, /storage[\s\S]+remove\(\[storagePath\]\)/)
  assert.match(fileRoute, /deleteMarketSubproductFile/)
})

test('admin bundle option API and helpers support one active full-purchase option per item', () => {
  assert.notEqual(bundleRoute, '', 'bundle option route should exist')
  assert.match(bundleRoute, /export async function GET/)
  assert.match(bundleRoute, /export async function PATCH/)
  assert.match(bundleRoute, /export async function DELETE/)
  assert.match(bundleRoute, /getMarketItemBundleOptionForAdmin/)
  assert.match(bundleRoute, /upsertMarketItemBundleOption/)
  assert.match(bundleRoute, /disableMarketItemBundleOption/)

  assert.match(lib, /export async function getMarketItemBundleOptionForAdmin/)
  assert.match(lib, /export async function upsertMarketItemBundleOption/)
  assert.match(lib, /export async function disableMarketItemBundleOption/)
  assert.match(lib, /price_credits/)
  assert.match(lib, /is_active/)
})

test('server helpers expose v2 subproduct admin reads and exact file replacement', () => {
  assert.match(lib, /export async function listMarketItemSubproductsForAdmin/)
  assert.match(lib, /export async function createMarketItemSubproduct/)
  assert.match(lib, /export async function updateMarketItemSubproduct/)
  assert.match(lib, /export async function deleteMarketItemSubproduct/)
  assert.match(lib, /export async function listMarketSubproductFilesForAdmin/)
  assert.match(lib, /export async function replaceMarketSubproductFile/)
  assert.match(lib, /export async function deleteMarketSubproductFile/)
  assert.match(lib, /assertMatchingWorkspaceSubject/)
  assert.match(lib, /market_subproduct_files/)
})

test('admin item GET returns v2 subproducts, subproduct files, and bundle summary alongside legacy files', () => {
  assert.match(itemRoute, /listMarketItemSubproductsForAdmin/)
  assert.match(itemRoute, /listMarketSubproductFilesForAdmin/)
  assert.match(itemRoute, /getMarketItemBundleOptionForAdmin/)
  assert.match(itemRoute, /subproducts/)
  assert.match(itemRoute, /subproductFiles/)
  assert.match(itemRoute, /bundleOption/)
})

test('storage helper validates dynamic file types and writes paid files under subproduct prefix', () => {
  assert.match(storage, /export function assertMarketSubproductUploadIsAllowed/)
  assert.match(storage, /mime_allowlist/)
  assert.match(storage, /extension/)
  assert.match(storage, /export function buildMarketSubproductStoragePath/)
  assert.match(storage, /subproducts\/\$\{subproductId\}/)
  assert.match(storage, /fileTypeCode/)
  assert.match(storage, /v\$\{version\}/)
})
