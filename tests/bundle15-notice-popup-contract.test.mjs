import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

// 등록 훅이 켜진 뒤에 불러야 '@/' 경로를 찾는다(정적 import 는 훅보다 먼저 풀린다).
const {
  POLICY_UPCOMING_PATH,
  closedStorageKey,
  getNoticeRecordProblems,
  hasAuthCompleteQuery,
  hideTodayStorageKey,
  isNoticePopupDismissed,
  isNoticePopupExcludedPath,
  isNoticePopupInWindow,
  isNoticeRecordGood,
  isoToKstLocalInput,
  kstDateString,
  kstLocalInputToIso,
  markNoticePopupClosed,
  markNoticePopupHiddenToday,
  resetNoticePopupMemory,
  shouldServeNoticePopup,
  validateNoticePopupInput,
} = await import('../src/lib/site-notice-popup.ts')

// 15번 계획 11-1: 공지 팝업·변경 예정 약관 고지의 코드 쪽 계약. DB 쪽은 bundle15-notice-popup-db-contract.test.mjs.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)

function fakeStorage({ throwGet = false, throwSet = false } = {}) {
  const map = new Map()
  return {
    map,
    get length() { return map.size },
    key: (index) => [...map.keys()][index] ?? null,
    getItem(key) { if (throwGet) throw new Error('blocked'); return map.has(key) ? map.get(key) : null },
    setItem(key, value) { if (throwSet) throw new Error('QuotaExceededError'); map.set(key, String(value)) },
    removeItem(key) { map.delete(key) },
  }
}

// ── 5-1 빼는 경로 ─────────────────────────────────────────────────────────────────────────────────
test('빼는 경로: 관리자·충전·결제·장바구니·변경 예정 글·인증 화면에서는 띄우지 않는다', () => {
  for (const path of ['/admin', '/admin/footer', '/dashboard/admin/x', '/pricing', '/checkout', '/checkout/payapp/result?orderId=x',
    '/checkout/kakaopay/result', '/cart', '/terms/upcoming', '/consent', '/login', '/signup', '/auth/callback', '/preview/x',
    '/forgot-password', '/reset-password']) {
    assert.equal(isNoticePopupExcludedPath(path, '/terms/upcoming'), true, path)
  }
  for (const path of ['/', '/items/1', '/categories/2', '/search', '/library', '/mypage', '/mypage/withdraw', '/terms', '/terms/refund']) {
    assert.equal(isNoticePopupExcludedPath(path, '/terms/upcoming'), false, path)
  }
})

test('빼는 경로: 과목 접두 경로도 같은 판정, 앞부분만 같은 경로는 띄운다', () => {
  assert.equal(isNoticePopupExcludedPath('/english/cart', null), true)
  assert.equal(isNoticePopupExcludedPath('/korean/checkout/payapp/result', null), true)
  assert.equal(isNoticePopupExcludedPath('/checkoutx', null), false)
  assert.equal(isNoticePopupExcludedPath('/cartoon', null), false)
})

test('빼는 경로: 링크 경로는 쿼리·# 을 뗀 경로와 정확히 같은 경로만, / 면 빼지 않는다', () => {
  assert.equal(isNoticePopupExcludedPath('/terms/service', '/terms/service?x=1#a'), true)
  assert.equal(isNoticePopupExcludedPath('/terms/service/x', '/terms/service?x=1#a'), false)
  assert.equal(isNoticePopupExcludedPath('/', '/'), false)
  assert.equal(isNoticePopupExcludedPath('/items/1', '/'), false)
  // /terms/upcoming 은 링크가 다른 곳이어도 늘 뺀다
  assert.equal(isNoticePopupExcludedPath('/terms/upcoming', '/terms/service'), true)
})

