import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { NextResponse, adminGuardMocks, load } from './helpers/market-images-harness.mjs'
import { memberNotificationsServer, seedMemberNotificationTexts } from './helpers/member-notifications-harness.mjs'

// 13번 묶음(docs/plan-bundle13-cs-tools.md 12-1) 가운데 문의 쪽 코드 계약: 답변 저장·수정(5절), 템플릿(6절), 카테고리 복구(7절),
// 문의 화면의 연락처 붙이기·열람 기록(8-2), 고객지원 문구 DB화(9절), 10번 가림 코드 갱신(5-1).
// (열람 기록 전수 시험·다른 화면은 tests/bundle13-cs-tools-contract.test.mjs, DB 는 tests/bundle13-cs-tools-db-contract.test.mjs)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const M1_PATH = 'supabase/migrations/20261217110000_bundle13_cs_tools.sql'
const m1 = existsSync(new URL(`../${M1_PATH}`, import.meta.url)) ? read(M1_PATH) : null

const content = load('src/lib/support-page-content.ts')
const template = load('src/lib/support-reply-template.ts')
const requestMeta = load('src/lib/admin-request-meta.ts')

const TICKET = '22222222-2222-4222-8222-222222222222'
const MEMBER = '11111111-1111-4111-8111-111111111111'
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
// 16번 묶음이 '알림' 화면(member_notification_texts)으로 옮긴 13번 키(16번 계획 5-2 대응표). 코드는 더 읽지 않는다.
const MOVED_TO_BUNDLE16 = ['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle', 'answerEditedNotificationMessage']

// 계획 10-1 표에서 키 목록(표 순서)과 '선택' 키(2번째 칸의 `키`)를 읽는다.
function planKeyTable() {
  const plan = read('docs/plan-bundle13-cs-tools.md')
  const section = plan.slice(plan.indexOf('### 10-1.'), plan.indexOf('### 10-2.'))
  const rows = section.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| 무리') && !line.startsWith('|---'))
  const all = []
  const optional = []
  for (const row of rows) {
    const [, , kind, keys] = row.split('|')
    optional.push(...[...kind.matchAll(/`([a-zA-Z]+)`/g)].map((match) => match[1]))
    all.push(...[...keys.matchAll(/`([a-zA-Z]+)`/g)].map((match) => match[1]))
  }
  return { all, required: all.filter((key) => !optional.includes(key)), optional }
}

function seedPageContent() {
  if (!m1) return null
  const match = m1.match(/\$json_support_page_content\$([\s\S]*?)\$json_support_page_content\$/)
  return match ? JSON.parse(match[1]) : null
}

function makeContent(overrides = {}) {
  const member = Object.fromEntries(content.SUPPORT_PAGE_MEMBER_KEYS.map((key) => [key, `값 ${key}`]))
  return {
    revision: 3,
    member: { ...member, answerCreatedNotificationMessage: '제목: {문의제목}', answerEditedNotificationMessage: '수정: {문의제목}', ...overrides.member },
    admin: { templateBlankMarker: '○○', answerEditReasonGuide: '안내', notifyOnAnswerEdit: true, accessLogRetentionYears: 2, ...overrides.admin },
  }
}

// ─── 9절: 문구 키 ────────────────────────────────────────────────────────────────────────────────
test('필수 키 목록(SUPPORT_PAGE_REQUIRED_KEYS)·전체 키가 계획 10-1 표와 같다(순서 포함, 16번이 옮긴 답변 알림 키 4개 빼고)', () => {
  const table = planKeyTable()
  assert.equal(table.all.length, 46)
  const kept = table.all.filter((key) => !MOVED_TO_BUNDLE16.includes(key))
  assert.deepEqual([...content.SUPPORT_PAGE_MEMBER_KEYS], kept)
  assert.deepEqual([...content.SUPPORT_PAGE_REQUIRED_KEYS], table.required.filter((key) => !MOVED_TO_BUNDLE16.includes(key)))
  assert.equal(content.SUPPORT_PAGE_REQUIRED_KEYS.length, 33)
  // 관리자 칸 이름이 모든 키에 있다
  assert.deepEqual(Object.keys(content.SUPPORT_PAGE_MEMBER_KEY_LABELS), kept)
})

