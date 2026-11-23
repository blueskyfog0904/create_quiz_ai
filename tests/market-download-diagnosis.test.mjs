import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, marketImages, loadRoute } from './helpers/market-images-harness.mjs'

// 진단은 route와 같은 권한 선택 함수(market-purchase.ts)를 쓴다.
const { diagnoseMarketFileDownload } = load('src/lib/market-download-diagnosis.ts', {
  '@/lib/market-purchase': load('src/lib/market-purchase.ts', { '@/lib/market-items-server': {} }),
})
const { MARKET_DOWNLOAD_BLOCK_REASON_LABELS } = load('src/lib/admin-orders.ts')

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const SUBPRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '00000000-0000-4000-8000-000000000001'

const item = { id: ITEM_ID, workspace_subject: 'korean', status: 'published', is_active: true, deleted_at: null }
const file = {
  id: FILE_ID, item_id: ITEM_ID, subproduct_id: SUBPRODUCT_ID, file_type_id: 'ft', workspace_subject: 'korean',
  storage_bucket: 'market-files', storage_path: 'a/b.pdf', original_file_name: 'b.pdf', is_active: true, deleted_at: null,
}
const subproduct = { id: SUBPRODUCT_ID, item_id: ITEM_ID, workspace_subject: 'korean', title: '구성', is_active: true, deleted_at: null }
const fileType = { id: 'ft', workspace_subject: 'korean', code: 'pdf', label: 'PDF' }
const entitlement = {
  id: 'ent-1', workspace_subject: 'korean', user_id: USER_ID, item_id: ITEM_ID, scope: 'subproduct',
  subproduct_id: SUBPRODUCT_ID, file_id: null, legacy_asset_kind: null, source_order_id: ORDER_ID, source_purchase_id: null, status: 'active',
}
const refund = { id: 'r1', target_kind: 'v2_order', order_id: ORDER_ID, legacy_purchase_id: null, status: 'pending' }
const normal = { item, file, subproduct, fileType, entitlements: [entitlement], refunds: [] }

// 같은 회원이 같은 상품을 한 번 더 산 주문 B(묶음 → 상품 전체 권한). 구성 1개(주문 A) 뒤 묶음을 사면 두 권한이 함께 살아 있다.
const ORDER_B = '55555555-5555-4555-8555-555555555555'
const entitlementB = { ...entitlement, id: 'ent-b', scope: 'item', subproduct_id: null, source_order_id: ORDER_B }
const refundB = { ...refund, id: 'rb', order_id: ORDER_B }
const ORDER_F = '66666666-6666-4666-8666-666666666666'

