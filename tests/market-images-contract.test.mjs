import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const libraryMigration = read('supabase/migrations/20261002014044_market_image_library.sql')
const refsMigration = read('supabase/migrations/20261002014653_market_image_refs.sql')
const lib = read('src/lib/market-images.ts')
const serverLib = read('src/lib/market-images-server.ts')
const routePaths = [
  'src/app/api/admin/market/images/route.ts',
  'src/app/api/admin/market/images/check/route.ts',
  'src/app/api/admin/market/images/move/route.ts',
  'src/app/api/admin/market/images/[id]/route.ts',
  'src/app/api/admin/market/image-folders/route.ts',
  'src/app/api/admin/market/image-folders/[id]/route.ts',
]
const routes = Object.fromEntries(routePaths.map((path) => [path, read(path)]))

test('image and folder routes run on nodejs and check admin first in every handler', () => {
  for (const [path, source] of Object.entries(routes)) {
    assert.match(source, /export const runtime = 'nodejs'/, path)
    const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\([^)]*\)[^{]*\{\n([^\n]*)\n([^\n]*)/g)]
    assert.ok(handlers.length > 0, path)
    for (const [, method, first, second] of handlers) {
      assert.match(first, /const auth = await requireMarketImageAdmin\(\)/, `${method} ${path}`)
      assert.match(second, /if \(auth instanceof NextResponse\) return auth/, `${method} ${path}`)
    }
    assert.doesNotMatch(source, /@\/lib\/supabase\/server/, `${path} must use the service-role client only`)
    assert.doesNotMatch(source, /main-ad-images|market-files|MAIN_AD_IMAGES_BUCKET|MARKET_STORAGE_BUCKET/, path)
  }
})

test('requireMarketImageAdmin checks profiles.is_admin and returns 401 / 403', () => {
  const body = serverLib.match(/export async function requireMarketImageAdmin[\s\S]+?\n}\n/)[0]
  assert.match(body, /auth\.getUser\(\)/)
  assert.match(body, /\.select\('is_admin'\)/)
  assert.match(body, /401, 'UNAUTHORIZED'/)
  assert.match(body, /403, 'FORBIDDEN'/)
  assert.match(serverLib, /^import 'server-only'/)
})

test('normalization uses fixed sharp limits and WebP parameters', () => {
  assert.match(serverLib, /limitInputPixels: 25_000_000/)
  assert.match(serverLib, /\(metadata\.pages \?\? 1\) > 1/)
  assert.match(serverLib, /\.rotate\(\)/)
  assert.match(serverLib, /fit: 'inside', withoutEnlargement: true/)
  assert.match(serverLib, /MARKET_IMAGE_WEBP_OPTIONS = \{ quality: \d+, effort: \d+ \} as const/)
  assert.doesNotMatch(serverLib, /withMetadata|keepMetadata|keepExif/)
})

test('client-safe library has no server imports and never reads thumbnail_url', () => {
  assert.doesNotMatch(lib, /^import /m)
  assert.match(lib, /export const MARKET_IMAGES_BUCKET = 'market-images'/)
  assert.match(lib, /export const MARKET_IMAGE_MAX_INPUT_BYTES = 4 \* 1024 \* 1024/)
  assert.match(lib, /export const MARKET_IMAGE_MAX_EDGE = 800/)
  assert.match(lib, /`thumbnails\/\$\{contentSha256\.slice\(0, 2\)\}\/\$\{contentSha256\}\.webp`/)
  assert.doesNotMatch(lib, /thumbnail_url|thumbnailUrl/)
})

test('upload dedupes by source then content hash, uploads with upsert:false and cleans up only its own object', () => {
  const source = routes['src/app/api/admin/market/images/route.ts']
  const sourceLookup = source.indexOf("findImage(admin, 'source_sha256'")
  const normalize = source.indexOf('normalizeMarketImage(input)')
  const contentLookup = source.indexOf("findImage(admin, 'content_sha256', image.contentSha256)")
  const upload = source.indexOf('.upload(storagePath')
  assert.ok(sourceLookup > 0 && sourceLookup < normalize && normalize < contentLookup && contentLookup < upload)
  assert.match(source, /upsert: false/)
  assert.match(source, /const createdObject = !uploadError/)
  assert.match(source, /if \(createdObject\) await removeMarketImageObjectIfUnreferenced\(admin, storagePath\)/)
  assert.match(source, /export const maxDuration = 60/)
  assert.match(source, /MAX_FILES_PER_REQUEST = 20/)
  assert.match(source, /400, 'TOO_MANY_FILES'/)
  assert.match(source, /error\.code === '23505'/)
  assert.match(source, /MAX_REQUEST_BYTES/)
  assert.match(source, /413, 'PAYLOAD_TOO_LARGE'/)
})