// ── 5-2 노출 판정 ──────────────────────────────────────────────────────────────────────────────
test('노출 판정: 꺼짐·끝·지문 형식, 시작 전 행도 서버는 넘기고 브라우저가 시작 뒤에 연다', () => {
  const now = Date.parse('2026-12-10T12:00:00+09:00')
  const base = { enabled: true, title: 't', body: 'b', linkUrl: null, linkLabel: null, startsAt: null, endsAt: '2027-01-12T00:00:00+09:00', contentSha256: SHA, revision: 1 }
  assert.equal(shouldServeNoticePopup(base, now), true)
  assert.equal(shouldServeNoticePopup({ ...base, enabled: false }, now), false)
  assert.equal(shouldServeNoticePopup({ ...base, endsAt: null }, now), false)
  assert.equal(shouldServeNoticePopup({ ...base, contentSha256: 'xyz' }, now), false)
  assert.equal(shouldServeNoticePopup({ ...base, startsAt: '2026-12-11T00:00:00+09:00' }, now), true)
  assert.equal(isNoticePopupInWindow({ ...base, startsAt: '2026-12-11T00:00:00+09:00' }, now), false)
  // 경계: 지금 = 시작 보임, 지금 = 끝 안 보임
  assert.equal(isNoticePopupInWindow({ ...base, startsAt: '2026-12-10T12:00:00+09:00' }, now), true)
  assert.equal(isNoticePopupInWindow({ ...base, endsAt: '2026-12-10T12:00:00+09:00' }, now), false)
  assert.equal(isNoticePopupInWindow({ ...base, contentSha256: SHA.toUpperCase() }, now), false)
})

// ── 5-3 오늘 하루·닫기·저장소 실패 ────────────────────────────────────────────────────────────────
test('오늘 하루: 한국 날짜 경계(UTC 14:59:59 → 전날, 15:00:00 → 다음 날)', () => {
  assert.equal(kstDateString(Date.parse('2026-12-10T14:59:59Z')), '2026-12-10')
  assert.equal(kstDateString(Date.parse('2026-12-10T15:00:00Z')), '2026-12-11')
})

test('오늘 하루: 오늘이면 안 뜨고 어제 날짜면 뜨며, 쓸 때 다른 지문 키는 지운다', () => {
  resetNoticePopupMemory()
  const local = fakeStorage()
  const session = fakeStorage()
  const storages = { local: () => local, session: () => session }
  const now = Date.parse('2026-12-10T12:00:00+09:00')
  local.setItem(hideTodayStorageKey(SHA), '2026-12-09')
  assert.equal(isNoticePopupDismissed(SHA, now, storages), false)
  local.setItem(hideTodayStorageKey(OTHER_SHA), '2026-12-10')
  local.setItem(closedStorageKey(OTHER_SHA), '1')
  local.setItem('unrelated', 'x')
  markNoticePopupHiddenToday(SHA, now, storages)
  assert.equal(local.getItem(hideTodayStorageKey(SHA)), '2026-12-10')
  assert.equal(local.getItem(hideTodayStorageKey(OTHER_SHA)), null)
  assert.equal(local.getItem(closedStorageKey(OTHER_SHA)), null)
  assert.equal(local.getItem('unrelated'), 'x')
  resetNoticePopupMemory()
  assert.equal(isNoticePopupDismissed(SHA, now, storages), true)
  // 한국 자정이 지나면 다시 뜬다
  assert.equal(isNoticePopupDismissed(SHA, Date.parse('2026-12-11T00:00:00+09:00'), storages), false)
  // 지문이 바뀌면 다시 뜬다
  assert.equal(isNoticePopupDismissed(OTHER_SHA, now, storages), false)
})

test('닫기: sessionStorage 에 지문 키, 같은 탭에서는 다시 안 뜬다', () => {
  resetNoticePopupMemory()
  const session = fakeStorage()
  markNoticePopupClosed(SHA, { session: () => session })
  assert.equal(session.getItem(closedStorageKey(SHA)), '1')
  resetNoticePopupMemory()
  assert.equal(isNoticePopupDismissed(SHA, Date.now(), { session: () => session, local: () => fakeStorage() }), true)
})

