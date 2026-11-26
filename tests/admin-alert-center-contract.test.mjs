import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const summaryRoute = read('src/app/api/admin/alerts/summary/route.ts')
const server = read('src/lib/admin-alerts-server.ts')
const provider = read('src/components/admin/admin-alert-context.tsx')
const center = read('src/components/admin/admin-alert-center.tsx')
const badge = read('src/components/admin/admin-menu-badge.tsx')
const dashboard = read('src/app/(admin)/admin/dashboard-client.tsx')
const sidebar = read('src/components/layout/admin-sidebar-client.tsx')
const layout = read('src/app/(admin)/admin/layout.tsx')
const supportClient = read('src/app/(admin)/admin/support/support-client.tsx')
const refundsClient = read('src/app/(admin)/admin/refunds/refunds-client.tsx')
const paymentReviewClient = read('src/app/(admin)/admin/refunds/payment-review-client.tsx')
const marketRefundsClient = read('src/app/(admin)/admin/refunds/market-refunds-client.tsx')
const alerts = load('src/lib/admin-alerts.ts')

const NOW = Date.parse('2026-11-16T03:00:00Z')
const secondsAgo = (seconds) => new Date(NOW - seconds * 1000).toISOString()
const event = (overrides = {}) => ({
  id: 'e1', kind: 'support_ticket_created', severity: 'info', title: '새 문의', body: null,
  link: '/admin/support', delivery: 'full', created_at: secondsAgo(1), ...overrides,
})

