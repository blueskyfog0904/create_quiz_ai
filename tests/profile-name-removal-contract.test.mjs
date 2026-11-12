import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 회원 이름은 받지도 저장하지도 않는다. 화면에는 이메일 앞 4글자 + # + profiles.display_tag(가입 때 DB가 정한 고정 태그)의 표시 이름을 쓴다.
function loadDisplayName() {
  const { outputText } = ts.transpileModule(read('src/lib/member-display-name.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const loaded = { exports: {} }
  new Function('exports', outputText)(loaded.exports)
  return loaded.exports.formatMemberDisplayName
}

test('표시 이름은 이메일 앞 4글자 + # + DB에 저장된 고정 태그다', () => {
  const format = loadDisplayName()
  const tag = 'WC1W'
  assert.equal(format('kimteacher@example.com', tag), 'kimt#WC1W')
  assert.equal(format('ab@example.com', tag), 'ab#WC1W')
  assert.equal(format(null, tag), '회원#WC1W')
  // 태그를 못 읽은 경우에는 앞부분만 보인다
  assert.equal(format('kimteacher@example.com', null), 'kimt')
  // 이메일 전체(도메인 포함)는 드러나지 않는다
  assert.doesNotMatch(format('kimteacher@example.com', tag), /@|example/)
})

test('카카오 로그인·가입은 이름 동의를 요청하지 않고, 가입 화면·API에 이름이 없다', () => {
  for (const path of ['src/app/(auth)/login/page.tsx', 'src/app/(auth)/signup/page.tsx']) {
    const source = read(path)
    assert.match(source, /scope: 'account_email,phone_number'/, path)
    assert.doesNotMatch(source, /phone_number,name/, path)
  }
  const signup = read('src/app/(auth)/signup/page.tsx')
  assert.doesNotMatch(signup, /kakaoName|htmlFor="name"|이름 \*/)
  const action = read('src/app/auth/actions.ts')
  assert.doesNotMatch(action, /full_name|formData\.get\('name'\)/)
  const profileApi = read('src/app/api/profile/route.ts')
  assert.doesNotMatch(profileApi, /\bname\b/)
})

test('공개 리뷰 작성자·헤더·결제 구매자명은 표시 이름을 쓰고, 이메일 원문은 리뷰로 나가지 않는다', () => {
  const reviews = read('src/lib/market-reviews-server.ts')
  assert.match(reviews, /name: formatMemberDisplayName\(profile\?\.email, profile\?\.display_tag\)/)
  assert.doesNotMatch(reviews, /profile\?\.name|email: profile/)
  assert.match(read('src/components/layout/header.tsx'), /formatMemberDisplayName\(profile\?\.email \?\? user\.email, profile\?\.display_tag\)/)
  assert.match(read('src/app/checkout/page.tsx'), /name: formatMemberDisplayName\(profile\?\.email \?\? user\.email, profile\?\.display_tag\)/)
})

test('고정 태그는 가입 때 컬럼 기본값으로 DB가 정하고, 기존 회원은 채운 뒤 NOT NULL·형식·중복 금지로 묶는다', () => {
  const migration = read('supabase/migrations/20261112100000_profiles_display_tag.sql')
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.generate_member_display_tag\(\)/)
  assert.match(migration, /c_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'/)
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM public\.profiles WHERE display_tag = v_tag\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.generate_member_display_tag\(\) FROM PUBLIC, anon, authenticated;/)
  const addAt = migration.indexOf('ALTER TABLE public.profiles ADD COLUMN display_tag text;')
  const backfillAt = migration.indexOf('UPDATE public.profiles SET display_tag = public.generate_member_display_tag()')
  const lockAt = migration.indexOf('ALTER COLUMN display_tag SET NOT NULL')
  assert.ok(addAt >= 0 && addAt < backfillAt && backfillAt < lockAt)
  assert.match(migration, /ALTER COLUMN display_tag SET DEFAULT public\.generate_member_display_tag\(\)/)
  assert.match(migration, /CHECK \(display_tag ~ '\^\[0-9A-Z\]\{4\}\$'\)/)
  assert.match(migration, /UNIQUE \(display_tag\)/)

  // 표시 이름을 만드는 곳은 회원 id가 아니라 저장된 태그를 넘긴다
  for (const path of [
    'src/app/checkout/page.tsx',
    'src/app/(solvook)/mypage/page.tsx',
    'src/app/(solvook)/mypage/profile/page.tsx',
    'src/components/layout/header.tsx',
    'src/lib/market-reviews-server.ts',
    'src/app/(admin)/admin/users/users-client.tsx',
    'src/app/(admin)/admin/refunds/refunds-client.tsx',
    'src/app/(admin)/admin/credits/credits-client.tsx',
    'src/app/(admin)/admin/credits/grant-credit-dialog.tsx',
    'src/app/(admin)/admin/ai-question-generation-runs/ai-question-generation-runs-client.tsx',
    'src/app/(admin)/admin/ai-question-generation-runs/[runId]/page.tsx',
  ]) {
    const source = read(path)
    const calls = source.match(/formatMemberDisplayName\(.*$/gm) ?? []
    assert.ok(calls.length > 0, path)
    for (const call of calls) assert.match(call, /display_tag|displayTagById/, `${path}: ${call}`)
  }
})

test('profiles 타입에 name이 없고, 마이그레이션은 함수부터 바꾼 뒤 컬럼을 지운다', () => {
  const types = read('src/types/supabase.ts')
  const profilesStart = types.indexOf('      profiles: {')
  const profilesBlock = types.slice(profilesStart, types.indexOf('Relationships:', profilesStart))
  assert.doesNotMatch(profilesBlock, /^\s+name\??: string \| null$/m)

  const migration = read('supabase/migrations/20261013053528_remove_profile_name.sql')
  const triggerAt = migration.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()')
  const rpcAt = migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_list_bank_questions(')
  const dropAt = migration.indexOf('alter table public.profiles drop column name;')
  assert.ok(triggerAt !== -1 && rpcAt > triggerAt && dropAt > rpcAt)
  const trigger = migration.slice(triggerAt, rpcAt)
  assert.doesNotMatch(trigger, /v_profile_name|\n\s+name,/)
  const rpc = migration.slice(rpcAt, dropAt)
  assert.doesNotMatch(rpc, /p\.name|'name',f\.name/)
  assert.match(rpc, /jsonb_build_object\('id',f\.user_id,'email',f\.email\)/)
  assert.match(migration, /raw_user_meta_data - 'full_name'/)
  assert.match(migration, /identity_data - 'full_name'/)
})
