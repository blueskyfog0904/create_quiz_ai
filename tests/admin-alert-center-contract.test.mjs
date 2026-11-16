import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const summaryRoute = read('src/app/api/admin/alerts/summary/route.ts')
const seenRoute = read('src/app/api/admin/alerts/seen/route.ts')
const server = read('src/lib/admin-alerts-server.ts')
const provider = read('src/components/admin/admin-alert-context.tsx')
const center = read('src/components/admin/admin-alert-center.tsx')
const badge = read('src/components/admin/admin-menu-badge.tsx')
const dashboard = read('src/app/(admin)/admin/dashboard-client.tsx')
const sidebar = read('src/components/layout/admin-sidebar-client.tsx')
const layout = read('src/app/(admin)/admin/layout.tsx')
const alerts = load('src/lib/admin-alerts.ts')

const NOW = Date.parse('2026-11-16T03:00:00Z')
const secondsAgo = (seconds) => new Date(NOW - seconds * 1000).toISOString()
const event = (overrides = {}) => ({
  id: 'e1', kind: 'support_ticket_created', severity: 'info', title: '새 문의', body: null,
  link: '/admin/support', delivery: 'full', created_at: secondsAgo(1), ...overrides,
})

test('알림 API 두 개 모두 관리자 확인이 데이터 접근보다 먼저다', () => {
  for (const [route, call] of [[summaryRoute, 'getAdminAlertSummary('], [seenRoute, 'markAdminAlertsSeen(']]) {
    assert.match(route, /export const dynamic = 'force-dynamic'/)
    assert.match(route, /status: 401/)
    assert.match(route, /status: 403/)
    const adminCheck = route.indexOf('profile?.is_admin')
    assert.ok(adminCheck > 0 && adminCheck < route.lastIndexOf(call))
    // 확인한 관리자 본인의 id만 넘긴다(요청 값으로 대상을 바꿀 수 없다).
    assert.match(route, new RegExp(`${call.replace('(', '\\(')}user\\.id[,)]`))
  }
  // 확인 기록은 { eventId: uuid } 하나만 받는다. 형식이 틀리면 400, 볼 수 없는 이벤트면 404.
  assert.ok(seenRoute.indexOf('readEventId(request)') < seenRoute.lastIndexOf('markAdminAlertsSeen('))
  assert.match(seenRoute, /keys\.length !== 1 \|\| typeof eventId !== 'string' \|\| !UUID_PATTERN\.test\(eventId\)/)
  assert.match(seenRoute, /if \(!eventId\) \{\s*return NextResponse\.json\(\{ error: 'Invalid request' \}, \{ status: 400 \}\)/)
  assert.match(seenRoute, /result === 'not_found'[\s\S]*?status: 404/)
  const uuidPattern = new RegExp(/const UUID_PATTERN = \/(.+)\/i/.exec(seenRoute)[1], 'i')
  assert.ok(uuidPattern.test('00000000-0000-4000-8000-000000000001'))
  for (const bad of ['', 'abc', '00000000-0000-4000-8000-00000000000', "00000000-0000-4000-8000-000000000001' or 1=1"]) {
    assert.ok(!uuidPattern.test(bad), bad)
  }
})

test('확인 기록: 서버의 현재 시각이 아니라 화면에 보인 이벤트의 created_at까지만, 뒤로 돌리지 않는다', () => {
  const mark = server.slice(server.indexOf('export async function markAdminAlertsSeen('))
  assert.match(mark, /markAdminAlertsSeen\(adminId: string, eventId: string\)/)
  // 이벤트는 관리자 세션(조회 정책)으로 읽는다.
  assert.match(mark, /const supabase = await createClient\(\)[\s\S]*?supabase\s*\.from\('admin_events'\)\s*\.select\('created_at'\)\s*\.eq\('id', eventId\)/)
  assert.match(mark, /if \(!event\) return 'not_found'/)
  assert.match(mark, /if \(isLaterTimestamp\(event\.created_at, seen\?\.last_seen_at \?\? null\)\) \{/)
  assert.match(mark, /\.upsert\(\{ admin_id: adminId, last_seen_at: event\.created_at \}\)/)
  // DB가 준 문자열 그대로 쓴다(현재 시각·Date 재조립 없음).
  assert.doesNotMatch(mark, /new Date|Date\.now|toISOString/)

  // 패널은 보여 준 목록의 맨 위 이벤트 id만 보낸다. 목록이 없으면 보내지 않는다.
  assert.match(center, /const newestId = summary\?\.events\?\.\[0\]\?\.id\s*if \(newestId && summary\.unreadCount !== 0\) markSeen\(newestId\)/)
  assert.equal([...center.matchAll(/markSeen\(/g)].length, 1)
  assert.match(center, /const summary = alerts\.loadFailed \? null : alerts\.summary/)
  assert.match(provider, /body: JSON\.stringify\(\{ eventId \}\)/)
  // 성공 뒤에는 건수를 0으로 지어내지 않고 다시 조회한다.
  assert.match(provider, /if \(response\.ok\) void refresh\(\)/)
  assert.doesNotMatch(provider, /unreadCount: 0/)

  const later = alerts.isLaterTimestamp
  assert.equal(later('2026-11-16T03:00:00.123456+00:00', null), true)
  assert.equal(later('2026-11-16T03:00:00.123457+00:00', '2026-11-16T03:00:00.123456+00:00'), true)
  assert.equal(later('2026-11-16T03:00:00.123456+00:00', '2026-11-16T03:00:00.123456+00:00'), false)
  assert.equal(later('2026-11-16T03:00:00.123456+00:00', '2026-11-16T03:00:00.123457+00:00'), false)
  // 소수부 길이가 달라도(뒤 0 생략) 맞게 비교한다.
  assert.equal(later('2026-11-16T03:00:00.2+00:00', '2026-11-16T03:00:00.123456+00:00'), true)
  assert.equal(later('2026-11-16T03:00:00+00:00', '2026-11-16T03:00:00.000001+00:00'), false)
  assert.equal(later('2026-11-16T03:00:01+00:00', '2026-11-16T03:00:00.999999+00:00'), true)
  assert.equal(later('2026-11-16T12:00:00.5+09:00', '2026-11-16T03:00:00.4+00:00'), true)
})

test('요약: service role 전용 표는 세션 클라이언트로 읽지 않고, 읽지 못한 부분은 null·unknown이다', () => {
  for (const table of ['admin_event_reads', 'admin_event_dispatch_state', 'admin_event_deliveries']) {
    const uses = [...server.matchAll(new RegExp(`(\\w+\\(?\\)?)\\s*\\.from\\('${table}'\\)`, 'g'))]
    assert.ok(uses.length > 0, table)
    for (const use of uses) assert.equal(use[1], 'createAdminClient()', table)
  }
  // 이벤트 목록·미확인 건수는 관리자 세션으로 읽어 조회 정책을 따른다.
  assert.match(server, /supabase\s*\.from\('admin_events'\)/)
  assert.doesNotMatch(server, /createAdminClient\(\)\s*\.from\('admin_events'\)/)
  assert.match(server, /getAdminWorkSummary\(\)/)
  // 폴링되는 조회라 건수는 head 조회, 목록은 최근 것만
  assert.match(server, /\.limit\(ADMIN_ALERT_RECENT_LIMIT\)/)
  assert.equal([...server.matchAll(/count: 'exact', head: true/g)].length, 2)
  // 실패한 부분은 0이 아닌 값으로 내려간다.
  assert.match(server, /catch \(error\) \{[\s\S]*?return fallback/)
  assert.match(server, /readOr<AdminAlertEvent\[\] \| null>\('최근 알림', null/)
  assert.match(server, /readOr<number \| null>\(\s*'미확인 건수',\s*null/)
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

test('미확인 건수: 처음 보는 관리자는 최근 목록 크기까지만, 세지 못하면 null', () => {
  assert.equal(alerts.capUnreadCount(null, null), null)
  assert.equal(alerts.capUnreadCount(null, secondsAgo(60)), null)
  assert.equal(alerts.capUnreadCount(3, null), 3)
  assert.equal(alerts.capUnreadCount(500, null), alerts.ADMIN_ALERT_RECENT_LIMIT)
  assert.equal(alerts.capUnreadCount(500, secondsAgo(60)), 500)
  assert.equal(alerts.capUnreadCount(0, secondsAgo(60)), 0)

  assert.equal(alerts.unreadIncrease(2, 5), 3)
  assert.equal(alerts.unreadIncrease(5, 5), 0)
  assert.equal(alerts.unreadIncrease(5, 0), 0)
  assert.equal(alerts.unreadIncrease(null, 5), 0)
  assert.equal(alerts.unreadIncrease(5, null), 0)
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

test('대시보드와 알림 패널은 처리 대기 항목 목록 하나를 같이 쓴다', () => {
  for (const source of [dashboard, center]) {
    assert.match(source, /import \{[^}]*ADMIN_WORK_ITEMS[^}]*\} from '@\/lib\/admin-alerts'/)
    assert.match(source, /ADMIN_WORK_ITEMS\.map\(/)
    assert.match(source, /value === null \? '확인 불가'/)
  }
  assert.doesNotMatch(dashboard, /const WORK_ITEMS/)
  assert.doesNotMatch(center, /\/admin\/(support|refunds)/)
})

test('조회·구독은 provider 한 곳에서만 하고, 종과 배지는 그 값을 쓴다', () => {
  assert.match(layout, /<AdminAlertProvider adminId=\{admin\.id\}>/)
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
  assert.match(provider, /fromPoll \? unreadIncrease\(/)
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

test('종: 실제 버튼, 미확인 건수를 글자로 알리고, 열면 확인 기록을 남긴다', () => {
  assert.match(center, /<button\s+type="button"\s+aria-label=\{bellLabel\}/)
  assert.match(center, /`미확인 \$\{unreadCount\}건`/)
  assert.match(center, /미확인 건수 확인 불가/)
  // 닫기(Escape·바깥 클릭)와 초점 이동은 Popover가 맡는다.
  assert.match(center, /<Popover open=\{open\} onOpenChange=\{handleOpenChange\}>/)
  assert.match(center, /<PopoverContent align="start" aria-label="알림"/)
  assert.match(provider, /fetch\('\/api\/admin\/alerts\/seen', \{\s*method: 'POST'/)
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

  assert.match(center, /const unreadCount = alerts\.loadFailed \? null : summary \? summary\.unreadCount : 0/)
  assert.match(center, /alerts\.loadFailed \? '알림 확인 불가' : '알림'/)
  assert.match(center, /unreadCount === null \? '!'/)
  assert.match(center, /alerts\.loadFailed \? '알림을 불러오지 못했습니다\.' : '불러오는 중…'/)
})
