import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const profileClientSource = readFileSync(
  new URL('../src/app/(dashboard)/mypage/profile/profile-client.tsx', import.meta.url),
  'utf8'
)

test('mypage password change verifies the current password before showing the new-password form', () => {
  assert.match(profileClientSource, /Label htmlFor="currentPassword">기존 비밀번호/)
  assert.match(profileClientSource, /!\s*isCurrentPasswordVerified\s*\?/)
  assert.match(profileClientSource, /기존 비밀번호 확인/)
  assert.match(profileClientSource, /signInWithPassword\(\{\s*email,\s*password: currentPassword/s)
  assert.match(profileClientSource, /updateUser\(\{\s*password: newPassword/s)
})
