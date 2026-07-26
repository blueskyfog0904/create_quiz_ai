import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const fixtureScriptPath = 'scripts/studio-browser-fixture.mjs'
const orchestratorScriptPath = 'scripts/studio-browser-verify.mjs'
const fixtureScriptExists = existsSync(fixtureScriptPath)
const orchestratorScriptExists = existsSync(orchestratorScriptPath)
const scriptsExist = fixtureScriptExists && orchestratorScriptExists

const categoryIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
]
const englishItemIds = Array.from(
  { length: 11 },
  (_, index) => `00000000-0000-4000-8000-000000000${101 + index}`
)
const koreanItemIds = Array.from(
  { length: 11 },
  (_, index) => `00000000-0000-4000-8000-000000000${201 + index}`
)
const sampleIds = [
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401',
]
const marketFileIds = [
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000601',
]

function readScripts() {
  return {
    fixture: readFileSync(fixtureScriptPath, 'utf8'),
    orchestrator: readFileSync(orchestratorScriptPath, 'utf8'),
  }
}

function runFixture(args, { evidenceDir, env = {} } = {}) {
  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    STUDIO_FIXTURE_EVIDENCE_DIR: evidenceDir,
    ...env,
  }

  return spawnSync(process.execPath, [fixtureScriptPath, ...args], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: 'utf8',
    timeout: 5_000,
  })
}

function childOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

function withEvidenceDir(run) {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'studio-fixture-contract-'))
  try {
    return run(evidenceDir)
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true })
  }
}

async function withEvidenceDirAsync(run) {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'studio-fixture-contract-'))
  try {
    return await run(evidenceDir)
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true })
  }
}

function spawnFixture(args, evidenceDir) {
  const childEnv = { ...process.env }
  delete childEnv.NEXT_PUBLIC_SUPABASE_URL
  delete childEnv.SUPABASE_URL
  delete childEnv.SUPABASE_SERVICE_ROLE_KEY
  const child = spawn(process.execPath, [fixtureScriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...childEnv,
      NODE_ENV: 'test',
      STUDIO_FIXTURE_EVIDENCE_DIR: evidenceDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, output: () => output }
}

function runRecoveryHarness(args, evidenceDir, { enabled = true } = {}) {
  return spawnSync(process.execPath, [fixtureScriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STUDIO_FIXTURE_EVIDENCE_DIR: evidenceDir,
      ...(enabled ? { STUDIO_FIXTURE_RECOVERY_TEST_ADAPTER: '1' } : {}),
    },
    encoding: 'utf8',
    timeout: 5_000,
  })
}

test('the deterministic fixture and sole browser orchestrator scripts exist', () => {
  assert.equal(
    fixtureScriptExists,
    true,
    `${fixtureScriptPath} must implement the low-level fixture lifecycle`
  )
  assert.equal(
    orchestratorScriptExists,
    true,
    `${orchestratorScriptPath} must be the sole normal browser verification entrypoint`
  )
})

