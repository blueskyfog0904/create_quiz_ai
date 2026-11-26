import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { adminGuardMocks } from './helpers/market-images-harness.mjs'
import { memberNotificationsServer } from './helpers/member-notifications-harness.mjs'

// 계획 W3-8b(마켓 환불 처리 알림), U1-5(사용자 알림 보강)
const require = createRequire(import.meta.url)
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

function loadModule(path, modules) {
  const code = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  const stubRequire = (name) => {
    if (name in modules) return modules[name]
    // 8번: 순수 규칙 모듈(알림 문구·마감)은 실제 파일을 쓴다.
    if (name === '@/lib/market-refund-rules') return loadModule('../src/lib/market-refund-rules.ts', {})
    return require(name)
  }
  new Function('exports', 'require', code)(loaded.exports, stubRequire)
  return loaded.exports
}

const json = { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } }
const adminSession = (from) => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from,
  }),
})
const adminProfile = { select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: true } }) }) }) }

class MarketRefundConflictError extends Error {}
class MarketRefundShortfallError extends Error {
  requested = 500
  restorable = 300
}

function loadMarketRefundRoute({ approve, reject, insert }) {
  const order = []
  const route = loadModule('../src/app/api/admin/market/refunds/[id]/route.ts', {
    'next/server': json,
    ...adminGuardMocks({ userId: 'admin-1' }),
    '@/lib/supabase/server': adminSession(() => adminProfile),
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        from: () => ({
          // 처리 전 본인 요청 확인(U3-4 검증 반영)이 읽는 요청. 다른 회원의 요청으로 둔다.
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'member-1', requested_refund_credits: 500 }, error: null }) }) }),
        }),
      }),
    },
    // 16번: 회원 알림은 공용 함수가 넣는다(문구는 DB 첫 값으로 그림). 그린 행을 notifications 기록으로 본다.
    '@/lib/member-notifications-server': memberNotificationsServer({
      insert: async (row) => {
        order.push({ table: 'notifications', row })
        return insert ? insert() : { error: null }
      },
    }),
    '@/lib/market-refunds': {
      MarketRefundConflictError,
      MarketRefundShortfallError,
      approveMarketRefund: async () => {
        order.push('approve')
        return approve()
      },
      rejectMarketRefund: async () => {
        order.push('reject')
        return reject()
      },
      // 8번: 거부 사유 코드·대표 정산·새 오류 종류
      MARKET_REFUND_REJECT_CODES: ['TARGET_CHANGED', 'PROVIDED_CONFIRMED', 'OTHER'],
      MarketRefundNeedsOwnerError: class extends Error {},
      MarketRefundRuleError: class extends Error {},
      settleMarketRefundByOwner: async () => ({}),
      getMarketRefundOwnerContext: async () => null,
    },
  })
  const patch = (body) => route.PATCH({ json: async () => body }, { params: Promise.resolve({ id: 'request-1' }) })
  return { order, patch }
}

async function silenced(run) {
  const original = console.error
  const logged = []
  console.error = (...args) => logged.push(args)
  try {
    return { result: await run(), logged }
  } finally {
    console.error = original
  }
}

test('market refund approval notifies the member with the restored amount after success', async () => {
  // 요청량 500 중 300만 복구된 부족분 승인: 알림에는 실제 복구량을 쓴다.
  const { order, patch } = loadMarketRefundRoute({
    approve: () => ({ id: 'request-1', user_id: 'member-1', requested_refund_credits: 500, approved_refund_credits: 300 }),
  })

  const response = await patch({ action: 'approve' })
  assert.equal(response.status, 200)
  assert.equal(response.body.success, true)
  assert.equal(order[0], 'approve')
  assert.equal(order.length, 2)
  assert.equal(order[1].table, 'notifications')
  assert.equal(order[1].row.user_id, 'member-1')
  assert.equal(order[1].row.link, '/mypage/credits')
  assert.equal(order[1].row.is_read, false)
  assert.match(order[1].row.message, /300 크레딧/)
  assert.doesNotMatch(order[1].row.message, /500/)
})