test('M1 첫 값(support_page_content)은 해석되고, 키가 코드 목록과 같다', { skip: !m1 && 'M1 파일 없음' }, () => {
  const seed = seedPageContent()
  assert.ok(seed, 'M1 에 $json_support_page_content$ 값이 있다')
  // 13번 첫 값에는 답변 알림 키가 남아 있다(16번 마이그레이션이 복사한 뒤 정리 스크립트가 지운다). 코드는 그 키를 읽지 않는다.
  assert.deepEqual(Object.keys(seed.member).filter((key) => !MOVED_TO_BUNDLE16.includes(key)), [...content.SUPPORT_PAGE_MEMBER_KEYS])
  const parsed = content.parseSupportPageContent(seed)
  assert.ok(parsed, '첫 값이 해석된다(필수 키가 모두 채워짐)')
  assert.equal(parsed.admin.templateBlankMarker, '○○')
  assert.equal(parsed.admin.accessLogRetentionYears, 2)
  assert.equal('notifyOnAnswerEdit' in parsed.admin, false)
  for (const key of MOVED_TO_BUNDLE16) assert.equal(key in parsed.member, false, key)
  // 알림 문구의 자리표시는 {문의제목} 하나뿐
  for (const key of ['answerCreatedNotificationMessage', 'answerEditedNotificationMessage']) {
    assert.deepEqual([...seed.member[key].matchAll(/\{[^{}]*\}/g)].map((m) => m[0]), ['{문의제목}'], key)
  }
})

test('문구 해석: 필수 키가 없거나 비면 null(오류 화면), 선택 키는 비워도 된다', () => {
  assert.ok(content.parseSupportPageContent(makeContent()))
  assert.equal(content.parseSupportPageContent(null), null)
  assert.equal(content.parseSupportPageContent(makeContent({ member: { pageTitle: '  ' } })), null)
  const missing = makeContent()
  delete missing.member.submitLabel
  assert.equal(content.parseSupportPageContent(missing), null)
  const optional = content.parseSupportPageContent(makeContent({ member: { responseTimeNote: '', answerEditedLabel: '' } }))
  assert.equal(optional.member.responseTimeNote, '')
  const noOptional = makeContent()
  delete noOptional.member.formNotice
  assert.equal(content.parseSupportPageContent(noOptional).member.formNotice, '')
  // 16번: notifyOnAnswerEdit 는 더 읽지 않는다(정리 전 값이 남아 있어도 해석에 영향 없음)
  assert.ok(content.parseSupportPageContent(makeContent({ admin: { notifyOnAnswerEdit: 'yes' } })))
  assert.equal(content.parseSupportPageContent(makeContent({ admin: { templateBlankMarker: '' } })), null)
})

test('문구 저장 검사: 필수 빈 값·모르는 자리표시·빈칸 표시/보관 기간 변경·판 충돌을 거부하고, 통과하면 판을 올린다', () => {
  const current = content.parseSupportPageContent(makeContent())
  const input = (overrides = {}) => ({ revision: 3, member: { ...current.member, ...overrides.member }, admin: { ...overrides.admin } })
  assert.equal(content.validateSupportPageContentInput(input({ member: { formTitle: '' } }), current).ok, false)
  assert.equal(content.validateSupportPageContentInput(input({ admin: { templateBlankMarker: '□□' } }), current).ok, false)
  assert.equal(content.validateSupportPageContentInput(input({ admin: { accessLogRetentionYears: 1 } }), current).ok, false)
  assert.deepEqual(content.validateSupportPageContentInput({ ...input(), revision: 2 }, current), { ok: false, error: 'REVISION_CONFLICT' })
  const ok = content.validateSupportPageContentInput(input({ member: { responseTimeNote: '  평일 10~18시 ' } }), current)
  assert.equal(ok.ok, true)
  assert.equal(ok.content.revision, 4)
  assert.equal(ok.content.member.responseTimeNote, '평일 10~18시')
  assert.equal(ok.content.admin.templateBlankMarker, '○○')
  assert.equal(ok.content.admin.accessLogRetentionYears, 2)
  // 16번: 이 탭은 답변 알림 키·notifyOnAnswerEdit 없이 저장한다(같은 문구를 두 곳에서 고치는 기간을 만들지 않음 — 16번 5-6)
  for (const key of MOVED_TO_BUNDLE16) assert.equal(key in ok.content.member, false, key)
  assert.equal('notifyOnAnswerEdit' in ok.content.admin, false)
})

