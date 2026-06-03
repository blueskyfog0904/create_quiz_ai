import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const generateProductsClientPath = new URL('../src/app/(admin)/admin/generate/products/generate-products-client.tsx', import.meta.url)
const generateMenuServerPath = new URL('../src/lib/generate-menu-server.ts', import.meta.url)
const editPagePath = new URL('../src/app/(admin)/admin/generate/products/[postId]/edit/page.tsx', import.meta.url)
const editClientPath = new URL('../src/app/(admin)/admin/generate/products/[postId]/edit/generate-product-edit-client.tsx', import.meta.url)

const generateProductsClient = readFileSync(generateProductsClientPath, 'utf8')
const generateMenuServer = readFileSync(generateMenuServerPath, 'utf8')

test('admin generate product list navigates to an edit page instead of opening an edit modal', () => {
  assert.match(generateProductsClient, /from 'next\/navigation'/)
  assert.match(generateProductsClient, /withAdminWorkspaceSubject/)
  assert.match(generateProductsClient, /router\.push\(withAdminWorkspaceSubject\(`\/admin\/generate\/products\/\$\{post\.id\}\/edit`, workspaceSubject\)\)/)
  assert.doesNotMatch(generateProductsClient, /openEditPostDialog/)
  assert.doesNotMatch(generateProductsClient, /getGenerateListboardPostItemsAction/)
  assert.match(generateProductsClient, /<DialogTitle>리스트보드 게시글 추가<\/DialogTitle>/)
})

test('admin generate product edit route loads a post and its items for the active workspace subject', () => {
  assert.equal(existsSync(editPagePath), true)
  const editPage = readFileSync(editPagePath, 'utf8')

  assert.match(editPage, /requireAdmin\(\)/)
  assert.match(editPage, /resolveAdminWorkspaceSubject/)
  assert.match(editPage, /getGenerateListboardPostForAdmin/)
  assert.match(editPage, /listGenerateListboardPostItemsForAdmin/)
  assert.match(editPage, /withAdminWorkspaceSubject\('\/admin\/generate\/products', workspaceSubject\)/)
  assert.match(editPage, /GenerateProductEditClient/)
})

test('admin generate product edit page client reuses existing update and item actions', () => {
  assert.equal(existsSync(editClientPath), true)
  const editClient = readFileSync(editClientPath, 'utf8')

  assert.match(editClient, /'use client'/)
  assert.match(editClient, /updateGenerateListboardPostAction/)
  assert.match(editClient, /createGenerateListboardPostItemAction/)
  assert.match(editClient, /updateGenerateListboardPostItemAction/)
  assert.match(editClient, /archiveGenerateListboardPostItemAction/)
  assert.match(editClient, /withAdminWorkspaceSubject\('\/admin\/generate\/products', workspaceSubject\)/)
  assert.match(editClient, /문제생성 상품 수정/)
})

test('server exposes a workspace-safe single generate listboard post lookup', () => {
  assert.match(generateMenuServer, /export async function getGenerateListboardPostForAdmin/)
  assert.match(generateMenuServer, /\.from\('generate_listboard_posts'\)/)
  assert.match(generateMenuServer, /\.eq\('id', postId\)/)
  assert.match(generateMenuServer, /\.is\('deleted_at', null\)/)
  assert.match(generateMenuServer, /workspaceSubject && post\.workspace_subject !== workspaceSubject/)
})