test('저장소 실패: getItem·setItem 이 던져도 예외 없음, 메모리로 같은 탭 안에서 다시 안 뜸, 읽기 실패 → 뜸', () => {
  resetNoticePopupMemory()
  const broken = fakeStorage({ throwGet: true, throwSet: true })
  const storages = { local: () => broken, session: () => broken }
  assert.equal(isNoticePopupDismissed(SHA, Date.now(), storages), false)
  assert.doesNotThrow(() => markNoticePopupClosed(SHA, storages))
  assert.equal(isNoticePopupDismissed(SHA, Date.now(), storages), true)
  resetNoticePopupMemory()
  assert.doesNotThrow(() => markNoticePopupHiddenToday(SHA, Date.now(), storages))
  assert.equal(isNoticePopupDismissed(SHA, Date.now(), storages), true)
})

test('저장소 실패: 저장소 객체 접근(getter)부터 던져도 예외 없음', () => {
  resetNoticePopupMemory()
  const originals = {}
  for (const name of ['localStorage', 'sessionStorage']) {
    originals[name] = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('SecurityError') } })
  }
  try {
    const storages = { local: () => globalThis.localStorage, session: () => globalThis.sessionStorage }
    assert.equal(isNoticePopupDismissed(SHA, Date.now(), storages), false)
    assert.doesNotThrow(() => markNoticePopupClosed(SHA, storages))
    assert.doesNotThrow(() => markNoticePopupHiddenToday(SHA, Date.now(), storages))
    assert.equal(isNoticePopupDismissed(SHA, Date.now(), storages), true)
  } finally {
    for (const name of ['localStorage', 'sessionStorage']) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name])
      else delete globalThis[name]
    }
    resetNoticePopupMemory()
  }
})

const popupSource = read('src/components/notice/site-notice-popup.tsx')
const libSource = read('src/lib/site-notice-popup.ts')

test('저장소: 도우미는 storage 를 인자로 받고, 부품은 window 저장소를 모듈 머리·렌더 중에 꺼내지 않는다', () => {
  assert.doesNotMatch(libSource, /window\.(localStorage|sessionStorage)/)
  // 부품은 getter 함수로만 넘긴다(호출은 도우미의 try 안).
  assert.match(popupSource, /const sessionStorageGetter: StorageGetter = \(\) => window\.sessionStorage/)
  assert.match(popupSource, /const localStorageGetter: StorageGetter = \(\) => window\.localStorage/)
  const direct = popupSource.split('\n').filter((line) => /window\.(localStorage|sessionStorage)/.test(line))
  assert.equal(direct.length, 2)
})

test('쿼리 규칙: 경로가 바뀔 때만 판단하고 useSearchParams 를 쓰지 않으며 login·logout=success 면 이번에는 열지 않는다', () => {
  assert.doesNotMatch(popupSource, /useSearchParams/)
  assert.match(popupSource, /hasAuthCompleteQuery\(window\.location\.search\)/)
  assert.match(popupSource, /\}, \[pathname, popup\]\)/)
  // layout 이 다시 그려져(router.refresh) popup 객체만 새로 와도 같은 경로·같은 지문이면 다시 판단하지 않는다(검증 minor 반영)
  assert.match(popupSource, /const judgedKey = `\$\{pathname\}\\n\$\{popup\.contentSha256\}`\n {4}if \(judgedRef\.current === judgedKey\) return\n {4}judgedRef\.current = judgedKey/)
  assert.ok(popupSource.indexOf('judgedRef.current = judgedKey') < popupSource.indexOf('hasAuthCompleteQuery(window.location.search)'))
  assert.equal(hasAuthCompleteQuery('?login=success'), true)
  assert.equal(hasAuthCompleteQuery('?a=1&logout=success'), true)
  assert.equal(hasAuthCompleteQuery('?login=fail'), false)
})

test('열린 채 빼는 경로로 이동하면 내리고 닫은 것으로 치지 않는다', () => {
  const effect = popupSource.match(/useEffect\(\(\) => \{\n {4}if \(!popup\) return[\s\S]*?\}, \[pathname, popup\]\)/)[0]
  assert.match(effect, /if \(excluded\) \{ setOpen\(false\); return \}/)
  assert.doesNotMatch(effect, /markNoticePopup/)
})