test('회원 고객지원 화면에 1-5 옛 문구가 남지 않는다(상태 이름만 코드에 남김), 탭 제목도 DB 값', () => {
  const view = read('src/app/(solvook)/mypage/support/_components/support-view.tsx')
  const page = read('src/app/(solvook)/mypage/support/page.tsx')
  // 주석을 빼고, 한글이 남은 곳은 상태 이름 표(STATUS_BADGES)뿐이다.
  const code = view.replace(/\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const statusBlock = code.slice(code.indexOf('const STATUS_BADGES'), code.indexOf('}\n\n', code.indexOf('const STATUS_BADGES')))
  const outside = code.replace(statusBlock, '')
  assert.deepEqual(outside.match(/[가-힣]+/g), null)
  assert.deepEqual(statusBlock.match(/label: '([가-힣]+)'/g), ["label: '대기중'", "label: '처리중'", "label: '답변완료'", "label: '종료'"])
  for (const old of ['빠른 시일 내에', '삭제한 내역은 복구할 수 없습니다', '미분류', '관리자 답변', '문의 등록하기']) {
    assert.ok(!view.includes(old), old)
  }
  // 수정 표시: 이름 값이 비면 숨김, 답변 날짜(responded_at)는 그대로
  assert.match(view, /ticket\.response_edited_at && texts\.answerEditedLabel && \(/)
  assert.match(view, /formatKoreanDate\(ticket\.responded_at\)/)
  // 탭 제목·설명은 generateMetadata 로 DB 값
  assert.doesNotMatch(page, /export const metadata/)
  assert.match(page, /export async function generateMetadata\(\)/)
  assert.match(page, /title: content\.member\.pageTitle/)
  assert.match(page, /texts=\{content\.member\}/)
  // 서버 읽기: unstable_cache + 태그, 실패는 예외(캐시하지 않음), 저장 뒤 revalidateTag(expire: 0)
  const server = read('src/lib/support-page-content-server.ts')
  assert.match(server, /unstable_cache\(async \(\): Promise<SupportPageContent> => \{/)
  assert.match(server, /\{ tags: \[SUPPORT_PAGE_CONTENT_CACHE_TAG\] \}/)
  assert.match(server, /if \(result\.status !== 'ok'\) throw new Error/)
  assert.match(server, /revalidateTag\(SUPPORT_PAGE_CONTENT_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.equal(content.SUPPORT_PAGE_CONTENT_CACHE_TAG, 'support_page_content')
})

// ─── 6절: 템플릿 자리표시·빈칸 ──────────────────────────────────────────────────────────────────────
test('템플릿 자리표시는 코드에 정한 세 개뿐이고, 모르는 {…} 는 거부한다', () => {
  assert.deepEqual([...template.SUPPORT_REPLY_PLACEHOLDERS], ['{사이트이름}', '{문의제목}', '{접수일}'])
  const filled = template.fillSupportReplyTemplate('{사이트이름}입니다. 「{문의제목}」({접수일}) {회원이메일} ○○원', {
    siteName: '문제마켓', ticketSubject: '환불 요청', receivedDate: '2026.11.26',
  })
  assert.equal(filled, '문제마켓입니다. 「환불 요청」(2026.11.26) {회원이메일} ○○원')
  assert.deepEqual(template.findUnknownPlaceholders('{사이트이름} {회원이메일} {전화} {회원이메일}'), ['{회원이메일}', '{전화}'])
  assert.equal(template.validateSupportReplyTemplate({ title: '환불', body: '{사이트이름} ○○' }), null)
  assert.match(template.validateSupportReplyTemplate({ title: '환불', body: '{회원이메일}' }), /쓸 수 없는 자리표시/)
  assert.match(template.validateSupportReplyTemplate({ title: '', body: '본문' }), /이름/)
  assert.match(template.validateSupportReplyTemplate({ title: 'x'.repeat(61), body: '본문' }), /이름/)
  assert.match(template.validateSupportReplyTemplate({ title: '제목', body: 'x'.repeat(4001) }), /본문/)
})

test('빈칸 찾기·나누기와 충돌 확인용 sha256', async () => {
  assert.deepEqual(template.findTemplateBlanks('○○월 ○○일 ○○원', '○○'), [0, 4, 8])
  assert.deepEqual(template.findTemplateBlanks('채움', '○○'), [])
  assert.deepEqual(template.findTemplateBlanks('○○', ''), [])
  assert.deepEqual(template.splitTemplateBlanks('가○○나', '○○'), [{ text: '가', blank: false }, { text: '○○', blank: true }, { text: '나', blank: false }])
  assert.equal(await template.sha256Hex(''), EMPTY_SHA)
  // DB 와 같은 계산(UTF-8 바이트의 sha256 hex)
  const { createHash } = await import('node:crypto')
  assert.equal(await template.sha256Hex('답변 ○○'), createHash('sha256').update('답변 ○○', 'utf8').digest('hex'))
})

test('M1 템플릿 첫 값은 정한 자리표시만 쓴다', { skip: !m1 && 'M1 파일 없음' }, () => {
  const block = m1.slice(m1.indexOf('INSERT INTO public.support_reply_templates'), m1.indexOf(') AS s(title, body, slug, sort_order)'))
  const bodies = [...block.matchAll(/E'((?:[^']|'')*)'/g)].map((match) => match[1])
  assert.equal(bodies.length, 14)
  for (const body of bodies) assert.deepEqual(template.findUnknownPlaceholders(body), [], body.slice(0, 30))
})

// ─── 5절: 답변 route ─────────────────────────────────────────────────────────────────────────────
// 16번: 답변 알림 문구·켜기는 member_notification_texts(공용 보내기 함수)에서 온다.
function answerTexts({ editEnabled = true } = {}) {
  const texts = seedMemberNotificationTexts()
  texts.kinds.supportAnswerCreated.title = '값 answerCreatedNotificationTitle'
  texts.kinds.supportAnswerCreated.message = '제목: {문의제목}'
  texts.kinds.supportAnswerEdited.title = '값 answerEditedNotificationTitle'
  texts.kinds.supportAnswerEdited.message = '수정: {문의제목}'
  texts.kinds.supportAnswerEdited.enabled = editEnabled
  return texts
}

function loadAnswerRoute({ rpcResult = { data: null, error: null }, pageContent = makeContent(), notificationError = null, texts = answerTexts() } = {}) {
  const calls = { rpc: [], notifications: [] }
  const route = load('src/app/api/admin/support/tickets/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        rpc: async (name, args) => (calls.rpc.push({ name, args }), rpcResult),
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: TICKET, admin_response: '최신 답변' }, error: null }) }) }),
        }),
      }),
    },
    '@/lib/member-notifications-server': memberNotificationsServer({
      texts,
      insert: async (row) => (calls.notifications.push({ table: 'notifications', row }), { error: notificationError }),
    }),
    '@/lib/admin-request-meta': requestMeta,
    '@/lib/support-page-content-server': {
      getSupportPageContent: async () => {
        if (pageContent instanceof Error) throw pageContent
        return pageContent
      },
    },
    '@/lib/support-page-content': content,
    '@/lib/support-reply-template': template,
    ...adminGuardMocks({ userId: 'admin-1' }),
  }, [])
  const body = { adminResponse: '답변입니다', expectedSha256: EMPTY_SHA, operationKey: '33333333-3333-4333-8333-333333333333' }
  const patch = async (extra = {}) => {
    const response = await route.PATCH({ json: async () => ({ ...body, ...extra }), headers: new Headers({ 'user-agent': 'UA' }) }, { params: Promise.resolve({ id: TICKET }) })
    return { status: response.status, body: await response.json() }
  }
  return { patch, calls }
}