// [이름, DB 상태, 기대 사유(null = 다운로드 가능)] — 현재 규칙이 구분하는 모든 경우.
// entitlements는 그 회원이 그 상품에 가진 권한 전부(주문 무관)이고, 관리자 화면이 보는 주문은 ORDER_ID(주문 A)다.
const CASES = [
  ['정상', normal, null],
  ['숨김 상품(구매자는 가능)', { ...normal, item: { ...item, status: 'hidden' } }, null],
  ['상품 없음', { ...normal, item: null }, 'item_missing'],
  ['삭제된 상품', { ...normal, item: { ...item, deleted_at: '2026-01-01T00:00:00Z' } }, 'item_deleted'],
  ['비활성 상품', { ...normal, item: { ...item, is_active: false } }, 'item_inactive'],
  ['임시저장 상품', { ...normal, item: { ...item, status: 'draft' } }, 'item_unpublished'],
  ['보관 상품', { ...normal, item: { ...item, status: 'archived' } }, 'item_unpublished'],
  ['파일 없음', { ...normal, file: null }, 'file_missing'],
  ['삭제된 파일', { ...normal, file: { ...file, is_active: false, deleted_at: '2026-01-01T00:00:00Z' } }, 'file_deleted'],
  ['비활성 파일', { ...normal, file: { ...file, is_active: false } }, 'file_inactive'],
  ['구성 없음', { ...normal, subproduct: null }, 'subproduct_missing'],
  ['비활성 구성', { ...normal, subproduct: { ...subproduct, is_active: false } }, 'subproduct_inactive'],
  ['삭제된 구성', { ...normal, subproduct: { ...subproduct, deleted_at: '2026-01-01T00:00:00Z' } }, 'subproduct_deleted'],
  ['파일 유형 없음', { ...normal, fileType: null }, 'file_type_missing'],
  ['권한 행 없음(구매했는데 권한이 없는 이상 상태)', { ...normal, entitlements: [] }, 'no_entitlement'],
  ['환불된 권한', { ...normal, entitlements: [{ ...entitlement, status: 'refunded' }] }, 'entitlement_refunded'],
  ['회수된 권한', { ...normal, entitlements: [{ ...entitlement, status: 'revoked' }] }, 'entitlement_revoked'],
  ['환불된 권한 + 다시 산 권한', { ...normal, entitlements: [{ ...entitlement, status: 'refunded' }, { ...entitlement, id: 'ent-2' }] }, null],
  ['다른 구성의 권한', { ...normal, entitlements: [{ ...entitlement, subproduct_id: 'other' }] }, 'no_entitlement'],
  ['다른 상품의 권한', { ...normal, entitlements: [{ ...entitlement, item_id: 'other', scope: 'item', subproduct_id: null }] }, 'no_entitlement'],
  ['상품 전체 권한', { ...normal, entitlements: [{ ...entitlement, scope: 'item', subproduct_id: null }] }, null],
  ['파일 권한', { ...normal, entitlements: [{ ...entitlement, scope: 'file', subproduct_id: null, file_id: FILE_ID }] }, null],
  ['다른 파일의 권한', { ...normal, entitlements: [{ ...entitlement, scope: 'file', subproduct_id: null, file_id: 'other' }] }, 'no_entitlement'],
  ['이전 방식 권한(legacy_asset)', { ...normal, entitlements: [{ ...entitlement, scope: 'legacy_asset', subproduct_id: null }] }, 'no_entitlement'],
  ['주문 정보 없는 권한', { ...normal, entitlements: [{ ...entitlement, source_order_id: null }] }, 'entitlement_order_missing'],
  ['환불 대기 중', { ...normal, refunds: [refund] }, 'pending_refund'],
  ['처리가 끝난 환불 요청', { ...normal, refunds: [{ ...refund, status: 'rejected' }, { ...refund, id: 'r2', status: 'canceled' }] }, null],
  ['다른 주문의 환불 대기', { ...normal, refunds: [{ ...refund, order_id: 'other' }] }, null],
  // 권한이 여러 개: 파일을 덮는 권한 중 환불 심사 중이 아닌 주문의 권한으로 받는다. 네 번째 값은 그때 쓰이는(다운로드 기록이 남는) 주문.
  ['권한 2개, 둘 다 정상 → 더 좁은 범위(구성) 권한', { ...normal, entitlements: [entitlement, entitlementB] }, null, ORDER_ID],
  ['권한 2개, 주문 B만 환불 대기', { ...normal, entitlements: [entitlement, entitlementB], refunds: [refundB] }, null, ORDER_ID],
  ['권한 2개, 주문 A만 환불 대기', { ...normal, entitlements: [entitlement, entitlementB], refunds: [refund] }, null, ORDER_B],
  ['권한 2개, 둘 다 환불 대기', { ...normal, entitlements: [entitlement, entitlementB], refunds: [refund, refundB] }, 'pending_refund'],
  ['주문 A 정상 + 주문 B 환불 완료', { ...normal, entitlements: [entitlement, { ...entitlementB, status: 'refunded' }] }, null, ORDER_ID],
  ['주문 A 환불 완료 + 주문 B 정상', { ...normal, entitlements: [{ ...entitlement, status: 'refunded' }, entitlementB] }, null, ORDER_B],
  ['주문 A 환불 완료 + 주문 B 환불 대기', { ...normal, entitlements: [{ ...entitlement, status: 'refunded' }, entitlementB], refunds: [refundB] }, 'pending_refund'],
  ['권한 2개, 주문 B에만 주문 정보 없음', { ...normal, entitlements: [entitlement, { ...entitlementB, source_order_id: null }] }, null, ORDER_ID],
  ['권한 2개, 주문 A에만 주문 정보 없음', { ...normal, entitlements: [{ ...entitlement, source_order_id: null }, entitlementB] }, null, ORDER_B],
  ['권한 2개, 환불 대기 + 주문 정보 없음 → 환불 심사 안내가 먼저', { ...normal, entitlements: [entitlement, { ...entitlementB, source_order_id: null }], refunds: [refund] }, 'pending_refund'],
  ['권한 2개, 둘 다 주문 정보 없음', { ...normal, entitlements: [{ ...entitlement, source_order_id: null }, { ...entitlementB, source_order_id: null }] }, 'entitlement_order_missing'],
  ['파일 권한 + 구성 권한 + 상품 전체 권한 → 파일 권한', {
    ...normal,
    entitlements: [entitlementB, entitlement, { ...entitlement, id: 'ent-f', scope: 'file', subproduct_id: null, file_id: FILE_ID, source_order_id: ORDER_F }],
  }, null, ORDER_F],
  ['같은 범위 권한 2개 → 권한 id가 앞선 것', { ...normal, entitlements: [entitlementB, { ...entitlementB, id: 'ent-a2', source_order_id: ORDER_F }] }, null, ORDER_F],
]

