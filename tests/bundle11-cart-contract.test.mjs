import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

// 11번 계획 11-1 '장바구니 껍데기'·'배치'·'부품·화면 규칙'의 소스 계약(장바구니 결제 칸).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const DIR = 'src/app/(solvook)/cart/_components'
const shell = read(`${DIR}/cart-view.tsx`)
const panelView = read(`${DIR}/cart-checkout-panel-view.tsx`)
const listView = read(`${DIR}/cart-line-list-view.tsx`)
const pageView = read(`${DIR}/cart-page-view.tsx`)
const page = read('src/app/(solvook)/cart/page.tsx')
const bottom = read('src/components/checkout/cart-checkout-panel-bottom.tsx')
const pure = read('src/lib/cart-checkout-panel.ts')
const cartSources = [
  ...readdirSync(new URL(`../${DIR}`, import.meta.url)).map((name) => [`${DIR}/${name}`, read(`${DIR}/${name}`)]),
  ['src/app/(solvook)/cart/page.tsx', page],
  ['src/lib/cart-checkout-panel.ts', pure],
]

function between(source, start, end) {
  const from = source.indexOf(start)
  assert.ok(from >= 0, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end}`)
  return source.slice(from, to)
}

test('표시 부품 안에는 동의·부분 보유·줄 선택 상태가 없다(창 열림·목록 펼치기만)', () => {
  assert.doesNotMatch(listView, /useState/)
  assert.doesNotMatch(pageView, /useState/)
  const states = [...panelView.matchAll(/const \[(\w+), \w+\] = useState/g)].map((match) => match[1])
  assert.deepEqual(states, ['listOpen'])
})

test('MarketCheckoutConfirmDialog 를 쓰지 않는다(결제 칸이 대신함)', () => {
  for (const [path, source] of cartSources) {
    assert.doesNotMatch(source, /MarketCheckoutConfirmDialog|market-checkout-confirm-dialog/, path)
  }
})

test('동의·고지·전체 취소 안내·부분 보유 문장을 코드에 두지 않는다(DB 값만)', () => {
  for (const [path, source] of cartSources) {
    assert.doesNotMatch(source, /단순 변심|하나라도 구매할 수 없으면|기보유분 차감 없이|정가로 구매됨을 확인|전체 구매가 취소/, path)
  }
  assert.match(panelView, /\{cartTexts\.cartCheckoutNotice\}/)
  assert.match(panelView, /\{cartTexts\.partialOwnedConfirmLabel\}/)
})

test('장바구니 줄에는 정가 구매 조건 문장 대신 정가 구매 표시만', () => {
  assert.match(listView, />정가 구매</)
  assert.doesNotMatch(listView, /정가로 구매됩니다/)
})

test('부분 보유 확인 체크의 접근 이름은 보이는 DB 문장뿐(aria-label 없음)', () => {
  const block = between(panelView, '{needsPartialAck && cartTexts ? (', ') : null}')
  assert.match(block, /<label /)
  assert.doesNotMatch(block, /aria-label/)
})

test('화면은 cartTextsSha256 을 계산하지 않고 사본 값을 보낸다', () => {
  for (const [path, source] of cartSources) {
    assert.doesNotMatch(source, /createHash|crypto\.subtle|sha256\(/, path)
  }
  assert.match(pure, /cartTextsSha256: input\.cartTexts\.cartTextsSha256,/)
  assert.match(shell, /cartTexts: consent\.cartTexts,\n\s+idempotencyKey: crypto\.randomUUID\(\),/)
})

test('결제 칸은 보인 고지를 사본으로 두고 그 사본을 그린다(뷰를 직접 그리지 않음)', () => {
  assert.match(shell, /const noticeCopy = consent\.noticeCopy/)
  assert.doesNotMatch(shell, /view\.purchaseNotice|view\.purchaseConsent/)
  assert.match(shell, /reconcileConsent\(consentRef\.current, consentInputFrom\(nextView,/)
})

test('키 수명: retryable 만 스냅숏을 두고 같은 본문으로 다시 보내며, 그 밖은 버린다', () => {
  const submit = between(shell, 'const submitCheckout = async', 'const pay = () =>')
  assert.ok(submit.indexOf("if (outcome.kind === 'retryable') {\n      setSnapshot(body)") >= 0)
  assert.ok(submit.indexOf('setSnapshot(null)\n\n    switch (outcome.kind)') > submit.indexOf("outcome.kind === 'retryable'"))
  assert.match(shell, /if \(decision\.state === 'retryable' && snapshot\) \{\n\s+void submitCheckout\(snapshot\)/)
  assert.match(submit, /if \(inFlightRef\.current\) return/)
})

test('[다시 선택]: 영수증을 먼저 조회하고 404 면 직전 키·줄 묶음을 기억해 다시 읽는다', () => {
  const reselect = between(shell, 'const reselect = async', 'const onPrimary = () =>')
  assert.ok(reselect.indexOf('lookupReceipt(snapshot.idempotencyKey)') < reselect.indexOf("result === 'notFound'"))
  assert.match(reselect, /rememberedRef\.current = \{ key: snapshot\.idempotencyKey, lineIds: snapshot\.items\.map/)
  assert.match(shell, /`\/api\/market\/cart\/checkouts\/\$\{key\}`/)
  assert.match(shell, /if \(shouldRecheckAfterReload\(rememberedRef\.current, nextView\.items\)\) await recheckRemembered\(nextView\)/)
  assert.match(shell, /if \(outcome\.recheckReceipt && afterReselect\) await recheckRemembered\(latestView\)/)
})

test('응답별 처리: 동의 필요는 동의 화면, 성공은 동의 비우고 다시 읽은 뷰 잔액으로 완료 창', () => {
  assert.match(shell, /redirectToConsentIfRequired\(response\.status, payload\)/)
  const success = between(shell, "case 'success': {", "case 'login':")
  assert.match(success, /clearConsentAfterSuccess/)
  assert.match(success, /const latestView = await reload\('silent', \[\]\)/)
  assert.match(shell, /balance: latestView \? latestView\.balance : typeof data\.balanceAfter === 'number' \? data\.balanceAfter : null,/)
  assert.match(shell, /onClose=\{\(\) => setCompleteQueue\(dequeueComplete\)\}/)
})

test('ACK_REQUIRED: 다시 읽은 뒤 details.lines 줄을 부분 보유로 보이게 하고 확인을 비운 뒤 초점', () => {
  const ack = between(shell, "case 'ackRequired': {", "case 'conflicting':")
  assert.ok(ack.indexOf('setForcedPartialIds(forced)') < ack.indexOf("await reload('silent', forced, outcome.message)"))
  assert.match(ack, /partialAck: false/)
  assert.match(ack, /focusTarget\('partialAck'\)/)
})

test('알림 자리: 두 요소(status·alert)를 처음부터 두고 role 을 바꾸지 않으며, 위 영역이 알리면 sr-only 이유는 빈다', () => {
  assert.match(panelView, /<p role="status" aria-live="polite"[^>]*>\{statusText\}<\/p>\n\s+<p role="alert"[^>]*>\{alertText\}<\/p>/)
  assert.equal((panelView.match(/role="status"/g) ?? []).length, 1)
  assert.match(shell, /const srReason = statusText \|\| alertText \? '' : decision\.blockedReason \?\? ''/)
  const announce = between(shell, 'const announce = ', '// ── 뷰 반영')
  assert.match(announce, /topRef\.current\.scrollTop = 0/)
  assert.match(announce, /if \(origin !== 'panel'\) return/)
  assert.doesNotMatch(announce, /\.focus\(/)
})

test('배치: 판정은 첫 그리기·글꼴 로드 끝·창 크기·고지 사본 교체 때만(쓰는 도중에는 부르지 않음)', () => {
  assert.match(shell, /document\.fonts\?\.ready\.then\(/)
  assert.match(shell, /window\.addEventListener\('resize', onResize\)/)
  assert.match(shell, /decideCheckoutPanelMode\(\{/)
  const calls = (shell.match(/decideMode\(\)/g) ?? []).length
  assert.equal(calls, 5)
  for (const handler of ['const updateSelection = async', 'const submitCheckout = async', 'onCheckedKeysChange=']) {
    const at = shell.indexOf(handler)
    const chunk = shell.slice(at, at + 400)
    assert.doesNotMatch(chunk, /decideMode\(/, handler)
  }
})

test('아래 묶음은 공용 부품이고 안에 조건부로 생기는 보이는 줄이 없다, 금액 줄은 tabular-nums·lg 줄바꿈 없음', () => {
  assert.match(panelView, /<CartCheckoutPanelBottom/)
  const body = between(bottom, 'return (', '\n  )\n}')
  assert.doesNotMatch(body, /&&| \? /)
  assert.match(bottom, /tabular-nums/)
  assert.match(bottom, /lg:whitespace-nowrap/)
  // 알림·부분 보유 확인·다시 불러오기는 위 영역에 있다
  const top = between(panelView, '<div ref={topRef}', '<CartCheckoutPanelBottom')
  assert.match(top, /role="alert"/)
  assert.match(top, /needsPartialAck && cartTexts/)
})

test('고정 막대: 결제 버튼 줄을 관찰하고, 결제하지 않으며, 숨기기 전에 초점을 제목으로', () => {
  assert.match(shell, /observer\.observe\(row\)/)
  assert.match(shell, /const row = buttonRowRef\.current/)
  assert.match(shell, /barRef\.current\?\.contains\(document\.activeElement\)\) \{[\s\S]{0,120}titleRef\.current\?\.focus/)
  const bar = between(pageView, 'export function CartCheckoutBar', 'export interface CartPageViewProps')
  assert.doesNotMatch(bar, /fetch|checkout/)
  assert.match(bar, /hidden=\{!visible\}\n\s+inert=\{!visible\}/)
  const goTo = between(shell, 'const goToPanel = () =>', '// ── 배치')
  assert.doesNotMatch(goTo, /fetch|submitCheckout|pay\(/)
  assert.match(goTo, /focusTarget\(decision\.focusTarget\)/)
})

test('막대 초점: 비활성 요소에는 주지 않고 제목으로 돌린다, sticky 안 대상은 scrollTop 을 옮긴 뒤 preventScroll', () => {
  const focus = between(shell, 'const focusTarget = ', 'const goToPanel = () =>')
  assert.match(focus, /element\.matches\(':disabled, \[aria-disabled="true"\]'\)\) element = titleRef\.current/)
  assert.match(focus, /top\.scrollTop = /)
  assert.match(focus, /focus\(\{ preventScroll: true \}\)/)
  assert.match(panelView, /id="cart-checkout-panel-title"\n\s+tabIndex=\{-1\}/)
})

test('스크롤 여백: 문서 scroll-padding 만 쓰고 대상별 scroll-margin 은 쓰지 않는다, 토스트는 막대 위로', () => {
  assert.match(shell, /html\.style\.scrollPaddingTop = /)
  assert.match(shell, /html\.style\.scrollPaddingBottom = barVisible/)
  for (const [path, source] of cartSources) {
    assert.doesNotMatch(source, /scroll-margin|scrollMargin|scroll-m[tbyx]?-/, path)
  }
  assert.match(shell, /\[data-sonner-toaster\]\[data-y-position="bottom"\]\{--offset-bottom:/)
})

test('동의 부품: studio 값을 --consent-* 변수로, 창에는 테마 클래스를 다시 붙이고 잠금 때 체크 비활성', () => {
  assert.match(panelView, /\[--consent-ink:var\(--studio-ink\)\] \[--consent-muted:var\(--studio-text\)\] \[--consent-line:var\(--studio-border\)\] \[--consent-ring:var\(--studio-focus-ring\)\]/)
  assert.match(panelView, /dialogClassName=\{cn\('studio-theme', CART_CONSENT_THEME_CLASS\)\}/)
  assert.match(panelView, /const consentLocked = decision\.locked \|\| decision\.consentDisabled/)
  assert.match(panelView, /<MarketLegacyConsent/)
})

test('고지 없음: 동의 자리에 안내(빨강 아님) + [다시 불러오기], 결제 막음', () => {
  const block = between(panelView, 'const consent = !noticeAvailable || !noticeCopy ? (', ') : noticeCopy.format === 2 ? (')
  assert.match(block, /role="alert"/)
  assert.doesNotMatch(block, /text-destructive/)
  assert.match(block, /다시 불러오기/)
})

test('[잔액 다시 확인]은 장바구니를 다시 읽고, 부족일 때 첫 버튼은 충전 링크', () => {
  const secondary = between(shell, 'const onSecondary = () =>', '// ── 초점 대상')
  assert.match(secondary, /void reload\('panel'\)/)
  // 버튼 이름(DB)을 읽었을 때만 충전 링크(이름 없는 버튼을 만들지 않음)
  assert.match(panelView, /decision\.state === 'insufficient' && decision\.primaryEnabled \? \(\s+<Button asChild/)
})

test('함께 살 수 없는 선택은 공용 판정 함수로 미리 막고 줄에 표시만 한다(선택을 풀지 않음)', () => {
  assert.match(pure, /import \{ findConflictingSelection \} from '@\/lib\/market-selection-conflict'/)
  assert.match(shell, /const conflictIds = conflictingLineIds\(lines\)/)
  assert.match(listView, /data-conflict-line=\{conflicted \? 'true' : undefined\}/)
})

test('page: 첫 값·개발 띠·15번 한 줄 안내만', () => {
  assert.match(page, /<CheckoutConsentPreviewBand preview=\{view\.consentPreview\} \/>/)
  assert.match(page, /<CartView initialView=\{view\} upcomingNotice=\{<UpcomingPolicyNotice \/>\} \/>/)
  assert.doesNotMatch(page, /isCheckoutConsentPreview|CHECKOUT_CONSENT_PREVIEW/)
  assert.doesNotMatch(shell, /isCheckoutConsentPreview|CHECKOUT_CONSENT_PREVIEW/)
})

// 구현 검증 반영(ui-a11y major 1·2, minor 2)
test('409 고지 바뀜: 동의 사본과 함께 뷰도 같은 사본으로 맞춘다(다음 줄 선택 때 옛 고지로 되돌아가지 않게)', () => {
  const changed = between(shell, "case 'noticeChanged': {", "case 'priceChanged':")
  const consentAt = changed.indexOf('setConsent({ ...result.state, checkedKeys: [] })')
  const viewAt = changed.indexOf('setView((current) => viewWithNoticeCopy(current, copy, outcome.cartTexts))')
  assert.ok(consentAt > 0 && viewAt > consentAt)
})

test('결제 응답 뒤 다시 읽기는 응답 이유(alert)를 넘겨, 주문 바뀜 안내가 그 이유를 덮지 않는다', () => {
  for (const [start, end] of [["case 'priceChanged':", "case 'insufficient':"], ["case 'insufficient':", "case 'ackRequired':"],
    ["case 'conflicting':", "case 'reload': {"], ["case 'reload': {", 'const pay = ']]) {
    const block = between(shell, start, end)
    assert.match(block, /announce\(outcome\.message, 'alert', 'panel'\)/, start)
    assert.match(block, /await reload\('silent', (undefined|forced), outcome\.message\)/, start)
  }
  assert.match(shell, /const announcement = reconcileAnnouncement\(result, responseAlert\)/)
  assert.doesNotMatch(shell, /announce\((NOTICE_CHANGED_MESSAGE|ORDER_CHANGED_MESSAGE)/)
})

test('지난 안내(status·alert)는 다음 사용자 조작 때 함께 비워 sr-only 막힌 이유가 다시 읽히고, 빈 장바구니에는 막대 여백이 없다', () => {
  for (const marker of ['const updateSelection = async', 'const removeItems = async', 'onPartialAckChange=', 'onCheckedKeysChange=']) {
    const at = shell.indexOf(marker)
    assert.ok(at > 0 && shell.slice(at, at + 260).includes("announce('', 'status', 'silent')"), marker)
  }
  assert.match(shell, /const barVisible = barObserved && hasItems/)
})
