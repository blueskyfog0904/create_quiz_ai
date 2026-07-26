import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePath = new URL('../src/app/api/admin/main-ad-settings/route.ts', import.meta.url)
const serverPath = new URL('../src/lib/main-ad-carousel-server.ts', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260725090000_create_main_ad_images_bucket.sql',
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

const route = existsSync(routePath) ? readFileSync(routePath, 'utf8') : ''
const server = existsSync(serverPath) ? readFileSync(serverPath, 'utf8') : ''
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''
const client = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : ''

test('main ad settings route keeps authentication and file writes behind the admin boundary', () => {
  assert.ok(existsSync(routePath), 'main ad settings route should exist')
  assert.match(route, /UNAUTHORIZED/)
  assert.match(route, /FORBIDDEN/)
  assert.match(route, /auth\.getUser\(\)/)
  assert.match(route, /profiles/)
  assert.match(route, /is_admin/)
  assert.match(route, /request\.formData\(\)/)
  assert.match(route, /getAll\('config'\)/)
  assert.match(route, /formData\.entries\(\)/)
  assert.match(route, /file:\$\{itemId\}:\$\{role\}/)
  assert.match(route, /MAIN_AD_IMAGES_BUCKET/)
  assert.match(route, /\.upload\(/)
  assert.match(route, /upsert:\s*false/)
})

test('main ad settings route validates all draft parts before the first upload', () => {
  const draftValidationIndex = route.indexOf('validateUploadPlan')
  const firstUploadIndex = route.indexOf('.upload(')

  assert.ok(draftValidationIndex >= 0, 'route should validate the complete upload plan')
  assert.ok(firstUploadIndex > draftValidationIndex, 'validation should happen before storage upload')
  assert.match(route, /getMainAdImageExtension/)
  assert.match(route, /validateMainAdCarouselConfig/)
  assert.match(route, /validateMainAdStoragePath/)
  assert.match(route, /unexpected|예상하지 않은/)
  assert.match(route, /duplicate|중복/)
})

test('main ad settings route compensates failed writes and treats obsolete cleanup as a warning', () => {
  assert.match(route, /uploadedPaths/)
  assert.match(route, /removeMainAdImagePaths/)
  assert.match(route, /getMainAdCarouselConfigForUpdate/)
  assert.match(route, /getReferencedMainAdImagePaths/)
  assert.match(route, /cleanupWarnings/)
  assert.match(route, /console\.error/)
  assert.match(route, /revalidatePath\('\/preview\/solvook-concept'\)/)
  assert.match(route, /revalidatePath\('\/admin\/main-ad-settings'\)/)
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
  assert.match(page, /getMainAdCarouselAdminData/)
  assert.match(client, /crypto\.randomUUID\(\)/)
  assert.match(client, /URL\.createObjectURL/)
  assert.match(client, /URL\.revokeObjectURL/)
  assert.match(client, /AlertDialog/)
  assert.match(client, /ArrowUp/)
  assert.match(client, /ArrowDown/)
  assert.match(client, /file:\$\{item\.id\}:pc/)
  assert.match(client, /file:\$\{item\.id\}:mobile/)
  assert.match(client, /fetch\('\/api\/admin\/main-ad-settings'/)
  assert.match(client, /cleanupWarnings/)
  assert.match(client, /aria-invalid/)
  assert.match(client, /FieldError/)
  assert.match(client, /validateEditableItems/)
})
