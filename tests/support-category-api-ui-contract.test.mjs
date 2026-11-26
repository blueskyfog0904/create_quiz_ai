import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const userCategoriesRoute = readFileSync(new URL('../src/app/api/support/categories/route.ts', import.meta.url), 'utf8')
const supportRoute = readFileSync(new URL('../src/app/api/support/route.ts', import.meta.url), 'utf8')
const adminCategoriesRoute = readFileSync(new URL('../src/app/api/admin/support/categories/route.ts', import.meta.url), 'utf8')
const adminCategoryRoute = readFileSync(new URL('../src/app/api/admin/support/categories/[id]/route.ts', import.meta.url), 'utf8')
const adminTicketRoute = readFileSync(new URL('../src/app/api/admin/support/tickets/[id]/route.ts', import.meta.url), 'utf8')
const userSupportPage = readFileSync(new URL('../src/app/(solvook)/mypage/support/page.tsx', import.meta.url), 'utf8')
const userSupportClient = readFileSync(new URL('../src/app/(solvook)/mypage/support/_components/support-view.tsx', import.meta.url), 'utf8')
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
  // 옛 슬랙 직접 호출은 없앴다. 관리자 알림은 DB의 관리자 이벤트(support_ticket_created)로 간다.
  assert.doesNotMatch(supportRoute, /sendSlackNotification|lib\/slack/)
})

test('admin support APIs manage categories by soft delete and replies through an admin ticket route', () => {
  assert.match(adminCategoriesRoute, /support_ticket_categories/)
  assert.match(adminCategoriesRoute, /requireAdminApiPermission\('support\.manage'\)/)
  assert.match(adminCategoryRoute, /deleted_at/)
  assert.match(adminCategoryRoute, /is_active: false/)
  assert.doesNotMatch(adminCategoryRoute, /\.delete\(/)
  assert.match(adminTicketRoute, /admin_response/)
  assert.match(adminTicketRoute, /responded_at/)
  assert.match(adminTicketRoute, /notifications/)
  assert.match(adminTicketRoute, /requireAdminApiPermission\('support\.manage'\)/)
})

test('support pages pass categories and render category-first UX with admin filters', () => {
  assert.match(userSupportPage, /support_ticket_categories/)
  assert.match(userSupportPage, /category_id/)
  assert.match(userSupportClient, /texts\.categoryLabel/)
  assert.match(userSupportClient, /selectedCategoryId/)
  assert.match(userSupportClient, /category_snapshot/)
  // 13번 9절: '미분류' 같은 화면 문구는 DB(support_page_content.member.uncategorizedLabel)에서 온다.
  assert.match(userSupportClient, /texts\.uncategorizedLabel/)
  assert.doesNotMatch(userSupportClient, /미분류/)
  assert.match(adminSupportPage, /support_ticket_categories/)
  assert.match(adminSupportPage, /searchParams/)
  assert.match(adminSupportClient, /카테고리 관리/)
  assert.match(adminSupportClient, /문의 목록/)
  assert.match(adminSupportClient, /categoryFilter/)
  assert.match(adminSupportClient, /soft delete|숨김|삭제/)
})


test('user support inquiry form shows the category guide as a plain list (no icon cards)', () => {
  // 카테고리 안내는 DB 값(help_text·guide 항목)을 "·" 목록으로만 보인다. 코드에 박힌 아이콘·설명 카드는 없앴다(2026-11-19).
  assert.doesNotMatch(userSupportClient, /getGuideCardMeta|bg-slate-950|구매한 자료명|환불 요청 사유/)
  assert.match(userSupportClient, /selectedCategoryHelpId/)
  assert.match(userSupportClient, /aria-describedby/)
  assert.match(userSupportClient, /selectedGuideItems\.map\(\(item\) => \(/)
})

test('13번 7절: 숨긴 카테고리는 [다시 사용] route 로 되살리고, 카테고리 쓰기는 작업 기록에 남는다', () => {
  const restoreRoute = readFileSync(new URL('../src/app/api/admin/support/categories/[id]/restore/route.ts', import.meta.url), 'utf8')
  assert.match(restoreRoute, /requireAdminApiPermission\('support\.manage'\)/)
  assert.match(restoreRoute, /deleted_at: null,\s+is_active: true,/)
  assert.match(restoreRoute, /\.not\('deleted_at', 'is', null\)/)
  assert.doesNotMatch(restoreRoute, /sort_order:/)
  assert.match(restoreRoute, /action: 'support_category_restore'/)
  assert.match(adminCategoriesRoute, /action: 'support_category_create'/)
  assert.match(adminCategoryRoute, /action: 'support_category_update'/)
  assert.match(adminCategoryRoute, /action: 'support_category_hide'/)
  for (const source of [restoreRoute, adminCategoriesRoute, adminCategoryRoute]) {
    assert.match(source, /request: adminRequestMeta\(request\)/)
  }
  // 숨긴 카테고리를 '사용' 체크로 켜려 하면 거부, slug 잠금 오류는 안내 문장으로
  assert.match(adminCategoryRoute, /current\.deleted_at && !current\.is_active && parsed\.data\.isActive === true/)
  assert.match(adminCategoryRoute, /SUPPORT_CATEGORY_SLUG_LOCKED/)
  // 화면: 사용 중/숨김 나눔, [다시 사용], 잠긴 카테고리는 코드 칸을 막음
  assert.match(adminSupportClient, /hiddenCategories\.map\(/)
  assert.match(adminSupportClient, /다시 사용/)
  assert.match(adminSupportClient, /disabled=\{editingLocked\}/)
})
