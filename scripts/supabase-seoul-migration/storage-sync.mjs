// storage-sync.sh 가 부른다. 옛 프로젝트에서 내려받아 새 프로젝트로 올리는 한 방향 동기화.
// 입력(환경변수): OLD_REF, NEW_REF, OLD_KEY, NEW_KEY, SYNC_DIR, LAST_SYNC, APPLY_DELETE, PREV_NEW_ONLY
// 안전장치: 쓰기·삭제 요청은 새 ref 주소로만 보낸다. 옛 ref 주소로는 GET만 한다.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { OLD_REF, NEW_REF, OLD_KEY, NEW_KEY, SYNC_DIR, LAST_SYNC = '', APPLY_DELETE = '0', PREV_NEW_ONLY = '' } = process.env
const REF_PATTERN = /^[a-z0-9]{20}$/
if (!REF_PATTERN.test(OLD_REF ?? '') || !REF_PATTERN.test(NEW_REF ?? '') || OLD_REF === NEW_REF) {
  throw new Error('OLD_REF·NEW_REF 형식이 아니거나 같습니다')
}
if (!OLD_KEY || !NEW_KEY || !SYNC_DIR) throw new Error('키 또는 SYNC_DIR가 없습니다')
if (!NEW_KEY.startsWith('sb_secret_')) throw new Error('새 키는 sb_secret_ 로 시작하는 secret 키여야 합니다(publishable 키 아님)')

const OLD_BASE = `https://${OLD_REF}.supabase.co/storage/v1`
const NEW_BASE = `https://${NEW_REF}.supabase.co/storage/v1`
const CONCURRENCY = 4
const DELETE_CHUNK = 100

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

function encodePath(name) {
  return name.split('/').map(encodeURIComponent).join('/')
}

// 옛 레거시 JWT 키라면 ref·role이 맞는지 확인한다(sb_secret 형식은 아래 버킷 조회로 확인)
function checkLegacyKey(key, ref, label) {
  const parts = key.split('.')
  if (parts.length !== 3) return
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  if (payload.ref !== ref || payload.role !== 'service_role') {
    throw new Error(`${label} 키가 ${ref}의 service_role 키가 아닙니다`)
  }
}

async function request(method, url, key, { body, extraHeaders } = {}) {
  const host = new URL(url).host
  if (method !== 'GET' && host !== `${NEW_REF}.supabase.co`) {
    throw new Error(`쓰기·삭제는 새 프로젝트에만 허용: ${method} ${host}`)
  }
  if (host.startsWith(`${OLD_REF}.`) && method !== 'GET') {
    throw new Error('옛 프로젝트에 대한 쓰기·삭제 거부')
  }
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(url, { method, headers: headers(key, extraHeaders), body })
    if (res.ok || attempt >= 3 || (res.status < 500 && res.status !== 429)) return res
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
  }
}

async function expectOk(res, what) {
  if (res.ok) return res
  const text = (await res.text()).slice(0, 300)
  throw new Error(`${what} 실패: HTTP ${res.status} ${text}`)
}

const readJson = (file) => JSON.parse(readFileSync(join(SYNC_DIR, file), 'utf8'))
const oldBuckets = readJson('old-buckets.json')
const newBuckets = readJson('new-buckets.json')
const oldObjects = readJson('old-objects.json')
const newObjects = readJson('new-objects.json')

checkLegacyKey(OLD_KEY, OLD_REF, '옛')
checkLegacyKey(NEW_KEY, NEW_REF, '새')
await expectOk(await request('GET', `${OLD_BASE}/bucket`, OLD_KEY), '옛 키 확인(버킷 목록)')
await expectOk(await request('GET', `${NEW_BASE}/bucket`, NEW_KEY), '새 키 확인(버킷 목록)')

// 1. 버킷: 같은 설정(public·크기·MIME)으로 만들거나 맞춘다
const sameBucket = (a, b) =>
  a.public === b.public &&
  (a.file_size_limit ?? null) === (b.file_size_limit ?? null) &&
  JSON.stringify(a.allowed_mime_types ?? null) === JSON.stringify(b.allowed_mime_types ?? null)

for (const bucket of oldBuckets) {
  const config = {
    public: bucket.public,
    file_size_limit: bucket.file_size_limit,
    allowed_mime_types: bucket.allowed_mime_types,
  }
  const existing = newBuckets.find((b) => b.id === bucket.id)
  if (!existing) {
    await expectOk(
      await request('POST', `${NEW_BASE}/bucket`, NEW_KEY, {
        body: JSON.stringify({ id: bucket.id, name: bucket.name, ...config }),
        extraHeaders: { 'content-type': 'application/json' },
      }),
      `버킷 생성 ${bucket.id}`
    )
    console.log(`  버킷 생성: ${bucket.id}`)
  } else if (!sameBucket(bucket, existing)) {
    await expectOk(
      await request('PUT', `${NEW_BASE}/bucket/${encodeURIComponent(bucket.id)}`, NEW_KEY, {
        body: JSON.stringify(config),
        extraHeaders: { 'content-type': 'application/json' },
      }),
      `버킷 설정 ${bucket.id}`
    )
    console.log(`  버킷 설정 맞춤: ${bucket.id}`)
  }
}
const extraBuckets = newBuckets.filter((b) => !oldBuckets.some((o) => o.id === b.id)).map((b) => b.id)
if (extraBuckets.length) console.log(`  [확인 필요] 새 쪽에만 있는 버킷(건드리지 않음): ${extraBuckets.join(', ')}`)