// 관리자 조회(admin-orders-server.ts의 listMarketOrdersForAdmin)가 주문 A를 볼 때 만드는 입력과 같은 재료:
// 회원이 그 상품에 가진 사용 가능 권한 전부 + 주문 A의 회수된 권한, 그리고 그 사용 가능 권한들의 주문에 걸린 v2 pending 환불.
// (lib이 실제로 이렇게 만드는지는 tests/admin-market-orders-contract.test.mjs가 lib을 돌려 확인한다.)
const diagnose = (state) => {
  const active = state.entitlements.filter((row) => row.status === 'active')
  const orderIds = active.map((row) => row.source_order_id)
  return diagnoseMarketFileDownload({
    itemId: ITEM_ID,
    item: state.item,
    file: state.file,
    subproduct: state.subproduct,
    fileTypeExists: Boolean(state.fileType),
    entitlements: [...active, ...state.entitlements.filter((row) => row.status !== 'active' && row.source_order_id === ORDER_ID)],
    pendingRefundOrderIds: state.refunds
      .filter((row) => row.target_kind === 'v2_order' && row.status === 'pending' && orderIds.includes(row.order_id))
      .map((row) => row.order_id),
  })
}

test('진단: 현재 규칙이 구분하는 경우마다 사유가 맞다', () => {
  for (const [name, state, reason, orderId = ORDER_ID] of CASES) {
    assert.deepEqual(diagnose(state), { downloadable: reason === null, reason, entitlementOrderId: reason === null ? orderId : null }, name)
  }
  // 모든 사유 코드를 적어도 한 경우가 다루고, 한글 이름표가 있다.
  assert.deepEqual(
    [...new Set(CASES.map(([, , reason]) => reason).filter(Boolean))].sort(),
    Object.keys(MARKET_DOWNLOAD_BLOCK_REASON_LABELS).sort()
  )
})

// 회원에게 보이는 route 응답(상태 코드·오류 코드)과 진단 사유의 대응
const ROUTE_RESPONSE = (reason) => {
  if (reason === null) return [302, null]
  if (reason === 'pending_refund') return [403, 'PENDING_REFUND']
  if (reason === 'entitlement_order_missing') return [500, 'INVALID_ENTITLEMENT']
  if (reason === 'no_entitlement' || reason === 'entitlement_refunded' || reason === 'entitlement_revoked') return [403, 'FORBIDDEN']
  return [404, 'NOT_FOUND']
}

