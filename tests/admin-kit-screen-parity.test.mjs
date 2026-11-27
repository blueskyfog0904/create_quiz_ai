import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// 20번 관리자 공통 틀: 화면을 부품으로 옮겨도 동작은 그대로(계획 docs/plan-bundle20-admin-common.md 6-2·9절).
// 대조 단위 = 화면 폴더 + 그 폴더가 import 하는 관리자 파일(src/app/(admin)·src/components/admin, 부품 kit 제외).
// 기대값은 옮기기 전(648e68c) 코드에서 뽑은 목록이다. 화면을 옮길 때마다 여기에 한 묶음을 더한다.
const ROOT = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8')
const isFile = (file) => existsSync(new URL(file, ROOT)) && statSync(new URL(file, ROOT)).isFile()

function walk(dir, files = []) {
  for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(child, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(child)
  }
  return files
}

function resolveImport(fromFile, specifier) {
  let base
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  else return null
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (isFile(base + suffix)) return base + suffix
  return null
}

// 부품으로 나눠 옮긴 코드도 따라가도록 관리자 파일은 import 를 따라간다(부품 kit 은 fetch 등이 없음을 kit 계약 시험이 지킨다).
const FOLLOW = (file) => (file.startsWith('src/app/(admin)/') || file.startsWith('src/components/admin/')) && !file.startsWith('src/components/admin/kit/')

function screenFiles(dir) {
  const seen = new Set()
  const queue = walk(dir)
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of read(file).matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(file, match[1])
      if (resolved && FOLLOW(resolved) && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return [...seen].sort()
}

const squash = (text) => text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/,\)/g, ')').trim()

