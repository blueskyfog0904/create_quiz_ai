import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const OWNER = '[studio-design-system-fixture]'
const STORAGE_PREFIX = 'studio-design-system-fixture/'
const STORAGE_BUCKET = 'market-files'
const LEASE_TTL_MS = 45_000
const DEFAULT_EVIDENCE_DIR = resolve('.omx/evidence/studio-design-system')
const RECOVERY_TEST_ADAPTER_FILE = 'recovery-adapter.json'

const categoryFixtures = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceSubject: 'english',
    subjectCode: 'english',
    entryKey: 'studio-en-fixture',
    slug: 'studio-en-fixture',
    title: 'Studio English Fixture',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    workspaceSubject: 'korean',
    subjectCode: 'korean',
    entryKey: 'studio-ko-fixture',
    slug: 'studio-ko-fixture',
    title: 'Studio Korean Fixture',
  },
]

const englishItemIds = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000110',
  '00000000-0000-4000-8000-000000000111',
]

const koreanItemIds = [
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000204',
  '00000000-0000-4000-8000-000000000205',
  '00000000-0000-4000-8000-000000000206',
  '00000000-0000-4000-8000-000000000207',
  '00000000-0000-4000-8000-000000000208',
  '00000000-0000-4000-8000-000000000209',
  '00000000-0000-4000-8000-000000000210',
  '00000000-0000-4000-8000-000000000211',
]

const publishedAtFixtures = [
  '2027-01-01T00:00:00.000Z',
  '2027-01-02T00:00:00.000Z',
  '2027-01-03T00:00:00.000Z',
  '2027-01-04T00:00:00.000Z',
  '2027-01-05T00:00:00.000Z',
  '2027-01-06T00:00:00.000Z',
  '2027-01-07T00:00:00.000Z',
  '2027-01-08T00:00:00.000Z',
  '2027-01-09T00:00:00.000Z',
  '2027-01-10T00:00:00.000Z',
  '2030-01-01T00:00:00.000Z',
]

const itemFixtures = [
  ...englishItemIds.map((id, index) => ({
    id,
    categoryId: categoryFixtures[0].id,
    workspaceSubject: 'english',
    title: `Studio English material ${index + 1}`,
    gradeLevel: index % 2 === 0 ? '고1' : '고2',
    publishedAt: publishedAtFixtures[index],
  })),
  ...koreanItemIds.map((id, index) => ({
    id,
    categoryId: categoryFixtures[1].id,
    workspaceSubject: 'korean',
    title: `Studio Korean material ${index + 1}`,
    gradeLevel: index % 2 === 0 ? '고1' : '고2',
    publishedAt: publishedAtFixtures[index],
  })),
]

const sampleFixtures = [
  {
    id: '00000000-0000-4000-8000-000000000301',
    itemId: '00000000-0000-4000-8000-000000000111',
    workspaceSubject: 'english',
  },
  {
    id: '00000000-0000-4000-8000-000000000401',
    itemId: '00000000-0000-4000-8000-000000000211',
    workspaceSubject: 'korean',
  },
]

const marketFileFixtures = [
  {
    id: '00000000-0000-4000-8000-000000000501',
    itemId: '00000000-0000-4000-8000-000000000111',
    sampleId: '00000000-0000-4000-8000-000000000301',
    workspaceSubject: 'english',
  },
  {
    id: '00000000-0000-4000-8000-000000000601',
    itemId: '00000000-0000-4000-8000-000000000211',
    sampleId: '00000000-0000-4000-8000-000000000401',
    workspaceSubject: 'korean',
  },
]

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command, runId: '', absent: false, scenario: '' }

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--run-id') {
      options.runId = rest[index + 1] ?? ''
      index += 1
    } else if (rest[index] === '--absent') {
      options.absent = true
    } else if (rest[index] === '--scenario') {
      options.scenario = rest[index + 1] ?? ''
      index += 1
    } else {
      throw new Error(`Unknown argument: ${rest[index]}`)
    }
  }

  if (!['seed', 'verify', 'heartbeat', 'cleanup', 'recover', 'test-recovery-prepare'].includes(command)) {
    throw new Error('Command must be one of seed, verify, heartbeat, cleanup, recover')
  }
  if (!options.runId || !/^[A-Za-z0-9_-]+$/.test(options.runId)) {
    throw new Error('--run-id is required and must contain only letters, numbers, underscore, or dash')
  }
  return options
}