// ── 4-3·7-2 좋은 기록(SQL 과 같은 예시 묶음) ──────────────────────────────────────────────────────
test('좋은 기록 판정: tests/fixtures/bundle15-notice-record-examples.json 전부', () => {
  const examples = JSON.parse(read('tests/fixtures/bundle15-notice-record-examples.json'))
  assert.ok(examples.cases.length >= 10)
  for (const example of examples.cases) {
    const after = { ...examples.base, ...example.patch }
    assert.equal(isNoticeRecordGood(after, examples.upcoming, examples.savedAt), example.good, example.name)
    assert.equal(getNoticeRecordProblems(after, examples.upcoming, examples.savedAt).length === 0, example.good, example.name)
  }
})

test('좋은 기록 판정: 링크는 글자까지 같아야 하고, 깨는 조건 다섯 가지를 따로 알린다', () => {
  assert.equal(POLICY_UPCOMING_PATH, '/terms/upcoming')
  const upcoming = { effectiveDate: '2027-01-11', effectiveDateLabel: '2027년 1월 11일' }
  const problems = getNoticeRecordProblems({
    enabled: false, body: '본문', linkUrl: '/terms/upcoming/', startsAt: '2026-12-09T00:00:00+09:00', endsAt: '2027-01-10T00:00:00+09:00',
  }, upcoming, '2026-12-08T00:00:00+09:00')
  assert.deepEqual(problems, ['disabled', 'ends_before_effective', 'starts_later', 'link_not_upcoming', 'body_missing_date'])
})

// ── 4-2 입력 검사(DB 와 같은 예시 묶음) ─────────────────────────────────────────────────────────
test('입력 검사: tests/fixtures/bundle15-notice-input-examples.json 전부', () => {
  const examples = JSON.parse(read('tests/fixtures/bundle15-notice-input-examples.json'))
  const now = Date.parse(examples.now)
  for (const example of examples.cases) {
    const input = { ...examples.base, ...example.patch }
    if (example.repeatTitle) input.title = '가'.repeat(example.repeatTitle)
    if (example.repeatBody) input.body = '가'.repeat(example.repeatBody)
    assert.equal(validateNoticePopupInput(input, now) === null, example.ok, example.name)
  }
})

test('관리자 카드 시각: datetime-local 은 한국 시각으로 읽고 +09:00 으로 보낸다', () => {
  assert.equal(kstLocalInputToIso('2027-01-12T00:00'), '2027-01-12T00:00:00+09:00')
  assert.equal(kstLocalInputToIso(''), null)
  assert.equal(isoToKstLocalInput('2027-01-11T15:00:00Z'), '2027-01-12T00:00')
  assert.equal(isoToKstLocalInput(null), '')
})