// 2. 차이: 없거나 크기가 다르거나, 옛 updated_at이 직전 동기화 기준 시각(옛 DB now())보다 늦은 것만 업로드
const key = (o) => `${o.bucket_id}\u0000${o.name}`
const newByKey = new Map(newObjects.map((o) => [key(o), o]))
const oldKeys = new Set(oldObjects.map(key))
const lastSync = LAST_SYNC ? new Date(LAST_SYNC) : null
if (LAST_SYNC && Number.isNaN(lastSync.getTime())) throw new Error(`LAST_SYNC 해석 불가: ${LAST_SYNC}`)

const toUpload = oldObjects.filter((o) => {
  const n = newByKey.get(key(o))
  if (!n) return true
  if (Number(n.size) !== Number(o.size)) return true
  return lastSync !== null && new Date(o.updated_at) > lastSync
})
// 새 쪽에만 있는 버킷은 건드리지 않으므로 옛 버킷 안의 객체만 삭제 후보로 둔다
const oldBucketIds = new Set(oldBuckets.map((b) => b.id))
const toDelete = newObjects.filter((o) => oldBucketIds.has(o.bucket_id) && !oldKeys.has(key(o)))
console.log(`  옛 ${oldObjects.length}개, 새 ${newObjects.length}개 → 업로드 ${toUpload.length}개, 새 쪽에만 있음 ${toDelete.length}개`)

// 3. 업로드
const failures = []
let done = 0
async function copyOne(o) {
  const path = `${encodeURIComponent(o.bucket_id)}/${encodePath(o.name)}`
  try {
    const down = await expectOk(await request('GET', `${OLD_BASE}/object/${path}`, OLD_KEY), `다운로드 ${o.bucket_id}/${o.name}`)
    const body = Buffer.from(await down.arrayBuffer())
    if (o.size != null && body.length !== Number(o.size)) {
      throw new Error(`크기 불일치 ${o.bucket_id}/${o.name}: DB ${o.size}, 받은 ${body.length}`)
    }
    const extraHeaders = { 'x-upsert': 'true', 'content-type': o.mimetype || 'application/octet-stream' }
    if (o.cache_control) extraHeaders['cache-control'] = o.cache_control
    await expectOk(await request('POST', `${NEW_BASE}/object/${path}`, NEW_KEY, { body, extraHeaders }), `업로드 ${o.bucket_id}/${o.name}`)
  } catch (error) {
    failures.push({ bucket_id: o.bucket_id, name: o.name, error: String(error.message ?? error) })
  }
  done += 1
  if (done % 50 === 0 || done === toUpload.length) console.log(`  업로드 진행 ${done}/${toUpload.length}`)
}
const started = Date.now()
const queue = [...toUpload]
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await copyOne(queue.shift())
  })
)
console.log(`  업로드 ${((Date.now() - started) / 1000).toFixed(0)}초`)

// 4. 새 쪽에만 있는 파일: 기본은 목록만, --apply-delete 일 때만 새 프로젝트에서 삭제
writeFileSync(join(SYNC_DIR, 'new-only.json'), JSON.stringify(toDelete.map((o) => ({ bucket_id: o.bucket_id, name: o.name })), null, 2))
if (toDelete.length) {
  for (const o of toDelete.slice(0, 20)) console.log(`  새 쪽에만 있음: ${o.bucket_id}/${o.name}`)
  if (toDelete.length > 20) console.log(`  … 외 ${toDelete.length - 20}개 (${join(SYNC_DIR, 'new-only.json')})`)
}
if (toDelete.length && APPLY_DELETE === '1') {
  // 직전 실행에서 목록으로 확인한 항목만 지운다
  const confirmed = new Set(JSON.parse(readFileSync(PREV_NEW_ONLY, 'utf8')).map(key))
  const deletable = toDelete.filter((o) => confirmed.has(key(o)))
  const skipped = toDelete.length - deletable.length
  if (skipped) console.log(`  직전 목록에 없던 ${skipped}개는 지우지 않음(다시 옵션 없이 실행해 확인)`)
  const byBucket = new Map()
  for (const o of deletable) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name])
  for (const [bucketId, names] of byBucket) {
    for (let i = 0; i < names.length; i += DELETE_CHUNK) {
      const prefixes = names.slice(i, i + DELETE_CHUNK)
      await expectOk(
        await request('DELETE', `${NEW_BASE}/object/${encodeURIComponent(bucketId)}`, NEW_KEY, {
          body: JSON.stringify({ prefixes }),
          extraHeaders: { 'content-type': 'application/json' },
        }),
        `삭제 ${bucketId}`
      )
    }
    console.log(`  새 프로젝트에서 삭제: ${bucketId} ${names.length}개`)
  }
} else if (toDelete.length) {
  console.log('  (삭제하지 않음. 목록을 확인한 뒤 --apply-delete 로 다시 실행)')
}

if (failures.length) {
  writeFileSync(join(SYNC_DIR, 'failures.json'), JSON.stringify(failures, null, 2))
  console.error(`  실패 ${failures.length}개 → ${join(SYNC_DIR, 'failures.json')}. 다시 실행하면 실패분만 다시 올립니다.`)
  process.exit(1)
}
