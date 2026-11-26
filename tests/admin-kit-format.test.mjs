import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ADMIN_UNAVAILABLE,
  formatCount,
  formatCredits,
  formatDelta,
  formatKstFull,
  formatKstShort,
  formatKstTime,
  formatSignedCredits,
  formatWon,
} from '../src/lib/admin-format.ts'

// 20번 5-1: 관리자 숫자·날짜 표기는 이 함수에서만 나온다. 값 없음 '–', 세지 못함 '확인 불가'.

test('원·크레딧·건수 표기', () => {
  assert.equal(formatWon(9900), '9,900원')
  assert.equal(formatWon(0), '0원')
  assert.equal(formatWon(-1500), '−1,500원')
  assert.equal(formatCredits(3000), '3,000 C')
  assert.equal(formatCount(1234), '1,234')
  assert.equal(formatCount(12, '건'), '12건')
})

test('크레딧 증감은 부호를 붙이고 음수는 − 를 쓴다(색은 정하지 않음, Q6)', () => {
  assert.equal(formatSignedCredits(3000), '+3,000 C')
  assert.equal(formatSignedCredits(-3000), '−3,000 C')
  assert.equal(formatSignedCredits(0), '0 C')
})

test('값 없음은 –, 세지 못한 값은 확인 불가', () => {
  for (const format of [formatWon, formatCredits, formatSignedCredits, formatCount]) {
    assert.equal(format(null), '–')
    assert.equal(format(undefined), '–')
    assert.equal(format(ADMIN_UNAVAILABLE), '확인 불가')
    assert.equal(format(Number.NaN), '확인 불가')
  }
  assert.equal(formatKstShort(null), '–')
  assert.equal(formatKstShort(''), '–')
  assert.equal(formatKstFull('not-a-date'), '확인 불가')
})

test('한국 시간 경계: UTC 14:59 는 같은 날 23:59, 15:00 은 다음 날 00:00', () => {
  assert.equal(formatKstShort('2026-11-19T01:44:00Z'), '11-19 10:44')
  assert.equal(formatKstFull('2026-11-19T14:59:00Z'), '2026-11-19 23:59')
  assert.equal(formatKstFull('2026-11-19T15:00:00Z'), '2026-11-20 00:00')
  assert.equal(formatKstFull('2026-12-31T15:00:00Z'), '2027-01-01 00:00')
  assert.equal(formatKstTime(new Date('2026-11-19T05:02:00Z')), '14:02')
})

test('증감: 비율, 앞 기간 0 은 "이전 0 → 신규", 어느 쪽이든 세지 못하면 확인 불가', () => {
  assert.deepEqual(formatDelta(120, 100), { direction: 'up', text: '20.0%' })
  assert.deepEqual(formatDelta(75, 100), { direction: 'down', text: '25.0%' })
  assert.deepEqual(formatDelta(100, 100), { direction: 'flat', text: '변화 없음' })
  assert.deepEqual(formatDelta(0, 0), { direction: 'flat', text: '변화 없음' })
  assert.deepEqual(formatDelta(5, 0), { direction: 'up', text: '이전 0 → 신규' })
  assert.deepEqual(formatDelta(5, ADMIN_UNAVAILABLE), { direction: 'unavailable', text: '확인 불가' })
  assert.deepEqual(formatDelta(null, 3), { direction: 'unavailable', text: '확인 불가' })
})