const savedTicket = { id: TICKET, user_id: MEMBER, subject: '환불 문의', status: 'resolved', admin_response: '답변입니다' }

test('답변 route: 세션 UPDATE·route 작업 기록 없이 save_support_ticket_answer 를 서버 키로 부른다', () => {
  const route = read('src/app/api/admin/support/tickets/[id]/route.ts')
  assert.doesNotMatch(route, /\.update\(/)
  assert.doesNotMatch(route, /recordAdminAudit/)
  assert.doesNotMatch(route, /@\/lib\/supabase\/server/)
  assert.match(route, /requireAdminApiPermission\('support\.manage'\)/)
  assert.match(route, /\.rpc\('save_support_ticket_answer', \{/)
  assert.match(route, /p_request_meta: adminRequestMeta\(request\)/)
  // 빈칸 검사는 DB 함수를 부르기 전에
  assert.ok(route.indexOf('findTemplateBlanks(') < route.indexOf(".rpc('save_support_ticket_answer'"))
})

test('답변 route: 빈칸 표시를 읽지 못하면 저장을 막고(503), 빈칸이 남으면 400 — 둘 다 DB 함수를 부르지 않는다', async () => {
  const unavailable = loadAnswerRoute({ pageContent: new Error('down') })
  assert.equal((await unavailable.patch()).status, 503)
  assert.equal(unavailable.calls.rpc.length, 0)
  const blank = loadAnswerRoute()
  const result = await blank.patch({ adminResponse: '○○원을 돌려드렸습니다' })
  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'SUPPORT_ANSWER_BLANK_LEFT')
  assert.equal(blank.calls.rpc.length, 0)
})

test('답변 route: 첫 답변 알림·수정 알림(설정 켬/끔)·재요청은 알림 없음·문구 DB 값(16번: member_notification_texts)', async () => {
  const first = loadAnswerRoute({ rpcResult: { data: { ticket: savedTicket, isEdit: false, historyId: null, replayed: false }, error: null } })
  const firstResult = await first.patch()
  assert.equal(firstResult.status, 200)
  assert.deepEqual(first.calls.rpc[0].args, {
    p_actor_id: 'admin-1', p_ticket_id: TICKET, p_response: '답변입니다', p_status: null, p_expected_sha256: EMPTY_SHA,
    p_reason: null, p_operation_key: '33333333-3333-4333-8333-333333333333', p_request_meta: { ip: null, user_agent: 'UA' },
  })
  assert.deepEqual(first.calls.notifications.map(({ row }) => [row.type, row.title, row.message, row.link]),
    [['inquiry_reply', '값 answerCreatedNotificationTitle', '제목: 환불 문의', '/mypage/support']])

  const edit = loadAnswerRoute({ rpcResult: { data: { ticket: savedTicket, isEdit: true, historyId: 'h1', replayed: false }, error: null } })
  const editResult = await edit.patch({ reason: '금액 오타' })
  assert.equal(editResult.body.isEdit, true)
  assert.equal(edit.calls.rpc[0].args.p_reason, '금액 오타')
  assert.deepEqual(edit.calls.notifications.map(({ row }) => [row.title, row.message]), [['값 answerEditedNotificationTitle', '수정: 환불 문의']])

  const editQuiet = loadAnswerRoute({
    rpcResult: { data: { ticket: savedTicket, isEdit: true, historyId: 'h1', replayed: false }, error: null },
    texts: answerTexts({ editEnabled: false }),
  })
  const quietResult = await editQuiet.patch({ reason: '오타' })
  assert.equal(quietResult.status, 200)
  assert.equal(editQuiet.calls.notifications.length, 0)
  // 꺼 둔 종류는 실패가 아니다
  assert.equal(quietResult.body.notificationFailed, undefined)

  const replay = loadAnswerRoute({ rpcResult: { data: { ticket: savedTicket, isEdit: false, historyId: null, replayed: true }, error: null } })
  const replayResult = await replay.patch()
  assert.equal(replayResult.body.replayed, true)
  assert.equal(replay.calls.notifications.length, 0)

  const failed = loadAnswerRoute({ rpcResult: { data: { ticket: savedTicket, isEdit: false, historyId: null, replayed: false }, error: null }, notificationError: { code: '42501' } })
  assert.equal((await failed.patch()).body.notificationFailed, true)
})

test('답변 route: DB 함수 오류 코드를 안내로 바꾸고, 충돌이면 최신 답변을 함께 준다', async () => {
  const expected = {
    SUPPORT_ANSWER_INPUT_INVALID: 400, SUPPORT_ANSWER_ACTOR_NOT_ALLOWED: 403, SUPPORT_TICKET_NOT_FOUND: 404,
    SUPPORT_TICKET_DELETED_BY_MEMBER: 409, MEMBER_WITHDRAWN: 409, SUPPORT_ANSWER_CONFLICT: 409,
    SUPPORT_ANSWER_REASON_REQUIRED: 400, SUPPORT_ANSWER_UNCHANGED: 400,
  }
  for (const [code, status] of Object.entries(expected)) {
    const route = loadAnswerRoute({ rpcResult: { data: null, error: { message: code } } })
    const result = await route.patch()
    assert.equal(result.status, status, code)
    assert.equal(result.body.code, code)
    assert.equal(route.calls.notifications.length, 0)
  }
  const conflict = await loadAnswerRoute({ rpcResult: { data: null, error: { message: 'SUPPORT_ANSWER_CONFLICT' } } }).patch()
  assert.equal(conflict.body.latest.admin_response, '최신 답변')
  const unknown = await loadAnswerRoute({ rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } } }).patch()
  assert.equal(unknown.status, 500)
  if (m1) {
    // route 가 아는 코드는 모두 M1 의 저장 함수(또는 탈퇴 트리거)가 내는 코드다
    for (const code of Object.keys(expected).filter((code) => code !== 'MEMBER_WITHDRAWN')) assert.ok(m1.includes(`'${code}'`), code)
  }
})