test('알림 요약 API는 관리자 확인이 데이터 접근보다 먼저다', () => {
  assert.match(summaryRoute, /export const dynamic = 'force-dynamic'/)
  // 공통 화면이라 관리자면 통과한다. 401·403은 공용 가드가 정한다.
  assert.match(summaryRoute, /const guard = await requireAdminApiPermission\('admin'\)\s*if \('error' in guard\) \{\s*return NextResponse\.json\(\{ error: guard\.error \}, \{ status: guard\.status \}\)/)
  const adminCheck = summaryRoute.indexOf("requireAdminApiPermission('admin')")
  assert.ok(adminCheck > 0 && adminCheck < summaryRoute.lastIndexOf('getAdminAlertSummary('))
})

test('"확인함" 기록은 쓰지 않는다: 종의 숫자는 처리해야만 줄어든다', () => {
  // 확인 기록 API·함수·미확인 건수는 걷어 냈다(표 admin_event_reads와 타입은 DB에 그대로 있다).
  assert.equal(existsSync(new URL('../src/app/api/admin/alerts/seen/route.ts', import.meta.url)), false)
  for (const source of [server, provider, center, badge]) {
    assert.doesNotMatch(source, /admin_event_reads|markSeen|markAdminAlertsSeen|unreadCount|alerts\/seen/)
  }
  // 종의 숫자 = 처리 대기 합계. 패널을 여닫는 것은 아무것도 기록·변경하지 않는다.
  assert.match(center, /const pendingCount = alerts\.loadFailed \? null : summary \? workTotal\(summary\.work\) : 0/)
  assert.match(center, /<Popover open=\{open\} onOpenChange=\{setOpen\}>/)
  assert.match(center, /\{pendingCount !== 0 \? \(/)
  assert.match(center, /pendingCount === null \? '!' : pendingCount > 99 \? '99\+' : pendingCount/)
  assert.match(center, /`처리 대기 \$\{pendingCount\}건`/)
  assert.match(center, /처리 대기 건수 확인 불가/)
  assert.doesNotMatch(center, /미확인/)
  // 패널 안에서는 처리 대기가 알림 목록보다 위다.
  assert.ok(center.indexOf('ADMIN_WORK_ITEMS.map(') < center.indexOf('summary.events.map('))
})

test('처리 대기 합계: 전부 숫자면 합, 하나라도 세지 못하면 null, 0이면 배지 없음', () => {
  const work = {
    supportPending: 1, marketRefundPending: 1, refundPending: 1, refundAttention: 1, paymentOrderReview: 0, paymentAlertOpen: 1,
  }
  assert.equal(alerts.workTotal(work), 5)
  // 5건 중 1건을 처리하면 4
  assert.equal(alerts.workTotal({ ...work, supportPending: 0 }), 4)
  assert.equal(alerts.workTotal({ ...work, paymentAlertOpen: null }), null)
  assert.equal(alerts.workTotal(null), null)
  const none = Object.fromEntries(Object.keys(work).map((key) => [key, 0]))
  assert.equal(alerts.workTotal(none), 0)
  // 합계는 처리 대기 항목 전부를 더한다(항목이 늘면 같이 늘어난다).
  assert.equal(alerts.workTotal(Object.fromEntries(alerts.ADMIN_WORK_ITEMS.map((item) => [item.key, 2]))), alerts.ADMIN_WORK_ITEMS.length * 2)
})

test('처리한 뒤에는 새로고침 없이 숫자가 맞는다: 처리 성공 경로마다 요약을 다시 읽는다', () => {
  // (가) 서버 레이아웃이 다시 그려질 때마다(router.refresh·재검증) provider가 다시 조회한다.
  assert.match(layout, /const renderedAt = Date\.now\(\)/)
  assert.match(layout, /<AdminAlertProvider adminId=\{admin\.id\} renderedAt=\{renderedAt\}>/)
  assert.match(provider, /useEffect\(\(\) => \{\s*void refresh\(\)\s*\}, \[refresh, renderedAt\]\)/)
  assert.match(provider, /refresh: refreshNow/)

  // (나) 처리 동작의 성공 경로가 직접 다시 읽게 한다.
  const successPaths = [
    [supportClient, "toast.success('답변이 등록되었습니다.')", 'alerts?.refresh()'],
    [refundsClient, 'setIsProcessDialogOpen(false)\n            router.refresh()', 'alerts?.refresh()'],
    [paymentReviewClient, 'setSelectedAlert(null)\n            router.refresh()', 'adminAlerts?.refresh()'],
    [paymentReviewClient, 'setSelectedOrder(null)\n            router.refresh()', 'adminAlerts?.refresh()'],
    [marketRefundsClient, 'setPending(null)\n      router.refresh()', 'alerts?.refresh()'],
  ]
  for (const [source, success, call] of successPaths) {
    const at = source.indexOf(success)
    assert.ok(at > 0, success)
    const after = source.slice(at + success.length, at + success.length + 160)
    assert.ok(after.includes(call), success)
    // 실패 경로(catch)보다 앞이다.
    assert.ok(after.indexOf(call) < (after.includes('catch') ? after.indexOf('catch') : Infinity), success)
  }
  // 환불 화면들은 처리 뒤 router.refresh()도 부른다(목록 갱신). 그 횟수만큼 요약 갱신이 붙어 있다.
  for (const source of [refundsClient, paymentReviewClient, marketRefundsClient]) {
    assert.equal([...source.matchAll(/router\.refresh\(\)/g)].length, [...source.matchAll(/[aA]lerts\?\.refresh\(\)/g)].length)
  }

  // 대시보드의 처리 대기 칩은 종·배지와 같은 값을 쓴다.
  // 21번: 첫 화면은 서버가 그리고(초기 work), 통계 route 는 기간을 바꿀 때만 부른다. [새로고침]은 숫자와 요약을 함께 다시 읽는다.
  assert.match(dashboard, /alerts\?\.loadFailed \? null : alerts\?\.summary\?\.work \?\? workFallback/)
  assert.match(dashboard, /const value = work \? work\[item\.key\] \?\? null : null/)
  assert.match(dashboard, /fetch\(`\/api\/admin\/stats\?/)
  assert.match(dashboard, /void loadDashboard\(period\.query, true\)\s*alerts\?\.refresh\(\)/)
})

test('요약: service role 전용 표는 세션 클라이언트로 읽지 않고, 읽지 못한 부분은 null·unknown이다', () => {
  for (const table of ['admin_event_dispatch_state', 'admin_event_deliveries']) {
    const uses = [...server.matchAll(new RegExp(`(\\w+\\(?\\)?)\\s*\\.from\\('${table}'\\)`, 'g'))]
    assert.ok(uses.length > 0, table)
    for (const use of uses) assert.equal(use[1], 'createAdminClient()', table)
  }
  // 이벤트 목록·미확인 건수는 관리자 세션으로 읽어 조회 정책을 따른다.
  assert.match(server, /supabase\s*\.from\('admin_events'\)/)
  assert.doesNotMatch(server, /createAdminClient\(\)\s*\.from\('admin_events'\)/)
  // 처리 대기 건수는 그 계정의 권한에 맞는 항목만 센다.
  assert.match(server, /getAdminWorkSummary\(access\)/)
  assert.match(read('src/app/api/admin/alerts/summary/route.ts'), /getAdminAlertSummary\(guard\.access\)/)
  // 폴링되는 조회라 건수는 head 조회, 목록은 최근 것만
  assert.match(server, /\.limit\(ADMIN_ALERT_RECENT_LIMIT\)/)
  assert.equal([...server.matchAll(/count: 'exact', head: true/g)].length, 1)
  // 실패한 부분은 0이 아닌 값으로 내려간다.
  assert.match(server, /catch \(error\) \{[\s\S]*?return fallback/)
  assert.match(server, /readOr<AdminAlertEvent\[\] \| null>\('최근 알림', null/)
  // 화면이 쓰지 않는 값은 내려보내지 않는다.
  assert.doesNotMatch(server, /lastSeenAt[,:]|lastRunAt/)
  assert.match(server, /readOr<number \| null>\('전송 포기 건수', null/)
  assert.match(server, /'전송 작업 상태',\s*null/)
  assert.doesNotMatch(server, /\?\? 0/)
  assert.doesNotMatch(server, /email/)
})

test('전송 상태 판정: 미설정 → 멈춤 → 설정 오류 → 정상, 읽지 못하면 unknown', () => {
  const derive = (state) => alerts.deriveDispatchStatus(state, NOW)
  assert.equal(derive(null), 'unknown')
  assert.equal(derive({ last_run_at: secondsAgo(5), last_run_error: null }), 'ok')
  assert.equal(derive({ last_run_at: secondsAgo(5), last_run_error: 'WEBHOOK_NOT_CONFIGURED' }), 'not_configured')
  assert.equal(derive({ last_run_at: secondsAgo(5), last_run_error: 'HEARTBEAT_FAILED' }), 'config_error')
  assert.equal(derive({ last_run_at: null, last_run_error: null }), 'stalled')
  assert.equal(derive({ last_run_at: secondsAgo(119), last_run_error: null }), 'ok')
  assert.equal(derive({ last_run_at: secondsAgo(121), last_run_error: null }), 'stalled')
  assert.equal(derive({ last_run_at: secondsAgo(600), last_run_error: 'HEARTBEAT_FAILED' }), 'stalled')
})

test('전송 상태 줄: 정상이면 없음, 실패 건수와 확인 불가를 드러낸다', () => {
  const messages = (status, gaveUpCount) => alerts.dispatchStatusMessages({ status, gaveUpCount })
  assert.deepEqual(messages('ok', 0), [])
  assert.deepEqual(messages('not_configured', 0), ['슬랙 알림 미설정'])
  assert.deepEqual(messages('config_error', 0), ['통지 설정 오류'])
  assert.deepEqual(messages('stalled', 3), ['통지 작업 멈춤', '통지 실패 3건'])
  assert.deepEqual(messages('ok', 2), ['통지 실패 2건'])
  assert.deepEqual(messages('unknown', null), ['통지 상태 확인 불가', '통지 실패 건수 확인 불가'])
})

test('폴링 토스트: 목록에 처음 보이는 이벤트 수로 알리고, 목록을 모르면 알리지 않는다', () => {
  const ids = (...list) => list.map((id) => ({ id }))
  assert.equal(alerts.countNewEvents(ids('a', 'b'), ids('c', 'a', 'b')), 1)
  assert.equal(alerts.countNewEvents(ids('a', 'b'), ids('d', 'c', 'a')), 2)
  assert.equal(alerts.countNewEvents(ids('a', 'b'), ids('a', 'b')), 0)
  assert.equal(alerts.countNewEvents([], ids('a')), 1)
  // 첫 조회(이전 목록 없음)·조회 실패한 목록으로는 알리지 않는다.
  assert.equal(alerts.countNewEvents(undefined, ids('a')), 0)
  assert.equal(alerts.countNewEvents(null, ids('a')), 0)
  assert.equal(alerts.countNewEvents(ids('a'), null), 0)
})

test('토스트 묶음: 1건은 그대로, 여러 건은 "새 알림 N건"과 첫 제목', () => {
  assert.deepEqual(alerts.summarizeToastBatch([event({ body: '요청 100크레딧' })]), {
    title: '새 문의', description: '요청 100크레딧', link: '/admin/support',
  })
  assert.equal(alerts.summarizeToastBatch([event()]).description, undefined)
  assert.deepEqual(
    alerts.summarizeToastBatch([event({ title: '충전 환불 요청', link: '/admin/refunds' }), event({ id: 'e2' }), event({ id: 'e3' })]),
    { title: '새 알림 3건', description: '충전 환불 요청', link: '/admin/refunds' }
  )
  assert.equal(alerts.ADMIN_ALERT_TOAST_BATCH_MS, 5000)
  assert.equal(alerts.ADMIN_ALERT_POLL_MS, 30000)
  assert.equal(alerts.isLoudAlertEvent({ delivery: 'full' }), true)
  assert.equal(alerts.isLoudAlertEvent({ delivery: 'screen' }), false)
})

test('메뉴 배지: 메뉴 주소로 맞추고, 하나라도 세지 못하면 숫자 대신 확인 불가', () => {
  const work = {
    supportPending: 2, marketRefundPending: 1, refundPending: 0, refundAttention: 3, paymentOrderReview: 0, paymentAlertOpen: 4,
  }
  assert.equal(alerts.menuBadgeCount('/admin/support', work), 2)
  assert.equal(alerts.menuBadgeCount('/admin/refunds', work), 8)
  assert.equal(alerts.menuBadgeCount('/admin/refunds', { ...work, refundAttention: null }), null)
  assert.equal(alerts.menuBadgeCount('/admin/support', { ...work, refundAttention: null }), 2)
  assert.equal(alerts.menuBadgeCount('/admin/support', { ...work, supportPending: null }), null)
  assert.equal(alerts.menuBadgeCount('/admin/users', work), undefined)
  // 요약 조회 자체가 실패하면 배지가 붙는 메뉴는 모두 확인 불가
  assert.equal(alerts.menuBadgeCount('/admin/support', null), null)
  assert.equal(alerts.menuBadgeCount('/admin/refunds', null), null)
  assert.equal(alerts.menuBadgeCount('/admin/users', null), undefined)
  // 배지가 붙는 메뉴는 처리 대기 항목의 주소에서 나온다.
  assert.deepEqual([...new Set(alerts.ADMIN_WORK_ITEMS.map((item) => item.href))].sort(), ['/admin/refunds', '/admin/support'])

  assert.match(badge, /const work = alerts\?\.loadFailed \? null : alerts\?\.summary\?\.work/)
  assert.match(badge, /work === undefined \? undefined : menuBadgeCount\(href, work\)/)
  assert.match(badge, /count === undefined \|\| count === 0\) return null/)
  assert.match(badge, /확인 불가/)
  assert.match(sidebar, /<AdminMenuBadge href=\{item\.href\}/)
  assert.doesNotMatch(badge, /item\.id|menuId/)
})

test('대시보드와 알림 패널은 처리 대기 항목 목록 하나를 같이 쓴다(권한이 없어 빠진 항목은 그리지 않는다)', () => {
  for (const source of [dashboard, center]) {
    assert.match(source, /import \{[^}]*visibleWorkItems[^}]*\} from '@\/lib\/admin-alerts'/)
    assert.match(source, /visibleWorkItems\([^)]*\)\.map\(|workItems\.map\(/)
    assert.match(source, /value === null \? '확인 불가'/)
  }
  assert.doesNotMatch(dashboard, /const WORK_ITEMS/)
  assert.doesNotMatch(center, /\/admin\/(support|refunds)/)
})

test('조회·구독은 provider 한 곳에서만 하고, 종과 배지는 그 값을 쓴다', () => {
  assert.match(layout, /<AdminAlertProvider adminId=\{admin\.id\}/)
  assert.equal([...provider.matchAll(/\.channel\(/g)].length, 1)
  for (const source of [center, badge, sidebar]) {
    assert.doesNotMatch(source, /\.channel\(|alerts\/summary|createClient/)
  }
  assert.match(center, /useAdminAlerts\(\)/)
  assert.match(badge, /useAdminAlerts\(\)/)
})

test('실시간: 관리자 세션으로 admin_events INSERT를 구독하고, 끊기면 30초 폴링으로 내려간다', () => {
  assert.match(provider, /from '@\/lib\/supabase\/client'/)
  assert.match(provider, /'postgres_changes',\s*\{ event: 'INSERT', schema: 'public', table: 'admin_events' \}/)
  // 채널에 들어가기 전에 세션 토큰을 Realtime에 싣는다.
  assert.ok(provider.indexOf('supabase.realtime.setAuth()') > 0)
  assert.ok(provider.indexOf('supabase.realtime.setAuth()') < provider.indexOf('channel.subscribe('))
  assert.match(provider, /status === 'SUBSCRIBED'\) \{\s*setRealtimeDown\(false\)/)
  assert.match(provider, /\} else \{[\s\S]*?setRealtimeDown\(true\)/)
  // 폴링은 항상 돌고 주기만 바뀐다(연결돼 보여도 이벤트가 안 오는 경우의 복구).
  assert.match(provider, /setInterval\(\(\) => void refresh\(true\), realtimeDown \? ADMIN_ALERT_POLL_MS : ADMIN_ALERT_SAFETY_POLL_MS\)/)
  assert.equal([...provider.matchAll(/setInterval\(/g)].length, 1)
  assert.doesNotMatch(provider, /if \(!realtimeDown\) return/)
  assert.equal(alerts.ADMIN_ALERT_SAFETY_POLL_MS, 300000)
  // 재연결 직후에는 끊긴 사이 온 알림도 알린다.
  assert.match(provider, /if \(wasDown\) void refresh\(true\)/)
  assert.match(provider, /fromPoll \? countNewEvents\(summaryRef\.current\?\.events, next\.events\) : 0/)
  assert.match(provider, /addEventListener\('visibilitychange'/)
  assert.match(center, /실시간 연결 끊김/)
})

test('정리: 채널·타이머·리스너를 모두 걷는다', () => {
  assert.match(provider, /supabase\.removeChannel\(channel\)/)
  assert.match(provider, /clearInterval\(timer\)/)
  assert.match(provider, /clearTimeout\(batchRef\.current\.timer\)/)
  assert.match(provider, /removeEventListener\('visibilitychange'/)
  assert.match(provider, /removeEventListener\('pointerdown', unlock\)/)
  assert.match(provider, /removeEventListener\('keydown', unlock\)/)
  assert.match(provider, /audioRef\.current\?\.close\(\)/)
  // 숨겨진 탭의 제목 표시는 탭이 보이거나 화면을 떠날 때 되돌린다.
  assert.match(provider, /document\.title = `\(\$\{hidden\.count\}\) \$\{hidden\.title\}`/)
  assert.equal([...provider.matchAll(/restoreTitle\(\)/g)].length, 2)
})

test('소리·브라우저 알림: 화면 전용 이벤트는 조용히, 소리는 켜짐일 때만, 권한은 버튼으로만 요청한다', () => {
  const loud = provider.slice(provider.indexOf('if (isLoudAlertEvent(event)) {'), provider.indexOf('if (document.hidden) {'))
  assert.match(loud, /soundOnRef\.current && [\s\S]*?playBeep\(\)/)
  assert.match(loud, /document\.hidden && typeof Notification !== 'undefined' && Notification\.permission === 'granted'/)
  assert.match(loud, /new Notification\(/)
  // 소리·브라우저 알림은 이 블록 밖에서 내지 않는다.
  const outside = provider.replace(loud, '')
  assert.doesNotMatch(outside, /playBeep\(\)|new Notification\(/)
  // 음원 파일 없이 Web Audio로, 첫 클릭·키 입력 뒤에만
  assert.match(provider, /new AudioContext\(\)/)
  assert.match(provider, /createOscillator\(\)/)
  assert.doesNotMatch(provider, /new Audio\(|\.mp3|\.wav/)
  assert.match(provider, /addEventListener\('pointerdown', unlock\)/)
  // 권한 요청은 패널 버튼의 onClick 하나뿐이다(Promise를 돌려주지 않는 브라우저도 견딘다).
  assert.doesNotMatch(provider, /requestPermission/)
  assert.equal([...center.matchAll(/requestPermission/g)].length, 1)
  assert.equal([...center.matchAll(/askNotificationPermission/g)].length, 2)
  assert.match(center, /onClick=\{askNotificationPermission\}/)
  assert.match(center, /Notification\.requestPermission\(setPermission\)\s*result\?\.then\(setPermission\)\.catch\(/)
  assert.match(provider, /audioRef\.current\.resume\(\)\.catch\(/)
  assert.match(center, /브라우저 알림 허용/)
  // 소리 설정은 관리자별로 저장하고, 저장소 접근 실패를 견딘다.
  assert.match(provider, /`admin-alert-sound:\$\{adminId\}`/)
  assert.equal([...provider.matchAll(/window\.localStorage\./g)].length, 2)
  assert.match(provider, /try \{\s*return window\.localStorage\.getItem/)
  assert.match(provider, /try \{\s*window\.localStorage\.setItem/)
  assert.match(center, /soundOn \? '소리 켜짐' : '소리 꺼짐'/)
})

test('종: 실제 버튼, 처리 대기 건수를 글자로 알리고, 패널은 화면 안에 들어온다', () => {
  assert.match(center, /<button\s+type="button"\s+aria-label=\{bellLabel\}/)
  assert.match(center, /<PopoverContent\s+align="start"\s+aria-label="알림"\s+collisionPadding=\{8\}/)
  // 화면보다 길면 패널 안에서 스크롤한다(맨 아래 버튼이 잘리지 않게).
  assert.match(center, /max-h-\[var\(--radix-popover-content-available-height\)\][^"]*max-w-\[calc\(100vw-1rem\)\][^"]*overflow-y-auto/)
  // 심각도는 색과 함께 글자로 표시한다.
  for (const label of ['긴급', '주의', '안내']) assert.match(center, new RegExp(`label: '${label}'`))
  assert.match(center, /timeZone: 'Asia\/Seoul'/)
  // 사이트 안 경로만 연다.
  assert.match(provider, /link\.startsWith\('\/'\) && !link\.startsWith\('\/\/'\) && !link\.includes\('\\\\'\)/)
  assert.doesNotMatch(center + provider + badge, /email/)
})

test('조회 실패는 0건처럼 보이지 않는다: 종·패널·메뉴 배지 모두 확인 불가로 바뀐다', () => {
  const refresh = provider.slice(provider.indexOf('const refresh = useCallback('), provider.indexOf('const playBeep'))
  assert.match(refresh, /if \(!response\.ok\) throw new Error/)
  assert.match(refresh, /setSummary\(next\)\s*setLoadFailed\(false\)/)
  assert.match(refresh, /catch \{[\s\S]*?if \(seq === requestSeqRef\.current\) setLoadFailed\(true\)/)
  // 늦게 온 옛 응답은 버린다.
  assert.match(refresh, /const seq = \+\+requestSeqRef\.current/)
  assert.match(refresh, /if \(seq !== requestSeqRef\.current\) return/)
  assert.ok(refresh.indexOf('if (seq !== requestSeqRef.current) return') < refresh.indexOf('setSummary(next)'))

  assert.match(center, /alerts\.loadFailed \? '알림 확인 불가' : '알림'/)
  assert.match(center, /alerts\.loadFailed \? '알림을 불러오지 못했습니다\.' : '불러오는 중…'/)
})

test('모바일 껍데기: 상단 바와 처음엔 닫힌 서랍, 데스크톱 사이드바는 그대로', () => {
  // 서랍 열림(모바일)과 접힘(데스크톱)은 서로 다른 상태다. 서랍은 닫힌 채 시작한다.
  assert.match(sidebar, /const \[mobileOpen, setMobileOpen\] = useState\(false\)/)
  assert.match(sidebar, /const \[collapsed, setCollapsed\] = useState\(false\)/)
  assert.doesNotMatch(sidebar, /window\.innerWidth/)
  // 상단 바는 모바일에만 있고, 메뉴 버튼은 서랍 상태를 알린다.
  assert.match(sidebar, /<header className="fixed inset-x-0 top-0 z-30 flex h-14 [^"]*md:hidden">/)
  assert.match(sidebar, /aria-label="메뉴 열기"\s+aria-expanded=\{mobileOpen\}\s+aria-controls="admin-sidebar"/)
  assert.match(sidebar, /<aside\s+id="admin-sidebar"/)
  // 닫힌 서랍은 보이지 않고 초점도 받지 않는다. 이 규칙은 모바일 폭에만 걸린다.
  assert.match(sidebar, /mobileOpen \? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full'/)
  assert.match(sidebar, /collapsed && 'md:w-16'/)
  // 메뉴 이동·바깥 누르기·Escape로 닫히고, 열려 있는 동안 뒤 화면 스크롤을 잠근다.
  assert.match(sidebar, /onClick=\{\(\) => setMobileOpen\(false\)\}/)
  assert.match(sidebar, /\{mobileOpen && \(\s*<div\s+className="fixed inset-0 z-30 bg-black\/50 md:hidden"/)
  const effect = sidebar.slice(sidebar.indexOf('if (!mobileOpen) return'), sidebar.indexOf('}, [mobileOpen])'))
  assert.match(effect, /event\.key === 'Escape'\) close\(\)/)
  assert.match(effect, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(effect, /document\.body\.style\.overflow = previousOverflow/)
  assert.match(effect, /removeEventListener\('keydown', handleKeyDown\)/)
  // 종은 모바일 상단 바와 데스크톱 사이드바 맨 위에 하나씩(한쪽만 보인다).
  assert.equal([...sidebar.matchAll(/<AdminAlertCenter /g)].length, 2)
  // 본문은 상단 바 아래에서 시작하고, 넓은 표가 페이지 전체를 옆으로 밀지 않는다(모바일 폭에서만).
  assert.match(layout, /max-md:min-w-0/)
  assert.match(layout, /className="p-6 max-md:px-4 max-md:pt-\[4\.5rem\] md:p-8"/)
})
