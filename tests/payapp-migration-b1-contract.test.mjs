import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

function readSql(dir, suffix) {
  const dirUrl = new URL(`../supabase/${dir}/`, import.meta.url)
  const filename = readdirSync(dirUrl).find((name) => name.endsWith(suffix))

  return filename ? readFileSync(new URL(filename, dirUrl), 'utf8') : ''
}

const migration = readSql('migrations', '_payapp_migration_b1_terms.sql')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const rollback = readSql('rollback', '_payapp_migration_b1_terms_down.sql')
const footerDefaults = readFileSync(new URL('../src/lib/footer-content.ts', import.meta.url), 'utf8')

// SQL 문자열 상수(|| 로 이어 붙인 조각 포함)를 하나의 문자열로 읽는다.
function constant(sql, name) {
  const match = sql.match(new RegExp(`${name} constant text :=([\\s\\S]*?);\\n`))
  assert.ok(match, `${name} is declared`)
  return [...match[1].matchAll(/E?'((?:[^']|'')*)'/g)]
    .map(([, value]) => value.replace(/''/g, "'").replace(/\\n/g, '\n'))
    .join('')
}

test('migration B1 changes only the dry-run footer value through fixed jsonb paths', () => {
  assert.ok(migration, 'B1 migration file exists')
  assert.match(migrationCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.match(migrationCode, /c_expected_md5 constant text := '[0-9a-f]{32}'/)
  assert.equal((migrationCode.match(/md5\(value::text\) = c_expected_md5/g) ?? []).length, 2)
  assert.match(migrationCode, /jsonb_set\(value, '\{policyDocuments,refundPolicy,content\}'/)
  assert.match(migrationCode, /'\{policyDocuments,privacyPolicy,content\}', to_jsonb\(v_privacy\)\)/)
  assert.match(migrationCode, /IF v_count <> 1 THEN/)
  assert.doesNotMatch(migrationCode, /\bCASCADE\b|^\s*(BEGIN|COMMIT)\s*;/im)
})

test('migration B1 wording matches the code defaults from phase 6', () => {
  // 20261110116000(DB-13)이 B1 문구에서 카카오페이를 지웠으므로, 그 치환을 거친 문장을 코드 기본값과 비교한다.
  const db13 = readSql('migrations', '_terms_remove_kakaopay.sql')
  const afterDb13 = (text) =>
    ['c_refund_pg', 'c_refund_methods', 'c_privacy'].reduce(
      (value, name) => value.replace(constant(db13, `${name}_old`), constant(db13, `${name}_new`)),
      text
    )
  for (const name of ['c_refund_pg_new', 'c_refund_methods_new', 'c_privacy_new']) {
    for (const line of afterDb13(constant(migration, name)).split('\n')) {
      const sentence = line.replace(/^- /, '')
      assert.ok(footerDefaults.includes(sentence), `${name}: ${sentence}`)
    }
  }
  for (const name of ['c_refund_pg_new', 'c_refund_methods_new', 'c_refund_original_new', 'c_privacy_new']) {
    assert.doesNotMatch(constant(migration, name), /토스페이먼츠|페이코|일반결제|카카오페이머니만|반드시/)
  }
})

test('migration B1 verifies old wording is gone and unrelated content is unchanged', () => {
  assert.match(migrationCode, /v_text ~ '\(토스페이먼츠\|페이코\|일반결제\|카카오페이머니만\|반드시 결제 당시\)'/)
  assert.match(migrationCode, /RAISE EXCEPTION 'VERIFY: unrelated footer content changed'/)
  assert.match(migrationCode, /position\('가명 처리된 회원 식별값' IN v_text\) = 0/)
  assert.match(migrationCode, /position\('원 결제수단으로 처리하는 것을 원칙으로 합니다\.' IN v_text\) = 0/)
})

test('B1 keeps the pre-B1 footer value whose md5 matches the dry-run guard', () => {
  const before = readFileSync(
    new URL('../supabase/rollback/20261021100000_payapp_migration_b1_terms_before.json', import.meta.url)
  )
  const expected = migration.match(/c_expected_md5 constant text := '([0-9a-f]{32})'/)?.[1]
  assert.equal(createHash('md5').update(before).digest('hex'), expected)
  assert.doesNotThrow(() => JSON.parse(before.toString('utf8')))
})

test('B1 checks each fragment once and both files end with a schema reload', () => {
  for (const name of ['c_refund_pg_old', 'c_refund_methods_old', 'c_refund_original_old', 'c_privacy_old']) {
    assert.match(migrationCode, new RegExp(`/ length\\(${name}\\) IS DISTINCT FROM 1`), name)
  }
  assert.match(migrationCode.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
  assert.match(rollback.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
  assert.match(rollback, /SET LOCAL lock_timeout = '3s';/)
  assert.match(rollback, /WHERE key = 'site_footer_content'\n\s+FOR UPDATE;/)
})

test('B1 rollback reverses the same fragments and requires the original md5', () => {
  assert.ok(rollback, 'B1 rollback file exists')
  for (const name of [
    'c_refund_pg_old', 'c_refund_pg_new', 'c_refund_methods_old', 'c_refund_methods_new',
    'c_refund_original_old', 'c_refund_original_new', 'c_privacy_old', 'c_privacy_new',
  ]) {
    assert.equal(constant(rollback, name), constant(migration, name), name)
  }
  assert.equal(
    rollback.match(/c_original_md5 constant text := '([0-9a-f]{32})'/)?.[1],
    migration.match(/c_expected_md5 constant text := '([0-9a-f]{32})'/)?.[1]
  )
  assert.match(rollback, /IF md5\(v_restored::text\) IS DISTINCT FROM c_original_md5 THEN/)
})