test('image delete uses delete_market_image RPC and maps IN_USE and 23503 to 409', () => {
  const source = routes['src/app/api/admin/market/images/[id]/route.ts']
  assert.match(source, /admin\.rpc\('delete_market_image', \{ p_image_id: id \}\)/)
  assert.match(source, /error\?\.code === '23503'[\s\S]+listMarketImageUsage\(admin, \[id\]\)[\s\S]+inUseResponse/)
  assert.match(source, /marketImageErrorResponse\(409, 'IN_USE'/)
  assert.match(source, /result\.code === 'NOT_FOUND'[\s\S]+404/)
  assert.match(source, /removeMarketImageObjectIfUnreferenced\(admin, result\.storagePath\)/)
  assert.doesNotMatch(source, /\.remove\(/)
  const helper = serverLib.match(/export async function removeMarketImageObjectIfUnreferenced[\s\S]+?\n}\n/)[0]
  assert.ok(helper.indexOf(".eq('storage_path', storagePath)") < helper.indexOf('.remove([storagePath])'))
  assert.match(routes['src/app/api/admin/market/images/move/route.ts'], /z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)\.max\(200\)/)
  assert.match(serverLib, /\.from\('market_items'\)[\s\S]+\.is\('deleted_at', null\)/)
  assert.match(serverLib, /\.from\('market_category_items'\)/)
})

test('folder delete refuses non-empty folders with FOLDER_NOT_EMPTY 409 and imageCount', () => {
  const source = routes['src/app/api/admin/market/image-folders/[id]/route.ts']
  assert.match(source, /409,\n\s+'FOLDER_NOT_EMPTY'/)
  assert.match(source, /\{ imageCount \}/)
  assert.match(source, /if \(imageCount > 0\) return folderNotEmptyResponse\(imageCount\)/)
  assert.match(source, /error\?\.code === '23503'\) return folderNotEmptyResponse/)
  assert.match(routes['src/app/api/admin/market/image-folders/route.ts'], /409, 'DUPLICATE_NAME'/)
})

test('library migration: public 2MB webp bucket, RLS without policies, table privileges revoked', () => {
  assert.match(libraryMigration, /'market-images',\s+'market-images',\s+true,\s+2097152,\s+array\['image\/webp'\]/)
  for (const table of ['market_image_folders', 'market_images']) {
    assert.match(libraryMigration, new RegExp(`alter table public\\.${table} enable row level security;`))
    assert.match(libraryMigration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`))
  }
  assert.doesNotMatch(`${libraryMigration}\n${refsMigration}`, /create policy/i)
  assert.match(libraryMigration, /folder_id uuid references public\.market_image_folders\(id\) on delete restrict/)
  assert.match(libraryMigration, /constraint market_images_content_sha256_key unique \(content_sha256\)/)
  assert.match(libraryMigration, /check \(content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.match(libraryMigration, /create index if not exists idx_market_images_source_sha256/)
})

test('refs migration: restrict FKs and a hardened service-role-only delete_market_image RPC', () => {
  assert.match(refsMigration, /foreign key \(thumbnail_image_id\)\s+references public\.market_images\(id\)\s+on delete restrict/)
  assert.match(refsMigration, /foreign key \(default_image_id\)\s+references public\.market_images\(id\)\s+on delete restrict/)
  const fn = refsMigration.match(/create or replace function public\.delete_market_image[\s\S]+?\n\$\$;/)[0]
  assert.match(fn, /returns jsonb/)
  assert.match(fn, /\n volatile\n|\nvolatile\n/)
  assert.match(fn, /\nsecurity definer\n/)
  assert.match(fn, /\nset search_path = public, pg_temp\n/)
  assert.match(fn, /i\.deleted_at is null/)
  for (const table of fn.matchAll(/\b(?:from|update|into)\s+([a-z_.]+)/g)) {
    if (!table[1].startsWith('v_')) assert.match(table[1], /^public\./, table[0])
  }
  assert.match(refsMigration, /revoke all on function public\.delete_market_image\(uuid\) from public, anon, authenticated;/)
  assert.match(refsMigration, /grant execute on function public\.delete_market_image\(uuid\) to service_role;/)
})
