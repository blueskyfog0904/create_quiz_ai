import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { load } from './helpers/market-images-harness.mjs'

// 20번 관리자 공통 틀 0단계 계약(계획 docs/plan-bundle20-admin-common.md 9절).
const ROOT = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8')
const exists = (file) => existsSync(new URL(file, ROOT))
const isFile = (file) => exists(file) && statSync(new URL(file, ROOT)).isFile()

function walk(dir, files = []) {
  for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(child, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(child)
  }
  return files
}

const KIT_DIR = 'src/components/admin/kit'
const kitFiles = walk(KIT_DIR)
const pureLibs = ['src/lib/admin-format.ts', 'src/lib/admin-status-tone.ts']

test('부품은 그리기만 한다: fetch·서버 액션·Supabase·권한 판정 없음', () => {
  assert.ok(kitFiles.length >= 10, `부품 파일 수 ${kitFiles.length}`)
  for (const file of [...kitFiles, ...pureLibs]) {
    const source = read(file)
    assert.doesNotMatch(source, /\bfetch\(/, `${file}: fetch`)
    assert.doesNotMatch(source, /['"]use server['"]/, `${file}: use server`)
    assert.doesNotMatch(source, /createClient|createAdminClient|@\/lib\/supabase/, `${file}: Supabase`)
    assert.doesNotMatch(source, /@\/lib\/admin-permissions|@\/lib\/auth\b|hasAdminPermission|requireAdmin/, `${file}: 권한 판정`)
  }
})

test('AdminConfirmDialog 는 StudioAlertDialog 를 넓힌 것이고 위험 확정은 adminDanger, 첫 초점 취소·높이 제한', () => {
  const confirm = read(`${KIT_DIR}/admin-confirm-dialog.tsx`)
  assert.match(confirm, /import \{ StudioAlertDialog \} from '@\/components\/design-system\/studio-dialog'/)
  assert.match(confirm, /<StudioAlertDialog[\s\S]*?destructive=\{danger\}[\s\S]*?destructiveVariant="adminDanger"[\s\S]*?limitHeight[\s\S]*?focusCancelOnOpen/)
  assert.doesNotMatch(confirm, /<Dialog\b|DialogContent/, '창을 새로 만들지 않는다')
  // 약속 처리는 순수 대기열(아래 실행 시험)에 맡기고, 화면이 사라지면 취소로 끝낸다.
  assert.match(confirm, /createAdminConfirmQueue<AdminConfirmOptions, AdminConfirmReasonOptions>/)
  assert.match(confirm, /React\.useEffect\(\(\) => \(\) => queue\.settle\(false\), \[queue\]\)/)
  assert.match(confirm, /if \(!nextOpen\) queue\.settle\(false\)/)
  assert.match(confirm, /onConfirm=\{\(\) => queue\.settle\(true, reasonText\)\}/)
  assert.match(confirm, /return \{ ask: queue\.ask, askReason: queue\.askReason, dialog \}/)

  // 회원 화면은 선택 속성을 주지 않으므로 위험 버튼은 지금처럼 destructive.
  const studio = read('src/components/design-system/studio-dialog.tsx')
  assert.match(studio, /destructiveVariant = 'destructive',/)
  assert.match(studio, /limitHeight = false,/)
  assert.match(studio, /focusCancelOnOpen = false,/)
  assert.match(studio, /variant=\{destructive \? destructiveVariant : 'brand'\}/)
  assert.match(studio, /limitHeight && 'max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto', hasImpacts && 'sm:max-w-\[480px\]'/)
})

test('버튼 변형: adminTable(md 32px·그 아래 44px), adminDanger(--admin-tone-danger-solid + 흰 글자)', () => {
  const button = read('src/components/ui/button.tsx')
  assert.match(button, /adminTable:\s*\n\s*"min-h-11 min-w-11 md:h-8 md:min-h-0 md:min-w-0 border border-\[var\(--studio-primary-border\)\]/)
  assert.match(button, /adminDanger:\s*\n\s*"min-h-11 min-w-11 bg-\[var\(--admin-tone-danger-solid\)\] text-white /)
  // adminAction 은 지우지 않는다(6-1 가): 꺼진 기능 파일만 쓰고, 그 기능을 다시 켤 때 옮긴다(7단계 래칫이 켜진 화면 0을 지킨다).
  assert.match(button, /adminAction:\s*\n/)
})

test('저장 바는 표시만 한다: 이탈 경고 훅·확인 함수·단축키 없음, 저장 함수 하나', () => {
  const saveBar = read(`${KIT_DIR}/admin-save-bar.tsx`)
  assert.doesNotMatch(saveBar, /useUnsavedChangesGuard|confirmLeaveIfUnsaved|use-unsaved-changes-guard/)
  assert.doesNotMatch(saveBar, /keydown|onKeyDown|metaKey|ctrlKey/i)
  assert.match(saveBar, /variant: 'fixed' \| 'inline'/)
  assert.match(saveBar, /onSave: \(\) => void/)
  assert.equal(saveBar.match(/onClick=/g)?.length, 1, '저장 바 버튼은 저장 함수 하나만 부른다')
  // 반영 안내 칸
  assert.match(saveBar, /applyNote\?: React\.ReactNode/)
  // 부품 전체에도 단축키 없음
  for (const file of kitFiles) assert.doesNotMatch(read(file), /metaKey|ctrlKey/, `${file}: 단축키`)
})

test('저장 바 규칙: 실패여도 변경이 없으면 변경 없음·[다시 시도] 막힘, saveWhenClean 이면 변경 없어도 켜짐', () => {
  const { adminSaveBarView, countChangedFields } = load(`${KIT_DIR}/admin-save-bar-state.ts`)
  const view = (input) => adminSaveBarView({ hasSavedAt: false, ...input })
  assert.deepEqual(view({ status: 'error', dirtyCount: 2 }), { kind: 'error', retry: true, disabled: false })
  // 충돌 등으로 다시 읽어 변경이 0건이 되면 헛 [다시 시도]가 없다.
  assert.deepEqual(view({ status: 'error', dirtyCount: 0 }), { kind: 'clean', retry: false, disabled: true })
  assert.deepEqual(view({ status: 'idle', dirtyCount: 0 }), { kind: 'clean', retry: false, disabled: true })
  assert.deepEqual(view({ status: 'idle', dirtyCount: 0, saveWhenClean: true }), { kind: 'clean', retry: false, disabled: false })
  assert.deepEqual(view({ status: 'idle', dirtyCount: 1, saveDisabled: true }), { kind: 'dirty', retry: false, disabled: true })
  assert.deepEqual(view({ status: 'saving', dirtyCount: 1, saveWhenClean: true }), { kind: 'saving', retry: false, disabled: true })
  // 20번 6단계: 변경 없이도 누를 수 있는 줄(saveWhenClean)은 변경이 없어도 실패를 보이고 [다시 시도]를 켠다.
  assert.deepEqual(view({ status: 'error', dirtyCount: 0, saveWhenClean: true }), { kind: 'error', retry: true, disabled: false })
  assert.deepEqual(view({ status: 'error', dirtyCount: 0, saveWhenClean: true, saveDisabled: true }), { kind: 'error', retry: true, disabled: true })
  assert.equal(view({ status: 'saved', dirtyCount: 0, hasSavedAt: true }).kind, 'saved')
  assert.equal(view({ status: 'saved', dirtyCount: 1, hasSavedAt: true }).kind, 'dirty')
  assert.equal(countChangedFields({ a: 1, b: [1] }, { a: 1, b: [2], c: 0 }), 2)
  const saveBar = read(`${KIT_DIR}/admin-save-bar.tsx`)
  assert.match(saveBar, /disabled=\{view\.disabled\}/)
  assert.match(saveBar, /\{view\.retry \? '다시 시도' : saveLabel\}/)
})

test('AdminMetricCard: 바깥 div, 누르는 영역만 button aria-pressed, button 안에 button·a 없음', () => {
  const card = read(`${KIT_DIR}/admin-metric-card.tsx`)
  const component = card.slice(card.indexOf('export function AdminMetricCard'), card.indexOf('export function AdminMetricGrid'))
  const returned = component.slice(component.indexOf('  return ('))
  assert.match(returned, /^ {2}return \(\n {4}<div/)
  const buttons = [...returned.matchAll(/<button\b[\s\S]*?<\/button>/g)]
  assert.equal(buttons.length, 1)
  assert.match(buttons[0][0], /aria-pressed=\{pressed \?\? false\}/)
  // body 는 글자만(제목·큰 값·증감 줄). body 에도 단추·링크가 없어야 한다.
  const body = component.slice(component.indexOf('const body = ('), component.indexOf('  return ('))
  for (const fragment of [buttons[0][0].slice(1), body]) {
    assert.doesNotMatch(fragment, /<(button|a|Button|Link|PopoverTrigger)\b/)
  }
  // 말풍선 단추는 button 의 형제(button 닫힌 뒤)
  assert.ok(returned.indexOf('<PopoverTrigger') > returned.indexOf('</button>'))
})

test('AdminDataTable: 숫자 열 오른쪽·tabular-nums, th scope, aria-sort, 개인정보 칸 표시, 넓이 규칙', () => {
  const table = read(`${KIT_DIR}/admin-data-table.tsx`)
  assert.match(table, /scope="col"/)
  assert.match(table, /aria-sort=\{column\.sort\}/)
  assert.match(table, /data-admin-pii=\{column\.pii \? '' : undefined\}/)
  assert.match(table, /!wide && 'xl:overflow-visible'/)
  assert.match(table, /className=\{adminTableHeadCellClass\(\{/)
  assert.match(table, /className=\{adminTableBodyCellClass\(\{/)
  assert.doesNotMatch(table, /<tr[^>]*onClick/, 'tr 에 onClick 을 두지 않는다')
})

test('AdminDataTable 칸 클래스: tailwind-merge 결과로 넓이 규칙 확인(첫 머리 칸도 xl 머리 고정)', () => {
  const utils = load('src/lib/utils.ts')
  const cells = load(`${KIT_DIR}/admin-data-table-classes.ts`, { '@/lib/utils': utils })
  assert.equal(cells.ADMIN_TABLE_PAGE_WIDTH_LIMIT, 960)
  const classes = (value) => value.split(/\s+/)
  const head = (input) => classes(cells.adminTableHeadCellClass({ dense: false, align: 'left', ...input }))
  const body = (input) => classes(cells.adminTableBodyCellClass({ dense: false, align: 'left', ...input }))

  // 넓지 않은 표: 모든 머리 칸(첫 칸 포함)에 xl 머리 고정이 남고 xl:static 은 없다.
  for (const first of [true, false]) {
    const cell = head({ first, wide: false })
    for (const name of ['xl:sticky', 'xl:top-0']) assert.ok(cell.includes(name), `first=${first}: ${name} 없음`)
    assert.ok(!cell.some((name) => name.endsWith(':static') || name === 'static'), `first=${first}: static 이 섞임`)
  }
  // 첫 머리 칸: xl 미만 첫 열 고정 + xl 이상 다른 머리 칸보다 위
  const firstHead = head({ first: true, wide: false })
  for (const name of ['sticky', 'left-0', 'xl:z-20']) assert.ok(firstHead.includes(name), name)
  assert.ok(!firstHead.includes('xl:z-10'))
  // 넓은 표(> 960px): 머리 고정 없음, 첫 열 고정만
  const wideHead = head({ first: true, wide: true })
  assert.ok(!wideHead.some((name) => name.startsWith('xl:sticky') || name.startsWith('xl:top')))
  assert.ok(wideHead.includes('sticky') && wideHead.includes('left-0'))
  assert.ok(!head({ first: false, wide: true }).includes('sticky'))
  // 본문 칸: 첫 열 고정, 숫자 열 오른쪽·tabular-nums, 행 높이 40/32px
  const firstBody = body({ first: true, wide: false })
  for (const name of ['sticky', 'left-0', 'h-10']) assert.ok(firstBody.includes(name), name)
  assert.ok(!firstBody.some((name) => name.endsWith(':static')))
  const numericBody = body({ first: false, wide: false, align: 'right', numeric: true, dense: true })
  for (const name of ['text-right', 'tabular-nums', 'h-8']) assert.ok(numericBody.includes(name), name)
  assert.ok(!numericBody.includes('sticky'))
})

test('useAdminConfirm 약속 처리(실행): 확정·취소·연속 ask·화면 사라짐·사유', async () => {
  const { createAdminConfirmQueue } = load(`${KIT_DIR}/admin-confirm-queue.ts`)
  const shown = []
  const queue = createAdminConfirmQueue((request) => shown.push(request ? request.type : null))

  // 확정 → true, 창 닫힘
  let pending = queue.ask({ title: 'A' })
  assert.deepEqual(shown, ['confirm'])
  queue.settle(true)
  assert.equal(await pending, true)
  assert.equal(shown.at(-1), null)

  // 취소(Esc·[취소]) → false
  pending = queue.ask({ title: 'B' })
  queue.settle(false)
  assert.equal(await pending, false)

  // 열린 채 다른 ask 가 오면 앞 약속은 취소로 풀리고, 뒤 것만 열려 있다.
  const first = queue.ask({ title: 'C' })
  const second = queue.askReason({ title: 'D', reasonLabel: '사유' })
  assert.equal(await first, false)
  queue.settle(true, '  고객 요청  ')
  assert.equal(await second, '고객 요청')

  // 사유 확인 취소 → null, 앞 사유 확인이 다른 ask 로 밀려도 null
  pending = queue.askReason({ title: 'E', reasonLabel: '사유' })
  queue.settle(false, '무시됨')
  assert.equal(await pending, null)
  const pushed = queue.askReason({ title: 'F', reasonLabel: '사유' })
  const next = queue.ask({ title: 'G' })
  assert.equal(await pushed, null)

  // 화면이 사라짐(훅 정리에서 settle(false)) → 열린 확인은 false. 열린 것이 없으면 아무 일 없음.
  queue.settle(false)
  assert.equal(await next, false)
  const before = shown.length
  queue.settle(false)
  queue.settle(true)
  assert.equal(shown.length, before)
})

test('AdminFilterBar: 주소 고치기는 updateListQuery, 키 이름은 화면이 준 그대로', () => {
  const filter = read(`${KIT_DIR}/admin-filter-bar.tsx`)
  assert.match(filter, /import \{ updateListQuery \} from '@\/lib\/list-pagination'/)
  assert.match(filter, /export function useAdminFilterParams<Key extends string>\(keys: readonly Key\[\], /)
  // 기준 쿼리(화면이 정규화한 값)를 주면 지금 주소 대신 그것으로 읽고 고친다.
  assert.match(filter, /options: \{ baseQuery\?: string \} = \{\}/)
  assert.match(filter, /const base = options\.baseQuery \?\? searchParams\.toString\(\)/)
  assert.match(filter, /values\[key\] = baseParams\.get\(key\) \?\? ''/)
  assert.match(filter, /const query = updateListQuery\(base, changes\)/)
})

// ───── 이탈 경고 훅: 지금 3곳뿐, 주소(같은 page 가 그리는 파일 합산)마다 ≤1 ─────

const HOOK_FILE = 'src/hooks/use-unsaved-changes-guard.ts'
const HOOK_CALL = /\buseUnsavedChangesGuard\(/g
const countHookCalls = (file) => (file === HOOK_FILE ? 0 : (read(file).match(HOOK_CALL) ?? []).length)

function resolveImport(fromFile, specifier) {
  let base
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  else return null
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (isFile(base + suffix)) return base + suffix
  }
  return null
}

function collectImported(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const source = read(file)
    for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(file, match[1] ?? match[2])
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return seen
}

test('이탈 경고 훅을 부르는 파일은 지금 3곳뿐(새로 생기면 실패)', () => {
  const callers = walk('src').filter((file) => countHookCalls(file) > 0).sort()
  assert.deepEqual(callers, [
    'src/app/(admin)/admin/footer/purchase-policy-form.tsx',
    'src/app/(admin)/admin/menu-management/menu-management-client.tsx',
    'src/app/(admin)/admin/review-tags/review-tags-client.tsx',
  ])
  for (const file of callers) assert.equal(countHookCalls(file), 1, file)
})

test('관리자 주소마다 이탈 경고 훅 호출 합계 ≤ 1 (page + 그 위 layout + import 한 파일 전체)', () => {
  const pages = walk('src/app/(admin)').filter((file) => file.endsWith('/page.tsx'))
  assert.ok(pages.length > 40)
  for (const page of pages) {
    const layouts = []
    let dir = path.posix.dirname(page)
    while (dir.startsWith('src/app/(admin)')) {
      if (isFile(`${dir}/layout.tsx`)) layouts.push(`${dir}/layout.tsx`)
      dir = path.posix.dirname(dir)
    }
    const files = collectImported([page, ...layouts])
    const total = [...files].reduce((sum, file) => sum + countHookCalls(file), 0)
    assert.ok(total <= 1, `${page}: 이탈 경고 훅 ${total}개`)
  }
})

// ───── 6-4 래칫: 목록에 없는 파일에 새로 생기면 실패. 단계마다 목록을 줄인다(7단계 끝에 켜진 화면 0). ─────

const RATCHET_SCOPE = [
  ...walk('src/app/(admin)'),
  ...walk('src/components/admin'),
  ...walk('src/components/layout').filter((file) => path.posix.basename(file).startsWith('admin-')),
]

// 꺼진 기능 파일(admin_disabled_features: question_bank·ai_generation·generate·passages·source_configs 등) — 예외, 다시 켤 때 옮긴다.
const DISABLED_FEATURE_FILE = /^src\/app\/\(admin\)\/admin\/(questions|question-bank|problem-types|ai-connections|ai-question-generation-runs|generate|passages|source-configs|labels|landing-pages|roles)\/|^src\/components\/admin\/(model-selector|provider-selector)\.tsx$/

function filesMatching(pattern) {
  return RATCHET_SCOPE.filter((file) => pattern.test(read(file))).sort()
}

function assertRatchet(name, pattern, allowedEnabled) {
  const unexpected = filesMatching(pattern).filter((file) => !DISABLED_FEATURE_FILE.test(file) && !allowedEnabled.includes(file))
  assert.deepEqual(unexpected, [], `${name}: 목록에 없는 켜진 화면 파일에 새로 생김`)
}

test('래칫: confirm( 은 지금 목록 밖 켜진 화면에 새로 생기지 않는다', () => {
  // 20번 6단계: 상품 화면 6곳(상품 삭제·서브상품 삭제·샘플 전체 삭제·구성·파일 유형 삭제·카테고리 칸 삭제)을 공통 확인 창으로 옮겨 목록이 비었다.
  assertRatchet('confirm(', /\bconfirm\(/, [])
})

test('래칫: alert( 은 지금 목록 밖 켜진 화면에 새로 생기지 않는다', () => {
  // 20번 6단계: 카테고리 칸 편집기는 화면 안 오류로 옮겨 뺐다. 7단계: 사이드바 로그아웃 실패 알림을 toast 로 옮겨 목록이 비었다.
  // 예외는 꺼진 기능 파일(DISABLED_FEATURE_FILE)뿐이다. 이탈 경고 훅(src/hooks/use-unsaved-changes-guard.ts)은 범위 밖이라 따로 둔다(5-3).
  assertRatchet('alert(', /\balert\(/, [])
})

test('래칫: adminAction 은 지금 목록 밖 켜진 화면에 새로 생기지 않는다', () => {
  // 22번(20번 6-1 4단계 '홈'): main-ad-settings 는 brandOutline 으로 옮겨 목록에서 뺐다.
  // 20번 6단계: 상품 화면 8파일(/admin/market/products/**)을 adminTable·brand·brandOutline 으로 옮겨 뺐다.
  // 20번 7단계: 대시보드(21번이 다시 만들며 없어짐)·공지/FAQ(board-admin)·알림 화면을 옮겨 목록이 비었다(켜진 화면 0, 예외는 꺼진 기능 파일뿐).
  assertRatchet('adminAction', /\badminAction\b/, [])
})

// 20번 7단계 완료 조건: 켜진 화면에서 숫자 표기용 toLocaleString( 은 0(formatCount 등 admin-format.ts).
// 남은 것은 날짜 표기뿐이다 — 대표가 날짜 표기(formatKstFull 등)를 정하기 전까지 화면마다 지금 모양을 지킨다(1~6단계 판단 1).
// 숫자 예외 1곳: 탈퇴 패널(10번)의 num — 값 일부가 타입 없는 보관 기록(unknown)에서 와서 formatCount 로 바꾸면 글자 값일 때 '확인 불가'로 바뀔 수 있다.
const TO_LOCALE_DATE_ALLOWED = {
  'src/app/(admin)/admin/audit-log/audit-log-client.tsx': 1,
  'src/app/(admin)/admin/audit-log/member-access-log-client.tsx': 1,
  'src/app/(admin)/admin/credits/credits-client.tsx': 1,
  'src/app/(admin)/admin/footer/policy-history/page.tsx': 1,
  'src/app/(admin)/admin/market/products/_lib/product-form.ts': 1,
  'src/app/(admin)/admin/orders/market-exception-refund-dialog.tsx': 4,
  'src/app/(admin)/admin/orders/orders-client.tsx': 1,
  'src/app/(admin)/admin/refunds/payment-review-client.tsx': 2,
  'src/app/(admin)/admin/support/support-client.tsx': 2,
  'src/app/(admin)/admin/support/withdrawn-tickets-panel.tsx': 1,
  'src/app/(admin)/admin/users/[id]/page.tsx': 1,
  'src/components/admin/admin-alert-center.tsx': 1,
}
const TO_LOCALE_NUMBER_EXCEPTIONS = {
  'src/app/(admin)/admin/users/[id]/member-withdrawal-panel.tsx': 1,
}
const DATE_TO_LOCALE = /new Date\([^)]*\)\.toLocaleString\(/g

test('래칫: 화면별 toLocaleString( 수는 늘지 않는다(새 표기는 admin-format.ts)', () => {
  const over = []
  for (const file of RATCHET_SCOPE) {
    if (DISABLED_FEATURE_FILE.test(file)) continue
    const count = (read(file).match(/toLocaleString\(/g) ?? []).length
    const allowed = (TO_LOCALE_DATE_ALLOWED[file] ?? 0) + (TO_LOCALE_NUMBER_EXCEPTIONS[file] ?? 0)
    if (count > allowed) over.push(`${file}: ${count} > ${allowed}`)
  }
  assert.deepEqual(over, [])
})

test('래칫(7단계 완료 조건): 켜진 화면의 toLocaleString( 은 날짜 표기뿐(숫자는 예외 목록 1곳만)', () => {
  const numeric = []
  for (const file of RATCHET_SCOPE) {
    if (DISABLED_FEATURE_FILE.test(file)) continue
    const source = read(file)
    const total = (source.match(/toLocaleString\(/g) ?? []).length
    const dates = (source.match(DATE_TO_LOCALE) ?? []).length
    if (total - dates > (TO_LOCALE_NUMBER_EXCEPTIONS[file] ?? 0)) numeric.push(`${file}: 숫자 ${total - dates}`)
  }
  assert.deepEqual(numeric, [])
})

test('부품 파일에는 래칫 대상(confirm·alert·adminAction·toLocaleString)이 없다', () => {
  for (const file of kitFiles) {
    assert.doesNotMatch(read(file), /\bconfirm\(|\balert\(|\badminAction\b|toLocaleString\(/, file)
  }
})

test('화면 비교 스크립트(6-3): login·capture 두 모드, 쓰기 막기, 창 닫기, 개인정보 가리기, 저장소 밖 저장', () => {
  const script = read('scripts/admin-visual-snapshot.mjs')
  assert.match(script, /options\.mode === 'login'/)
  assert.match(script, /options\.mode === 'capture'/)
  assert.match(script, /const ALLOWED_METHODS = new Set\(\['GET', 'HEAD'\]\)/)
  assert.match(script, /context\.route\('\*\*\/\*'[\s\S]*?route\.abort\(/)
  assert.match(script, /if \(blocked\.length > 0\) \{\s+throw new Error/)
  assert.match(script, /page\.on\('dialog', \(dialog\) => void dialog\.dismiss\(\)\)/)
  // WebSocket 은 서버에 잇지 않고 닫는다(connectToServer 를 부르지 않음).
  assert.match(script, /context\.routeWebSocket\(\/\.\*\/, \(socket\) => \{[\s\S]*?socket\.close\(\)/)
  assert.doesNotMatch(script, /connectToServer/)
  assert.match(script, /mask: \[page\.locator\(PII_SELECTOR\)\]/)
  assert.match(script, /const PII_SELECTOR = '\[data-admin-pii\]'/)
  assert.match(script, /path\.join\(homedir\(\), 'admin-visual-snapshots'\)/)
  assert.match(script, /\{ width: 1024, height: 768 \}/)
  // 로그인은 사람이 직접: 서비스 키·고정 계정 만들기를 쓰지 않는다.
  assert.doesNotMatch(script, /studio-browser-fixture|SERVICE_ROLE|service_role|createClient|dotenv|\.env/)
  // 확인 창(유형 가) 열림(1단계): 여는 단추 하나만 누르고, 창을 찍은 뒤 Esc 로 닫는다(확정 단추는 누르지 않음).
  assert.match(script, /else if \(key === '--confirm'\) options\.confirms\.push\(parseConfirm\(value\)\)/)
  const confirmBody = script.slice(script.indexOf('async function captureConfirm'), script.indexOf('async function capture('))
  assert.match(confirmBody, /page\.getByRole\('dialog'\)/)
  assert.match(confirmBody, /mask: \[page\.locator\(PII_SELECTOR\)\]/)
  assert.match(confirmBody, /page\.keyboard\.press\('Escape'\)/)
  assert.equal(confirmBody.match(/\.click\(/g)?.length, 1, '여는 단추만 누른다')
  assert.match(confirmBody, /\.filter\(\{ visible: true \}\)\.first\(\)/)
  // 누른 뒤 창이 뜨기 전 /api/ 요청(기록을 남기는 GET 포함)은 끊고 실패로 끝낸다.
  assert.match(confirmBody, /const abortApi = \(route\) => \{[\s\S]*?return route\.abort\('blockedbyclient'\)/)
  assert.match(confirmBody, /await page\.route\('\*\*\/api\/\*\*', abortApi\)[\s\S]*?trigger\.click\([\s\S]*?finally \{\s+await page\.unroute\('\*\*\/api\/\*\*', abortApi\)/)
  assert.match(confirmBody, /if \(apiBeforeDialog\.length > 0\) \{\s+throw new Error/)
  assert.match(script, /막힌 쓰기 요청 \$\{blocked\.length\}건/)
  // login 모드에는 막기·찍기가 없다.
  const loginBody = script.slice(script.indexOf('async function login'), script.indexOf('async function capture'))
  assert.doesNotMatch(loginBody, /route\(|screenshot\(/)
})