// name( … ) 호출 전체(괄호 짝 맞춤)를 공백을 접어 돌려준다.
function callsOf(source, name) {
  const calls = []
  for (const match of source.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1
      else if (source[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    calls.push(squash(source.slice(match.index, end + 1)))
  }
  return calls
}

function parityItems(dir) {
  const sources = screenFiles(dir).map(read)
  const join = (pick) => sources.flatMap(pick).sort()
  return {
    // fetch URL 템플릿·method·body(helper 로 감싼 것 포함)
    fetch: join((source) => callsOf(source, 'fetch')),
    // 서버 액션·*-server 로더 import
    serverImports: join((source) => [...source.matchAll(/from\s*'([^']*(?:-server|actions))'/g)].map((match) => match[1])),
    // 브라우저 직접 조회 .from('표')·.rpc('함수')
    db: join((source) => [...source.matchAll(/\.(from|rpc)\(\s*['"]([^'"]+)['"]/g)].map((match) => `${match[1]}:${match[2]}`)),
    // 가드 호출
    guards: join((source) => [...source.matchAll(/\brequire[A-Z]\w*\([^)]*\)/g)].map((match) => match[0])),
    // 주소 키 이름
    searchParamKeys: [...new Set(sources.flatMap((source) => [
      ...[...source.matchAll(/searchParams\??: Promise<\{([^}]*)\}>/g)].flatMap((match) => [...match[1].matchAll(/(\w+)\?:/g)].map((key) => key[1])),
      ...[...source.matchAll(/[sS]earchParams\??\.get\(\s*['"](\w+)['"]/g)].map((match) => match[1]),
      ...[...source.matchAll(/resolvedSearchParams\??\.(\w+)/g)].map((match) => match[1]),
    ]))].sort(),
    confirm: join((source) => callsOf(source, 'confirm')),
    alert: join((source) => callsOf(source, 'alert')),
    guardHook: join((source) => callsOf(source, 'useUnsavedChangesGuard')),
  }
}

// 저장 바 하나에 저장 함수 하나. 저장 함수 둘을 한 버튼으로 묶지 않는다.
function saveBarsOf(dir) {
  return screenFiles(dir).flatMap((file) => {
    const source = read(file)
    return [...source.matchAll(/<AdminSaveBar\b[\s\S]*?\/>/g)].map((match) => {
      const onSave = match[0].match(/onSave=\{([^}]*)\}/g) ?? []
      return { file, variant: match[0].match(/variant="(\w+)"/)?.[1], onSave }
    })
  })
}

const SAVE_HANDLER = /^onSave=\{(?:\(\) => void (\w+)\(\)|(\w+))\}$/

// ───── 1단계 시범: /admin/review-tags ─────
const REVIEW_TAGS = 'src/app/(admin)/admin/review-tags'

test('/admin/review-tags: 부르는 API·가드·주소 키·이탈 경고 훅은 옮기기 전과 같다', () => {
  const items = parityItems(REVIEW_TAGS)
  assert.deepEqual(items.fetch, [
    "fetch('/api/admin/review-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_subject: workspaceSubject, label, sort_order: Number(newSortOrder) || 0, }), })",
    "fetch(`/api/admin/review-tags/${tag.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: draft.label.trim(), sort_order: Number(draft.sortOrder) || 0 }), })",
    "fetch(`/api/admin/review-tags/${tagId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), })",
    "fetch(withAdminWorkspaceSubject('/api/admin/review-tags', workspaceSubject))",
  ])
  assert.deepEqual(items.serverImports, ['@/lib/admin-permissions-server', '@/lib/admin-sidebar-server'])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ["requireAdminPagePermission('reviews.manage')"])
  assert.deepEqual(items.searchParamKeys, ['subject'])
  assert.deepEqual(items.confirm, [])
  // 이탈 경고 훅은 지금 호출 그대로 1개(5-3).
  assert.deepEqual(items.guardHook, ['useUnsavedChangesGuard(dirtyTags.length > 0)'])
})

test('/admin/review-tags: 브라우저 알림 창 5곳은 같은 자리·같은 문구로 화면 안 오류로 바뀌었다(Q3)', () => {
  const items = parityItems(REVIEW_TAGS)
  // 옮기기 전: alert( 5곳(읽기 실패·빈 문구·추가 실패·줄 저장 실패·모두 저장 실패)
  assert.deepEqual(items.alert, [])
  const client = read(`${REVIEW_TAGS}/review-tags-client.tsx`)
  const setters = [...callsOf(client, 'setLoadError'), ...callsOf(client, 'setActionError'), ...callsOf(client, 'setSaveAllError')]
  for (const expected of [
    "setLoadError(error instanceof Error ? error.message : '태그를 불러오지 못했습니다.')",
    "setActionError('태그 문구를 입력하세요.')",
    "setActionError(error instanceof Error ? error.message : '태그 추가에 실패했습니다.')",
    "setActionError(error instanceof Error ? error.message : '저장에 실패했습니다.')",
    "setSaveAllError(error instanceof Error ? error.message : '저장에 실패했습니다.')",
  ]) {
    assert.ok(setters.includes(expected), expected)
  }
  // 오류는 화면에 보인다: 추가·줄 저장 = 오류 띠, 읽기 = 표 실패 칸(행이 없을 때)·오류 띠(행이 있을 때) + 다시 시도, 모두 저장 = 저장 바.
  assert.match(client, /\{actionError \? <div ref=\{actionErrorRef\}><AdminNotice kind="error">\{actionError\}<\/AdminNotice><\/div> : null\}/)
  // 알림 창은 늘 보였으므로, 위쪽 띠도 오류가 생기면 그 자리로 옮겨 보인다. 모두 저장을 시작하면 앞 오류 띠는 지운다.
  assert.match(client, /if \(actionError\) actionErrorRef\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(client, /setSavingId\('all'\)\s+setActionError\(null\)\s+setSaveAllError\(null\)/)
  assert.match(client, /loadError && tags\.length === 0 \? \(\s*<AdminTableState kind="error" message=\{loadError\} onRetry=\{\(\) => void loadTags\(\)\} \/>/)
  assert.match(client, /<AdminNotice kind="error" onRetry=\{\(\) => void loadTags\(\)\}>\{loadError\}<\/AdminNotice>/)
  assert.match(client, /errorMessage=\{saveAllError\}/)
})

test('/admin/review-tags: 같은 열·버튼·막힘 조건, 저장 바 하나 = 저장 함수 하나', () => {
  const client = read(`${REVIEW_TAGS}/review-tags-client.tsx`)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['태그 문구', '정렬 순서', '상태', '작업'])
  for (const condition of [
    "disabled={savingId === tag.id || savingId === 'all' || !isDirty}",
    "disabled={savingId === tag.id || savingId === 'all'}",
    'disabled={savingId !== null} onClick={() => void createTag()}',
    'saveDisabled={savingId !== null}',
    'const isDirty = draft.label !== tag.label || Number(draft.sortOrder) !== tag.sortOrder',
    "{tag.isActive ? '비활성화' : '활성화'}",
    "{savingId === 'new' ? '추가 중…' : '태그 추가'}",
    'onClick={() => void patchTag(tag.id, { is_active: !tag.isActive })}',
    'onClick={() => saveDraft(tag)}',
  ]) {
    assert.ok(client.includes(condition), condition)
  }
  assert.equal(client.match(/disabled=\{savingId === 'all'\}/g)?.length, 2, '문구·순서 입력칸은 모두 저장 중에 막힌다')
  // 표 안 버튼은 adminTable(주황 adminAction 없음).
  assert.equal(client.match(/variant="adminTable"/g)?.length, 2)
  assert.doesNotMatch(client, /adminAction/)

  // 저장 함수가 하나(saveAllDrafts)인 주소 → 아래 고정 저장 바 1개.
  const bars = saveBarsOf(REVIEW_TAGS)
  assert.equal(bars.length, 1)
  assert.equal(bars[0].variant, 'fixed')
  assert.equal(bars[0].onSave.length, 1)
  assert.equal(bars[0].onSave[0].match(SAVE_HANDLER)?.slice(1).find(Boolean), 'saveAllDrafts')
})

// ───── 1단계 시범: /admin/my-password ─────
const MY_PASSWORD = 'src/app/(admin)/admin/my-password'

test('/admin/my-password: 부르는 API·가드·확인 조건은 옮기기 전과 같다', () => {
  const items = parityItems(MY_PASSWORD)
  assert.deepEqual(items.fetch, [
    "fetch('/api/admin/my-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }), })",
  ])
  assert.deepEqual(items.serverImports, [])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ['requireAdminPanelUser()'])
  assert.deepEqual(items.searchParamKeys, [])
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  assert.deepEqual(items.guardHook, [])

  const client = read(`${MY_PASSWORD}/my-password-client.tsx`)
  for (const fragment of [
    'if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {',
    'if (newPassword !== confirmPassword) {',
    'disabled={isSaving || !currentPassword || !newPassword || !confirmPassword}',
    "{isSaving ? '변경 중…' : '비밀번호 변경'}",
  ]) {
    assert.ok(client.includes(fragment), fragment)
  }
  // 결과 안내는 오류 띠(role=alert)·정보 띠(role=status)로 같은 문구를 보인다.
  assert.match(client, /<AdminNotice kind=\{message\.tone === 'error' \? 'error' : 'info'\}>\{message\.text\}<\/AdminNotice>/)
  // 비밀번호 변경은 일회성 제출이라 저장 바를 두지 않는다(입력값을 남기지 않음).
  assert.deepEqual(saveBarsOf(MY_PASSWORD), [])
})

// ───── 2단계: /admin/orders ─────
// 기대값은 옮기기 전(38a1273) 코드에서 뽑은 목록이다.
const ORDERS = 'src/app/(admin)/admin/orders'
const EXCEPTION_DIALOG = `${ORDERS}/market-exception-refund-dialog.tsx`

test('/admin/orders: 부르는 API·가드·주소 키는 옮기기 전과 같고, 브라우저 확인 창은 공통 확인 창으로 바뀌었다', () => {
  const items = parityItems(ORDERS)
  assert.deepEqual(items.fetch, [
    'fetch(`/api/admin/market/orders/${orderId}/exception-refund`)',
    "fetch(`/api/admin/market/orders/${orderId}/exception-refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), })",
    'fetch(`/api/admin/orders/market?${requestKey}`)',
    'fetch(`/api/admin/orders/payments?${requestKey}`)',
    "fetch(`/api/admin/users/${context.order.userId}/withdrawal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_event', kind: 'market_cash_refund', refId: orderId, details: { settlementKey, amount_won: amountValue, method, note: note.trim(), item_title: context.order.itemTitle }, }), })",
  ])
  assert.deepEqual(items.serverImports, ['@/lib/admin-orders-server', '@/lib/admin-orders-server', '@/lib/admin-permissions-server', '@/lib/admin-sidebar-server'])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ["requireAdminPagePermission('orders.view')"])
  assert.deepEqual(items.searchParamKeys, ['subject', 'tab'])
  // 옮기기 전: 예외 환불 창의 부족분 window.confirm( 1곳(유형 나) → await ask(
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  assert.deepEqual(items.guardHook, [])
  // 목록 주소 키(useListQuery)는 그대로
  const payments = read(`${ORDERS}/orders-client.tsx`)
  const market = read(`${ORDERS}/market-orders-client.tsx`)
  for (const key of ['q', 'provider', 'status', 'environment', 'from', 'to']) assert.ok(payments.includes(`listQuery.params.get('${key}')`), key)
  for (const key of ['q', 'status', 'orderSubject', 'from', 'to']) assert.ok(market.includes(`listQuery.params.get('${key}')`), key)
  assert.equal((payments + market).match(/const setFilter = \(key: string, value: string\) => listQuery\.update\(\{ \[key\]: value, page: 1 \}\)/g)?.length, 2)
})

test('/admin/orders: 같은 탭·열·버튼, 주황 버튼 없음, 날짜 표기는 지금 모양 그대로', () => {
  const page = read(`${ORDERS}/page.tsx`)
  assert.match(page, /\{ id: 'payments', label: '충전 결제' \},\s+\{ id: 'market', label: '마켓 구매' \},/)
  assert.match(page, /href=\{`\/admin\/orders\?tab=\$\{tab\.id\}`\}/)
  assert.match(page, /<AdminPageHeader\s+title=\{<AdminMenuName href="\/admin\/orders" fallback="주문 조회" \/>\}/)
  const payments = read(`${ORDERS}/orders-client.tsx`)
  const market = read(`${ORDERS}/market-orders-client.tsx`)
  const headers = (source) => [...source.matchAll(/header: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(headers(payments), ['주문 시각', '회원', '요금제 · 금액', '결제수단', '상태', '주문번호', '상세'])
  assert.deepEqual(headers(market), ['주문 시각', '회원', '상품', '사용 크레딧', '상태', '다운로드', '상세'])
  for (const source of [payments, market]) {
    assert.match(source, /<Button type="button" size="sm" variant="adminTable" onClick=\{\(\) => setSelectedOrder\(order\)\}>상세<\/Button>/)
    assert.doesNotMatch(source, /adminAction/)
    // 회원 칸은 화면 비교 때 가린다.
    assert.match(source, /key: 'member',\s+header: '회원',\s+pii: true,/)
  }
  assert.match(payments, /<AdminDataTable[\s\S]*?minWidth=\{760\}/)
  assert.match(market, /<AdminDataTable[\s\S]*?minWidth=\{860\}/)
  // 예외 환불 버튼은 완료 주문에만
  assert.match(market, /selectedOrder\.status === 'completed' \? \(\s+<div className="mt-3 flex justify-end">\s+<Button type="button" size="sm" variant="brandOutline" onClick=\{\(\) => setExceptionOrderId\(selectedOrder\.id\)\}>/)
  // 날짜는 지금 모양(toLocaleString ko-KR, Asia/Seoul) 그대로
  assert.match(payments, /export const formatDateTime = \(value: string \| null \| undefined\) =>\s+value \? new Date\(value\)\.toLocaleString\('ko-KR', \{ timeZone: 'Asia\/Seoul' \}\) : '-'/)
  // 상태 색은 한 표(admin-status-tone)에서
  assert.match(payments, /adminStatusTone\('paymentOrder', order\.status\)/)
  assert.match(market, /adminStatusTone\('marketOrder', order\.status\)/)
  assert.match(market, /adminStatusTone\('marketEntitlement', entitlement\.status\)/)
})

// 예외 환불 창의 submit 을 그대로 떼어 실행한다(유형 나: 첫 요청 → 409 → 확인 → 다시 요청, 잠금 유지).
function loadExceptionSubmit() {
  const source = read(EXCEPTION_DIALOG)
  const start = source.indexOf('const submit = async () => {')
  assert.ok(start > 0)
  let depth = 0
  let end = source.indexOf('{', start + 'const submit = async () =>'.length)
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1
    else if (source[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(start, end + 1)
  const names = ['context', 'preview', 'setSubmitting', 'post', 'buildBody', 'ask', 'formatCredits', 'toast', 'MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE', 'setPreview', 'onDone']
  return new Function('deps', `const { ${names.join(', ')} } = deps\n${body}\nreturn submit`)
}

function exceptionWorld({ answer }) {
  const log = []
  let submitting = false
  let release
  const deps = {
    context: { order: { committedCredits: 0 } },
    preview: { amount: 100, committed: 0 },
    setSubmitting: (value) => { submitting = value; log.push(`submitting:${value}`) },
    buildBody: (expectedCredits, extra = {}) => ({ expectedCredits, ...extra }),
    post: async (body) => {
      log.push(`post:${JSON.stringify(body)}`)
      if (log.filter((line) => line.startsWith('post:')).length === 1) {
        return { response: { status: 409, ok: false }, result: { code: 'MARKET_REFUND_SHORTFALL', error: '일부 크레딧은 이미 썼습니다.', requested: 100, restorable: 60 } }
      }
      return { response: { status: 200, ok: true }, result: { success: true, message: '처리했습니다.' } }
    },
    ask: (options) => {
      log.push(`ask:submitting=${submitting}`)
      deps.lastAsk = options
      return new Promise((resolve) => { release = () => resolve(answer) })
    },
    formatCredits: (value) => `${value} C`,
    toast: { success: (message) => log.push(`success:${message}`), error: (message) => log.push(`error:${message}`), warning: () => {} },
    MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE: '',
    setPreview: () => {},
    onDone: () => log.push('done'),
  }
  return { deps, log, release: () => release(), isSubmitting: () => submitting }
}

test('/admin/orders 예외 환불(유형 나): 409 부족분 → 확인 → confirmedRefundCredits 로 다시 요청, 창이 열린 동안 잠금 유지', async () => {
  const world = exceptionWorld({ answer: true })
  const running = loadExceptionSubmit()(world.deps)()
  await new Promise((resolve) => setImmediate(resolve))
  // 확인 창이 열린 동안: 첫 요청만 나갔고 잠금(submitting)은 쥔 채다(finally 가 먼저 풀지 않음).
  assert.deepEqual(world.log, ['submitting:true', 'post:{"expectedCredits":100}', 'ask:submitting=true'])
  assert.equal(world.isSubmitting(), true)
  assert.deepEqual(world.deps.lastAsk.impacts.map((impact) => [impact.label, impact.value]), [['요청', '100 C'], ['돌려줄 수 있음', '60 C']])
  assert.equal(world.deps.lastAsk.description, '일부 크레딧은 이미 썼습니다.')
  world.release()
  await running
  assert.deepEqual(world.log.slice(3), ['post:{"expectedCredits":100,"confirmedRefundCredits":60}', 'success:처리했습니다.', 'done', 'submitting:false'])
})

test('/admin/orders 예외 환불(유형 나): 확인 창에서 취소하면 다시 요청하지 않는다', async () => {
  const world = exceptionWorld({ answer: false })
  const running = loadExceptionSubmit()(world.deps)()
  await new Promise((resolve) => setImmediate(resolve))
  world.release()
  await running
  assert.deepEqual(world.log, ['submitting:true', 'post:{"expectedCredits":100}', 'ask:submitting=true', 'submitting:false'])
})

test('/admin/orders 예외 환불: 창이 열린 동안 실행 버튼이 잠기고, 확인 창은 예외 환불 창 안에 그린다', () => {
  const dialog = read(EXCEPTION_DIALOG)
  assert.match(dialog, /const \{ ask, dialog: confirmDialog \} = useAdminConfirm\(\)/)
  assert.match(dialog, /<Button variant="brand" onClick=\{\(\) => void submit\(\)\} disabled=\{submitting \|\| !context \|\| !preview/)
  assert.match(dialog, /<Button variant="brandOutline" onClick=\{\(\) => void loadPreview\(\)\} disabled=\{submitting \|\| !context \|\| !ticketReady\}>금액 확인<\/Button>/)
  assert.match(dialog, /onOpenChange=\{\(open\) => !open && !submitting && onClose\(\)\}/)
  assert.match(dialog, /\{confirmDialog\}\n\s+<\/DialogContent>/)
  assert.doesNotMatch(dialog, /window\.confirm|\bconfirm\(/)
})

// ───── 3단계: /admin/pricing ─────
// 공용 checkout-consent-editor 는 3-2단계에서 바꾼다(공용 부품 규칙). 대조 단위에는 import 를 따라 함께 든다.
const PRICING = 'src/app/(admin)/admin/pricing'

test('/admin/pricing: 서버 액션·로더·표·가드·주소 키는 옮기기 전(38a1273)과 같다', () => {
  const items = parityItems(PRICING)
  assert.deepEqual(items.fetch, [])
  assert.deepEqual(items.serverImports, [
    '../actions', './actions', './actions', './actions', './actions',
    '@/lib/admin-audit-log-server', '@/lib/admin-permissions-server', '@/lib/admin-permissions-server', '@/lib/admin-sidebar-server',
    '@/lib/checkout-consent-server', '@/lib/footer-content-server', '@/lib/point-charge-policy-server', '@/lib/point-charge-policy-server',
    '@/lib/pricing-page-content-server', '@/lib/pricing-page-content-server',
  ])
  assert.deepEqual(items.db, ['from:pricing_plans', 'from:pricing_plans', 'from:pricing_plans', 'from:pricing_plans', 'from:pricing_plans'])
  assert.deepEqual(items.guards, ["requireAdminPagePermission('pricing.manage')"])
  assert.deepEqual(items.searchParamKeys, ['subject'])
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  assert.deepEqual(items.guardHook, [])
  // 저장 호출·인자는 그대로
  const content = read(`${PRICING}/pricing-page-content-form.tsx`)
  const charge = read(`${PRICING}/point-charge-policy-form.tsx`)
  const plans = read(`${PRICING}/pricing-plans-client.tsx`)
  assert.ok(content.includes('const result = await savePricingPageContentAction(content)'))
  assert.ok(charge.includes('const result = await savePointChargePolicyTextsAction({ texts, expectedVersion: policy.version, consentKeys: consentDraft })'))
  assert.ok(plans.includes('await togglePlanStatus(toggleTarget.id, nextActive)'))
  assert.ok(plans.includes('const data = await getPricingPlans()'))
})

test('/admin/pricing: 같은 열·버튼·막힘 조건, 판매 중지 확인은 공통 확인 창(위험 버튼)', () => {
  const plans = read(`${PRICING}/pricing-plans-client.tsx`)
  assert.deepEqual([...plans.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['순서', '상품명', '크레딧', '가격', '화면 표시', '상태', '관리'])
  assert.doesNotMatch(plans, /adminAction|toLocaleString\(/)
  for (const fragment of [
    'onCheckedChange={() => setToggleTarget(plan)}',
    'onClick={() => handleEdit(plan)}',
    '<AdminTableState kind="error" message={error} onRetry={fetchPlans} />',
    "state={plans.length === 0 ? <AdminTableState kind=\"empty\" message=\"등록된 요금제가 없습니다.\" /> : undefined}",
    // 확인 창: 처리 중에는 닫힘·확정이 막히고, 판매 중지만 위험 버튼
    'onOpenChange={(open) => !open && !toggling && setToggleTarget(null)}',
    'danger={Boolean(toggleTarget?.is_active)}',
    'pending={toggling}',
    'onConfirm={handleConfirmToggle}',
  ]) {
    assert.ok(plans.includes(fragment), fragment)
  }
  assert.match(plans, /toast\.success\(`'\$\{toggleTarget\.name\}' 요금제를 \$\{nextActive \? '판매중' : '비활성'\}으로 바꿨습니다\.`\)\s+setToggleTarget\(null\)/)
  assert.match(plans, /\} finally \{\s+setToggling\(false\)\s+\/\/[^\n]*\n\s+fetchPlans\(\)/)
  // 저장 함수가 셋 이상(요금제 창·충전 화면 문구·결제 전 확인 문구)인 주소 → 저장 영역마다 인라인 저장 줄
  const bars = saveBarsOf(PRICING)
  assert.equal(bars.length, 2)
  for (const bar of bars) {
    assert.equal(bar.variant, 'inline', bar.file)
    assert.equal(bar.onSave.length, 1, bar.file)
    assert.equal(bar.onSave[0].match(SAVE_HANDLER)?.slice(1).find(Boolean), 'handleSave', bar.file)
  }
  const content = read(`${PRICING}/pricing-page-content-form.tsx`)
  const charge = read(`${PRICING}/point-charge-policy-form.tsx`)
  assert.ok(content.includes('saveDisabled={saving || readFailed}'))
  assert.ok(content.includes('saveLabel="문구 저장"'))
  assert.ok(charge.includes('saveDisabled={saving || (blocked && !legacyFieldsInvalid)}'))
  // 변경 0건이어도 예전 칸 검사에 걸리면 버튼이 켜져 전처럼 그 칸을 펼치고 초점을 옮긴다.
  assert.ok(charge.includes('saveWhenClean={blocked && legacyFieldsInvalid}'))
  assert.ok(charge.includes('saveLabel="결제 고지 문구 저장"'))
  // 저장 결과 알림(toast)은 그대로, 저장 줄은 같은 실패 글을 함께 보인다.
  for (const source of [content, charge]) {
    assert.match(source, /if \(!result\.success\) \{\s+toast\.error\(result\.error\)\s+setSaveError\(result\.error\)\s+return/)
  }
  // 충전 정책 폼의 막힘·검사 흐름은 그대로
  assert.match(charge, /if \(blocked\) \{\s+if \(legacyCollapsed && legacyFieldsInvalid\) \{/)
  assert.ok(charge.includes("toast.error(legacyInvalid ?? validityInvalid ?? '새 방식 동의 문구를 확인해 주세요.')"))
})

// ───── 3단계: /admin/storefront-menu ─────
const STOREFRONT_MENU = 'src/app/(admin)/admin/storefront-menu'

test('/admin/storefront-menu: 서버 액션·로더·가드는 옮기기 전(38a1273)과 같다', () => {
  const items = parityItems(STOREFRONT_MENU)
  assert.deepEqual(items.fetch, [])
  assert.deepEqual(items.serverImports, [
    './actions', '@/lib/admin-audit-log-server', '@/lib/admin-permissions-server', '@/lib/admin-permissions-server',
    '@/lib/storefront-header-links-server', '@/lib/storefront-header-links-server',
  ])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ['requireAdmin()', "requireAdminPagePermission('site.manage')"])
  assert.deepEqual(items.searchParamKeys, [])
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  assert.deepEqual(items.guardHook, [])
})

test('/admin/storefront-menu: 같은 칸·버튼·막힘 조건, 저장 함수 하나 = 아래 고정 저장 바', () => {
  const client = read(`${STOREFRONT_MENU}/storefront-menu-client.tsx`)
  for (const fragment of [
    'if (loadFailed || invalid || isSaving) return',
    'const result = await saveStorefrontHeaderLinksAction(links)',
    'const hasChanges = JSON.stringify(links) !== JSON.stringify(savedLinks)',
    'onClick={() => setLinks(savedLinks)} disabled={loadFailed || isSaving || !hasChanges}',
    'disabled={loadFailed || isSaving || links.length >= STOREFRONT_HEADER_LINK_MAX_COUNT}',
    'disabled={loadFailed || isSaving || index === 0} onClick={() => move(index, -1)}',
    'disabled={loadFailed || isSaving || index === links.length - 1} onClick={() => move(index, 1)}',
    "{link.isActive ? '보임' : '숨김'}",
    // 전의 저장 버튼 막힘 조건 그대로(실패 뒤 [다시 시도]도 변경이 없으면 막힘).
    'saveDisabled={loadFailed || Boolean(invalid) || isSaving || !hasChanges}',
    'dirtyCount={countChangedFields(links, savedLinks)}',
  ]) {
    assert.ok(client.includes(fragment), fragment)
  }
  assert.equal(client.match(/disabled=\{loadFailed \|\| isSaving\}/g)?.length, 5, '이름·주소 칸, 스위치 둘, 삭제 버튼은 저장 중·읽기 실패에 막힌다')
  assert.doesNotMatch(client, /adminAction/)
  const bars = saveBarsOf(STOREFRONT_MENU)
  assert.equal(bars.length, 1)
  assert.equal(bars[0].variant, 'fixed')
  assert.equal(bars[0].onSave.length, 1)
  assert.equal(bars[0].onSave[0].match(SAVE_HANDLER)?.slice(1).find(Boolean), 'handleSave')
})

// ───── 3단계: /admin/admin-accounts ─────
const ADMIN_ACCOUNTS = 'src/app/(admin)/admin/admin-accounts'

test('/admin/admin-accounts: 부르는 API·가드·주소 키는 옮기기 전(38a1273)과 같다', () => {
  const items = parityItems(ADMIN_ACCOUNTS)
  assert.deepEqual(items.fetch, [
    "fetch('/api/admin/admin-accounts')",
    "fetch('/api/admin/admin-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: loginId, password: newPassword }), })",
    "fetch(`/api/admin/admin-accounts/${account.userId}/permissions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grants }), })",
    "fetch(`/api/admin/admin-accounts/${account.userId}/revoke`, { method: 'POST' })",
    "fetch(`/api/admin/admin-accounts/${account.userId}`, { method: 'DELETE', })",
    "fetch(`/api/admin/admin-accounts/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), })",
  ])
  assert.deepEqual(items.serverImports, ['@/lib/admin-permissions-server', '@/lib/admin-sidebar-server'])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ["requireAdminPagePermission('owner')"])
  assert.deepEqual(items.searchParamKeys, ['subject'])
  assert.deepEqual(items.guardHook, [])
})

test('/admin/admin-accounts: 브라우저 확인 창 2곳은 같은 자리에서 먼저 묻고(유형 가), 알림 창 11곳은 같은 문구로 화면 안에 보인다', () => {
  const items = parityItems(ADMIN_ACCOUNTS)
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  const client = read(`${ADMIN_ACCOUNTS}/admin-accounts-client.tsx`)
  // (가) 확인 결과 전에는 잠금도 요청도 없다: ask → 취소면 return → 그 뒤 setSavingId·fetch
  for (const [name, title, request] of [
    ['deleteAccount', "title: `'${account.loginId}' 관리자 계정을 삭제할까요?`", "fetch(`/api/admin/admin-accounts/${account.userId}`, {"],
    ['revokeAccount', "title: `'${account.loginId}' 계정의 관리자 권한을 해제할까요?`", "fetch(`/api/admin/admin-accounts/${account.userId}/revoke`"],
  ]) {
    const start = client.indexOf(`const ${name} = async (account: AdminAccountRow) => {`)
    const body = client.slice(start, client.indexOf('\n  }\n', start))
    const asked = body.indexOf('const confirmed = await ask({')
    assert.ok(asked > 0 && body.includes(title), name)
    assert.ok(body.indexOf('if (!confirmed) {') > asked, name)
    assert.ok(body.indexOf('setSavingId(account.userId)') > body.indexOf('if (!confirmed) {'), name)
    assert.ok(body.indexOf(request) > body.indexOf('setSavingId(account.userId)'), name)
    assert.match(body, /danger: true,/, name)
  }
  assert.ok(client.includes("description: '삭제하면 되돌릴 수 없습니다.'"))
  assert.ok(client.includes("description: '해제하면 관리자 화면에 들어올 수 없고 목록에서 빠집니다. 다시 주는 화면은 없습니다(필요하면 새 아이디를 만드세요).'"))
  assert.match(client, /\{confirmDialog\}\n\s+<\/div>\n\s+\)\n\}/)
  // 옮기기 전 alert( 의 문구 → 같은 문구의 화면 안 오류(띠)·알림(toast)
  const shown = [
    ...callsOf(client, 'setLoadError'), ...callsOf(client, 'setCreateError'), ...callsOf(client, 'setActionError'), ...callsOf(client, 'setPasswordError'),
    ...callsOf(client, 'toast.success'),
  ]
  for (const expected of [
    "setLoadError(error instanceof Error ? error.message : '관리자 목록을 불러오지 못했습니다.')",
    "setCreateError('아이디와 비밀번호를 모두 입력하세요.')",
    "setCreateError('비밀번호 확인이 일치하지 않습니다.')",
    "setCreateError(error instanceof Error ? error.message : '관리자 ID 생성에 실패했습니다.')",
    "setPasswordError(error instanceof Error ? error.message : '저장에 실패했습니다.')",
    "setPasswordError(`비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)",
    "setPasswordError('비밀번호 확인이 일치하지 않습니다.')",
    "setActionError(error instanceof Error ? error.message : '삭제에 실패했습니다.')",
    "setActionError(error instanceof Error ? error.message : '권한 해제에 실패했습니다.')",
    "toast.success('비밀번호를 변경했습니다.')",
  ]) {
    assert.ok(shown.includes(expected), expected)
  }
  const dialog = read(`${ADMIN_ACCOUNTS}/admin-permissions-dialog.tsx`)
  assert.ok(dialog.includes("toast.success('권한을 저장했습니다. 그 계정의 다음 요청(화면 이동·새로고침)부터 반영됩니다.')"))
  // 오류는 화면에 보인다: 읽기 = 표 실패 칸(행이 없을 때)·오류 띠(행이 있을 때) + 다시 시도, 새 계정·줄 작업·비밀번호 창 = 오류 띠
  assert.match(client, /loadError && accounts\.length === 0 \? \(\s+<AdminTableState kind="error" message=\{loadError\} onRetry=\{\(\) => void loadAccounts\(\)\} \/>/)
  assert.match(client, /<AdminNotice kind="error" onRetry=\{\(\) => void loadAccounts\(\)\}>\{loadError\}<\/AdminNotice>/)
  assert.match(client, /\{actionError \? <AdminNotice kind="error">\{actionError\}<\/AdminNotice> : null\}/)
  // 목록을 다시 읽으면 앞 줄 작업 오류 띠는 지운다.
  assert.match(client, /setLoadError\(null\)\s+setActionError\(null\)\s+\} catch/)
})

test('/admin/admin-accounts: 같은 열·버튼·막힘 조건, 주황 버튼 없음', () => {
  const client = read(`${ADMIN_ACCOUNTS}/admin-accounts-client.tsx`)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['아이디', '유형', '역할 · 권한', '생성일', '최근 로그인', '작업'])
  for (const fragment of [
    "{account.role === 'staff' && !isSelf ? (",
    'disabled={savingId === account.userId || isSelf}',
    "disabled={savingId === 'new'} onClick={() => void createAccount()}",
    "{savingId === 'new' ? '추가 중…' : '관리자 ID 추가'}",
    'onClick={() => openPasswordDialog(account)}',
    'onClick={() => setEditingAccount(account)}',
    'onClick={() => void revokeAccount(account)}',
    'onClick={() => void deleteAccount(account)}',
    "{savingId === passwordTarget?.userId ? '변경 중…' : '비밀번호 재설정'}",
    'onOpenChange={(open) => { if (!open && savingId !== passwordTarget?.userId) closePasswordDialog() }}',
  ]) {
    assert.ok(client.includes(fragment), fragment)
  }
  assert.equal(client.match(/disabled=\{savingId === account\.userId\}/g)?.length, 3)
  assert.equal(client.match(/variant="adminTable"/g)?.length, 4)
  assert.doesNotMatch(client, /adminAction/)
  // 날짜 표기는 지금 모양(YYYY.MM.DD) 그대로
  assert.ok(client.includes('return `${year}.${month}.${day}`'))
  assert.deepEqual(saveBarsOf(ADMIN_ACCOUNTS), [])
})

// ───── 3단계: /admin/menu-management ─────
const MENU_MANAGEMENT = 'src/app/(admin)/admin/menu-management'

test('/admin/menu-management: 서버 액션·가드·주소 키·이탈 경고 훅은 옮기기 전과 같다', () => {
  const items = parityItems(MENU_MANAGEMENT)
  assert.deepEqual(items.fetch, [])
  assert.deepEqual(items.serverImports, [
    './actions',
    './actions',
    '@/lib/admin-features-server',
    '@/lib/admin-permissions-server',
    '@/lib/admin-permissions-server',
    '@/lib/admin-sidebar-server',
    '@/lib/generate-menu-server',
    '@/lib/header-navigation-server',
    '@/lib/market-menu-server',
  ])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, [...Array(19).fill('requireAdmin()'), "requireAdminPagePermission('owner')"])
  assert.deepEqual(items.searchParamKeys, ['subject'])
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  // 저장 영역이 둘이어도 이탈 경고 훅은 지금처럼 OR 로 묶은 1개(5-3).
  assert.deepEqual(items.guardHook, ['useUnsavedChangesGuard(hasUnsavedChanges || hasUnsavedAdminSidebarChanges)'])

  // 화면이 부르는 서버 액션(이름·인자) 그대로
  const client = read(`${MENU_MANAGEMENT}/menu-management-client.tsx`)
  for (const call of [
    'await saveMenuManagementConfig({ ...config, logoText: nextLogoText }, workspaceSubject)',
    'await saveAdminSidebarNavigationConfigAction(adminSidebarConfig)',
    'await updateGenerateMenuEntryAction(generateEntryForm.id, {',
    'await createGenerateMenuEntryAction({',
    'await archiveGenerateMenuEntryAction(archiveTarget.id, workspaceSubject)',
    'await reorderGenerateMenuEntriesAction(nextEntries.map((entry) => entry.id), workspaceSubject)',
    'await backfillGenerateMenuEntriesAction(workspaceSubject)',
    'await backfillMarketMenuEntriesAction(workspaceSubject)',
  ]) {
    assert.ok(client.includes(call), call)
  }
  assert.match(read(`${MENU_MANAGEMENT}/page.tsx`), /const data = await getMenuManagementData\(workspaceSubject\)\s+return <MenuManagementClient key=\{workspaceSubject\} \{\.\.\.data\} workspaceSubject=\{workspaceSubject\} \/>/)
})

test('/admin/menu-management: 같은 표·열·버튼·막힘 조건, 저장 함수 둘 = 인라인 저장 줄 둘', () => {
  const client = read(`${MENU_MANAGEMENT}/menu-management-client.tsx`)
  // 표 4개(관리자 패널 순서·일반 헤더 메뉴·문제생성 2단계·라이브러리 2단계)의 열 그대로
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), [
    '메뉴명', '기준 경로', '표시 그룹', '순서 조정',
    'Depth', '메뉴명', '링크', '하위 메뉴', '노출', '관리',
    '메뉴명', '유형', 'slug', '경로 미리보기', '게시글 수', '노출', '활성', '구분선', '관리',
    '메뉴명', '경로', '실제 주소 미리보기', '노출', '구분선', '관리',
  ])
  for (const fragment of [
    "onClick={() => handleMoveAdminSidebarNode(node, 'up')} disabled={nodeIndex === 0}",
    "onClick={() => handleMoveAdminSidebarNode(node, 'down')} disabled={nodeIndex === adminSidebarNavigationNodes.length - 1}",
    "onClick={() => handleMoveAdminSidebarChild(node, item, 'up')} disabled={index === 0}",
    "onClick={() => handleMoveAdminSidebarChild(node, item, 'down')} disabled={index === node.items.length - 1}",
    "onClick={() => handleMoveParent(parentIndex, 'up')} disabled={parentIndex === 0}",
    "onClick={() => handleMoveParent(parentIndex, 'down')} disabled={parentIndex === editableConfig.items.length - 1}",
    'onClick={() => openChildCreateDialog(item.id)} disabled={isDedicatedChildSectionParent(item.href)}',
    'onClick={() => setDeleteTarget({ id: item.id, title: item.title, hasChildren: item.children.length > 0 })}',
    "onClick={() => handleMoveChild(item.id, childIndex, 'down')} disabled={childIndex === item.children.length - 1}",
    'onClick={() => setDeleteTarget({ id: child.id, title: child.title, parentId: item.id })}',
    "onClick={() => handleMoveGenerateEntry(index, 'up')} disabled={index === 0 || isMutatingGenerateEntries}",
    "onClick={() => handleMoveGenerateEntry(index, 'down')} disabled={index === generateMenuEntries.length - 1 || isMutatingGenerateEntries}",
    "disabled={entry.entry_type === 'personal_generate'} onClick={() => setArchiveTarget(entry)}",
    "onClick={() => handleMoveChild(libraryParent.id, childIndex, 'down')} disabled={childIndex === libraryMenuChildren.length - 1}",
    'onClick={() => setDeleteTarget({ id: child.id, title: child.title, parentId: libraryParent.id })}',
    '...(!isDedicatedChildSectionParent(item.href)',
    'state={flatRows.length === 0 ? <AdminTableState kind="empty" message="등록된 메뉴가 없습니다. 상위 메뉴를 먼저 추가해주세요." /> : undefined}',
    '<AdminTableState kind="empty" message="라이브러리 상위 메뉴를 찾을 수 없습니다." />',
    '<AdminTableState kind="empty" message="등록된 라이브러리 2단계 메뉴가 없습니다." />',
    'backfillStatus.missingLegacyChildren.length > 0 ? (',
    'marketBackfillStatus.missingLegacyChildren.length > 0 ? (',
    'onClick={handleBackfillGenerateChildren} disabled={isBackfilling}',
    'onClick={handleBackfillMarketChildren} disabled={isBackfillingMarket}',
    "{workspaceSubject === 'english' && !hasGenerateParent && (",
    '{!hasMarketParent && (',
    'tools={<AdminWorkspaceSwitcher />}',
    '<Button variant="brand" onClick={handleSubmitGenerateEntry} disabled={isMutatingGenerateEntries}>',
  ]) {
    assert.ok(client.includes(fragment), fragment)
  }
  // 삭제·보관 확인은 공통 확인 창(위험 확정 = adminDanger). 확정 뒤 흐름은 전과 같다(창을 닫고 같은 함수를 부름).
  assert.equal(client.match(/<AdminConfirmDialog\b/g)?.length, 2)
  assert.match(client, /title="메뉴를 삭제할까요\?"[\s\S]*?confirmLabel="삭제"\s+danger\s+onConfirm=\{handleConfirmDelete\}/)
  assert.match(client, /title="문제생성 메뉴를 보관할까요\?"[\s\S]*?confirmLabel="보관"\s+danger[\s\S]*?onConfirm=\{\(\) => \{\s+setArchiveTarget\(null\)\s+void handleArchiveGenerateEntry\(\)\s+\}\}/)
  assert.doesNotMatch(client, /AlertDialog\b|adminAction|toLocaleString\(/)
  assert.equal(client.match(/variant="adminTable"/g)?.length, 23)

  // 저장 함수가 둘(handleSaveAll·handleSaveAdminSidebar)인 주소 → 인라인 저장 줄 2개, 줄마다 저장 함수 하나.
  const bars = saveBarsOf(MENU_MANAGEMENT)
  assert.equal(bars.length, 2)
  assert.deepEqual(bars.map((bar) => bar.variant), ['inline', 'inline'])
  for (const bar of bars) assert.equal(bar.onSave.length, 1)
  assert.deepEqual(bars.map((bar) => bar.onSave[0].match(SAVE_HANDLER)?.slice(1).find(Boolean)), ['handleSaveAll', 'handleSaveAdminSidebar'])
  // 전의 버튼 막힘 조건(isSaving || !hasUnsavedChanges 등)은 저장 중 표시 + saveDisabled 로 그대로.
  assert.match(client, /status=\{isSaving \? 'saving' :[^}]*\}[\s\S]*?onSave=\{handleSaveAll\}\s+saveLabel="일반 메뉴 저장"\s+saveDisabled=\{!hasUnsavedChanges\}/)
  assert.match(client, /status=\{isSavingAdminSidebar \? 'saving' :[^}]*\}[\s\S]*?onSave=\{handleSaveAdminSidebar\}\s+saveLabel="관리자 패널 순서 저장"\s+saveDisabled=\{!hasUnsavedAdminSidebarChanges\}/)
  // 저장 안 된 변경 수는 기존 dirty 값이 참일 때만 0보다 크다.
  assert.match(client, /const headerDirtyCount = hasUnsavedChanges \? Math\.max\(1, /)
  assert.match(client, /const adminSidebarDirtyCount = hasUnsavedAdminSidebarChanges \? Math\.max\(1, /)
})

// ───── 3-2단계: /admin/footer · 공용 checkout-consent-editor ─────
const FOOTER = 'src/app/(admin)/admin/footer'
const CONSENT_EDITOR = 'src/components/admin/checkout-consent-editor.tsx'
const { createHash } = await import('node:crypto')

test('/admin/footer: 부르는 API·서버 액션·가드·주소 키·이탈 경고 훅은 옮기기 전(38a1273)과 같다', () => {
  const items = parityItems(FOOTER)
  assert.deepEqual(items.fetch, [
    "fetch('/api/admin/site-logo', { method: 'DELETE' })",
    "fetch('/api/admin/site-logo', { method: 'POST', body: form })",
  ])
  assert.deepEqual(items.serverImports, [
    './actions', './actions', './actions', './consent-actions', './consent-actions', './notice-popup-actions', './notice-popup-actions',
    './purchase-policy-actions', './purchase-policy-actions',
    '@/lib/admin-audit-log-server', '@/lib/admin-audit-log-server', '@/lib/admin-audit-log-server',
    '@/lib/admin-permissions-server', '@/lib/admin-permissions-server', '@/lib/admin-permissions-server',
    '@/lib/admin-permissions-server', '@/lib/admin-permissions-server', '@/lib/admin-permissions-server',
    '@/lib/checkout-consent-server', '@/lib/footer-content-server', '@/lib/footer-content-server',
    '@/lib/market-purchase-policy-server', '@/lib/market-purchase-policy-server',
    '@/lib/signup-consent-server', '@/lib/signup-consent-server', '@/lib/signup-consent-server', '@/lib/signup-consent-server',
    '@/lib/site-brand-server', '@/lib/site-notice-popup-server', '@/lib/site-notice-popup-server',
  ])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, [...Array(11).fill('requireAdmin()'), "requireAdminPagePermission('site.manage')", "requireAdminPagePermission('site.manage')"])
  assert.deepEqual(items.searchParamKeys, [])
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  // 이탈 경고 훅은 구매 고지 폼의 지금 호출 그대로 1개(5-3). 저장 줄은 훅을 부르지 않는다.
  assert.deepEqual(items.guardHook, ['useUnsavedChangesGuard(hasChanges)'])
})

test('/admin/footer: 저장 액션 호출·인자는 그대로(동의 문구·지문이 바뀌지 않게 같은 값을 보낸다)', () => {
  const sources = screenFiles(FOOTER).filter((file) => !file.endsWith('actions.ts')).map(read)
  const calls = (name) => sources.flatMap((source) => callsOf(source, name)).sort()
  assert.deepEqual(calls('saveFooterContentAction'), ['saveFooterContentAction(footerContent)'])
  assert.deepEqual(calls('saveSiteBrandAction'), ['saveSiteBrandAction(draft)'])
  assert.deepEqual(calls('saveNoticePopupAction'), ['saveNoticePopupAction(saved.revision, pending.input)'])
  assert.deepEqual(calls('saveSignupConsentItemAction'), ['saveSignupConsentItemAction(target, false)', 'saveSignupConsentItemAction(target, true)'])
  assert.deepEqual(calls('reviseSignupConsentItemAction'), [
    'reviseSignupConsentItemAction(item.id, item.version, note, true)',
    'reviseSignupConsentItemAction(pending.item.id, pending.item.version, pending.note, false)',
  ])
  assert.deepEqual(calls('saveSignupConsentTextsAction'), ['saveSignupConsentTextsAction(texts)'])
  assert.deepEqual(calls('saveMarketPurchasePolicyAction'), [
    'saveMarketPurchasePolicyAction({ texts: draft, consentKeys: consentDraft, cartTexts: cartDraft, cartInsufficientTexts: insufficientDraft, expectedVersion: saved.policy.version, })',
  ])
  // 공용 동의 편집기(pricing·footer 가 씀): 입력 처리(onChange·onClick·onCheckedChange) 16개가 옮기기 전과 글자까지 같다
  // → 편집기가 만드는 값(consentTitle·consentSummary·consentItems)이 같아 저장 내용·지문이 같다. 바뀐 것은 색·테두리·버튼 변형뿐.
  const editor = read(CONSENT_EDITOR)
  const handlers = []
  for (const match of editor.matchAll(/\b(onChange|onClick|onCheckedChange)=\{/g)) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < editor.length; end += 1) {
      if (editor[end] === '{') depth += 1
      else if (editor[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    handlers.push(editor.slice(match.index, end + 1).replace(/\s+/g, ' ').trim())
  }
  assert.equal(handlers.length, 16)
  assert.equal(createHash('sha256').update(handlers.join('\n')).digest('hex'), '705ec78976bd8b48e1401327b20ee38086923aaf59f210cb4967b7e30b659dac')
  assert.doesNotMatch(editor, /adminAction/)
  assert.equal(editor.match(/variant="brandOutline"/g)?.length, 2)
})

test('/admin/footer: 같은 칸·버튼·막힘 조건, 공지 팝업은 확인 창을 거친 뒤에만 저장(유형 가)', () => {
  const client = read(`${FOOTER}/footer-client.tsx`)
  for (const fragment of [
    '<Button variant="brandOutline" onClick={handleReset} disabled={isSaving || !hasUnsavedChanges}>',
    'saveDisabled={!hasUnsavedChanges}',
    'href="/admin/footer/policy-history"',
    '{policyLockNotice ? <AdminNotice kind="warning">{policyLockNotice}</AdminNotice> : null}',
  ]) assert.ok(client.includes(fragment), fragment)
  for (const title of ['기본 사업자 정보', '추가 안내 문구', '약관 및 정책', '미리보기']) assert.ok(client.includes(`<CardTitle>${title}</CardTitle>`), title)

  const brand = read(`${FOOTER}/site-brand-form.tsx`)
  assert.ok(brand.includes('saveDisabled={loadFailed || Boolean(invalid) || !hasChanges}'))
  assert.ok(brand.includes('if (loadFailed || invalid || isSaving) return'))

  const logo = read(`${FOOTER}/site-logo-settings.tsx`)
  for (const fragment of ['disabled={!file || isSaving} onClick={saveLogo}', 'disabled={isSaving} onClick={resetLogo}', '{error && <AdminNotice kind="error">{error}</AdminNotice>}']) {
    assert.ok(logo.includes(fragment), fragment)
  }

  const popup = read(`${FOOTER}/notice-popup-admin.tsx`)
  assert.ok(popup.includes('disabled={!previewContent.title || !previewContent.body}'))
  // 저장 줄의 [저장]은 확인 창을 연다(openConfirm 안에는 저장 요청이 없다). 저장은 확인 창의 [저장](onConfirm={save}) 뒤.
  const openConfirm = popup.slice(popup.indexOf('const openConfirm = () => {'), popup.indexOf('const save = async () => {'))
  assert.doesNotMatch(openConfirm, /saveNoticePopupAction/)
  assert.match(popup, /pending=\{saving\}\n\s+onConfirm=\{save\}/)
  assert.match(popup, /destructiveVariant="adminDanger"/)

  const consent = read(`${FOOTER}/signup-consent-admin.tsx`)
  assert.deepEqual([...consent.matchAll(/key: '(\w+)',\s+header: (?:'([^']+)'|<span className="sr-only">([^<]+)<\/span>)/g)].map((match) => match[2] ?? match[3]), [
    '이름', '구분', '고정', '연결 약관', '순서', '보임', '버전', '마지막 개정', '현재 버전 동의 회원', '작업',
  ])
  for (const fragment of [
    'variant="adminTable" disabled={busy} onClick={() => setDraft(draftFromItem(item))}>수정</Button>',
    "{item.required && item.is_active && item.policy_slug ? (",
    'variant="adminTable" disabled={busy} onClick={() => setReviseTarget({ item, note: \'\' })}>',
    'disabled={busy || !reviseTarget.note.trim()} onClick={() => startRevise(reviseTarget.item, reviseTarget.note)}',
    'variant="adminDanger" disabled={busy || !acknowledged} onClick={onConfirm}',
    '{lockNotice ? <AdminNotice kind="warning">{lockNotice}</AdminNotice> : null}',
  ]) assert.ok(consent.includes(fragment), fragment)
  assert.doesNotMatch(consent, /adminAction/)

  const purchase = read(`${FOOTER}/purchase-policy-form.tsx`)
  assert.ok(purchase.includes('saveDisabled={!hasChanges || (blocked && !legacyInvalid)}'))
  assert.ok(purchase.includes('if (!draft || !saved || !hasChanges || isSaving) return'))
})

test('/admin/footer: 저장 함수가 여럿인 주소 → 저장 함수마다 인라인 저장 줄 하나(둘을 한 버튼으로 묶지 않음)', () => {
  const bars = saveBarsOf(FOOTER)
  assert.ok(bars.every((bar) => bar.variant === 'inline'), '고정 바 없음')
  assert.ok(bars.every((bar) => bar.onSave.length === 1), '저장 줄 하나에 저장 함수 하나')
  const byFile = bars.map((bar) => `${bar.file.split('/').pop()}:${bar.onSave[0].match(SAVE_HANDLER)?.slice(1).find(Boolean)}`).sort()
  assert.deepEqual(byFile, [
    'footer-client.tsx:handleSave',
    'notice-popup-admin.tsx:openConfirm',
    'purchase-policy-form.tsx:handleSave',
    // 가입 동의 항목 편집 칸(ItemEditor 의 onSave = startSave(draft))·안내 문구 저장
    'signup-consent-admin.tsx:onSave',
    'signup-consent-admin.tsx:saveTexts',
    'site-brand-form.tsx:handleSave',
  ])
  // 로고는 고르면 바로 적용하는 올리기라 저장 줄을 두지 않는다(비밀번호 변경과 같은 판단).
  assert.ok(!bars.some((bar) => bar.file.endsWith('site-logo-settings.tsx')))
  // 저장 줄은 이탈 경고 훅을 부르지 않는다 — 훅은 구매 고지 폼의 1개뿐(위 대조 시험).
  assert.match(read(`${FOOTER}/signup-consent-admin.tsx`), /onSave=\{\(\) => startSave\(draft\)\}/)
})

// ───── 5단계: 회원·고객(/admin/users·상세, /admin/support, /admin/refunds, /admin/credits, /admin/reviews, /admin/audit-log) ─────
// 기대값은 옮기기 전(e3a37d9) 코드에서 뽑은 목록이다. 바뀐 것은 없앤 confirm·alert 뿐(→ 공통 확인 창·화면 안 오류).
const STEP5 = {
  USERS: 'src/app/(admin)/admin/users',
  SUPPORT: 'src/app/(admin)/admin/support',
  REFUNDS: 'src/app/(admin)/admin/refunds',
  CREDITS: 'src/app/(admin)/admin/credits',
  REVIEWS: 'src/app/(admin)/admin/reviews',
  AUDIT_LOG: 'src/app/(admin)/admin/audit-log',
}
const STEP5_BEFORE = {
  USERS: {
    "fetch": [
      "fetch('/api/admin/users/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selectedUser.id, amount, description: reason, category, idempotencyKey }) })",
      "fetch('/api/admin/users/credits/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, amount: parsedAmount, reason: reason.trim(), idempotencyKey }), })",
      "fetch(`/api/admin/users/${userId}/suspension`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), })",
      "fetch(`/api/admin/users/${userId}/withdrawal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), })",
      "fetch(`/api/admin/users/search?q=${encodeURIComponent(searchQuery.trim())}`)",
      "fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })"
    ],
    "serverImports": [
      "./suspension-policy-actions",
      "./suspension-policy-actions",
      "@/lib/admin-member-access-log-server",
      "@/lib/admin-member-access-log-server",
      "@/lib/admin-member-detail-server",
      "@/lib/admin-member-suspension-server",
      "@/lib/admin-member-suspension-server",
      "@/lib/admin-permissions-server",
      "@/lib/admin-permissions-server",
      "@/lib/admin-permissions-server",
      "@/lib/admin-users-server",
      "@/lib/admin-users-server",
      "@/lib/member-suspension-policy-server"
    ],
    "db": [
      "from:member_suspensions",
      "rpc:save_member_suspension_policy"
    ],
    "guards": [
      "requireAdminPagePermission('members.view')",
      "requireAdminPagePermission('members.view')"
    ],
    "searchParamKeys": [
      "page",
      "pageSize",
      "q",
      "suspended"
    ]
  },
  SUPPORT: {
    "fetch": [
      "fetch('/api/admin/alerts/summary', { cache: 'no-store' })",
      "fetch(`/api/admin/support/categories/${category.id}/restore`, { method: 'POST', })",
      "fetch(`/api/admin/support/categories/${category.id}`, { method: 'DELETE', })",
      "fetch(`/api/admin/support/tickets/${selectedTicket.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminResponse: response, status: 'resolved', // 13번: 지금 보이는 답변(첫 답변이면 빈 글)의 sha256 — 그사이 다른 사람이 답했으면 서버가 충돌로 막는다. expectedSha256: await sha256Hex(selectedTicket.admin_response ?? ''), operationKey: answerOperationKey, }), })",
      "fetch(`/api/admin/support/tickets/${selectedTicketId}/member-summary`)",
      "fetch(`/api/admin/support/tickets/${ticket.id}/answer-revisions`)",
      "fetch(`/api/admin/support/tickets/${ticket.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminResponse: text, expectedSha256: await sha256Hex(ticket.admin_response ?? ''), reason: reason.trim(), operationKey, }), })",
      "fetch(`/api/admin/users/${target.user_id}/withdrawal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_ticket', ticketId: target.id, reason: reason.trim() }), })",
      "fetch(editingCategory ? `/api/admin/support/categories/${editingCategory.id}` : '/api/admin/support/categories', { method: editingCategory ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), })"
    ],
    "serverImports": [
      "./actions",
      "./actions",
      "@/lib/admin-audit-log-server",
      "@/lib/admin-member-access-log-server",
      "@/lib/admin-member-detail-server",
      "@/lib/admin-permissions-server",
      "@/lib/admin-permissions-server",
      "@/lib/admin-support-server",
      "@/lib/member-withdrawal-server",
      "@/lib/site-brand-server",
      "@/lib/support-page-content-server",
      "@/lib/support-page-content-server",
      "@/lib/withdrawn-member-redaction-server"
    ],
    "db": [
      "from:support_reply_templates",
      "from:support_reply_templates",
      "from:support_reply_templates",
      "from:support_reply_templates",
      "from:support_ticket_categories",
      "from:support_tickets",
      "from:support_tickets",
      "from:support_tickets",
      "from:support_tickets",
      "from:support_tickets",
      "from:support_tickets"
    ],
    "guards": [
      "requireAdminPagePermission('support.manage')"
    ],
    "searchParamKeys": [
      "categoryId",
      "includeDeleted",
      "page",
      "pageSize",
      "q",
      "status",
      "ticket"
    ]
  },
  REFUNDS: {
    "fetch": [
      "fetch('/api/admin/alerts/summary', { cache: 'no-store' })",
      "fetch('/api/admin/payments/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId: selectedAlert.id, note: alertNote }), })",
      "fetch('/api/admin/payments/review', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentOrderId: selectedOrder.id, action, note, ...(action === 'paid_confirmed' && mulNo.trim() ? { mulNo: mulNo.trim() } : {}), ...(action === 'paid_confirmed' && paidAt ? { paidAt: new Date(paidAt).toISOString() } : {}), ...(action === 'cancel_handled' ? { externalMethod } : {}), }), })",
      "fetch('/api/admin/payments/sales-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }), })",
      "fetch('/api/admin/refunds', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: selectedRequest.id, action: processAction, adminNote: adminNote || undefined, ...(processAction === 'reject' ? { memberReason: memberReasonText } : {}), ...(processAction === 'reject' && selectedRequest.status === 'manual_review' ? { providerNotCancelledConfirmed } : {}), ...(processAction === 'complete_manual' ? { externalMethod, refundAmount: Number(refundAmount), // 전액 모드도 미리보기에서 받은 쓸 수 있는 몫 합을 보낸다(그사이 바뀌면 DB 가 거절 → 새로고침 안내). recoveredCredits: selectedRequiresRecovery ? Number(recoveredCredits) : remainingCredits, } : {}), }) })",
      "fetch(`/api/admin/market/refunds/${ownerTarget.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'owner_settle', confirmedRefundCredits, adminNote: ownerNote.trim(), ownerItems: ownerSources.map((source) => ({ sourceId: source.sourceId, restored: Number(ownerInputs[source.sourceId]?.restored || 0), reissued: Number(ownerInputs[source.sourceId]?.reissued || 0), unrecovered: Number(ownerInputs[source.sourceId]?.unrecovered || 0), reason: ownerInputs[source.sourceId]?.reason.trim() ?? '', })), }), })",
      "fetch(`/api/admin/market/refunds/${request.id}`)",
      "fetch(`/api/admin/market/refunds/${requestId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, confirmedRefundCredits, adminNote: adminNote.trim() || undefined, ...(action === 'reject' ? { rejectCode, evidence: rejectCode === 'PROVIDED_CONFIRMED' ? rejectEvidence.trim() : undefined } : {}), }), })",
      "fetch(`/api/admin/refunds/recovery-preview?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' })"
    ],
    "serverImports": [
      "@/lib/admin-member-access-log-server",
      "@/lib/admin-permissions-server",
      "@/lib/member-withdrawal-server",
      "@/lib/payment-orders-server",
      "@/lib/payment-review-actions",
      "@/lib/payment-review-actions",
      "@/lib/payment-review-actions",
      "@/lib/payment-sales-status-server",
      "@/lib/payment-sales-status-server",
      "@/lib/site-board-server",
      "@/lib/withdrawn-member-redaction-server"
    ],
    "db": [
      "from:market_refund_requests",
      "from:payment_orders",
      "from:payment_reconciliation_alerts",
      "from:refund_requests"
    ],
    "guards": [
      "requireAdminPagePermission(['refunds.payment', 'refunds.market'])"
    ],
    "searchParamKeys": []
  },
  CREDITS: {
    "fetch": [
      "fetch('/api/admin/users/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selectedUser.id, amount, description: reason, category, idempotencyKey }) })",
      "fetch('/api/admin/users/credits/limits', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perGrant: nextPerGrant, perDay: nextPerDay }), })",
      "fetch(`/api/admin/users/search?q=${encodeURIComponent(searchQuery.trim())}`)"
    ],
    "serverImports": [
      "@/lib/admin-credit-grant-limits-server",
      "@/lib/admin-credit-transactions-server",
      "@/lib/admin-credit-transactions-server",
      "@/lib/admin-member-access-log-server",
      "@/lib/admin-permissions-server"
    ],
    "db": [],
    "guards": [
      "requireAdminPagePermission('credits.view')"
    ],
    "searchParamKeys": [
      "page",
      "pageSize",
      "q",
      "type"
    ]
  },
  REVIEWS: {
    "fetch": [
      "fetch(`/api/admin/reviews/${review.id}`, { method: 'DELETE' })",
      "fetch(`/api/admin/reviews?${params.toString()}`)"
    ],
    "serverImports": [
      "@/lib/admin-permissions-server",
      "@/lib/admin-sidebar-server"
    ],
    "db": [],
    "guards": [
      "requireAdminPagePermission('reviews.manage')"
    ],
    "searchParamKeys": [
      "subject"
    ]
  },
  AUDIT_LOG: {
    "fetch": [
      "fetch(`/api/admin/audit-log/access?${requestKey}`)",
      "fetch(`/api/admin/audit-log?${requestKey}`)"
    ],
    "serverImports": [
      "@/lib/admin-audit-log-server",
      "@/lib/admin-member-access-log-view-server",
      "@/lib/admin-permissions-server",
      "@/lib/admin-sidebar-server"
    ],
    "db": [],
    "guards": [
      "requireAdminPagePermission('owner')"
    ],
    "searchParamKeys": [
      "subject",
      "tab"
    ]
  },
}

for (const [name, dir] of Object.entries(STEP5)) {
  test(`${dir.replace('src/app/(admin)', '')}: 부르는 API·서버 액션·로더·표·가드·주소 키는 옮기기 전(e3a37d9)과 같고, 브라우저 확인·알림 창은 없다`, () => {
    const items = parityItems(dir)
    for (const key of ['fetch', 'serverImports', 'db', 'guards', 'searchParamKeys']) assert.deepEqual(items[key], STEP5_BEFORE[name][key], `${name}.${key}`)
    assert.deepEqual(items.confirm, [], `${name}.confirm`)
    assert.deepEqual(items.alert, [], `${name}.alert`)
    // 이탈 경고 훅은 이 화면들에 없다(새로 걸지 않음, 5-3).
    assert.deepEqual(items.guardHook, [], `${name}.guardHook`)
    // 켜진 화면의 주황 버튼은 없다(6-4 래칫).
    for (const file of screenFiles(dir).filter((file) => file.startsWith(dir))) assert.doesNotMatch(read(file), /adminAction/, file)
  })
}
// 13번 열람 기록(recordMemberAccess·attachMemberContacts)·연락처 가림(maskPhone·logged 분기)은 개인정보 의무라 글자까지 같다.
// 지문은 옮기기 전(e3a37d9) 다섯 page 에서 뽑았다(18줄).
test('5단계: 회원 연락처 열람 기록 호출·화면 키·항목과 기록 실패 때 가림은 옮기기 전과 글자까지 같다(13번)', () => {
  const files = [
    `${STEP5.USERS}/page.tsx`, `${STEP5.USERS}/[id]/page.tsx`, `${STEP5.SUPPORT}/page.tsx`, `${STEP5.REFUNDS}/page.tsx`, `${STEP5.CREDITS}/page.tsx`,
  ]
  const lines = []
  for (const file of files) {
    const source = read(file)
    for (const name of ['recordMemberAccess', 'attachMemberContacts', 'maskPhone']) for (const call of callsOf(source, name)) lines.push(`${file}|${call}`)
    for (const line of source.split('\n')) {
      if (/logged \|\||paymentLogged|const profile = logged|notesSection|visiblePaymentRefundRows|visibleReviewOrders|const users = result\.users|email: logged/.test(line)) lines.push(`${file}|${line.trim()}`)
    }
  }
  assert.equal(lines.length, 18)
  assert.equal(createHash('sha256').update(lines.join('\n')).digest('hex'), '29870f5a83fb59c79d877c0ec951ec9040e82ff18a5bbc47ff3574ecce131cf6')
  // 문의 상세 창의 연락처(전화는 회원 요약에서, 기록 실패면 가림)도 그대로
  const support = read(`${STEP5.SUPPORT}/support-client.tsx`)
  assert.ok(support.includes("if (loaded?.contactMasked) return '연락처 가림(열람 기록 실패)'"))
})

// 브라우저 확인 창 → 공통 확인 창(유형 가: 확인 전에는 잠금·요청이 없다). 문구는 전의 확인 창 그대로(제목 + 설명으로 나눔).
function assertAskFirst(source, fnStart, { title, request, danger }) {
  const start = source.indexOf(fnStart)
  assert.ok(start >= 0, fnStart)
  const body = source.slice(start, source.indexOf('\n  }\n', start))
  const asked = body.indexOf('await ask')
  assert.ok(asked > 0, `${fnStart}: ask`)
  assert.ok(body.includes(title), `${fnStart}: ${title}`)
  const stop = body.search(/if \(!confirmed\)|\)\)\) return/)
  assert.ok(stop > asked, `${fnStart}: 취소면 멈춤`)
  assert.ok(body.indexOf(request) > stop, `${fnStart}: 요청은 확인 뒤`)
  if (danger) assert.match(body, /danger: true,/, fnStart)
  else assert.doesNotMatch(body, /danger: true/, fnStart)
}

test('5단계 유형 (가): 메모 지우기·가림, 카테고리 숨김·다시 사용, 템플릿 숨김·바꾸기, 후기 삭제는 먼저 묻고 확인 뒤에만 요청한다', () => {
  const notes = read(`${STEP5.USERS}/[id]/member-notes-panel.tsx`)
  assertAskFirst(notes, 'const remove = async (noteId: string) => {', { title: "title: '이 메모를 지울까요?'", request: "void call(noteId, `/api/admin/users/${userId}/notes`, { action: 'delete', noteId }", danger: true })
  assert.ok(notes.includes("description: '지운 메모도 탈퇴할 때까지 보관됩니다(개인정보처리방침 2·3절).'"))
  assertAskFirst(notes, 'const redact = async (noteId: string) => {', { title: "title: '이 메모의 글을 가림 문구로 바꿀까요?'", request: "void call(noteId, `/api/admin/users/${userId}/notes/redact`, { noteId }", danger: true })
  assert.ok(notes.includes("description: '되돌릴 수 없습니다. 적지 말아야 할 개인정보(계좌·주민등록번호 등)가 적힌 경우에만 씁니다.'"))
  // 훅은 탈퇴 회원 조기 반환보다 먼저 부른다(훅 순서 고정).
  assert.ok(notes.indexOf('useAdminConfirm()') < notes.indexOf('if (data.withdrawn) {'))
  assert.match(notes, /\{confirmDialog\}\n\s+<\/div>\n\s+\)\n\}/)

  const support = read(`${STEP5.SUPPORT}/support-client.tsx`)
  assertAskFirst(support, 'const hideCategory = async (category: SupportCategory) => {', { title: "title: `'${category.name}' 카테고리를 숨김 처리하시겠습니까?`", request: 'fetch(`/api/admin/support/categories/${category.id}`', danger: true })
  assert.ok(support.includes("description: '기존 문의의 카테고리 스냅샷은 유지됩니다.'"))
  assertAskFirst(support, 'const restoreCategory = async (category: SupportCategory) => {', { title: "title: `'${category.name}' 카테고리를 다시 사용할까요?`", request: 'fetch(`/api/admin/support/categories/${category.id}/restore`', danger: false })
  assert.ok(support.includes("description: '회원 문의 화면에 다시 보입니다.'"))

  const templates = read(`${STEP5.SUPPORT}/reply-templates-panel.tsx`)
  assertAskFirst(templates, 'const hide = async (template: SupportReplyTemplateRow) => {', { title: "title: `'${template.title}' 템플릿을 숨길까요?`", request: 'hideSupportReplyTemplateAction({ id: template.id, revision: template.revision })', danger: true })
  assert.ok(templates.includes("description: '답변 창의 템플릿 목록에서 빠집니다.'"))

  // 템플릿 고르기: 쓰던 글이 있을 때만 묻고, 확인하면 지금처럼 넣고 창을 닫는다. 확인 창은 고르기 창 안에 그린다.
  const tools = read(`${STEP5.SUPPORT}/reply-template-tools.tsx`)
  const choose = tools.slice(tools.indexOf('const choose = async (template: SupportReplyTemplateRow) => {'), tools.indexOf('const renderList'))
  assert.match(choose, /if \(currentText\.trim\(\) && !\(await ask\(\{\s+title: '쓰던 답변을 이 템플릿으로 바꿀까요\?',\s+description: '지금 쓴 글은 사라집니다\.',/)
  assert.ok(choose.indexOf('onInsert(fillSupportReplyTemplate(') > choose.indexOf(')))) return'))
  assert.match(tools, /\{confirmDialog\}\n\s+<\/DialogContent>/)

  const reviews = read(`${STEP5.REVIEWS}/reviews-admin-client.tsx`)
  assertAskFirst(reviews, 'const deleteReview = async (review: AdminReviewRow) => {', { title: "title: '이 후기를 삭제하시겠습니까?'", request: 'fetch(`/api/admin/reviews/${review.id}`, { method: \'DELETE\' })', danger: true })
  // 확인 창에 자료명·본문을 그대로 보인다(화면 비교 때 가림).
  assert.ok(reviews.includes('description: <span data-admin-pii="" className="whitespace-pre-line break-keep">{`${review.itemTitle}\\n"${review.content ?? \'(본문 없음)\'}"`}</span>,'))
  const deleteBody = reviews.slice(reviews.indexOf('const deleteReview = async'), reviews.indexOf('const columns'))
  assert.ok(deleteBody.indexOf('setDeletingId(review.id)') > deleteBody.indexOf('if (!confirmed) return'))
})

test('/admin/reviews: 알림 창 2곳은 같은 문구로 화면 안에 보이고(읽기 = 표 실패 칸·오류 띠, 삭제 = 오류 띠), 표는 표 부품(가로 넘침 틀)', () => {
  const client = read(`${STEP5.REVIEWS}/reviews-admin-client.tsx`)
  assert.ok(client.includes("if (id === requestId.current) setLoadError(error instanceof Error ? error.message : '후기를 불러오지 못했습니다.')"))
  assert.ok(client.includes("setActionError(error instanceof Error ? error.message : '삭제에 실패했습니다.')"))
  assert.match(client, /loadError && !data \? \(\s+<AdminTableState kind="error" message=\{loadError\} onRetry=\{\(\) => void loadReviews\(\)\} \/>/)
  assert.match(client, /\{loadError && data \? <AdminNotice kind="error" onRetry=\{\(\) => void loadReviews\(\)\}>\{loadError\}<\/AdminNotice> : null\}/)
  assert.match(client, /\{actionError \? <div ref=\{actionErrorRef\}><AdminNotice kind="error">\{actionError\}<\/AdminNotice><\/div> : null\}/)
  assert.match(client, /if \(actionError\) actionErrorRef\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\)/)
  // 1단계 메모: 이 표만 가로 넘침 틀이 없던 것 → 표 부품(xl 미만 표 안 가로 스크롤)
  assert.doesNotMatch(client, /<table\b/)
  assert.match(client, /<AdminDataTable\s+caption="후기 목록"[\s\S]*?minWidth=\{860\}/)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['자료', '별점', '본문·태그', '작성자', '도움', '작성일', '작업'])
  assert.match(client, /key: 'content',\s+header: '본문·태그',\s+\/\/[^\n]*\n\s+pii: true,/)
  // 주소 키·검색·쪽은 그대로, 날짜 표기(YYYY.MM.DD) 그대로
  for (const fragment of [
    "const ratingFilter = listQuery.params.get('rating') ?? ''",
    "const search = listQuery.params.get('q') ?? ''",
    "if (search) params.set('search', search)",
    "disabled={deletingId === review.id}",
    "{deletingId === review.id ? '삭제 중…' : '삭제'}",
    'return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, \'0\')}.${String(date.getDate()).padStart(2, \'0\')}`',
  ]) assert.ok(client.includes(fragment), fragment)
  assert.match(read(`${STEP5.REVIEWS}/page.tsx`), /<AdminPageHeader\s+title=\{<><AdminMenuName href="\/admin\/reviews" fallback="후기 관리" \/> · \{workspaceSubject === 'english' \? '영어' : '국어'\}<\/>\}/)
})

// 자료 환불의 부족분 확인 2곳(유형 나)을 그대로 떼어 실행한다: 첫 요청 → 409 → 확인 → confirmedRefundCredits 로 다시 요청, 잠금 유지.
const MARKET_REFUNDS = `${STEP5.REFUNDS}/market-refunds-client.tsx`
const { default: ts } = await import('typescript')

function sliceFunction(source, start) {
  const begin = source.indexOf(start)
  assert.ok(begin > 0, start)
  let depth = 0
  let end = source.indexOf('{', begin + start.length - 1)
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1
    else if (source[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return source.slice(begin, end + 1)
}

function loadMarketRefundFunction(start, name, names) {
  const body = ts.transpileModule(sliceFunction(read(MARKET_REFUNDS), start), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('deps', `const { ${names.join(', ')} } = deps\n${body}\nreturn ${name}`)
}

function shortfallWorld({ answer, restorable = 60 }) {
  const log = []
  let processing = null
  let release
  const deps = {
    setProcessingId: (value) => { processing = value; log.push(`processing:${value}`) },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      log.push(`fetch:${JSON.stringify({ action: body.action, confirmedRefundCredits: body.confirmedRefundCredits })}`)
      const first = log.filter((line) => line.startsWith('fetch:')).length === 1
      const result = first
        ? { code: 'MARKET_REFUND_SHORTFALL', error: '일부 크레딧은 이미 썼습니다.', requested: 100, restorable }
        : { success: true, message: '처리했습니다.' }
      return { status: first ? 409 : 200, ok: !first, json: async () => result }
    },
    formatCredits: (value) => `${value} C`,
    toast: { success: (message) => log.push(`success:${message}`), error: (message) => log.push(`error:${message}`), warning: () => {} },
    MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE: '',
    router: { refresh: () => {} },
    alerts: null,
    setPending: () => {},
    setOwnerTarget: () => {},
    adminNote: '',
    rejectCode: '',
    rejectEvidence: '',
    ownerTarget: { id: 'request-1' },
    ownerNote: '대표 메모',
    ownerSources: [],
    ownerInputs: {},
  }
  const ask = (options) => {
    log.push(`ask:processing=${processing}`)
    deps.lastAsk = options
    return new Promise((resolve) => { release = () => resolve(answer) })
  }
  deps.ask = ask
  deps.askOwnerShortfall = ask
  return { deps, log, release: () => release(), processing: () => processing }
}

const PROCESS_REFUND_DEPS = ['setProcessingId', 'fetch', 'adminNote', 'rejectCode', 'rejectEvidence', 'ask', 'formatCredits', 'setPending', 'toast', 'MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE', 'router', 'alerts']
const OWNER_SETTLE_DEPS = ['ownerTarget', 'setProcessingId', 'fetch', 'ownerNote', 'ownerSources', 'ownerInputs', 'askOwnerShortfall', 'formatCredits', 'toast', 'MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE', 'setOwnerTarget', 'router', 'alerts']

test('/admin/refunds 자료 환불 승인(유형 나): 409 부족분 → 확인 → confirmedRefundCredits 로 다시 요청, 창이 열린 동안 잠금 유지', async () => {
  const world = shortfallWorld({ answer: true })
  const processRefund = loadMarketRefundFunction('const processRefund = async (requestId: string, action: RefundAction) => {', 'processRefund', PROCESS_REFUND_DEPS)(world.deps)
  const running = processRefund('request-1', 'approve')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(world.log, ['processing:request-1', 'fetch:{"action":"approve"}', 'ask:processing=request-1'])
  assert.equal(world.processing(), 'request-1')
  assert.equal(world.deps.lastAsk.description, '일부 크레딧은 이미 썼습니다.')
  assert.deepEqual(world.deps.lastAsk.impacts.map((impact) => [impact.label, impact.value]), [['요청', '100 C'], ['복구 가능', '60 C']])
  assert.equal(world.deps.lastAsk.danger, undefined)
  world.release()
  await running
  assert.deepEqual(world.log.slice(3), ['fetch:{"action":"approve","confirmedRefundCredits":60}', 'success:처리했습니다.', 'processing:null'])
})

test('/admin/refunds 자료 환불 승인(유형 나): 확인 창에서 취소하면 다시 요청하지 않는다', async () => {
  const world = shortfallWorld({ answer: false })
  const processRefund = loadMarketRefundFunction('const processRefund = async (requestId: string, action: RefundAction) => {', 'processRefund', PROCESS_REFUND_DEPS)(world.deps)
  const running = processRefund('request-1', 'approve')
  await new Promise((resolve) => setImmediate(resolve))
  world.release()
  await running
  assert.deepEqual(world.log, ['processing:request-1', 'fetch:{"action":"approve"}', 'ask:processing=request-1', 'processing:null'])
})

test('/admin/refunds 대표 정산(유형 나): 409 부족분 → 확인 → 돌려줄 수 있는 양으로 다시 정산, 창이 열린 동안 잠금 유지 / 취소면 다시 보내지 않음', async () => {
  const world = shortfallWorld({ answer: true })
  const submitOwnerSettle = loadMarketRefundFunction('const submitOwnerSettle = async (confirmedRefundCredits?: number) => {', 'submitOwnerSettle', OWNER_SETTLE_DEPS)(world.deps)
  const running = submitOwnerSettle(undefined)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(world.log, ['processing:request-1', 'fetch:{"action":"owner_settle"}', 'ask:processing=request-1'])
  assert.deepEqual(world.deps.lastAsk.impacts.map((impact) => [impact.label, impact.value]), [['요청', '100 C'], ['돌려줄 수 있음', '60 C']])
  world.release()
  await running
  // 확인 뒤: 전처럼 잠금을 넘겨 같은 함수를 돌려줄 수 있는 양으로 다시 부른다(다시 묻지 않음).
  assert.deepEqual(world.log.slice(3), [
    'processing:null', 'processing:request-1', 'fetch:{"action":"owner_settle","confirmedRefundCredits":60}', 'success:처리했습니다.', 'processing:null', 'processing:null',
  ])
  assert.equal(world.log.filter((line) => line.startsWith('ask:')).length, 1)

  const canceled = shortfallWorld({ answer: false })
  const cancelRun = loadMarketRefundFunction('const submitOwnerSettle = async (confirmedRefundCredits?: number) => {', 'submitOwnerSettle', OWNER_SETTLE_DEPS)(canceled.deps)(undefined)
  await new Promise((resolve) => setImmediate(resolve))
  canceled.release()
  await cancelRun
  assert.deepEqual(canceled.log, ['processing:request-1', 'fetch:{"action":"owner_settle"}', 'ask:processing=request-1', 'processing:null'])
})

test('/admin/refunds: 부족분 확인 창은 각 처리 창 안에 그리고, 창이 열린 동안 실행 버튼이 잠긴다', () => {
  const client = read(MARKET_REFUNDS)
  assert.match(client, /const \{ ask, dialog: confirmDialog \} = useAdminConfirm\(\)/)
  assert.match(client, /const \{ ask: askOwnerShortfall, dialog: ownerConfirmDialog \} = useAdminConfirm\(\)/)
  assert.match(client, /\{confirmDialog\}\n\s+<\/DialogContent>/)
  assert.match(client, /\{ownerConfirmDialog\}\n\s+<\/DialogContent>/)
  assert.match(client, /onOpenChange=\{\(open\) => !open && processingId === null && setPending\(null\)\}/)
  assert.match(client, /onOpenChange=\{\(open\) => !open && processingId === null && setOwnerTarget\(null\)\}/)
  assert.match(client, /disabled=\{processingId !== null \|\| \(pending\?\.action === 'reject'/)
  assert.match(client, /disabled=\{processingId !== null \|\| !ownerNote\.trim\(\)/)
  assert.doesNotMatch(client, /window\.confirm|\bconfirm\(/)
})

test('/admin/refunds: 같은 열·버튼·조건, 상태 색은 5-1 표, 회원·사유·메모 칸은 가림 표시', () => {
  const headers = (source) => [...source.matchAll(/header: '([^']+)'/g)].map((match) => match[1])
  const payment = read(`${STEP5.REFUNDS}/refunds-client.tsx`)
  const market = read(MARKET_REFUNDS)
  const review = read(`${STEP5.REFUNDS}/payment-review-client.tsx`)
  assert.deepEqual(headers(payment), ['요청일', '사용자', '요금제', '크레딧', '금액', '사유', '상태', '결제 처리', '처리'])
  assert.deepEqual(headers(market), ['요청일', '사용자', '상품', '환불 크레딧', '대상', '사유', '상태', '처리 메모', '처리'])
  assert.deepEqual(headers(review), ['주문일', '회원', '주문번호·결제사 거래번호', '결제사', '상품·금액', '사유', '처리'])
  assert.match(payment, /adminStatusTone\('refundRequest', status\)/)
  assert.match(market, /adminStatusTone\('marketRefundRequest', request\.status\)/)
  for (const fragment of [
    "['pending_review', 'retryable_failed'].includes(request.status) ? (",
    "request.status === 'manual_review' ? (",
    "{request.origin === 'user' && (",
    "onClick={() => openProcessDialog(request, 'approve')}",
    "onClick={() => openProcessDialog(request, 'complete_manual')}",
    'disabled={isSubmitting || !manualCompletionReady || !rejectReady || !memberReasonReady}',
    "variant={processAction === 'reject' ? 'adminDanger' : 'brand'}",
    'onPress={() => setStatusFilter(card.filter)}',
  ]) assert.ok(payment.includes(fragment), fragment)
  assert.deepEqual([...payment.matchAll(/filter: '(\w+)' \}/g)].map((match) => match[1]), ['pending_review', 'completed', 'rejected', 'attention'])
  for (const fragment of [
    "cell: (request) => (request.status === 'pending' ? (",
    '{isOwner ? (',
    'disabled={processingId === request.id} onClick={() => void openOwnerSettle(request)}',
    "{request.memberWithdrawn ? '가림' : request.reason ?? '-'}",
    "{request.memberWithdrawn ? '가림' : request.admin_note ?? '-'}",
  ]) assert.ok(market.includes(fragment), fragment)
  for (const fragment of ['order.allowedActions.length > 0 ? (', 'onClick={() => openDialog(order)}']) assert.ok(review.includes(fragment), fragment)
  for (const source of [payment, market]) {
    assert.match(source, /key: 'member',\s+header: '사용자',\s+pii: true,/)
    assert.match(source, /key: 'reason',\s+header: '사유',[\s\S]{0,80}?pii: true,/)
  }
  assert.match(market, /key: 'adminNote',\s+header: '처리 메모',\s+pii: true,/)
  assert.match(review, /key: 'member', header: '회원', pii: true,/)
  // 날짜 표기는 지금 모양 그대로
  assert.ok(payment.includes("cell: (request) => new Date(request.created_at).toLocaleDateString('ko-KR'),"))
  assert.ok(market.includes("cell: (request) => new Date(request.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }),"))
  assert.ok(review.includes("cell: (order) => new Date(order.created_at).toLocaleString('ko-KR'),"))
  assert.match(read(`${STEP5.REFUNDS}/page.tsx`), /<AdminNotice kind="error" title=\{`다음 목록을 불러오지 못했습니다: \$\{loadErrors\.join\(', '\)\}`\}>/)
})

test('/admin/users: 카드형 목록 → 표(Q2), 같은 표시 조건·주소 키, 연락처는 가림 표시', () => {
  const client = read(`${STEP5.USERS}/users-client.tsx`)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['회원', '연락처', '소속', '역할', '가입일', '크레딧', '작업'])
  for (const fragment of [
    '{user.is_admin && (',
    '{user.suspended && (',
    '{user.suspended === null && (',
    '{user.withdrawn_at && (',
    '{user.provider && (',
    '{user.email && (',
    '{user.phone && (',
    "cell: (user) => (user.credit_balance === null ? '잔액 확인 불가' : formatCredits(user.credit_balance)),",
    "cell: (user: AdminUserListItem) => (!user.withdrawn_at ? (",
    '...(canGrantCredits',
    "router.push(buildHref({ suspended: event.target.checked ? '1' : null, page: 1 }))",
    "cell: (user) => new Date(user.created_at).toLocaleDateString('ko-KR'),",
    "label={`탈퇴 ${new Date(user.withdrawn_at).toLocaleDateString('ko-KR')}`}",
    'data-admin-pii=""',
  ]) assert.ok(client.includes(fragment), fragment)
  assert.match(client, /key: 'member',\s+header: '회원',\s+\/\/[^\n]*\n\s+pii: true,/)
  assert.match(client, /key: 'contact',\s+header: '연락처',\s+pii: true,/)
  assert.match(read(`${STEP5.USERS}/page.tsx`), /<AdminPageHeader\s+title=\{<AdminMenuName href="\/admin\/users" fallback="사용자 관리" \/>\}/)
  // 정지 정책 카드(대표 전용, 12번): 저장 함수 하나 = 인라인 저장 줄 하나. 변경 없이 눌러도 전처럼 서버가 '바뀐 내용이 없습니다'로 답한다.
  const card = read(`${STEP5.USERS}/suspension-policy-card.tsx`)
  assert.ok(card.includes('const result = await saveMemberSuspensionPolicyAction(data.policy.revision, normalized)'))
  assert.match(card, /saveDisabled=\{saving\}\s+saveWhenClean/)
})

test('/admin/users/[id]: 정지·메모(12번)·열람 기록 링크(13번)는 그대로, 표 4개는 표 부품, 개인정보 칸 가림 표시', () => {
  const page = read(`${STEP5.USERS}/[id]/page.tsx`)
  assert.match(page, /\{isOwner && \(\s*<Link href=\{`\/admin\/audit-log\?tab=access&member=\$\{profile\.id\}`\}/)
  assert.equal(page.match(/<AdminDataTable\b/g)?.length, 4)
  assert.deepEqual([...page.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), [
    '받은 날', '구분', '남은 수량', '만료일', '상태', '회수',
    '주문 시각', '요금제', '결제수단', '상태', '주문번호',
    '구매 시각', '상품', '상태', '다운로드', '진단',
    '일시', '유형', '내용', '변동', '거래 후 잔액',
  ])
  assert.ok(page.includes("...(canRevoke ? [{"))
  assert.match(page, /\['이메일', profile\.email \|\| '-', true\],\s+\['전화번호', profile\.phone \|\| '-', true\],/)
  assert.ok(page.includes("<dd data-admin-pii={pii ? '' : undefined} className=\"min-w-0 break-all\">{value}</dd>"))
  // 날짜 표기 그대로
  assert.match(page, /const formatDateTime = \(value: string \| null \| undefined\) =>\s+value \? new Date\(value\)\.toLocaleString\('ko-KR', \{ timeZone: 'Asia\/Seoul' \}\) : '-'/)
  // 크레딧 증감 색(Q6): 평범한 사용은 기본 글자색, 회수만 빨강
  assert.match(page, /creditAmountTone\(transaction\.amount, getAdminCreditTransactionKind\(transaction\)\.tone\)/)

  const suspension = read(`${STEP5.USERS}/[id]/member-suspension-panel.tsx`)
  assert.equal(suspension.match(/fetch\(/g)?.length, 1)
  for (const call of [
    "await postSuspension(userId, { action: 'lift', suspensionId: suspension.id, liftReason: reason.trim() })",
    "await postSuspension(userId, { action: 'notice', suspensionId: suspension.id, via, sentAt: sent.toISOString(), summary: summary.trim() })",
    "const result = await postSuspension(userId, {\n        action: 'suspend',",
  ]) assert.ok(suspension.includes(call), call)
  assert.match(suspension, /<Button type="button" variant="adminDanger" onClick=\{\(\) => void submit\(\)\} disabled=\{submitting\}>\{submitting \? '처리 중…' : '정지 확정'\}<\/Button>/)
  assert.ok(suspension.includes("data-admin-pii={PII_FACTS.has(label) ? '' : undefined}"))
  assert.ok(suspension.includes("const PII_FACTS = new Set(['회원에게 알린 사유', '내부 메모', '알림', '해제'])"))
  const notes = read(`${STEP5.USERS}/[id]/member-notes-panel.tsx`)
  assert.match(notes, /aria-label="관리자 메모" data-admin-pii="" \/>/)
  assert.match(notes, /<p data-admin-pii="" className=\{`mt-1 whitespace-pre-wrap break-words text-sm/)
  const withdrawal = read(`${STEP5.USERS}/[id]/member-withdrawal-panel.tsx`)
  assert.ok(withdrawal.includes("const PII_ROWS = new Set(['이메일', '휴대폰', '카카오 이메일'])"))
  assert.match(withdrawal, /placeholder=\{email \?\? userId\} data-admin-pii="" \/>/)
  // 본인 확인 메모·고지 원문·익명화 사유
  for (const fragment of [
    'onChange={(event) => setIdentityNote(event.target.value)} maxLength={500} rows={2} data-admin-pii="" />',
    '<Textarea readOnly value={notice.text} rows={8} className="font-mono text-xs" data-admin-pii="" />',
    'onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} data-admin-pii="" />',
  ]) assert.ok(withdrawal.includes(fragment), fragment)
})

test('/admin/support: 카드형 목록 → 표(Q2), 첫 열 단추로 연다, 필터는 [적용] 그대로, 문의·답변 본문은 가림 표시', () => {
  const client = read(`${STEP5.SUPPORT}/support-client.tsx`)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['문의', '카테고리', '상태', '회원', '접수일', '답변'])
  assert.match(client, /<button\s+type="button"[\s\S]{0,200}?onClick=\{\(\) => openTicket\(ticket\)\}/)
  assert.doesNotMatch(client, /<div[^>]*onClick=\{\(\) => openTicket/)
  for (const fragment of [
    '<Button variant="brand" onClick={applyFilters}>적용</Button>',
    'onReset={resetFilters}',
    'resultCount={pagination.totalCount}',
    "adminStatusTone('supportTicket', statusKey)",
    '<p data-admin-pii="" className="whitespace-pre-wrap text-[var(--studio-text)]">{selectedTicket?.message}</p>',
    '<p data-admin-pii="" className="whitespace-pre-wrap text-[var(--studio-text)]">{selectedTicket.admin_response}</p>',
    "cell: (ticket) => new Date(ticket.created_at).toLocaleDateString('ko-KR') },",
  ]) assert.ok(client.includes(fragment), fragment)
  assert.match(client, /key: 'subject',\s+header: '문의',\s+\/\/[^\n]*\n\s+pii: true,/)
  assert.match(client, /key: 'member', header: '회원', pii: true,/)
  // 안내 문구 탭(대표): 저장 함수 하나 = 인라인 저장 줄, 전의 [저장] 막힘 조건 그대로
  const content = read(`${STEP5.SUPPORT}/support-page-content-panel.tsx`)
  assert.ok(content.includes('saveDisabled={saving || emptyRequired.length > 0 || tooLong.length > 0}'))
  assert.ok(content.includes('const result = await saveSupportPageContentAction({'))
  // 변경이 없으면 저장이 막힌다(saveWhenClean 없음, 대표 확인 항목). 정지 정책 카드만 saveWhenClean(위 /admin/users 시험).
  assert.doesNotMatch(content, /saveWhenClean/)
  // 링크 문의 주의 문구는 전처럼 role="alert"
  assert.match(read(`${STEP5.SUPPORT}/page.tsx`), /<AdminNotice kind="warning" role="alert" className="mb-6">/)
  // 상세 창 제목·연락처 줄은 화면 비교 때 가린다
  assert.ok(client.includes('<DialogTitle data-admin-pii="">{selectedTicket?.subject}</DialogTitle>'))
  assert.ok(client.includes('<span data-admin-pii="">{selectedContactText(selectedTicket, memberSummary)}</span>'))
})

test('/admin/credits: 지급 창의 요청·검사는 그대로(돈이 오가는 창), 거래 표·지표 카드는 부품, 증감 색은 Q6', () => {
  const dialog = read(`${STEP5.CREDITS}/grant-credit-dialog.tsx`)
  for (const fragment of [
    "if (amount <= 0) {",
    "if (!Number.isInteger(amount)) {",
    "if (reason.trim().length > 500) {",
    "setStep('confirm')",
    'setIdempotencyKey(crypto.randomUUID())',
    '<Button variant="brand" onClick={handleSubmit} disabled={isSubmitting}>',
  ]) assert.ok(dialog.includes(fragment), fragment)
  assert.match(dialog, /<span className="font-bold tabular-nums text-\[var\(--admin-tone-success-text\)\]">\{formatSignedCredits\(amount\)\}<\/span>/)
  const client = read(`${STEP5.CREDITS}/credits-client.tsx`)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['일시', '사용자', '유형', '내용', '금액'])
  assert.match(client, /key: 'member',\s+header: '사용자',\s+pii: true,/)
  assert.match(client, /adminStatusTone\('creditTransaction', kind\.tone\)/)
  assert.ok(client.includes("{new Date(t.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}"))
  // 기본 한도 카드: 저장 함수 하나 = 인라인 저장 줄, 요청 그대로
  const card = read(`${STEP5.CREDITS}/credit-grant-limits-card.tsx`)
  assert.match(card, /<AdminSaveBar\s+variant="inline"[\s\S]*?onSave=\{\(\) => void save\(\)\}[\s\S]*?saveDisabled=\{isSaving\}/)
  // 변경이 없으면 저장이 막힌다(saveWhenClean 없음 — 2·3단계 판단 5와 같음, 대표 확인 항목)
  assert.doesNotMatch(card, /saveWhenClean/)
})

test('/admin/audit-log: 두 탭의 표·필터는 부품, 대상·IP 칸은 가림 표시, 날짜 표기 그대로', () => {
  const actions = read(`${STEP5.AUDIT_LOG}/audit-log-client.tsx`)
  const access = read(`${STEP5.AUDIT_LOG}/member-access-log-client.tsx`)
  assert.deepEqual([...actions.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['시각', '처리자', '종류', '대상', '수량', '사유', '상세'])
  assert.deepEqual([...access.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['시각', '처리자', '화면', '회원', '항목', '사유', 'IP'])
  assert.match(actions, /key: 'target', header: '대상', pii: true,/)
  assert.match(access, /key: 'ip', header: 'IP', pii: true,/)
  assert.match(access, /key: 'members',\s+header: '회원',\s+\/\/[^\n]*\n\s+pii: true,/)
  assert.ok(access.includes('<span data-admin-pii="">회원: {data?.member?.name ?? member.slice(0, 8)}</span>'))
  for (const key of ['actor', 'action', 'source', 'from', 'to']) assert.ok(actions.includes(`listQuery.params.get('${key}')`), key)
  for (const key of ['actor', 'screen', 'member', 'from', 'to']) assert.ok(access.includes(`listQuery.params.get('${key}')`), key)
  for (const source of [actions, access]) {
    assert.match(source, /const formatDateTime = \(value: string \| null \| undefined\) =>\s+value \? new Date\(value\)\.toLocaleString\('ko-KR', \{ timeZone: 'Asia\/Seoul' \}\) : '-'/)
    assert.match(source, /const setFilter = \(key: string, value: string\) => listQuery\.update\(\{ \[key\]: value, page: 1 \}\)/)
  }
  assert.ok(access.includes("onClick={() => setFilter('member', '')}>필터 해제</Button>"))
})

test('5단계: 저장 바 하나에 저장 함수 하나(모두 인라인 줄 — 접힌 카드·탭·편집 칸 안에 있음), 이탈 경고 훅 없음', () => {
  const bars = Object.values(STEP5).flatMap((dir) => saveBarsOf(dir))
  const byFile = [...new Set(bars.map((bar) => `${bar.file.split('/').pop()}:${bar.variant}:${bar.onSave.length}:${bar.onSave[0]?.match(SAVE_HANDLER)?.slice(1).find(Boolean)}`))].sort()
  assert.deepEqual(byFile, [
    'credit-grant-limits-card.tsx:inline:1:save',
    'support-page-content-panel.tsx:inline:1:save',
    'suspension-policy-card.tsx:inline:1:save',
  ])
})