test('관리자 문의 상세: [답변 수정]은 답변이 있고 회원이 지우지 않은 문의에만, 사유·안내·이전 답변(열람 기록)', () => {
  const edit = read('src/app/(admin)/admin/support/ticket-answer-edit.tsx')
  const client = read('src/app/(admin)/admin/support/support-client.tsx')
  assert.match(edit, /if \(!ticket\.admin_response \|\| ticket\.is_deleted_by_user\) return null/)
  assert.match(edit, /회원은 고친 글만 봅니다\. 이전 글은 기록으로 남습니다\./)
  assert.match(edit, /expectedSha256: await sha256Hex\(ticket\.admin_response \?\? ''\)/)
  assert.match(edit, /reason: reason\.trim\(\)/)
  assert.match(edit, /maxLength=\{ANSWER_REASON_MAX\}/)
  assert.match(edit, /fetch\(`\/api\/admin\/support\/tickets\/\$\{ticket\.id\}\/answer-revisions`\)/)
  assert.match(edit, /result\.code === 'SUPPORT_ANSWER_CONFLICT'/)
  assert.match(client, /reasonGuide=\{pageContent\?\.admin\.answerEditReasonGuide \|\| null\}/)
  // 첫 답변도 sha256(빈 글)·요청 키를 보내고, 빈칸이 남으면 버튼을 막는다
  assert.match(client, /expectedSha256: await sha256Hex\(selectedTicket\.admin_response \?\? ''\)/)
  assert.match(client, /operationKey: answerOperationKey/)
  assert.match(client, /disabled=\{submitting \|\| !response\.trim\(\) \|\| !blankMarker \|\| responseBlanksLeft\}/)
  // 템플릿 넣기: 그 문의 카테고리 먼저, 쓰던 글이 있으면 확인
  const tools = read('src/app/(admin)/admin/support/reply-template-tools.tsx')
  assert.match(tools, /template\.category_id === ticket\.category_id/)
  // 20번 5단계: 브라우저 확인 창 → 공통 확인 창(유형 가, 같은 자리에서 먼저 묻기)
  assert.match(tools, /if \(currentText\.trim\(\) && !\(await ask\(\{\s+title: '쓰던 답변을 이 템플릿으로 바꿀까요\?'/)
})

function loadRevisionsRoute({ withdrawn = false, revisions = [{ id: 'r1', previous_response: '이전', reason: '오타' }], logged = true } = {}) {
  const accessCalls = []
  const route = load('src/app/api/admin/support/tickets/[id]/answer-revisions/route.ts', {
    'next/server': { NextResponse },
    '@/lib/admin-orders': { UUID_PATTERN: /^[0-9a-f-]{36}$/ },
    ...adminGuardMocks({ userId: 'admin-1' }),
    '@/lib/admin-member-access-log-server': { recordMemberAccess: async (input) => (accessCalls.push(input), logged) },
    '@/lib/admin-request-meta': requestMeta,
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        from: (table) => {
          const query = {
            select: () => query, eq: () => query, order: async () => ({ data: revisions, error: null }),
            maybeSingle: async () => ({ data: table === 'support_tickets' ? { user_id: MEMBER } : null, error: null }),
          }
          return query
        },
      }),
    },
    '@/lib/withdrawn-member-redaction-server': { readWithdrawnUserIdsForRedaction: async () => new Set(withdrawn ? [MEMBER] : []) },
  }, [])
  return { get: () => route.GET({ headers: new Headers() }, { params: Promise.resolve({ id: TICKET }) }), accessCalls }
}

test('이전 답변 route: support.manage, 탈퇴 회원 404, 보이기 전에 열람 기록(support.ticket), 기록 실패면 보이지 않음', async () => {
  const source = read('src/app/api/admin/support/tickets/[id]/answer-revisions/route.ts')
  assert.match(source, /requireAdminApiPermission\('support\.manage'\)/)
  const ok = loadRevisionsRoute()
  const response = await ok.get()
  assert.equal(response.status, 200)
  assert.deepEqual(ok.accessCalls.map(({ screen, memberIds, fields }) => ({ screen, memberIds, fields })),
    [{ screen: 'support.ticket', memberIds: [MEMBER], fields: ['answer_history'] }])
  assert.equal(ok.accessCalls[0].context.ticketId, TICKET)
  const withdrawn = loadRevisionsRoute({ withdrawn: true })
  assert.equal((await withdrawn.get()).status, 404)
  assert.equal(withdrawn.accessCalls.length, 0)
  const empty = loadRevisionsRoute({ revisions: [] })
  assert.equal((await empty.get()).status, 200)
  assert.equal(empty.accessCalls.length, 0)
  const notLogged = loadRevisionsRoute({ logged: false })
  const blocked = await notLogged.get()
  assert.equal(blocked.status, 503)
  assert.equal((await blocked.json()).revisions, undefined)
})

// ─── 8-2: 문의 화면 연락처 ──────────────────────────────────────────────────────────────────────────
test('문의 목록: profiles 를 끼워 읽지 않고 attachMemberContacts(support.list, email)로 붙이며, 전화는 싣지 않는다', () => {
  const page = read('src/app/(admin)/admin/support/page.tsx')
  const columns = page.slice(page.indexOf('const TICKET_COLUMNS'), page.indexOf('` as const'))
  assert.doesNotMatch(columns, /profiles|phone|email/)
  assert.doesNotMatch(page, /\.from\('profiles'\)/)
  assert.match(page, /await attachMemberContacts\(\{\s+access,\s+screen: 'support\.list',/)
  assert.match(page, /fields: \['email'\],/)
  assert.match(page, /shape: \(row, contact\): Ticket => \(\{ \.\.\.row, profiles: contact \? \{ email: contact\.email, phone: null \} : null \}\)/)
  // 목록 행과 바로 여는 문의 모두에 붙인다
  assert.match(page, /const listRows = \[\.\.\.\(ticketRows \?\? \[\]\), \.\.\.\(linkedTicketRow \? \[linkedTicketRow\] : \[\]\)\]/)
  // 검색어 원문은 기록 context 에 넣지 않는다
  const attach = page.slice(page.indexOf('await attachMemberContacts('), page.indexOf('const tickets ='))
  assert.doesNotMatch(attach, /queryText|keyword[,}]|q:/)
})

function loadSummaryRoute({ logged = true, withdrawnContact = false } = {}) {
  const accessCalls = []
  const route = load('src/app/api/admin/support/tickets/[id]/member-summary/route.ts', {
    'next/server': { NextResponse },
    '@/lib/admin-orders': { UUID_PATTERN: /^[0-9a-f-]{36}$/ },
    '@/lib/admin-member-detail-server': { getAdminMemberSummary: async () => ({ otherTickets: { failed: false, data: 1 } }) },
    ...adminGuardMocks({ userId: 'admin-1' }),
    '@/lib/admin-member-access-log-server': {
      readMemberContacts: async () => new Map(withdrawnContact ? [] : [[MEMBER, { id: MEMBER, email: 'm@test.com', phone: '010-1234-5678', display_tag: null }]]),
      recordMemberAccess: async (input) => (accessCalls.push(input), logged),
    },
    '@/lib/admin-request-meta': requestMeta,
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: MEMBER }, error: null }) }) }) }) }),
    },
    '@/lib/withdrawn-member-redaction-server': { readWithdrawnUserIdsForRedaction: async () => new Set() },
  }, [])
  return { get: async () => (await route.GET({ headers: new Headers() }, { params: Promise.resolve({ id: TICKET }) })).json(), accessCalls }
}