// 실제 다운로드 route + 실제 market-items-server·market-purchase·market-refunds를, 조회 조건(eq·is)을 그대로 적용하는 가짜 DB로 돌린다.
async function runDownloadRoute(state) {
  const events = []
  const recorded = []
  const tables = {
    market_items: [state.item],
    market_subproduct_files: [state.file],
    market_item_subproducts: [state.subproduct],
    market_file_types: [state.fileType],
    market_entitlements: state.entitlements,
    market_refund_requests: state.refunds,
  }
  const { client } = createFakeAdmin(({ table, ops }) => {
    if (ops.some(([name]) => name === 'insert')) {
      assert.equal(table, 'market_download_events')
      events.push('download-recorded')
      recorded.push(ops.find(([name]) => name === 'insert')[1])
      return { data: {}, error: null }
    }
    const rows = tables[table].filter(Boolean).filter((row) => ops.every(([name, column, value]) => (
      (name !== 'eq' && name !== 'is') || row[column] === value
    )))
    return { data: ops.some(([name]) => name === 'maybeSingle') ? rows[0] ?? null : rows, error: null }
  })
  client.storage = {
    from: () => ({
      createSignedUrl: async () => {
        events.push('signed-url')
        return { data: { signedUrl: 'https://example.invalid/signed' }, error: null }
      },
    }),
  }

  const bypass = { createAdminClient: () => client }
  const workspaceSubject = load('src/lib/workspace-subject.ts')
  const categoryTree = load('src/lib/market-category-tree.ts', { '@/lib/workspace-subject': workspaceSubject })
  const refunds = load('src/lib/market-refunds.ts', {
    '@/lib/credits': {},
    '@/lib/supabase/bypass': bypass,
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/market-purchase-policy': load('src/lib/market-purchase-policy.ts'),
    '@/lib/market-purchase-policy-server': {},
  })
  const itemsServer = load('src/lib/market-items-server.ts', {
    '@/lib/supabase/bypass': bypass,
    '@/lib/market-refunds': refunds,
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': categoryTree,
  })
  const purchase = load('src/lib/market-purchase.ts', { '@/lib/market-items-server': itemsServer })
  const { route } = loadRoute('src/app/api/market/items/[itemId]/download/route.ts', {
    userId: USER_ID,
    admin: { client },
    mocks: { '@/lib/market-items-server': itemsServer, '@/lib/market-purchase': purchase, '@/lib/market-refunds': refunds },
  })
  const request = new Request(`http://localhost/api/market/items/${ITEM_ID}/download?fileId=${FILE_ID}`)
  request.nextUrl = new URL(request.url)
  const response = await route.GET(request, { params: Promise.resolve({ itemId: ITEM_ID }) })
  return { status: response.status, code: response.status === 302 ? null : (await response.json()).error.code, events, recorded }
}

test('진단은 회원 다운로드 route의 응답과 경우마다 일치하고, route는 권한 반환 순서와 무관하게 같은 결과를 낸다', async () => {
  for (const [name, state, reason, orderId = ORDER_ID] of CASES) {
    // route는 권한을 정렬 없이 읽는다 → DB가 돌려주는 순서를 두 가지(정순·역순)로 돌려도 응답·기록이 같아야 한다.
    for (const entitlements of [state.entitlements, [...state.entitlements].reverse()]) {
      const result = await runDownloadRoute({ ...state, entitlements })
      assert.deepEqual([result.status, result.code], ROUTE_RESPONSE(reason), name)
      // 허용될 때만 서명 URL을 만들고 다운로드 기록을 남긴다.
      assert.deepEqual(result.events, reason === null ? ['signed-url', 'download-recorded'] : [], name)
      if (reason === null) {
        // 다운로드 기록은 실제로 쓰인 권한과 그 주문에 남는다(환불 심사 중인 주문에는 남지 않는다) — 진단이 알린 주문과 같다.
        const [event] = result.recorded
        const used = state.entitlements.find((row) => row.id === event.entitlement_id)
        assert.equal(event.order_id, orderId, name)
        assert.deepEqual([used.status, used.source_order_id], ['active', orderId], name)
        assert.equal(state.refunds.some((row) => row.status === 'pending' && row.order_id === event.order_id), false, name)
        assert.equal(diagnose(state).entitlementOrderId, event.order_id, name)
      }
    }
  }
})