// 8번: 거부 사유는 필수이고 회원에게 그대로 안내한다(분쟁 대비 — 회원이 이유를 알아야 한다).
test('market refund rejection notifies the member with the required reject reason', async () => {
  const { order, patch } = loadMarketRefundRoute({
    reject: () => ({ id: 'request-1', user_id: 'member-1', approved_refund_credits: null, admin_note: '받은 자료로 확인됨' }),
  })

  const missing = await patch({ action: 'reject' })
  assert.equal(missing.status, 400)
  assert.deepEqual(order, [], '사유 없이 거부하지 않는다')

  const response = await patch({ action: 'reject', rejectCode: 'PROVIDED_CONFIRMED', adminNote: '받은 자료로 확인됨' })
  assert.equal(response.status, 200)
  assert.equal(order[0], 'reject')
  assert.equal(order[1].row.user_id, 'member-1')
  assert.match(order[1].row.title, /거절/)
  assert.equal(order[1].row.link, '/mypage/support')
  assert.match(order[1].row.message, /사유: 받은 자료로 확인됨/)
})

test('a failed or throwing notification never changes the refund response and reports notificationFailed without member ids', async () => {
  const failures = [
    () => ({ error: { code: '42501', message: 'member-1 denied' } }),
    () => {
      throw new Error('member-1 network down')
    },
  ]
  for (const insert of failures) {
    const { patch } = loadMarketRefundRoute({
      approve: () => ({ id: 'request-1', user_id: 'member-1', approved_refund_credits: 500 }),
      insert,
    })
    const { result, logged } = await silenced(() => patch({ action: 'approve' }))
    assert.equal(result.status, 200)
    assert.equal(result.body.success, true)
    // 16번 6절: 실패는 같은 칸(notificationFailed)으로 화면에 알린다. 로그에는 회원 id 가 없다(공용 함수가 오류 코드만 남김).
    assert.equal(result.body.notificationFailed, true)
    assert.doesNotMatch(JSON.stringify(logged), /member-1/)
  }
})

test('shortfall, conflict and other errors send no notification', async () => {
  const errors = [
    [new MarketRefundShortfallError('부족'), 409],
    [new MarketRefundConflictError('이미 처리됨'), 409],
    [new Error('실패'), 500],
  ]
  for (const [error, status] of errors) {
    for (const action of ['approve', 'reject']) {
      const fail = () => {
        throw error
      }
      const { order, patch } = loadMarketRefundRoute({ approve: fail, reject: fail })
      const response = await patch(action === 'reject' ? { action, rejectCode: 'OTHER', adminNote: '요건 미달' } : { action })
      assert.equal(response.status, status)
      assert.deepEqual(order, [action])
    }
  }
})

test('the admin credit grant notification links to the credits page', () => {
  // 16번: 지급 route 는 공용 함수에 종류만 넘기고, 링크는 종류 규칙(코드)에 있다.
  const route = read('../src/app/api/admin/users/credits/route.ts')
  assert.match(route, /sendMemberNotification\(\{\s+kind: 'creditGranted',/)
  assert.match(read('../src/lib/member-notifications.ts'), /creditGranted: \{[\s\S]{0,300}?link: '\/mypage\/credits',/)
  assert.ok(existsSync(new URL('../src/app/(solvook)/mypage/credits/page.tsx', import.meta.url)))
})

// 13번 5절: 답변 저장은 서버 키 DB 함수가 하고, 알림 문구는 DB(support_page_content.member)에서 읽는다.
function loadTicketRoute(notificationError) {
  const route = loadModule('../src/app/api/admin/support/tickets/[id]/route.ts', {
    'next/server': json,
    ...adminGuardMocks({ userId: 'admin-1' }),
    // DB 함수와 회원 알림은 서버 키(bypass)로 부른다. 세션으로 알림을 넣으면 이 테스트가 실패한다.
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        rpc: async (name) => {
          assert.equal(name, 'save_support_ticket_answer')
          return { data: { ticket: { id: 'ticket-1', user_id: 'member-1', subject: '문의' }, isEdit: false, historyId: null, replayed: false }, error: null }
        },
      }),
    },
    // 16번: 회원 알림은 공용 함수(서버 키)로 넣는다. 세션으로 알림을 넣는 길은 없다.
    '@/lib/member-notifications-server': memberNotificationsServer({ insert: async () => ({ error: notificationError }) }),
    '@/lib/admin-request-meta': loadModule('../src/lib/admin-request-meta.ts', {}),
    '@/lib/support-page-content-server': {
      getSupportPageContent: async () => ({
        revision: 1,
        member: { answerCreatedNotificationTitle: '답변 알림', answerCreatedNotificationMessage: '제목: {문의제목}', answerEditedNotificationTitle: '수정 알림', answerEditedNotificationMessage: '수정: {문의제목}' },
        admin: { templateBlankMarker: '○○', answerEditReasonGuide: '', notifyOnAnswerEdit: true, accessLogRetentionYears: 2 },
      }),
    },
    '@/lib/support-page-content': loadModule('../src/lib/support-page-content.ts', {}),
    '@/lib/support-reply-template': loadModule('../src/lib/support-reply-template.ts', {}),
  })
  const body = { adminResponse: '답변', expectedSha256: '0'.repeat(64), operationKey: '55555555-5555-4555-8555-555555555555' }
  return () => route.PATCH({ json: async () => body, headers: new Headers() }, { params: Promise.resolve({ id: 'ticket-1' }) })
}