// ── 5-4 팝업 판 ────────────────────────────────────────────────────────────────────────────────
test('팝업 판: 공용 판·높이 제한·움직임 줄이기 클래스, 직계 자식 3개, 날 DialogContent 없음', () => {
  assert.doesNotMatch(popupSource, /<DialogContent\b/)
  const panel = popupSource.match(/<StudioDialogPanel\n([\s\S]*?)\n {6}>\n([\s\S]*?)\n {6}<\/StudioDialogPanel>/)
  assert.ok(panel, 'StudioDialogPanel')
  const [, attributes, children] = panel
  assert.match(attributes, /showCloseButton=\{false\}/)
  for (const token of ['sm:max-w-lg', 'max-h-[calc(100dvh-2rem)]', 'grid-rows-[auto_minmax(0,1fr)_auto]',
    'motion-reduce:data-[state=open]:animate-none', 'motion-reduce:data-[state=closed]:animate-none']) {
    assert.ok(attributes.includes(token), token)
  }
  assert.match(attributes, /onOpenAutoFocus=/)
  const topLevel = children.split('\n').filter((line) => /^ {8}<[A-Za-z]/.test(line)).map((line) => line.trim().split(/[\s>]/)[0])
  assert.deepEqual(topLevel, ['<StudioDialogHeader', '<div', '<StudioDialogFooter'])
  // 개발 미리보기 표시는 머리 안(제목 위)
  const header = children.match(/<StudioDialogHeader>([\s\S]*?)<\/StudioDialogHeader>/)[1]
  assert.ok(header.indexOf('개발 미리보기') >= 0 && header.indexOf('개발 미리보기') < header.indexOf('<StudioDialogTitle'))
  // 가운데 칸: relative min-h-0 감싸는 칸 → 스크롤 칸(h-full overflow-y-auto, tabIndex 0) + 그림자(aria-hidden)
  assert.match(children, /<div className="relative min-h-0">\n {10}<div\n {12}ref=\{scrollRef\}\n {12}tabIndex=\{0\}/)
  assert.match(children, /className="h-full overflow-y-auto/)
  assert.match(children, /aria-hidden="true"\n {14}className="pointer-events-none absolute inset-x-0 bottom-0/)
  // 버튼 순서: 오늘 하루 보지 않기(brandOutline) → 닫기(brand)
  const footer = children.match(/<StudioDialogFooter>([\s\S]*?)<\/StudioDialogFooter>/)[1]
  assert.ok(footer.indexOf('variant="brandOutline"') < footer.indexOf('오늘 하루 보지 않기'))
  assert.ok(footer.indexOf('오늘 하루 보지 않기') < footer.indexOf('variant="brand"'))
  assert.ok(footer.indexOf('variant="brand"') < footer.indexOf('닫기'))
  // 링크를 누르면 닫기로 친다
  assert.match(popupSource, /onLinkClick=\{close\}/)
})

// ── 5-1 붙일 곳 ────────────────────────────────────────────────────────────────────────────────
test('붙일 곳: 회원 화면 layout 과 약관 layout 두 곳에만 팝업이 있다', () => {
  for (const path of ['src/app/(solvook)/layout.tsx', 'src/app/terms/layout.tsx']) {
    const source = read(path)
    assert.match(source, /<SiteNoticePopup popup=\{noticePopup\} \/>/, path)
    assert.match(source, /getActiveSiteNoticePopup\(renderedAt\)/, path)
    assert.match(source, /eslint-disable-next-line react-hooks\/purity -- 서버 컴포넌트다/, path)
  }
  for (const path of ['src/app/(admin)/admin/layout.tsx', 'src/app/template.tsx', 'src/app/(auth)/layout.tsx']) {
    assert.doesNotMatch(read(path), /SiteNoticePopup/, path)
  }
})

// ── 6-2 한 줄 안내·하단 링크 ──────────────────────────────────────────────────────────────────
test('한 줄 안내 붙일 곳: 약관 화면·목록·가입·동의·충전·결제·장바구니, 동의 문구 키는 바꾸지 않는다', () => {
  assert.match(read('src/app/terms/[documentSlug]/page.tsx'), /<UpcomingPolicyNotice documentSlug=\{document\.slug\} showAppliedHistory/)
  const termsList = read('src/app/terms/page.tsx')
  assert.ok(termsList.indexOf('<UpcomingPolicyNotice variant="card" showAppliedHistory />') < termsList.indexOf('policyLinks.map'))
  assert.match(read('src/app/(auth)/signup/page.tsx'), /upcomingNotice=\{<UpcomingPolicyNotice \/>\}/)
  assert.match(read('src/app/(auth)/consent/page.tsx'), /upcomingNotice=\{<UpcomingPolicyNotice \/>\}/)
  assert.match(read('src/app/checkout/page.tsx'), /upcomingNotice=\{<UpcomingPolicyNotice \/>\}/)
  assert.match(read('src/app/(solvook)/cart/page.tsx'), /upcomingNotice=\{<UpcomingPolicyNotice \/>\}/)
  assert.match(read('src/app/pricing/page.tsx'), /<UpcomingPolicyNotice className="mb-6" \/>/)
  // 가입·동의: 동의 목록 위(/consent 는 동의를 마친 계정이 넘어가므로 화면 시험 대신 이 시험으로 본다)
  const consentClient = read('src/app/(auth)/consent/consent-client.tsx')
  assert.ok(consentClient.indexOf('{upcomingNotice}') >= 0 && consentClient.indexOf('{upcomingNotice}') < consentClient.indexOf('<ConsentChecklist'))
  const signupClient = read('src/app/(auth)/signup/signup-client.tsx')
  const section = signupClient.match(/const consentSection = consentForm\.ok \? \(([\s\S]*?)\) : \(/)[1]
  assert.ok(section.indexOf('{upcomingNotice}') < section.indexOf('<ConsentChecklist'))
  // 결제 칸 위
  const checkoutClient = read('src/app/checkout/checkout-client.tsx')
  assert.ok(checkoutClient.indexOf('{upcomingNotice ?') < checkoutClient.indexOf('paymentMethods.length === 0 ?'))
  // 구매 고지·충전 확인 문구는 건드리지 않는다
  assert.doesNotMatch(read('src/components/legal/upcoming-policy-notice.tsx'), /purchaseNotice|checkoutNotice|point_charge_policy|market_purchase_policy/)
})

test('한 줄 안내: upcoming 이면 bannerText·bannerLinkLabel, applied 이면 이력 링크(약관 화면·목록만), 글은 모두 DB 값', () => {
  const source = read('src/components/legal/upcoming-policy-notice.tsx')
  assert.match(source, /const summary = await getUpcomingPolicySummary\(\)\n {2}if \(!summary\) return null/)
  assert.match(source, /summary\.status === 'upcoming'/)
  assert.match(source, /summary\.status === 'applied' && showAppliedHistory && summary\.historyLinkLabel/)
  assert.match(source, /text = summary\.bannerText/)
  assert.match(source, /linkLabel = summary\.bannerLinkLabel/)
  assert.match(source, /aria-hidden="true"/)
})

test('읽기 실패: 변경 예정 글 가벼운 읽기는 던지지 않고 null, 하단 데이터는 값을 돌려주고 링크만 뺀다', () => {
  const server = read('src/lib/site-notice-popup-server.ts')
  const summary = server.match(/export async function getUpcomingPolicySummary\(\)[\s\S]*?\n\}\n/)[0]
  assert.match(summary, /try \{[\s\S]*\} catch \(error\) \{[\s\S]*return null/)
  // 가벼운 읽기는 상태·라벨 칸만 캐시에 남긴다
  assert.match(server, /return parsePolicyUpcomingSummary\(result\.value\)/)
  const parse = libSource.match(/export function parsePolicyUpcomingSummary[\s\S]*?\n\}\n/)[0]
  assert.doesNotMatch(parse, /content|changes|consentItems/)
  const footer = read('src/lib/solvook-footer-data.ts')
  assert.match(footer, /getUpcomingPolicySummary\(\)/)
  assert.match(footer, /if \(upcoming\?\.status === 'upcoming' && upcoming\.footerLinkLabel\) \{\n {4}policyLinks\.push\(\{ key: 'policyUpcoming', label: upcoming\.footerLinkLabel, href: POLICY_UPCOMING_PATH \}\)/)
})

test('캐시: 팝업·변경 예정 글 읽기는 60초 캐시와 태그, 팝업 저장은 태그를 바로 만료한다', () => {
  const server = read('src/lib/site-notice-popup-server.ts')
  assert.match(server, /\{ revalidate: 60, tags: \[SITE_NOTICE_POPUP_CACHE_TAG\] \}/)
  assert.match(server, /\{ revalidate: 60, tags: \[POLICY_UPCOMING_DOCUMENTS_CACHE_TAG\] \}/)
  assert.match(libSource, /export const SITE_NOTICE_POPUP_CACHE_TAG = 'site_notice_popup'/)
})

// ── 6-1 /terms/upcoming ───────────────────────────────────────────────────────────────────────
test('/terms/upcoming: 행이 없으면 404, 지문 다시 계산, 재동의 화면과 같은 그리기, 상태별 글은 DB 값', () => {
  const page = read('src/app/terms/upcoming/page.tsx')
  assert.match(page, /import \{ ConsentTextLine \} from '@\/components\/auth\/consent-checklist'/)
  assert.match(page, /splitConsentLines\(item\.content\)/)
  assert.match(page, /if \(!upcoming\) \{\n {4}notFound\(\)/)
  assert.match(page, /sha256Hex\(document\.content\) === document\.sha256/)
  assert.match(page, /labels\.checking/)
  assert.match(page, /upcoming\.appliedAt \? upcoming\.statusTexts\.revertedAfterApply : upcoming\.statusTexts\.withdrawn/)
  assert.match(page, /upcoming\.statusTexts\.applied/)
  assert.match(page, /applied \? labels\.currentLinkApplied : labels\.currentLinkUpcoming/)
  assert.match(page, /labels\.beforeFull/)
  assert.match(page, /labels\.before\}/)
  assert.match(page, /labels\.after\}/)
  // 고정 경로라 [documentSlug] 보다 먼저 잡힌다
  assert.ok(existsSync(new URL('../src/app/terms/upcoming/page.tsx', import.meta.url)))
})

// ── 7절 관리자 ───────────────────────────────────────────────────────────────────────────────
test('관리자: 카드는 대표일 때만, 액션은 owner 가드·태그 바로 만료, 판정 함수는 인자 없이, 날짜 상수 없음', () => {
  const page = read('src/app/(admin)/admin/footer/page.tsx')
  assert.match(page, /access\.role === 'owner' \? getNoticePopupAdminData\(\) : Promise\.resolve\(null\)/)
  assert.match(page, /\{noticePopupData \? <NoticePopupAdmin data=\{noticePopupData\} \/> : null\}/)
  const actions = read('src/app/(admin)/admin/footer/notice-popup-actions.ts')
  assert.match(actions, /^'use server'/)
  assert.equal(actions.match(/await assertAdminActionPermission\('owner'\)/g).length, 2)
  assert.match(actions, /revalidateTag\(SITE_NOTICE_POPUP_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.match(actions, /revalidatePath\('\/admin\/footer'\)/)
  const server = read('src/lib/site-notice-popup-server.ts')
  assert.match(server, /db\.rpc\('policy_upcoming_notice_continuity'\)/)
  const card = read('src/app/(admin)/admin/footer/notice-popup-admin.tsx')
  for (const source of [card, actions]) {
    assert.doesNotMatch(source, /2026-12-10|2027-01-11|2027-01-12|2027년/)
  }
})

test('관리자: 7-2 경고 다섯 가지는 하나의 판정(getNoticeRecordProblems)으로, 게시 행이 upcoming 일 때만', () => {
  const card = read('src/app/(admin)/admin/footer/notice-popup-admin.tsx')
  assert.match(card, /upcoming\?\.status === 'upcoming'\n {6}\? getNoticeRecordProblems\(input/)
  for (const key of ['disabled', 'ends_before_effective', 'starts_later', 'link_not_upcoming', 'body_missing_date']) {
    assert.match(card, new RegExp(`\\n {2}${key}: ['\`]`), key)
  }
  assert.match(card, /이렇게 저장하면 30일 고지가 끊긴 것으로 기록되어 시행일 스크립트가 멈춥니다\./)
  assert.match(card, /내용이 바뀌어 이미 닫은 회원에게도 다시 보입니다\./)
  assert.match(card, /지금부터 회원에게 보입니다\./)
  // 미리보기는 표시 전용 부품(저장소·DB 안 씀)
  assert.match(card, /<SiteNoticePopupDialog\n {8}open=\{previewOpen\}/)
  assert.doesNotMatch(card, /localStorage|sessionStorage/)
})

test('관리자 7-3: 약관 저장과 가입 동의 항목 저장·개정이 POLICY_UPCOMING_LOCKED 를 받아 같은 안내를 보이고, 고지 중이면 미리 안내', () => {
  assert.match(libSource, /export const POLICY_UPCOMING_LOCKED_MESSAGE =\n {2}'변경 예정 약관을 고지하는 중이라 시행일까지 약관 문서\(본문·이름·주소·켜기\)를 바꿀 수 없습니다\. 고쳐야 하면 고지를 다시 해야 합니다\(런북\)\.'/)
  const footerActions = read('src/app/(admin)/admin/footer/actions.ts')
  assert.match(footerActions, /isPolicyUpcomingLockedMessage\(error\.message\)\) \{\n {6}return \{ success: false, error: POLICY_UPCOMING_LOCKED_MESSAGE \}/)
  const consentServer = read('src/lib/signup-consent-server.ts')
  assert.match(consentServer, /if \(isPolicyUpcomingLockedMessage\(message\)\) return POLICY_UPCOMING_LOCKED_CODE/)
  assert.equal(consentServer.match(/code: consentSaveErrorCode\(error\.message\)/g).length, 2)
  assert.match(read('src/app/(admin)/admin/footer/consent-actions.ts'), /\[POLICY_UPCOMING_LOCKED_CODE\]: POLICY_UPCOMING_LOCKED_MESSAGE/)
  const page = read('src/app/(admin)/admin/footer/page.tsx')
  assert.match(page, /upcoming\.ok && upcoming\.value\?\.status === 'upcoming' \? POLICY_UPCOMING_LOCKED_MESSAGE : null/)
  assert.match(page, /policyLockNotice=\{policyLockNotice\}/)
  assert.match(page, /<SignupConsentAdmin data=\{consentData\} lockNotice=\{policyLockNotice\} \/>/)
})

// ── 10-1 미리보기 ──────────────────────────────────────────────────────────────────────────────
test('미리보기: 조건 셋(개발·Vercel 아님·환경값), allowDevelopmentBuild 없음, 회원 화면·관리자 읽기 모두 미리보기 파일', () => {
  const server = read('src/lib/site-notice-popup-server.ts')
  assert.match(server, /return process\.env\.NODE_ENV === 'development'\n {4}&& !process\.env\.VERCEL\n {4}&& process\.env\.NOTICE_POPUP_PREVIEW === '1'/)
  assert.match(server, /process\.env\.NOTICE_POPUP_PREVIEW_UPCOMING_FILE/)
  assert.doesNotMatch(read('next.config.ts'), /allowDevelopmentBuild/)
  // 가벼운 읽기·전체 읽기·관리자 읽기 모두 운영 행이 없을 때 미리보기 파일을 쓴다
  assert.equal(server.match(/await readPreviewUpcomingFile\(\)/g).length, 3)
})

// ── 구현 검증 minor 반영 ────────────────────────────────────────────────────────────────────────
test('/terms/upcoming: 칸 이름(시행일·게시일·목차·목록 링크)도 게시 행 labels(DB 값), 변경 전·후는 전문과 같은 줄 규칙, 펼침 표시', () => {
  const page = read('src/app/terms/upcoming/page.tsx')
  for (const key of ['effectiveDate', 'publishedAt', 'toc', 'backToList']) {
    assert.ok(page.includes(`upcoming.labels.${key}`), key)
    assert.ok(libSource.includes(`${key}: str(labels.${key})`), key)
  }
  for (const word of ['>시행일<', '>게시일<', 'aria-label="목차"', '약관 및 정책 목록']) assert.ok(!page.includes(word), word)
  assert.match(page, /<PolicyDocumentContent content=\{change\.before\} \/>/)
  assert.match(page, /<PolicyDocumentContent content=\{change\.after\} \/>/)
  assert.equal((page.match(/<ChevronDown aria-hidden="true"/g) ?? []).length, 2)
  assert.match(page, /scroll-mt-36/)
  assert.doesNotMatch(page, /scroll-mt-24/)
})

test('관리자 미리보기: 링크를 눌러도 이동하지 않고(입력 보존), 틀린 칸별 안내·상태 화면 글', () => {
  const admin = read('src/app/(admin)/admin/footer/notice-popup-admin.tsx')
  assert.match(admin, /onLinkClick=\{\(event\) => \{\n {10}event\.preventDefault\(\)/)
  assert.match(admin, /toast\.error\(INPUT_PROBLEM_LABELS\[invalidField\]/)
  for (const field of ['title', 'body', 'linkUrl', 'linkLabel', 'date', 'endsAt']) assert.match(admin, new RegExp(`\\n  ${field}: '`), field)
  assert.match(admin, /UPCOMING_STATUS_LABELS\[upcoming\.status\]/)
})
