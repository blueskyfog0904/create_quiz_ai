import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 회원 이름은 받지도 저장하지도 않는다. 화면에는 이메일 앞 3글자 + 회원 id 끝 4글자의 표시 이름을 쓴다.
function loadDisplayName() {
  const { outputText } = ts.transpileModule(read('src/lib/member-display-name.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const loaded = { exports: {} }
  new Function('exports', outputText)(loaded.exports)
  return loaded.exports.formatMemberDisplayName
}

test('표시 이름은 이메일 앞 3글자 + 회원 id 끝 4글자이고 같은 회원은 항상 같다', () => {
  const format = loadDisplayName()
  const userId = '83d5ad03-3723-4dd3-9924-836c7c6e1f04'
  assert.equal(format('kimteacher@example.com', userId), 'kim1f04')
  assert.equal(format('kimteacher@example.com', userId), format('kimteacher@example.com', userId))
  assert.equal(format('ab@example.com', userId), 'ab1f04')
  assert.equal(format(null, userId), '회원1f04')
  // 이메일 전체(도메인 포함)는 드러나지 않는다
  assert.doesNotMatch(format('kimteacher@example.com', userId), /@|example/)
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
  assert.match(reviews, /name: formatMemberDisplayName\(profile\?\.email, review\.user_id\)/)
  assert.doesNotMatch(reviews, /profile\?\.name|email: profile/)
  assert.match(read('src/components/layout/header.tsx'), /formatMemberDisplayName\(profile\?\.email \?\? user\.email, user\.id\)/)
  assert.match(read('src/app/checkout/page.tsx'), /name: formatMemberDisplayName\(profile\?\.email \?\? user\.email, user\.id\)/)
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