test('the ticket reply route reports notificationFailed only when the notification insert fails', async () => {
  const ok = await loadTicketRoute(null)()
  assert.equal(ok.status, 200)
  assert.equal(ok.body.success, true)
  assert.equal('notificationFailed' in ok.body, false)

  const { result, logged } = await silenced(loadTicketRoute({ code: '42501', message: 'member-1 denied' }))
  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.ticket.id, 'ticket-1')
  assert.equal(result.body.notificationFailed, true)
  assert.doesNotMatch(JSON.stringify(logged), /member-1/)
})

test('the admin support screen warns when the reply was saved without a member notification', () => {
  const client = read('../src/app/(admin)/admin/support/support-client.tsx')
  assert.match(
    client,
    /if \(result\.notificationFailed\) \{\s+toast\.warning\('답변은 저장했지만 회원 알림을 만들지 못했습니다\.'\)\s+\} else \{\s+toast\.success\('답변이 등록되었습니다\.'\)/
  )
})

test('the mypage notifications page lists only my rows, paginated, and never writes', () => {
  const page = read('../src/app/(solvook)/mypage/notifications/page.tsx')
  // 마이페이지 메뉴는 공통 왼쪽 메뉴(모든 마이페이지 화면)에 있다(2026-11-19)
  const home = read('../src/app/(solvook)/mypage/_components/mypage-side-nav.tsx')

  assert.doesNotMatch(page, /'use client'/)
  assert.match(page, /const userId = await getRequestAuthUserId\(\)\s+if \(!userId\) \{\s+redirect\(/)
  // 세션 클라이언트(RLS 적용)로만 읽고, 두 조회 모두 본인 행으로 좁힌다.
  assert.match(page, /import \{ createClient \} from '@\/lib\/supabase\/server'/)
  assert.doesNotMatch(page, /createAdminClient|supabase\/bypass/)
  assert.equal([...page.matchAll(/\.from\('notifications'\)/g)].length, 2)
  assert.equal([...page.matchAll(/\.eq\('user_id', userId\)/g)].length, 2)
  // 최신순, 한 쪽 분량만 읽는다.
  assert.match(page, /\.order\('created_at', \{ ascending: false \}\)/)
  assert.match(page, /getListPagination\(count \?\? 0, requestedPage, undefined\)/)
  assert.match(page, /\.range\(pagination\.offset, pagination\.offset \+ pagination\.pageSize - 1\)/)
  assert.match(page, /\?page=\$\{pagination\.page - 1\}/)
  assert.match(page, /\?page=\$\{pagination\.page \+ 1\}/)
  // 조회만 한다. 읽음 처리·쓰기 경로가 없다.
  assert.doesNotMatch(page, /\.update\(|\.insert\(|\.delete\(|\.upsert\(|\.rpc\(|fetch\(|is_read/)

  assert.match(home, /href: '\/mypage\/notifications'/)
  // 12번: 이용 제한 중일 때만 안내 화면 메뉴 이름을 넘긴다.
  assert.match(read('../src/app/(solvook)/mypage/layout.tsx'), /<MypageSideNav restrictionLabel=\{restrictionLabel\} \/>/)
})

test('the list page size used by the notifications page is 20', () => {
  const { getListPagination } = loadModule('../src/lib/list-pagination.ts', {})
  assert.deepEqual(getListPagination(45, '2', undefined), { totalCount: 45, page: 2, pageSize: 20, totalPages: 3, offset: 20 })
  // 범위를 벗어난 쪽 번호는 마지막 쪽으로 맞춘다.
  assert.equal(getListPagination(45, '99', undefined).page, 3)
  assert.equal(getListPagination(0, 'x', undefined).offset, 0)
})
