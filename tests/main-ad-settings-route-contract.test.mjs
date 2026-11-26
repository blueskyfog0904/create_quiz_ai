import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePath = new URL('../src/app/api/admin/main-ad-settings/route.ts', import.meta.url)
const serverPath = new URL('../src/lib/main-ad-carousel-server.ts', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260725090000_create_main_ad_images_bucket.sql',
  import.meta.url
)
const atomicUpdateMigrationPath = new URL(
  '../supabase/migrations/20260729080904_atomic_main_ad_carousel_subject_update.sql',
  import.meta.url
)
const pagePath = new URL(
  '../src/app/(admin)/admin/main-ad-settings/page.tsx',
  import.meta.url
)
const clientPath = new URL(
  '../src/app/(admin)/admin/main-ad-settings/main-ad-settings-client.tsx',
  import.meta.url
)
const contractPath = new URL('../src/lib/main-ad-carousel.ts', import.meta.url)

const route = existsSync(routePath) ? readFileSync(routePath, 'utf8') : ''
const server = existsSync(serverPath) ? readFileSync(serverPath, 'utf8') : ''
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const atomicUpdateMigration = existsSync(atomicUpdateMigrationPath)
  ? readFileSync(atomicUpdateMigrationPath, 'utf8')
  : ''
const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''
const client = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : ''
const contract = existsSync(contractPath) ? readFileSync(contractPath, 'utf8') : ''

