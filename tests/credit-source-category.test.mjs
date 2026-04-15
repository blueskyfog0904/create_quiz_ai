import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAdminGrantSourceCategory } from '../src/lib/credit-source-display.ts'

test('maps admin compensation and other grants to admin_grant', () => {
  assert.equal(resolveAdminGrantSourceCategory('compensation'), 'admin_grant')
  assert.equal(resolveAdminGrantSourceCategory('other'), 'admin_grant')
})

test('maps admin event grants to bonus and refund grants to system_refund', () => {
  assert.equal(resolveAdminGrantSourceCategory('event'), 'bonus')
  assert.equal(resolveAdminGrantSourceCategory('refund'), 'system_refund')
})
