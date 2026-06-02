import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const userCategoriesRoute = readFileSync(new URL('../src/app/api/support/categories/route.ts', import.meta.url), 'utf8')
const supportRoute = readFileSync(new URL('../src/app/api/support/route.ts', import.meta.url), 'utf8')
const adminCategoriesRoute = readFileSync(new URL('../src/app/api/admin/support/categories/route.ts', import.meta.url), 'utf8')
const adminCategoryRoute = readFileSync(new URL('../src/app/api/admin/support/categories/[id]/route.ts', import.meta.url), 'utf8')
const adminTicketRoute = readFileSync(new URL('../src/app/api/admin/support/tickets/[id]/route.ts', import.meta.url), 'utf8')
const userSupportPage = readFileSync(new URL('../src/app/(dashboard)/mypage/support/page.tsx', import.meta.url), 'utf8')
const userSupportClient = readFileSync(new URL('../src/app/(dashboard)/mypage/support/support-client.tsx', import.meta.url), 'utf8')
const adminSupportPage = readFileSync(new URL('../src/app/(admin)/admin/support/page.tsx', import.meta.url), 'utf8')
const adminSupportClient = readFileSync(new URL('../src/app/(admin)/admin/support/support-client.tsx', import.meta.url), 'utf8')

test('user support APIs read active categories and create/update/delete tickets through hardened RPCs', () => {
  assert.match(userCategoriesRoute, /support_ticket_categories/)
  assert.match(userCategoriesRoute, /is_active/)
  assert.match(userCategoriesRoute, /deleted_at/)
  assert.match(supportRoute, /create_support_ticket/)
  assert.match(supportRoute, /update_own_pending_support_ticket/)
  assert.match(supportRoute, /soft_delete_own_support_ticket/)
  assert.match(supportRoute, /categoryId/)
  assert.match(supportRoute, /카테고리|문의 유형/)
  assert.match(supportRoute, /sendSlackNotification[\s\S]+카테고리/)
})

test('admin support APIs manage categories by soft delete and replies through an admin ticket route', () => {
  assert.match(adminCategoriesRoute, /support_ticket_categories/)
  assert.match(adminCategoriesRoute, /is_admin/)
  assert.match(adminCategoryRoute, /deleted_at/)
  assert.match(adminCategoryRoute, /is_active: false/)
  assert.doesNotMatch(adminCategoryRoute, /\.delete\(/)
  assert.match(adminTicketRoute, /admin_response/)
  assert.match(adminTicketRoute, /responded_at/)
  assert.match(adminTicketRoute, /notifications/)
  assert.match(adminTicketRoute, /is_admin/)
})

test('support pages pass categories and render category-first UX with admin filters', () => {
  assert.match(userSupportPage, /support_ticket_categories/)
  assert.match(userSupportPage, /category_id/)
  assert.match(userSupportClient, /문의 카테고리|문의 유형/)
  assert.match(userSupportClient, /selectedCategoryId/)
  assert.match(userSupportClient, /category_snapshot/)
  assert.match(userSupportClient, /미분류/)
  assert.match(adminSupportPage, /support_ticket_categories/)
  assert.match(adminSupportPage, /searchParams/)
  assert.match(adminSupportClient, /카테고리 관리/)
  assert.match(adminSupportClient, /문의 목록/)
  assert.match(adminSupportClient, /categoryFilter/)
  assert.match(adminSupportClient, /soft delete|숨김|삭제/)
})