test('main ad settings route keeps authentication and file writes behind the admin boundary', () => {
  assert.ok(existsSync(routePath), 'main ad settings route should exist')
  assert.match(route, /UNAUTHORIZED/)
  assert.match(route, /FORBIDDEN/)
  assert.match(route, /requireAdminApiPermission\(permission\)/)
  assert.match(route, /permission: AdminPermissionRequirement = 'storefront\.edit'/)
  assert.match(route, /request\.formData\(\)/)
  assert.match(route, /getAll\('config'\)/)
  assert.match(route, /formData\.entries\(\)/)
  assert.match(route, /file:\$\{itemId\}:\$\{role\}/)
  assert.match(route, /MAIN_AD_IMAGES_BUCKET/)
  assert.match(route, /\.upload\(/)
  assert.match(route, /upsert:\s*false/)
  assert.match(route, /isWorkspaceSubject/)
  assert.match(route, /!subjectParam \|\| !isWorkspaceSubject\(subjectParam\)/)
  assert.match(route, /INVALID_MAIN_AD_SETTINGS[\s\S]*400/)
})

test('main ad settings route validates all draft parts before the first upload', () => {
  const draftValidationIndex = route.indexOf('validateUploadPlan')
  const firstUploadIndex = route.indexOf('.upload(')

  assert.ok(draftValidationIndex >= 0, 'route should validate the complete upload plan')
  assert.ok(firstUploadIndex > draftValidationIndex, 'validation should happen before storage upload')
  assert.match(route, /getMainAdImageExtension/)
  assert.match(server, /validateMainAdCarouselConfig/)
  assert.match(route, /validateMainAdStoragePath/)
  assert.match(route, /unexpected|예상하지 않은/)
  assert.match(route, /duplicate|중복/)
})

test('main ad settings route compensates failed writes and treats obsolete cleanup as a warning', () => {
  assert.match(route, /uploadedPaths/)
  assert.match(route, /removeMainAdImagePaths/)
  assert.match(route, /updateMainAdCarouselSubjectConfig/)
  assert.match(route, /getReferencedMainAdImagePaths/)
  assert.match(route, /cleanupWarnings/)
  assert.match(route, /console\.error/)
  assert.match(route, /revalidatePath\('\/preview\/solvook-concept'\)/)
  assert.match(route, /revalidatePath\('\/admin\/main-ad-settings'\)/)
  assert.match(route, /getMainAdCarouselSubjectConfig/)
})

test('main ad settings atomically replaces only the requested subject and cleans up from RPC snapshots', () => {
  assert.ok(existsSync(atomicUpdateMigrationPath), 'atomic subject update migration should exist')
  assert.match(server, /\.rpc\('update_main_ad_carousel_subject'/)
  assert.match(route, /beforeConfig/)
  assert.match(route, /afterConfig/)
  assert.doesNotMatch(route, /saveMainAdCarouselConfig/)
  assert.match(atomicUpdateMigration, /for update/i)
  assert.match(atomicUpdateMigration, /p_subject is null or p_subject not in \('english', 'korean'\)/i)
  assert.match(atomicUpdateMigration, /before_config/i)
  assert.match(atomicUpdateMigration, /after_config/i)
  assert.match(atomicUpdateMigration, /Invalid main ad item id/)
  assert.match(atomicUpdateMigration, /Duplicate main ad item id/)
  assert.match(atomicUpdateMigration, /Duplicate cross-subject main ad item id/)
  assert.match(atomicUpdateMigration, /revoke execute on function[\s\S]*from public, anon, authenticated/i)
  assert.match(atomicUpdateMigration, /grant execute on function[\s\S]*to service_role/i)
})

test('main ad server helper reads and writes the shared system setting with safe fallback', () => {
  assert.ok(existsSync(serverPath), 'main ad server helper should exist')
  assert.match(server, /system_settings/)
  assert.match(server, /MAIN_AD_CAROUSEL_SETTING_KEY/)
  assert.match(server, /maybeSingle\(\)/)
  assert.match(server, /getDefaultMainAdCarouselConfig/)
  assert.match(server, /normalizeMainAdCarouselConfig/)
  assert.match(server, /getPublicUrl/)
  assert.match(server, /onConflict:\s*'key'/)
  assert.match(server, /getMainAdCarouselConfigForUpdate/)
  assert.match(server, /기존 메인 광고 설정 조회에 실패했습니다/)
  assert.match(server, /try\s*\{[\s\S]*\.remove\(uniquePaths\)[\s\S]*catch/)
})

test('main ad image bucket is public-read with limits and no browser write policy', () => {
  assert.ok(existsSync(migrationPath), 'main ad storage migration should exist')
  assert.match(migration, /main-ad-images/)
  assert.match(migration, /public/)
  assert.match(migration, /10485760/)
  assert.match(migration, /image\/jpeg/)
  assert.match(migration, /image\/png/)
  assert.match(migration, /image\/webp/)
  assert.match(migration, /on conflict/)
  assert.doesNotMatch(migration, /create policy/i)
  assert.doesNotMatch(migration, /storage\.objects/i)
})

test('main ad admin page supports ordered edits, safe previews and confirmed deletion', () => {
  assert.ok(existsSync(pagePath), 'main ad admin page should exist')
  assert.ok(existsSync(clientPath), 'main ad admin client should exist')
  assert.match(page, /getMainAdCarouselAdminData\(workspaceSubject\)/)
  assert.match(page, /resolveAdminWorkspaceSubject/)
  assert.match(
    page,
    /<MainAdSettingsClient[\s\S]*key=\{workspaceSubject\}[\s\S]*workspaceSubject=\{workspaceSubject\}/
  )
  assert.match(client, /crypto\.randomUUID\(\)/)
  assert.match(client, /URL\.createObjectURL/)
  assert.match(client, /URL\.revokeObjectURL/)
  assert.match(client, /AlertDialog/)
  assert.match(client, /ArrowUp/)
  assert.match(client, /ArrowDown/)
  assert.match(client, /file:\$\{item\.id\}:pc/)
  assert.match(client, /file:\$\{item\.id\}:mobile/)
  assert.match(client, /withAdminWorkspaceSubject\('\/api\/admin\/main-ad-settings'/)
  assert.match(client, /AdminWorkspaceSwitcher/)
  assert.match(client, /cleanupWarnings/)
  assert.match(client, /aria-invalid/)
  assert.match(client, /FieldError/)
  assert.match(client, /validateEditableItems/)
})

test('main ad admin previews match public crop ratios and explain the title and upload guidance', () => {
  assert.match(client, /mobile \? 'aspect-\[8\/5\]' : 'aspect-\[8\/3\]'/)
  assert.match(client, /className="h-full w-full object-cover"/)
  assert.match(client, /공개 왼쪽 목록에 표시되는 유일한 문구/)
  assert.match(client, /1920×720px \(8:3\)/)
  assert.match(client, /1200×750px \(8:5\)/)
  assert.match(client, /JPG, PNG, WEBP/)
  assert.match(client, /최대 10MB/)
  assert.match(client, /object-cover|가장자리가 잘릴 수/)
})

// 22번(계획 Q6, 의도적 변경): 보일 배너가 0개면 회원 홈의 배너 영역이 숨으므로 안내도 그렇게 바꾼다.
test('main ad admin empty state says the member home hides the banner area', () => {
  assert.match(client, /보일 배너가 없으면 회원 홈에는 배너 영역이 보이지 않습니다/)
  assert.doesNotMatch(client, /프리뷰에는 같은 광고 영역의 빈 상태가 표시됩니다|기존 프리뷰 히어로가 그대로 표시됩니다/)
})

// 22번 3-5·6절·7절: 예약 칸(한국 시간 입력 → UTC), 요약 표·상태 tone, 0개가 되는 저장 확인, 저장 뒤 작업 기록
test('main ad admin edits the schedule in KST, shows status tones and confirms a save that hides every banner', () => {
  assert.match(client, /type="datetime-local"/)
  assert.match(client, /utcIsoToKstLocal\(item\.startsAt\)/)
  assert.match(client, /kstLocalToUtcIso\(event\.target\.value\)/)
  assert.match(client, /startsAt: item\.startsAt,\s*endsAt: item\.endsAt/)
  assert.match(client, /adminStatusTone\('banner', status\)/)
  assert.match(client, /AdminDataTable/)
  assert.match(client, /visibleAfter === 0 && visibleBefore > 0[\s\S]*await ask\(/)
  assert.match(client, /저장하면 지금 보일 배너가 0개가 되어 회원 홈에 배너 영역이 사라집니다/)
  // 작업 기록은 저장 성공(settingSaved) 뒤, 원문 없이 바뀐 칸만
  const saved = route.indexOf('settingSaved = true')
  const audit = route.indexOf("action: 'main_ad_carousel_save'")
  assert.ok(saved > 0 && audit > saved, 'audit after the RPC save')
  assert.match(route, /changes: diffMainAdItems\(beforeConfig\.items\[workspaceSubject\], afterConfig\.items\[workspaceSubject\]\)/)
  assert.match(route, /request: adminRequestMeta\(request\)/)
})

test('new main ads use the shared five-second default contract', () => {
  assert.match(contract, /MAIN_AD_DEFAULT_DURATION_SECONDS\s*=\s*5/)
  assert.match(client, /durationSeconds:\s*MAIN_AD_DEFAULT_DURATION_SECONDS/)
  assert.doesNotMatch(client, /durationSeconds:\s*5/)
})