test('다운로드 route와 그 판정 함수는 이 진단이 옮겨 적은 조건 그대로다', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const route = read('src/app/api/market/items/[itemId]/download/route.ts')
  // 판정 순서: 파일(상품·파일·구성) → 파일을 덮는 권한 → 권한별 환불 대기 확인 → 쓸 권한 선택 → 서명 URL → 기록.
  // 권한 범위·순서·선택은 route와 진단이 같은 함수(market-purchase.ts)를 쓴다.
  const diagnosisSource = read('src/lib/market-download-diagnosis.ts')
  for (const shared of ['listMarketSubproductFileV2Entitlements(target, ', 'findMarketSubproductFileV2Entitlement(target, ']) {
    assert.ok(route.includes(shared) && diagnosisSource.includes(shared), shared)
  }
  const v2 = route.slice(route.indexOf('async function handleMarketV2Download'), route.indexOf('async function handleLegacyMarketDownload'))
  const order = ['getActiveMarketSubproductFileForDownload(', 'listMarketSubproductFileV2Entitlements(', 'listPendingMarketRefundScopes(', 'isPendingRefundBlockingFile(', 'findMarketSubproductFileV2Entitlement(', 'createSignedUrl(', 'recordMarketV2DownloadEvent(']
    .map((marker) => v2.indexOf(marker))
  assert.ok(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1])), JSON.stringify(order))

  const itemsServer = read('src/lib/market-items-server.ts')
  const fileRule = itemsServer.slice(itemsServer.indexOf('export async function getActiveMarketSubproductFileForDownload'), itemsServer.indexOf('type DownloadFileCategoryOrder'))
  assert.match(fileRule, /const isDownloadableStatus = item\?\.status === 'published' \|\| item\?\.status === 'hidden'/)
  assert.match(fileRule, /if \(!item \|\| item\.deleted_at !== null \|\| item\.is_active === false \|\| !isDownloadableStatus\) \{\s*return null/)
  assert.match(fileRule, /\.eq\('is_active', true\)\s*\.is\('deleted_at', null\)/)
  assert.match(fileRule, /if \(!subproduct \|\| subproduct\.is_active === false \|\| subproduct\.deleted_at !== null \|\| !fileType\) \{\s*return null/)
  const entitlementRule = itemsServer.slice(itemsServer.indexOf('export async function listMarketV2EntitlementsForItem'), itemsServer.indexOf('export async function getActiveMarketSubproductFileForDownload'))
  assert.match(entitlementRule, /\.eq\('user_id', userId\)\s*\.eq\('item_id', itemId\)\s*\.eq\('status', 'active'\)/)
  const refunds = read('src/lib/market-refunds.ts')
  // 8번: 심사 중 범위는 route 와 관리자 진단이 같은 함수(listPendingMarketRefundScopes + isPendingRefundBlockingFile)로 판단한다.
  const pendingRule = refunds.slice(refunds.indexOf('export async function listPendingMarketRefundScopes'))
  assert.match(pendingRule, /\.eq\('target_kind', 'v2_order'\)\s*\.eq\('status', 'pending'\)\s*\.in\('order_id', ids\)/)
  const adminOrders = read('src/lib/admin-orders-server.ts')
  assert.match(adminOrders, /const pendingScopes = buildPendingMarketRefundScopes\(pendingRequests, /)
  assert.match(adminOrders, /pendingRefundOrderIds: pendingRefundOrderIdsForFile\(file\)/)
})