function evidencePaths() {
  const evidenceDir = resolve(process.env.STUDIO_FIXTURE_EVIDENCE_DIR || DEFAULT_EVIDENCE_DIR)
  mkdirSync(evidenceDir, { recursive: true })
  return {
    evidenceDir,
    leasePath: join(evidenceDir, 'fixture.lease.json'),
    ledgerPath: join(evidenceDir, 'fixture.json'),
    recoveryAdapterPath: join(evidenceDir, RECOVERY_TEST_ADAPTER_FILE),
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, path)
}

function ownershipMarker(runId) {
  return `${OWNER}:${runId}`
}

function isPidPresent(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function isLeaseFresh(lease) {
  const heartbeatTime = Date.parse(lease.heartbeatAt)
  return Number.isFinite(heartbeatTime) && Date.now() - heartbeatTime <= LEASE_TTL_MS
}

function ownerPid() {
  const configured = Number(process.env.STUDIO_FIXTURE_OWNER_PID)
  return Number.isInteger(configured) && configured > 0 ? configured : process.pid
}

function assertLeaseOwner(lease, runId) {
  if (lease.runId !== runId || lease.pid !== ownerPid()) {
    throw new Error('Active fixture lease belongs to another run or PID')
  }
}

function acquireLease(leasePath, runId) {
  const now = new Date().toISOString()
  const lease = { runId, pid: ownerPid(), startedAt: now, heartbeatAt: now }
  try {
    writeFileSync(leasePath, `${JSON.stringify(lease, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    return lease
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let existingLease
    try {
      existingLease = readJson(leasePath)
    } catch {
      throw new Error('Active fixture lease is being created; refusing competing run')
    }
    if (existingLease.runId === runId && existingLease.pid === ownerPid()) return existingLease
    if (isPidPresent(existingLease.pid) || isLeaseFresh(existingLease)) {
      throw new Error('Active fixture lease already exists; refusing competing run')
    }
    throw new Error('Stale fixture lease requires explicit recover before seed')
  }
}

function requireOwnedLease(leasePath, runId) {
  if (!existsSync(leasePath)) throw new Error('Active fixture lease is required')
  const lease = readJson(leasePath)
  assertLeaseOwner(lease, runId)
  return lease
}

function assertStaleLeaseForRecovery(leasePath, runId) {
  if (!existsSync(leasePath)) throw new Error('Recovery requires an existing fixture lease')
  const lease = readJson(leasePath)
  if (lease.runId !== runId) throw new Error('Recovery run id does not match fixture lease')
  if (isPidPresent(lease.pid) || isLeaseFresh(lease)) {
    throw new Error('Recovery refused: lease is active or not stale')
  }
  return lease
}

function loadLocalEnvironment() {
  if (process.env.NODE_ENV !== 'test' || process.env.STUDIO_FIXTURE_LOAD_ENV === '1') {
    config({ path: resolve('.env.local'), quiet: true })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('Required env NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing')
  }

  const parsed = new URL(url)
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'supabase.co' || hostname.endsWith('.supabase.co')) {
    throw new Error('Remote .supabase.co mutation is always refused')
  }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('Fixture mutation is restricted to literal localhost or 127.0.0.1 hosts')
  }
  return { url, serviceRoleKey }
}

function recoveryTestAdapterEnabled() {
  return process.env.NODE_ENV === 'test'
    && process.env.STUDIO_FIXTURE_RECOVERY_TEST_ADAPTER === '1'
}

function assertRecoveryTestAdapterEnabled() {
  if (!recoveryTestAdapterEnabled()) {
    throw new Error(
      'Recovery test adapter is refused unless NODE_ENV=test and the explicit adapter env is enabled'
    )
  }
}

function makeRecoveryTestSupabase(paths) {
  assertRecoveryTestAdapterEnabled()
  const readState = () => readJson(paths.recoveryAdapterPath)
  const writeState = (state) => atomicWriteJson(paths.recoveryAdapterPath, state)

  return {
    from(table) {
      if (table !== 'market_items') {
        throw new Error(`Recovery test adapter refuses unsupported table ${table}`)
      }
      return {
        select() {
          return {
            eq(column, id) {
              if (column !== 'id') throw new Error('Recovery test adapter only supports exact id lookup')
              return {
                async maybeSingle() {
                  const row = readState().store.find((entry) => entry.id === id) ?? null
                  return { data: row, error: null }
                },
              }
            },
          }
        },
        delete() {
          return {
            async eq(column, id) {
              if (column !== 'id') throw new Error('Recovery test adapter only supports exact id deletion')
              const state = readState()
              const index = state.store.findIndex((entry) => entry.id === id)
              if (index !== -1) state.store.splice(index, 1)
              state.removalOrder.push(id)
              writeState(state)
              return { error: null }
            },
          }
        },
      }
    },
  }
}

function makeSupabase(paths) {
  if (recoveryTestAdapterEnabled()) return makeRecoveryTestSupabase(paths)
  const { url, serviceRoleKey } = loadLocalEnvironment()
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function newLedger(runId) {
  const marker = ownershipMarker(runId)
  return {
    version: 1,
    ownership: marker,
    runId,
    createdAt: new Date().toISOString(),
    credentials: null,
    resources: [],
  }
}

function readOwnedLedger(ledgerPath, runId) {
  if (!existsSync(ledgerPath)) throw new Error('fixture.json ledger is missing')
  const ledger = readJson(ledgerPath)
  if (ledger.runId !== runId || ledger.ownership !== ownershipMarker(runId)) {
    throw new Error('Fixture ledger ownership or run id does not match')
  }
  return ledger
}

function recordIntent(ledgerPath, ledger, resource) {
  if (resource.runId !== ledger.runId || resource.ownership !== ledger.ownership) {
    throw new Error('Resource intent ownership must match the exact fixture run')
  }
  ledger.resources.push({ ...resource, state: 'intent', recordedAt: new Date().toISOString() })
  atomicWriteJson(ledgerPath, ledger)
  return ledger.resources.length - 1
}

function markCreated(ledgerPath, ledger, index) {
  ledger.resources[index].state = 'created'
  ledger.resources[index].createdAt = new Date().toISOString()
  atomicWriteJson(ledgerPath, ledger)
}

function markRemoved(ledgerPath, ledger, resource) {
  resource.state = 'removed'
  resource.removedAt = new Date().toISOString()
  atomicWriteJson(ledgerPath, ledger)
}

function ensureNoError(label, error) {
  if (error) throw new Error(`${label}: ${error.message}`)
}

async function listAuthUserByEmail(supabase, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    ensureNoError('list auth users', error)
    const match = data.users.find((user) => user.email === email)
    if (match) return match
    if (data.users.length < 1000) return null
  }
  throw new Error('Auth user preflight exceeded the supported local pagination range')
}

async function selectRowsByIds(supabase, table, ids, columns = '*') {
  const { data, error } = await supabase.from(table).select(columns).in('id', ids)
  ensureNoError(`select ${table}`, error)
  return data ?? []
}

async function assertStoragePathAbsent(supabase, path) {
  const directory = dirname(path)
  const objectName = basename(path)
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(directory, {
    search: objectName,
    limit: 100,
  })
  ensureNoError(`storage list ${directory}`, error)
  if ((data ?? []).some((entry) => entry.name === objectName)) {
    throw new Error(`Storage collision: ${path} is already present`)
  }
}

async function storageObjectExists(supabase, path) {
  const directory = dirname(path)
  const objectName = basename(path)
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(directory, {
    search: objectName,
    limit: 100,
  })
  ensureNoError(`storage list ${directory}`, error)
  return (data ?? []).some((entry) => entry.name === objectName)
}

function fixtureStoragePath(runId, sample) {
  const path = `${STORAGE_PREFIX}${runId}/${sample.workspaceSubject}/${sample.id}/pdf-icon.png`
  assertOwnedStoragePath(runId, path)
  return path
}

function assertOwnedStoragePath(runId, path) {
  const exactRunPrefix = `${STORAGE_PREFIX}${runId}/`
  const normalizedPath = posix.normalize(path)
  if (
    normalizedPath !== path
    || !normalizedPath.startsWith(exactRunPrefix)
    || normalizedPath === exactRunPrefix
  ) {
    throw new Error(`Storage path is outside the exact fixture run prefix: ${path}`)
  }
  return normalizedPath
}

async function preflightCreateOnly(supabase, runId, email) {
  const categoryIds = categoryFixtures.map((entry) => entry.id)
  const itemIds = itemFixtures.map((item) => item.id)
  const sampleIds = sampleFixtures.map((sample) => sample.id)
  const marketFileIds = marketFileFixtures.map((file) => file.id)
  const collisions = []

  collisions.push(...await selectRowsByIds(supabase, 'market_menu_entries', categoryIds, 'id'))
  collisions.push(...await selectRowsByIds(supabase, 'market_items', itemIds, 'id'))
  collisions.push(...await selectRowsByIds(supabase, 'market_item_sample_pages', sampleIds, 'id'))
  collisions.push(...await selectRowsByIds(supabase, 'market_item_files', marketFileIds, 'id'))

  for (const field of ['entry_key', 'slug']) {
    const { data, error } = await supabase
      .from('market_menu_entries')
      .select(`id,${field}`)
      .in(field, categoryFixtures.map((entry) => entry[field === 'entry_key' ? 'entryKey' : 'slug']))
    ensureNoError(`preflight market_menu_entries.${field}`, error)
    collisions.push(...(data ?? []))
  }

  if (await listAuthUserByEmail(supabase, email)) collisions.push({ email })
  for (const sample of sampleFixtures) {
    await assertStoragePathAbsent(supabase, fixtureStoragePath(runId, sample))
  }

  if (collisions.length > 0) {
    throw new Error('Create-only collision: fixture identity already exists or is a foreign row')
  }
}

async function seed(paths, runId) {
  acquireLease(paths.leasePath, runId)
  const supabase = makeSupabase(paths)
  const marker = ownershipMarker(runId)
  const email = `studio-design-system+${runId}@local.test`
  const password = randomBytes(24).toString('base64url')
  await preflightCreateOnly(supabase, runId, email)

  const ledger = newLedger(runId)
  ledger.credentials = { email, password }
  atomicWriteJson(paths.ledgerPath, ledger)

  let intentIndex = recordIntent(paths.ledgerPath, ledger, {
    type: 'auth-user',
    runId,
    email,
    ownership: marker,
  })
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: 'Studio Fixture',
      phone: '01000000000',
      provider: 'email',
      signup_completed: true,
      ownership: marker,
    },
  })
  ensureNoError('create fixture auth user', userError)
  if (!userData.user) throw new Error('create fixture auth user returned no user')
  ledger.resources[intentIndex].id = userData.user.id
  markCreated(paths.ledgerPath, ledger, intentIndex)

  for (const category of categoryFixtures) {
    intentIndex = recordIntent(paths.ledgerPath, ledger, {
      type: 'market-menu-entry',
      id: category.id,
      entryKey: category.entryKey,
      slug: category.slug,
      runId,
      ownership: marker,
    })
    const { error } = await supabase.from('market_menu_entries').insert({
      id: category.id,
      entry_key: category.entryKey,
      slug: category.slug,
      workspace_subject: category.workspaceSubject,
      subject_code: category.subjectCode,
      title: category.title,
      description: marker,
      sort_order: 990,
      is_visible: true,
      is_active: true,
      search_config: {},
    })
    ensureNoError(`create market category ${category.id}`, error)
    markCreated(paths.ledgerPath, ledger, intentIndex)
  }

  for (const [index, item] of itemFixtures.entries()) {
    intentIndex = recordIntent(paths.ledgerPath, ledger, {
      type: 'market-item',
      runId,
      id: item.id,
      categoryId: item.categoryId,
      ownership: marker,
    })
    const { error } = await supabase.from('market_items').insert({
      id: item.id,
      menu_entry_id: item.categoryId,
      workspace_subject: item.workspaceSubject,
      title: item.title,
      summary: 'Deterministic Studio board row',
      description: marker,
      exam_year: 2027,
      exam_month: index % 2 === 0 ? 3 : 6,
      grade_level: item.gradeLevel,
      source_type: 'fixture',
      source_1: item.workspaceSubject === 'english' ? '영어' : '국어',
      pdf_price: 10,
      hwp_price: 20,
      sort_order: itemFixtures.length - index,
      status: 'published',
      is_active: true,
      published_at: item.publishedAt,
      created_at: item.publishedAt,
      updated_at: item.publishedAt,
      question_count: 20 + index,
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })
    ensureNoError(`create market item ${item.id}`, error)
    markCreated(paths.ledgerPath, ledger, intentIndex)
  }

  const sampleAsset = readFileSync(resolve('public/icons/file-types/pdf-icon.png'))
  for (const sample of sampleFixtures) {
    const storagePath = fixtureStoragePath(runId, sample)
    await assertStoragePathAbsent(supabase, storagePath)
    intentIndex = recordIntent(paths.ledgerPath, ledger, {
      type: 'storage-object',
      runId,
      bucket: STORAGE_BUCKET,
      path: storagePath,
      ownership: marker,
    })
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, sampleAsset, { contentType: 'image/png', upsert: false })
    ensureNoError(`create storage object ${storagePath}`, uploadError)
    markCreated(paths.ledgerPath, ledger, intentIndex)

    intentIndex = recordIntent(paths.ledgerPath, ledger, {
      type: 'market-sample-page',
      runId,
      id: sample.id,
      itemId: sample.itemId,
      path: storagePath,
      ownership: marker,
    })
    const { error: sampleError } = await supabase.from('market_item_sample_pages').insert({
      id: sample.id,
      item_id: sample.itemId,
      workspace_subject: sample.workspaceSubject,
      page_number: 1,
      display_order: 1,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: marker,
      mime_type: 'image/png',
      file_size_bytes: sampleAsset.byteLength,
      status: 'active',
      committed_at: new Date().toISOString(),
      is_active: true,
      created_by: userData.user.id,
    })
    ensureNoError(`create market sample ${sample.id}`, sampleError)
    markCreated(paths.ledgerPath, ledger, intentIndex)

    const marketFile = marketFileFixtures.find((file) => file.sampleId === sample.id)
    if (!marketFile) throw new Error(`Missing market file fixture for sample ${sample.id}`)
    intentIndex = recordIntent(paths.ledgerPath, ledger, {
      type: 'market-item-file',
      runId,
      id: marketFile.id,
      itemId: marketFile.itemId,
      path: storagePath,
      ownership: marker,
    })
    const { error: fileError } = await supabase.from('market_item_files').insert({
      id: marketFile.id,
      item_id: marketFile.itemId,
      workspace_subject: marketFile.workspaceSubject,
      asset_kind: 'pdf',
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: marker,
      mime_type: 'image/png',
      file_size_bytes: sampleAsset.byteLength,
      version: 1,
      is_active: true,
      created_by: userData.user.id,
    })
    ensureNoError(`create market item file ${marketFile.id}`, fileError)
    markCreated(paths.ledgerPath, ledger, intentIndex)
  }

  console.log(JSON.stringify({ ok: true, command: 'seed', runId, ledger: paths.ledgerPath }))
}

async function inspectResource(supabase, resource) {
  const marker = ownershipMarker(resource.runId)
  if (resource.ownership !== marker) return { exists: true, owned: false }

  if (resource.type === 'auth-user') {
    const user = await listAuthUserByEmail(supabase, resource.email)
    if (!user) return { exists: false }
    const idMatches = resource.id == null || user.id === resource.id
    const owned = idMatches
      && user.email === resource.email
      && user.user_metadata?.ownership === marker
    return { exists: true, owned, row: user }
  }
  if (resource.type === 'storage-object') {
    try {
      assertOwnedStoragePath(resource.runId, resource.path)
    } catch {
      return { exists: true, owned: false }
    }
    const exists = await storageObjectExists(supabase, resource.path)
    return {
      exists,
      owned: resource.bucket === STORAGE_BUCKET
        && resource.path.startsWith(`${STORAGE_PREFIX}${resource.runId}/`),
    }
  }

  const table = {
    'market-menu-entry': 'market_menu_entries',
    'market-item': 'market_items',
    'market-sample-page': 'market_item_sample_pages',
    'market-item-file': 'market_item_files',
  }[resource.type]
  const { data, error } = await supabase.from(table).select('*').eq('id', resource.id).maybeSingle()
  ensureNoError(`inspect ${resource.type}`, error)
  if (!data) return { exists: false }

  if (resource.type === 'market-menu-entry') {
    return {
      exists: true,
      owned: data.description === marker
        && data.entry_key === resource.entryKey
        && data.slug === resource.slug,
      row: data,
    }
  }
  if (resource.type === 'market-item') {
    return {
      exists: true,
      owned: data.description === marker && data.menu_entry_id === resource.categoryId,
      row: data,
    }
  }
  const owned = data.item_id === resource.itemId
    && data.storage_path === resource.path
    && data.original_file_name === marker
  return { exists: true, owned, row: data }
}

async function removeOwnedResource(supabase, resource) {
  const inspection = await inspectResource(supabase, resource)
  if (!inspection.exists) return
  if (!inspection.owned) {
    throw new Error(`Ownership verification refused deletion of ${resource.type} ${resource.id ?? resource.path}`)
  }

  if (resource.type === 'auth-user') {
    const { error } = await supabase.auth.admin.deleteUser(inspection.row.id)
    ensureNoError('delete exact fixture auth user', error)
    return
  }
  if (resource.type === 'storage-object') {
    const { error } = await supabase.storage.from(resource.bucket).remove([resource.path])
    ensureNoError(`delete exact storage object ${resource.path}`, error)
    return
  }

  const table = {
    'market-menu-entry': 'market_menu_entries',
    'market-item': 'market_items',
    'market-sample-page': 'market_item_sample_pages',
    'market-item-file': 'market_item_files',
  }[resource.type]
  const { error } = await supabase.from(table).delete().eq('id', resource.id)
  ensureNoError(`delete exact ${resource.type} ${resource.id}`, error)
}

async function verify(paths, runId, absent) {
  requireOwnedLease(paths.leasePath, runId)
  const supabase = makeSupabase(paths)
  const ledger = readOwnedLedger(paths.ledgerPath, runId)

  for (const resource of ledger.resources) {
    if (!absent && resource.state === 'removed') {
      throw new Error(`Fixture resource was removed before present verification: ${resource.type}`)
    }
    const inspection = await inspectResource(supabase, resource)
    if (absent && inspection.exists) {
      throw new Error(`Expected absent resource is still present: ${resource.type}`)
    }
    if (!absent && (!inspection.exists || !inspection.owned)) {
      throw new Error(`Fixture resource is missing or foreign: ${resource.type}`)
    }
  }
  console.log(JSON.stringify({ ok: true, command: 'verify', absent, runId }))
}

async function cleanupResources(paths, runId, { staleRecovery = false } = {}) {
  if (staleRecovery) assertStaleLeaseForRecovery(paths.leasePath, runId)
  else requireOwnedLease(paths.leasePath, runId)

  const supabase = makeSupabase(paths)
  const ledger = readOwnedLedger(paths.ledgerPath, runId)
  const resources = [...ledger.resources].reverse()
  for (const resource of resources) {
    if (resource.state === 'removed') continue
    await removeOwnedResource(supabase, resource)
    markRemoved(paths.ledgerPath, ledger, resource)
  }

  if (staleRecovery) {
    for (const resource of ledger.resources) {
      const inspection = await inspectResource(supabase, resource)
      if (inspection.exists) throw new Error(`Recovery verify absent failed: ${resource.type}`)
    }
    unlinkSync(paths.leasePath)
  }
  console.log(JSON.stringify({ ok: true, command: staleRecovery ? 'recover' : 'cleanup', runId }))
}

function heartbeat(paths, runId) {
  const lease = requireOwnedLease(paths.leasePath, runId)
  lease.heartbeatAt = new Date().toISOString()
  atomicWriteJson(paths.leasePath, lease)
  console.log(JSON.stringify({ ok: true, command: 'heartbeat', runId }))
}

function prepareInterruptedRecoveryTest(paths, runId, scenario) {
  assertRecoveryTestAdapterEnabled()
  if (!['interrupted', 'active', 'foreign'].includes(scenario)) {
    throw new Error('Recovery test scenario must be interrupted, active, or foreign')
  }

  const marker = ownershipMarker(runId)
  const categoryId = 'recovery-test-category'
  const active = scenario === 'active'
  const foreign = scenario === 'foreign'
  const now = new Date()
  const stale = new Date(now.getTime() - LEASE_TTL_MS - 5_000).toISOString()
  atomicWriteJson(paths.leasePath, {
    runId,
    pid: active ? process.ppid : 2_147_483_647,
    startedAt: active ? now.toISOString() : stale,
    heartbeatAt: active ? now.toISOString() : stale,
  })

  const ledger = newLedger(runId)
  atomicWriteJson(paths.ledgerPath, ledger)
  const fixtureResources = foreign
    ? [{ id: 'foreign-ledger-resource', state: 'intent' }]
    : [
        { id: 'owned-created', state: 'created' },
        { id: 'owned-intent', state: 'intent' },
      ]
  for (const fixtureResource of fixtureResources) {
    const index = recordIntent(paths.ledgerPath, ledger, {
      type: 'market-item',
      runId,
      id: fixtureResource.id,
      categoryId,
      ownership: marker,
    })
    if (fixtureResource.state === 'created') {
      markCreated(paths.ledgerPath, ledger, index)
    }
  }
  atomicWriteJson(paths.recoveryAdapterPath, {
    runId,
    resources: ledger.resources,
    removalOrder: [],
    store: [
      ...fixtureResources.map((resource) => ({
        id: resource.id,
        description: foreign ? 'foreign-owner' : marker,
        menu_entry_id: categoryId,
      })),
      {
        id: 'untracked-foreign',
        description: 'foreign-owner',
        menu_entry_id: 'foreign-category',
      },
    ],
  })
  throw new Error('Simulated interruption after durable intent recording')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const paths = evidencePaths()

  if (options.command === 'test-recovery-prepare') {
    prepareInterruptedRecoveryTest(paths, options.runId, options.scenario)
  } else if (options.command === 'seed') await seed(paths, options.runId)
  else if (options.command === 'verify') await verify(paths, options.runId, options.absent)
  else if (options.command === 'heartbeat') heartbeat(paths, options.runId)
  else if (options.command === 'cleanup') await cleanupResources(paths, options.runId)
  else if (options.command === 'recover') {
    await cleanupResources(paths, options.runId, { staleRecovery: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