test('문의 상세 연락처: 회원 요약 route 가 열람 기록(support.ticket, email·phone)을 먼저 남기고, 실패하면 가린다', async () => {
  const ok = loadSummaryRoute()
  const body = await ok.get()
  assert.deepEqual(body.contact, { email: 'm@test.com', phone: '010-1234-5678' })
  assert.equal(body.contactMasked, false)
  assert.deepEqual(ok.accessCalls.map(({ screen, fields, memberIds }) => ({ screen, fields, memberIds })), [{ screen: 'support.ticket', fields: ['email', 'phone'], memberIds: [MEMBER] }])
  const failed = await loadSummaryRoute({ logged: false }).get()
  assert.equal(failed.contact, null)
  assert.equal(failed.contactMasked, true)
  // 탈퇴(연락처 없음)면 기록하지 않는다
  const gone = loadSummaryRoute({ withdrawnContact: true })
  assert.equal((await gone.get()).contact, null)
  assert.equal(gone.accessCalls.length, 0)
})

// ─── 5-1: 10번 가림 코드 ────────────────────────────────────────────────────────────────────────────
test('10번 가림 종류·칸 목록이 TS 여러 곳과 DB(M1 의 redact_member_text)에서 같다', () => {
  const route = read('src/app/api/admin/users/[id]/withdrawal/route.ts')
  const lib = read('src/lib/member-withdrawal.ts')
  const server = read('src/lib/member-withdrawal-server.ts')
  const panel = read('src/app/(admin)/admin/users/[id]/member-withdrawal-panel.tsx')
  const kinds = [...lib.match(/kind: ('[a-z_]+'(?: \| '[a-z_]+')+)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(kinds.includes('support_ticket_answer_revision'))
  const routeKinds = [...route.match(/const targetKind = z\.enum\(\[([^\]]+)\]\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(routeKinds.sort(), [...kinds].sort())
  const routeFields = [...route.match(/field: z\.enum\(\[([^\]]+)\]\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.match(server, /case 'support_ticket_answer_revision': \{[\s\S]*?from\('support_ticket_answer_revisions'\)\.select\('ticket_id'\)/)
  const labels = panel.slice(panel.indexOf('const TARGET_KIND_LABELS'), panel.indexOf('const TARGET_FIELDS'))
  const fieldsBlock = panel.slice(panel.indexOf('const TARGET_FIELDS'), panel.indexOf('const REDACTION_REASON_LABELS'))
  assert.deepEqual([...labels.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]).sort(), [...kinds].sort())
  const panelFields = Object.fromEntries([...fieldsBlock.matchAll(/^\s+([a-z_]+): \[(.*)\],$/gm)]
    .map((m) => [m[1], [...m[2].matchAll(/\['([a-z_]+)', '/g)].map((f) => f[1])]))
  assert.deepEqual(Object.keys(panelFields).sort(), [...kinds].sort())
  assert.deepEqual(panelFields.support_ticket_answer_revision, ['previous_response', 'reason'])
  for (const fields of Object.values(panelFields)) for (const field of fields) assert.ok(routeFields.includes(field), field)
  // 모르는 종류에도 패널이 죽지 않는다(칸 목록이 없으면 [확인함]만)
  assert.match(panel, /const fields: \[string, string\]\[\] = TARGET_FIELDS\[item\.kind\] \?\? \[\]/)
  assert.match(panel, /\{fields\.length > 0 && \(/)
  if (m1) {
    const redact = m1.slice(m1.indexOf('CREATE OR REPLACE FUNCTION public.redact_member_text('))
    const dbFields = Object.fromEntries([...redact.slice(0, redact.indexOf('RAISE EXCEPTION')).matchAll(/p_target_kind = '([a-z_]+)' AND p_field IN \(([^)]+)\)/g)]
      .map((m) => [m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map((f) => f[1])]))
    for (const kind of ['support_ticket', 'support_ticket_revision', 'support_ticket_answer_revision']) {
      assert.deepEqual(panelFields[kind], dbFields[kind], kind)
    }
  }
  // 탈퇴 보관 문의 열람: 답변 수정 이력(answerRevisions)을 보인다
  const withdrawnPanel = read('src/app/(admin)/admin/support/withdrawn-tickets-panel.tsx')
  assert.match(withdrawnPanel, /answerRevisions\?: Array</)
  assert.match(withdrawnPanel, /\(opened\.answerRevisions \?\? \[\]\)\.map\(/)
  if (m1) assert.match(m1, /'answerRevisions'/)
})

// ─── 6절·9절: 서버 액션 ─────────────────────────────────────────────────────────────────────────────
test('템플릿·문구 서버 액션: 가드 → 서버 키 → revision 비교 → 작업 기록(request), 고정 값은 화면에서 못 고침', () => {
  const actions = read('src/app/(admin)/admin/support/actions.ts')
  assert.match(actions, /export async function saveSupportReplyTemplateAction\([^)]*\)[^{]*\{\n  const access = await assertAdminActionPermission\('support\.manage'\)/)
  assert.match(actions, /export async function saveSupportPageContentAction\([^)]*\)[^{]*\{\n  const access = await assertAdminActionPermission\('owner'\)/)
  assert.match(actions, /\.eq\('id', input\.id\)\.eq\('revision', input\.revision\)\.is\('deleted_at', null\)/)
  for (const action of ['support_reply_template_save', 'support_reply_template_hide', 'support_page_content_update']) {
    assert.match(actions, new RegExp(`action: '${action}'`))
  }
  assert.equal(actions.match(/request: await requestMeta\(\)/g).length, 3)
  const server = read('src/lib/support-page-content-server.ts')
  assert.match(server, /\.eq\('value->revision', expectedRevision\)/)
  // 작업 기록 종류가 목록에 있다
  const { ADMIN_AUDIT_ACTIONS } = load('src/lib/admin-audit-log.ts')
  for (const action of ['support_ticket_reply', 'support_ticket_reply_edit', 'support_category_create', 'support_category_update',
    'support_category_hide', 'support_category_restore', 'support_reply_template_save', 'support_reply_template_hide', 'support_page_content_update']) {
    assert.ok(ADMIN_AUDIT_ACTIONS[action], action)
  }
  // '안내 문구' 탭은 대표에게만 보인다
  const client = read('src/app/(admin)/admin/support/support-client.tsx')
  assert.match(client, /\{isOwner && \(\s+<Button\s+variant=\{activeSection === 'content'/)
  assert.match(client, /activeSection === 'content' && isOwner && \(/)
})
