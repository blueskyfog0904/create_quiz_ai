import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const helperFilename = '20260208000000_create_is_admin_helper.sql'
const userRolesFilename = '20260209_create_user_roles.sql'
const remediationFilename = '20260210000000_restrict_is_admin_public_policies.sql'

const migrationFilenames = readdirSync(migrationsDir).sort()

const readMigration = (filename) => readFileSync(
  new URL(filename, migrationsDir),
  'utf8'
)

const findPolicyBlock = (sql, policyName, tableName) => {
  const escapedPolicyName = policyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `create\\s+policy\\s+"${escapedPolicyName}"\\s+on\\s+public\\.${escapedTableName}\\b[\\s\\S]*?;`,
    'i'
  )

  return sql.match(pattern)?.[0] ?? ''
}

const getIsAdminPolicyBlocks = () => migrationFilenames.flatMap((filename) => {
  const sql = readMigration(filename)
  const blocks = sql.match(/create\s+policy\s+"[^"]+"\s+on\s+public\.[a-z_]+\b[\s\S]*?;/gi) ?? []

  return blocks
    .filter((block) => /public\.is_admin\s*\(/i.test(block))
    .map((block) => ({ filename, block }))
})

test('creates public.is_admin before migrations first reference it', () => {
  const helperPath = new URL(helperFilename, migrationsDir)

  assert.equal(existsSync(helperPath), true)
  assert.ok(helperFilename < userRolesFilename)
  assert.ok(migrationFilenames.indexOf(helperFilename) < migrationFilenames.indexOf(userRolesFilename))

  const helperSql = readMigration(helperFilename)

  assert.match(helperSql, /create\s+or\s+replace\s+function\s+public\.is_admin\s*\(\s*\)/i)
  assert.match(helperSql, /security\s+definer/i)
  assert.match(helperSql, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i)
  assert.match(helperSql, /auth\.uid\s*\(\s*\)/i)
  assert.match(helperSql, /from\s+public\.profiles(?:\s+\w+)?[\s\S]*\b(?:profiles|p)\.is_admin\s+is\s+true/i)
  assert.match(helperSql, /revoke\s+all\s+on\s+function\s+public\.is_admin\s*\(\s*\)\s+from\s+public/i)
  assert.match(helperSql, /grant\s+execute\s+on\s+function\s+public\.is_admin\s*\(\s*\)\s+to\s+authenticated/i)
})

test('remediates existing public.is_admin policies after user_roles exists', () => {
  const remediationPath = new URL(remediationFilename, migrationsDir)

  assert.equal(existsSync(remediationPath), true)
  assert.ok(userRolesFilename < remediationFilename)
  assert.ok(migrationFilenames.indexOf(userRolesFilename) < migrationFilenames.indexOf(remediationFilename))

  const remediationSql = readMigration(remediationFilename)
  const adminsCanManageRoles = findPolicyBlock(
    remediationSql,
    'Admins can manage roles',
    'user_roles'
  )

  assert.match(remediationSql, /drop\s+policy\s+if\s+exists\s+"Admins can manage roles"\s+on\s+public\.user_roles/i)
  assert.match(adminsCanManageRoles, /for\s+all\s+to\s+authenticated/i)
  assert.match(adminsCanManageRoles, /using\s*\(\s*public\.is_admin\s*\(\s*\)\s*\)/i)
  assert.match(adminsCanManageRoles, /with\s+check\s*\(\s*public\.is_admin\s*\(\s*\)\s*\)/i)
})

test('all public.is_admin admin policies are either authenticated or remediated', () => {
  const remediationSql = existsSync(new URL(remediationFilename, migrationsDir))
    ? readMigration(remediationFilename)
    : ''

  for (const { filename, block } of getIsAdminPolicyBlocks()) {
    if (/to\s+authenticated/i.test(block)) {
      continue
    }

    const policyMatch = block.match(/create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-z_]+)/i)

    assert.ok(policyMatch, `Could not parse public.is_admin policy in ${filename}`)

    const [, policyName, tableName] = policyMatch
    const remediatedBlock = findPolicyBlock(remediationSql, policyName, tableName)

    assert.match(
      remediationSql,
      new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${policyName}"\\s+on\\s+public\\.${tableName}`, 'i')
    )
    assert.match(
      remediatedBlock,
      /to\s+authenticated/i,
      `${filename} ${policyName} on ${tableName} must be remediated to authenticated`
    )
  }
})
