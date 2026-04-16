import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const profileClientSource = readFileSync(
  new URL('../src/app/(dashboard)/mypage/profile/profile-client.tsx', import.meta.url),
  'utf8'
)

test('mypage password change requires current password input before updateUser', () => {
  assert.match(profileClientSource, /Label htmlFor="currentPassword">기존 비밀번호/)
  assert.match(profileClientSource, /signInWithPassword\(\{\s*email,\s*password: currentPassword/s)
  assert.match(profileClientSource, /updateUser\(\{\s*password: newPassword/s)
})