test('fixture identity is exact, subject-separated, owned, and create-only', { skip: !scriptsExist }, () => {
  const { fixture } = readScripts()

  for (const id of [...categoryIds, ...englishItemIds, ...koreanItemIds, ...sampleIds, ...marketFileIds]) {
    assert.match(fixture, new RegExp(id), `${id} must be an explicit fixture identity`)
  }
  for (const slug of ['studio-en-fixture', 'studio-ko-fixture']) {
    assert.match(
      fixture,
      new RegExp(`(?:entryKey|entry_key|slug)[\\s\\S]{0,120}['"]${slug}['"]`),
      `${slug} must be a distinct entry key and slug`
    )
  }
  assert.match(fixture, /\[studio-design-system-fixture\]/)
  assert.match(fixture, /studio-design-system-fixture\//)
  assert.match(fixture, /studio-design-system\+\$\{runId\}@local\.test/)
  assert.match(fixture, /randomBytes|randomUUID/)
  assert.match(fixture, /collision|already exists|already present|foreign row/i)
  assert.match(fixture, /create-only|create only|absent-only|absent only/i)
  assert.doesNotMatch(fixture, /\.upsert\s*\(/)
  assert.doesNotMatch(fixture, /\.update\s*\(/)
})

test('run ids cannot contain dot segments and lease acquisition is atomic and exclusive', { skip: !scriptsExist }, async () => {
  const { fixture } = readScripts()
  assert.match(fixture, /\^\[A-Za-z0-9_\-\]\+\$/)
  assert.match(fixture, /flag:\s*['"]wx['"]/)
  assert.match(fixture, /EEXIST/)

  withEvidenceDir((evidenceDir) => {
    for (const runId of ['.', '..', 'a.b', '../escape', 'safe..unsafe']) {
      const result = runFixture(['seed', '--run-id', runId], { evidenceDir })
      assert.notEqual(result.status, 0)
      assert.match(childOutput(result), /run.id|letters|numbers|underscore|dash|invalid/i)
    }
    assert.equal(existsSync(join(evidenceDir, 'fixture.lease.json')), false)
  })

  await withEvidenceDirAsync(async (evidenceDir) => {
    const left = spawnFixture(['seed', '--run-id', 'concurrent-left'], evidenceDir)
    const right = spawnFixture(['seed', '--run-id', 'concurrent-right'], evidenceDir)
    const [[leftCode], [rightCode]] = await Promise.all([
      once(left.child, 'exit'),
      once(right.child, 'exit'),
    ])
    assert.notEqual(leftCode, 0)
    assert.notEqual(rightCode, 0)
    const combined = `${left.output()}\n${right.output()}`
    assert.match(combined, /required env/i)
    assert.match(combined, /active.*lease|lease.*active|already.*running/i)
    const lease = JSON.parse(readFileSync(join(evidenceDir, 'fixture.lease.json'), 'utf8'))
    assert.ok(['concurrent-left', 'concurrent-right'].includes(lease.runId))
  })
})

test('ownership is scoped to the exact run and auth intent recovery remains fail closed', { skip: !scriptsExist }, () => {
  const { fixture } = readScripts()
  assert.match(fixture, /`\$\{OWNER\}:\$\{runId\}`/)
  assert.match(fixture, /resource\.ownership\s*===\s*marker|resource\.ownership\s*!==\s*marker/)
  assert.match(fixture, /user\.user_metadata\?\.ownership\s*===\s*marker/)
  assert.match(fixture, /resource\.id\s*==\s*null|!resource\.id/)
  assert.match(fixture, /inspection\.row\.id/)
  assert.match(fixture, /normalize|normalized/i)
  assert.match(fixture, /STORAGE_PREFIX[\s\S]{0,260}runId[\s\S]{0,260}startsWith/)
  assert.doesNotMatch(fixture, /description:\s*`?\$\{OWNER\}(?!:)/)
  assert.equal(fixture.match(/description:\s*marker/g)?.length, 2)
  assert.equal(fixture.match(/original_file_name:\s*marker/g)?.length, 2)
  const removalStart = fixture.indexOf('async function removeOwnedResource')
  const ownershipRefusal = fixture.indexOf('if (!inspection.owned)', removalStart)
  const exactDelete = fixture.indexOf(".delete().eq('id', resource.id)", removalStart)
  assert.ok(removalStart >= 0 && ownershipRefusal > removalStart && exactDelete > ownershipRefusal)
})

test('page-one sample items include owned PDF file fixtures and deterministic dates', { skip: !scriptsExist }, () => {
  const { fixture } = readScripts()
  for (const id of marketFileIds) assert.match(fixture, new RegExp(id))
  assert.match(fixture, new RegExp(`itemId:\\s*['"]${englishItemIds.at(-1)}['"]`))
  assert.match(fixture, new RegExp(`itemId:\\s*['"]${koreanItemIds.at(-1)}['"]`))
  assert.match(fixture, /type:\s*['"]market-item-file['"]/)
  assert.match(fixture, /from\(['"]market_item_files['"]\)\.insert/)
  assert.match(fixture, /published_at:\s*item\.publishedAt/)
  assert.match(fixture, /publishedAtFixtures[\s\S]{0,800}['"]2030-01-01T00:00:00\.000Z['"]/)
})

test('fixture mutations fail closed outside literal local Supabase hosts', { skip: !scriptsExist }, () => {
  const { fixture } = readScripts()

  assert.match(fixture, /NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(fixture, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(fixture, /hostname/)
  assert.match(fixture, /127\.0\.0\.1/)
  assert.match(fixture, /localhost/)
  assert.match(fixture, /\.supabase\.co/)

  withEvidenceDir((evidenceDir) => {
    const missingEnv = { ...process.env }
    delete missingEnv.NEXT_PUBLIC_SUPABASE_URL
    delete missingEnv.SUPABASE_URL
    delete missingEnv.SUPABASE_SERVICE_ROLE_KEY
    const missingResult = spawnSync(
      process.execPath,
      [fixtureScriptPath, 'seed', '--run-id', 'missing-env-contract'],
      {
        cwd: process.cwd(),
        env: {
          ...missingEnv,
          NODE_ENV: 'test',
          STUDIO_FIXTURE_EVIDENCE_DIR: evidenceDir,
        },
        encoding: 'utf8',
        timeout: 5_000,
      }
    )
    assert.notEqual(missingResult.status, 0)
    assert.match(childOutput(missingResult), /NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|required env/i)
  })

  withEvidenceDir((evidenceDir) => {
    const remoteResult = runFixture(
      ['seed', '--run-id', 'remote-host-contract'],
      {
        evidenceDir,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://fixture-contract.supabase.co',
          SUPABASE_URL: 'https://fixture-contract.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'fixture-contract-key',
        },
      }
    )
    assert.notEqual(remoteResult.status, 0)
    assert.match(childOutput(remoteResult), /localhost|127\.0\.0\.1|remote|supabase\.co|refus/i)
  })
})

test('fixture lease requires the same run id and PID plus TTL freshness', { skip: !scriptsExist }, () => {
  const { fixture, orchestrator } = readScripts()

  for (const token of ['fixture.lease.json', 'runId', 'pid', 'startedAt', 'heartbeatAt']) {
    assert.match(`${fixture}\n${orchestrator}`, new RegExp(token.replace('.', '\\.')))
  }
  assert.match(fixture, /LEASE_TTL|leaseTtl|ttl/i)
  assert.match(fixture, /process\.kill\s*\([^,]+,\s*0\s*\)/)
  assert.match(fixture, /heartbeat/)
  assert.match(orchestrator, /10_?000/)
  assert.match(orchestrator, /setInterval\s*\(/)

  withEvidenceDir((evidenceDir) => {
    const leasePath = join(evidenceDir, 'fixture.lease.json')
    const localEnv = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-contract-key',
    }

    writeFileSync(
      leasePath,
      JSON.stringify({
        runId: 'active-owner',
        pid: process.pid,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })
    )
    const activeResult = runFixture(
      ['seed', '--run-id', 'competing-run'],
      { evidenceDir, env: localEnv }
    )
    assert.notEqual(activeResult.status, 0)
    assert.match(childOutput(activeResult), /active.*lease|lease.*active|already.*running/i)

    for (const lease of [
      {
        runId: 'recent-dead-owner',
        pid: 2_147_483_647,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        heartbeatAt: new Date().toISOString(),
      },
      {
        runId: 'expired-live-owner',
        pid: process.pid,
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
        heartbeatAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
    ]) {
      writeFileSync(leasePath, JSON.stringify(lease))
      const result = runFixture(
        ['recover', '--run-id', lease.runId],
        { evidenceDir, env: localEnv }
      )
      assert.notEqual(result.status, 0)
      assert.match(
        childOutput(result),
        /active.*lease|lease.*active|not stale|recovery.*refus/i,
        'stale recovery must require both a missing PID and an expired heartbeat'
      )
    }
  })
})

test('fixture ledger records intent before writes and recovers exact owned resources in reverse', { skip: !scriptsExist }, () => {
  const { fixture } = readScripts()

  assert.match(fixture, /fixture\.json/)
  assert.match(fixture, /['"]intent['"]/)
  assert.match(fixture, /['"]created['"]/)
  assert.match(fixture, /recordIntent|writeIntent|appendIntent/)
  assert.match(fixture, /markCreated|recordCreated/)
  assert.match(fixture, /renameSync|rename\s*\(/, 'ledger writes must be atomic')
  assert.match(fixture, /seed/)
  assert.match(fixture, /verify/)
  assert.match(fixture, /heartbeat/)
  assert.match(fixture, /cleanup/)
  assert.match(fixture, /recover/)
  assert.match(fixture, /--absent|\babsent\b/)
  assert.match(fixture, /\.reverse\s*\(|toReversed\s*\(/)
  assert.match(fixture, /ownership|owner/i)
  assert.match(fixture, /storage[\s\S]{0,500}(?:exists|list|search)[\s\S]{0,500}(?:recordIntent|writeIntent|appendIntent)/i)
  assert.doesNotMatch(fixture, /delete\s*\(\s*\)\s*\.neq|remove\s*\(\s*\[?\s*['"]studio-design-system-fixture\/['"]/)
})

test('recovery harness proves interrupted intent recovery and preserves active or foreign ownership', { skip: !scriptsExist }, () => {
  withEvidenceDir((evidenceDir) => {
    const disabled = runRecoveryHarness(
      ['test-recovery-prepare', '--run-id', 'disabled-seam', '--scenario', 'interrupted'],
      evidenceDir,
      { enabled: false }
    )
    assert.notEqual(disabled.status, 0)
    assert.match(childOutput(disabled), /NODE_ENV=test|explicit|adapter|refus/i)
    assert.equal(existsSync(join(evidenceDir, 'fixture.json')), false)

    const interrupted = runRecoveryHarness(
      ['test-recovery-prepare', '--run-id', 'interrupted-run', '--scenario', 'interrupted'],
      evidenceDir
    )
    assert.notEqual(interrupted.status, 0, 'prepare must simulate a process interruption')
    assert.match(childOutput(interrupted), /simulated interruption/i)

    const beforeRecovery = JSON.parse(readFileSync(join(evidenceDir, 'recovery-adapter.json'), 'utf8'))
    assert.deepEqual(beforeRecovery.removalOrder, [])
    assert.equal(beforeRecovery.resources.some((resource) => resource.state === 'intent'), true)

    const recovered = runRecoveryHarness(
      ['recover', '--run-id', 'interrupted-run'],
      evidenceDir
    )
    assert.equal(recovered.status, 0, childOutput(recovered))
    const recoveredState = JSON.parse(readFileSync(join(evidenceDir, 'recovery-adapter.json'), 'utf8'))
    assert.deepEqual(recoveredState.removalOrder, ['owned-intent', 'owned-created'])
    assert.deepEqual(
      recoveredState.store.map((resource) => resource.id),
      ['untracked-foreign'],
      'recovery must delete only exact owned resources'
    )
    assert.equal(existsSync(join(evidenceDir, 'fixture.lease.json')), false)

    rmSync(evidenceDir, { recursive: true, force: true })
    const activePrepare = runRecoveryHarness(
      ['test-recovery-prepare', '--run-id', 'active-run', '--scenario', 'active'],
      evidenceDir
    )
    assert.notEqual(activePrepare.status, 0)
    const activeRecovery = runRecoveryHarness(
      ['recover', '--run-id', 'active-run'],
      evidenceDir
    )
    assert.notEqual(activeRecovery.status, 0)
    assert.match(childOutput(activeRecovery), /active|not stale|refus/i)
    assert.equal(existsSync(join(evidenceDir, 'fixture.lease.json')), true)

    rmSync(evidenceDir, { recursive: true, force: true })
    const foreignPrepare = runRecoveryHarness(
      ['test-recovery-prepare', '--run-id', 'foreign-run', '--scenario', 'foreign'],
      evidenceDir
    )
    assert.notEqual(foreignPrepare.status, 0)
    const foreignRecovery = runRecoveryHarness(
      ['recover', '--run-id', 'foreign-run'],
      evidenceDir
    )
    assert.notEqual(foreignRecovery.status, 0)
    assert.match(childOutput(foreignRecovery), /ownership|foreign|refus/i)
    const foreignState = JSON.parse(readFileSync(join(evidenceDir, 'recovery-adapter.json'), 'utf8'))
    assert.equal(foreignState.store.some((resource) => resource.id === 'foreign-ledger-resource'), true)
    assert.equal(existsSync(join(evidenceDir, 'fixture.lease.json')), true)
  })
})

test('browser verification is the sole lifecycle owner and always cleans up or recovers', { skip: !scriptsExist }, () => {
  const { fixture, orchestrator } = readScripts()

  assert.match(orchestrator, /studio-browser-fixture\.mjs/)
  assert.match(orchestrator, /try\s*\{/)
  assert.match(orchestrator, /finally\s*\{/)
  assert.match(orchestrator, /['"]seed['"]/)
  assert.match(orchestrator, /['"]heartbeat['"]/)
  assert.match(orchestrator, /['"]cleanup['"]/)
  assert.match(orchestrator, /['"]recover['"]/)
  assert.match(orchestrator, /['"]verify['"][\s\S]{0,160}['"]--absent['"]/)
  assert.match(orchestrator, /fixture\.lease\.json/)
  assert.match(orchestrator, /clearInterval\s*\(/)
  assert.match(orchestrator, /localhost:4000|127\.0\.0\.1:4000/)
  assert.match(orchestrator, /pathname/)
  assert.match(orchestrator, /studio-theme/)
  assert.match(orchestrator, /boundingBox\s*\(/)
  assert.match(orchestrator, /(?:width|height)[\s\S]{0,80}44/)
  assert.match(orchestrator, /INTERACTION_VIEWPORTS\s*=\s*new Set\(\[['"]mobile-320['"],\s*['"]desktop-1440['"]\]\)/)
  assert.match(orchestrator, /INTERACTION_VIEWPORTS\.has\(viewport\.name\)/)
  assert.match(orchestrator, /assertMarketInteractions\([\s\S]{0,300}preview:\s*true/)
  assert.match(orchestrator, /board-preview/)
  assert.match(orchestrator, /search and reset/)
  assert.match(orchestrator, /pagination boundaries/)
  assert.match(orchestrator, /sample prefetch/)
  assert.match(orchestrator, /isEnabled\s*\(/)
  assert.match(orchestrator, /Dialog 열기/)
  assert.match(orchestrator, /showcase-level/)
  assert.match(orchestrator, /getComputedStyle/)
  assert.match(orchestrator, /git[\s\S]{0,80}rev-parse/)
  assert.match(orchestrator, /auth mode|authMode/i)
  assert.match(orchestrator, /recordAssertion\([^\n]+['"]FAIL['"]/)
  assert.match(orchestrator, /AggregateError/)
  assert.match(orchestrator, /cleanup[\s\S]{0,1000}cleanup/, 'owned cleanup must be retried before leaving the lease')
  assert.match(orchestrator, /node_modules[\s\S]{0,120}next[\s\S]{0,120}bin[\s\S]{0,120}next/)
  assert.match(orchestrator, /detached:\s*process\.platform\s*!==\s*['"]win32['"]/)
  assert.match(orchestrator, /process\.kill\(-child\.pid,\s*['"]SIGTERM['"]\)/)
  assert.match(orchestrator, /process\.kill\(-child\.pid,\s*['"]SIGKILL['"]\)/)
  assert.match(orchestrator, /\.next[\s\S]{0,120}(?:dev[\s\S]{0,80})?lock/)
  assert.match(orchestrator, /child process exit|process group exit/i)

  for (const route of [
    '/preview/design-system',
    '/preview/solvook-concept',
    '/preview/solvook-concept/boards/ebs-literature',
    '/preview/solvook-concept/boards/ebs-literature/posts/jingsori-2027',
    '/english/market/studio-en-fixture',
    '/korean/market/studio-ko-fixture',
    '/english/market/studio-en-fixture/board-preview',
    '/korean/market/studio-ko-fixture/board-preview',
  ]) {
    assert.match(orchestrator, new RegExp(route.replaceAll('/', '\\/')))
  }

  assert.match(fixture, /STUDIO_FIXTURE_EVIDENCE_DIR/)
  assert.doesNotMatch(orchestrator, /SUPABASE_URL\s*=|SUPABASE_SERVICE_ROLE_KEY\s*=/)
})

test('browser interactions and final evidence cover preview parity, tokens, responsive DOM, and lifecycle order', { skip: !scriptsExist }, () => {
  const { orchestrator } = readScripts()
  const marketStart = orchestrator.indexOf('async function assertMarketInteractions')
  const marketEnd = orchestrator.indexOf('async function assertShowcaseInteractions')
  const marketBody = orchestrator.slice(marketStart, marketEnd)
  const matrixStart = orchestrator.indexOf('async function runBrowserMatrix')
  const matrixEnd = orchestrator.indexOf('function releaseOwnedLease')
  const matrixBody = orchestrator.slice(matrixStart, matrixEnd)
  const mainStart = orchestrator.indexOf('async function main()')
  const mainEnd = orchestrator.indexOf('\nmain().catch', mainStart)
  const mainBody = orchestrator.slice(mainStart, mainEnd)

  assert.ok(marketStart >= 0 && marketEnd > marketStart)
  assert.doesNotMatch(marketBody, /if\s*\(preview\)\s*return/)
  for (const assertion of [
    'pagination boundaries',
    'sample prefetch',
    'focus restoration',
    'empty state',
    'single shared result',
  ]) assert.match(marketBody, new RegExp(assertion, 'i'))
  assert.match(marketBody, /keyboard\.press\(['"]Tab['"]\)/)
  assert.match(marketBody, /document\.activeElement/)
  assert.match(marketBody, /row identity/i)
  assert.match(marketBody, /10[^\n]{0,100}20|20[^\n]{0,100}10/)
  assert.match(marketBody, /sample trigger focus restoration/i)

  assert.match(orchestrator, /getPropertyValue\(['"]--studio-surface['"]\)/)
  assert.match(orchestrator, /getPropertyValue\(['"]--studio-text['"]\)/)
  assert.match(orchestrator, /getPropertyValue\(['"]--studio-border['"]\)/)
  assert.match(orchestrator, /getPropertyValue\(['"]--studio-focus-ring['"]\)/)
  assert.match(orchestrator, /getPropertyValue\(['"]--studio-primary-soft['"]\)/)
  assert.match(orchestrator, /getPropertyValue\(['"]--studio-primary['"]\)/)
  assert.match(orchestrator, /backgroundColor\s*!==\s*expected|backgroundColor\s*===\s*expected/)
  assert.match(orchestrator, /visuals\.color\s*!==\s*expected\.primary/)
  assert.match(orchestrator, /boxShadow[\s\S]{0,160}(?:focusRing|expectedFocus)/)

  assert.doesNotMatch(matrixBody, /writeBrowserManifest|writeFinalManifest/)
  assert.doesNotMatch(matrixBody, /const evidenceRows\s*=\s*\[\]/)
  assert.match(mainBody, /const evidenceRows\s*=\s*\[\]/)
  const cleanupIndex = mainBody.indexOf('cleanupOwnedFixture')
  const leaseReleaseIndex = mainBody.indexOf('releaseOwnedLease')
  const devStopIndex = mainBody.indexOf('stopDevServer')
  const manifestIndex = mainBody.indexOf('writeBrowserManifest')
  assert.ok(cleanupIndex >= 0)
  assert.ok(leaseReleaseIndex > cleanupIndex)
  assert.ok(devStopIndex > cleanupIndex)
  assert.ok(manifestIndex > leaseReleaseIndex && manifestIndex > devStopIndex)
  assert.match(orchestrator, /renameSync\s*\(/)
  for (const metadata of [
    'Supabase hostname',
    'Playwright version',
    'Browser version',
    'Fixture IDs',
    'Storage paths',
  ]) assert.match(orchestrator, new RegExp(metadata, 'i'))
  for (const lifecycle of [
    'fixture seed',
    'fixture verify present',
    'fixture cleanup',
    'fixture verify absent',
    'lease release',
    'dev server stop',
  ]) assert.match(orchestrator, new RegExp(lifecycle, 'i'))
  assert.match(mainBody, /primaryError\s*\?\s*['"]FAIL['"]\s*:\s*['"]PASS['"]/)
})

test('browser matrix isolates anonymous previews from authenticated market routes per viewport', { skip: !scriptsExist }, () => {
  const { orchestrator } = readScripts()
  const matrixStart = orchestrator.indexOf('async function runBrowserMatrix')
  const matrixEnd = orchestrator.indexOf('function releaseOwnedLease')
  const matrixBody = orchestrator.slice(matrixStart, matrixEnd)
  const viewportLoop = matrixBody.indexOf('for (const viewport of VIEWPORTS)')
  const anonymousContext = matrixBody.indexOf('anonymousContext', viewportLoop)
  const anonymousPage = matrixBody.indexOf('anonymousPage', anonymousContext)
  const previewLoop = matrixBody.indexOf('PREVIEW_ROUTES', anonymousPage)
  const anonymousClose = matrixBody.indexOf('anonymousContext.close()', previewLoop)
  const marketContext = matrixBody.indexOf('marketContext', anonymousClose)
  const marketPage = matrixBody.indexOf('marketPage', marketContext)
  const login = matrixBody.indexOf("'/login'", marketPage)
  const marketLoop = matrixBody.indexOf('MARKET_ROUTES', login)
  const marketClose = matrixBody.indexOf('marketContext.close()', marketLoop)

  for (const index of [
    viewportLoop,
    anonymousContext,
    anonymousPage,
    previewLoop,
    anonymousClose,
    marketContext,
    marketPage,
    login,
    marketLoop,
    marketClose,
  ]) assert.ok(index >= 0)
  assert.ok(
    viewportLoop < anonymousContext
      && anonymousContext < anonymousPage
      && anonymousPage < previewLoop
      && previewLoop < anonymousClose
      && anonymousClose < marketContext
      && marketContext < marketPage
      && marketPage < login
      && login < marketLoop
      && marketLoop < marketClose,
    'anonymous preview context must finish before authenticated market context starts'
  )
  assert.doesNotMatch(
    matrixBody.slice(anonymousContext, anonymousClose),
    /ephemeral fixture authentication|\/login|credentials\.email|credentials\.password/
  )
  assert.match(orchestrator, /const PREVIEW_ROUTES\s*=\s*\[/)
  assert.match(orchestrator, /const MARKET_ROUTES\s*=\s*\[/)
})

test('market browser assertions cover every 44px control and rendered sample image', { skip: !scriptsExist }, () => {
  const { orchestrator } = readScripts()
  const marketStart = orchestrator.indexOf('async function assertMarketInteractions')
  const marketEnd = orchestrator.indexOf('async function assertShowcaseInteractions')
  const marketBody = orchestrator.slice(marketStart, marketEnd)

  for (const control of ['#year', '#month', '#grade', '#title', '#market-rows-per-page']) {
    assert.match(
      marketBody,
      new RegExp(`assertMinimumTarget\\(page\\.locator\\(['"]${control.replace('#', '\\#')}['"]\\)`),
      `${control} must have an actual 44px locator assertion`
    )
  }
  assert.match(marketBody, /assertMinimumTarget\([\s\S]{0,160}name:\s*['"]검색['"]/)
  assert.match(marketBody, /assertMinimumTarget\([\s\S]{0,160}name:\s*['"]초기화['"]/)
  assert.match(marketBody, /assertMinimumTarget\(purchaseCta,\s*['"]market PDF purchase CTA['"]\)/)
  assert.match(marketBody, /dialog[\s\S]{0,200}locator\(['"]img['"]\)/)
  assert.match(marketBody, /naturalWidth[\s\S]{0,120}naturalHeight/)
  assert.match(marketBody, /boundingBox\s*\(\)/)
})

test('Solvook board helper exercises filters, responsive parity, empty state, and pagination at every viewport', { skip: !scriptsExist }, () => {
  const { orchestrator } = readScripts()
  const boardStart = orchestrator.indexOf('async function assertSolvookBoardInteractions')
  const boardEnd = orchestrator.indexOf('async function assertSolvookDetailInteractions')
  const boardBody = orchestrator.slice(boardStart, boardEnd)
  const matrixStart = orchestrator.indexOf('async function runBrowserMatrix')
  const matrixEnd = orchestrator.indexOf('function releaseOwnedLease')
  const matrixBody = orchestrator.slice(matrixStart, matrixEnd)
  const previewLoop = matrixBody.indexOf('PREVIEW_ROUTES')
  const boardCall = matrixBody.indexOf('assertSolvookBoardInteractions(', previewLoop)
  const detailCall = matrixBody.indexOf('assertSolvookDetailInteractions(', boardCall)
  const anonymousClose = matrixBody.indexOf('anonymousContext.close()', detailCall)

  assert.ok(boardStart >= 0 && boardEnd > boardStart)
  assert.ok(previewLoop >= 0 && boardCall > previewLoop && detailCall > boardCall)
  assert.ok(anonymousClose > detailCall, 'Solvook helpers must run in the anonymous context')
  assert.equal(orchestrator.match(/assertSolvookBoardInteractions\(/g)?.length, 2)
  assert.equal(orchestrator.match(/assertSolvookDetailInteractions\(/g)?.length, 2)
  assert.doesNotMatch(matrixBody.slice(previewLoop, anonymousClose), /INTERACTION_VIEWPORTS\.has/)

  for (const locator of [
    '#board-title-search',
    '연도 필터',
    '교재 필터',
    '작품 유형 필터',
    '학년 필터',
    '자료 정렬',
    '페이지당 자료 수',
  ]) assert.match(boardBody, new RegExp(locator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(boardBody, /studio-board-desktop-results/)
  assert.match(boardBody, /studio-board-mobile-results/)
  assert.match(boardBody, /locator\(['"]table tbody tr['"]\)/)
  assert.match(boardBody, /locator\(['"]article['"]\)/)
  assert.match(boardBody, /isVisible\s*\(\)/)
  assert.match(boardBody, /authorLabel:\s*titleParts\[1\]/)
  assert.match(boardBody, /authorLabel:\s*paragraphs\[0\]/)
  assert.match(boardBody, /querySelectorAll\(['"]p['"]\)/)
  assert.match(boardBody, /paragraphs\[0\]/)
  assert.match(boardBody, /paragraphs\[1\]/)
  assert.match(boardBody, /JSON\.stringify\([\s\S]{0,160}(?:desktopEntries|mobileEntries)/)
  assert.match(boardBody, /조건에 맞는 자료가 없습니다/)
  assert.match(boardBody, /searchParams\.get\(['"]q['"]\)/)
  for (const value of [
    '2027',
    'EBS 수능특강',
    '현대 소설',
    '고3',
    '2026',
    '고전 시가',
    '고1',
  ]) assert.match(boardBody, new RegExp(value))
  for (const identity of ['징소리', '오래된 책상', '나무 새의 약속']) {
    assert.match(boardBody, new RegExp(identity))
  }
  assert.match(boardBody, /pageOne[\s\S]{0,260}pageTwo|pageTwo[\s\S]{0,260}pageOne/)
  assert.match(boardBody, /isDisabled\s*\(\)/)
  assert.match(boardBody, /assertMinimumTarget\s*\(/)
})

test('Solvook home helper checks quick menus, sections, and keyboard search before board navigation', { skip: !scriptsExist }, () => {
  const { orchestrator } = readScripts()
  const homeStart = orchestrator.indexOf('async function assertSolvookHomeInteractions')
  const homeEnd = orchestrator.indexOf('async function assertSolvookBoardInteractions')
  const homeBody = orchestrator.slice(homeStart, homeEnd)
  const matrixStart = orchestrator.indexOf('async function runBrowserMatrix')
  const matrixEnd = orchestrator.indexOf('function releaseOwnedLease')
  const matrixBody = orchestrator.slice(matrixStart, matrixEnd)
  const previewLoop = matrixBody.indexOf('PREVIEW_ROUTES')
  const homeCall = matrixBody.indexOf('assertSolvookHomeInteractions(', previewLoop)
  const boardCall = matrixBody.indexOf('assertSolvookBoardInteractions(', homeCall)

  assert.ok(homeStart >= 0 && homeEnd > homeStart)
  assert.ok(previewLoop >= 0 && homeCall > previewLoop && boardCall > homeCall)
  assert.match(homeBody, /quick-access-title/)
  assert.match(homeBody, /count\s*\(\)[\s\S]{0,80}8/)
  for (const heading of [
    '선생님들이 먼저 살펴보는 자료',
    '교재와 출처로 골라보기',
    '최근 등록된 수업 자료',
    '필요한 작품부터 찾아 수업 자료를 완성하세요',
  ]) assert.match(homeBody, new RegExp(heading))
  assert.match(homeBody, /#preview-home-search/)
  assert.match(homeBody, /keyboard\.press\(['"]Tab['"]\)/)
  assert.match(homeBody, /document\.activeElement/)
  assert.match(homeBody, /searchParams\.get\(['"]q['"]\)/)
  assert.match(homeBody, /assertMinimumTarget\s*\(/)
  assert.match(homeBody, /div\[class\*=['"]studio-content-width['"]\]/)
  assert.match(homeBody, /Math\.min\(viewport\.width,\s*1200\)/)
  assert.match(
    homeBody,
    /viewport\.width\s*<\s*744\s*\?\s*20\s*:\s*viewport\.width\s*<\s*1200\s*\?\s*32\s*:\s*0/
  )
  assert.match(homeBody, /getBoundingClientRect\s*\(\)/)
  assert.match(homeBody, /getComputedStyle\(element\)\.maxWidth/)
})

test('Solvook detail helper exercises tabs and the visible responsive action surface with focus', { skip: !scriptsExist }, () => {
  const { orchestrator } = readScripts()
  const detailStart = orchestrator.indexOf('async function assertSolvookDetailInteractions')
  const detailEnd = orchestrator.indexOf('async function assertShowcaseInteractions')
  const detailBody = orchestrator.slice(detailStart, detailEnd)

  assert.ok(detailStart >= 0 && detailEnd > detailStart)
  assert.match(detailBody, /getByRole\(['"]tab['"]/)
  for (const tab of ['자료 정보', '지문 구조', '포함 문항', '샘플 보기', '이용 안내']) {
    assert.match(detailBody, new RegExp(tab))
  }
  for (const content of [
    '수업 흐름이 보이는 자료',
    '밤길에서 되살아나는 기억',
    '포함 문항 7개',
    '문서 구성 미리보기',
    '시안 이용 안내',
  ]) assert.match(detailBody, new RegExp(content))
  assert.match(detailBody, /tabs-content/)
  assert.match(detailBody, /aria-selected|data-state/)
  assert.match(detailBody, /studio-detail-mobile-actions/)
  assert.match(detailBody, /TEACHER ACTION/)
  assert.match(detailBody, /viewport\.width\s*>=\s*1024/)
  assert.match(detailBody, /라이브러리에 담기/)
  assert.match(detailBody, /이 자료로 문제 생성/)
  assert.match(detailBody, /샘플 보기/)
  assert.match(detailBody, /document\.activeElement/)
  assert.match(detailBody, /assertMinimumTarget\s*\(/)
  assert.match(detailBody, /dialog-content/)
})

test('remote fixture refusal still writes a final FAIL manifest after safe lifecycle completion', { skip: !scriptsExist }, () => {
  withEvidenceDir((evidenceDir) => {
    const result = spawnSync(process.execPath, [orchestratorScriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STUDIO_FIXTURE_EVIDENCE_DIR: evidenceDir,
        STUDIO_BROWSER_BASE_URL: 'http://127.0.0.1:4000',
        NEXT_PUBLIC_SUPABASE_URL: 'https://fixture-contract.supabase.co',
        SUPABASE_URL: 'https://fixture-contract.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-contract-key',
      },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.notEqual(result.status, 0)
    assert.match(childOutput(result), /remote|supabase\.co|refus/i)
    const manifestPath = join(evidenceDir, 'final', 'manifest.md')
    assert.equal(existsSync(manifestPath), true)
    const manifest = readFileSync(manifestPath, 'utf8')
    assert.match(manifest, /Overall status: FAIL/)
    assert.match(manifest, /fixture seed \| FAIL/)
    assert.match(manifest, /fixture cleanup \| PASS/)
    assert.match(manifest, /fixture verify absent \| PASS/)
    assert.match(manifest, /lease release \| PASS/)
    assert.match(manifest, /dev server stop \| PASS/)
    assert.match(manifest, /Supabase hostname: non-local-refused/)
    assert.equal(existsSync(join(evidenceDir, 'fixture.lease.json')), false)
    assert.deepEqual(
      readdirSync(join(evidenceDir, 'final')).filter((name) => name.endsWith('.tmp')),
      [],
      'atomic manifest write must not leave temporary files'
    )
  })
})
