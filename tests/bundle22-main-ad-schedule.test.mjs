import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers/market-images-harness.mjs'

// 22번 묶음 배너 예약 노출 순수 시험(계획 docs/plan-bundle22-home-merch.md 3-5·8절):
// isMainAdVisibleAt 경계(시작 정각 보임, 끝 정각 안 보임, null), 한국 시간 → UTC, 끝 ≤ 시작 거절, 예약 칸 보존.
const ad = load('src/lib/main-ad-carousel.ts')
const tone = load('src/lib/admin-status-tone.ts')

const itemId = '5f5bdada-e30a-48ca-88e9-51f994f6f6ec'
const pcImagePath = `carousel/${itemId}/pc/76757991-f555-4a8a-a6cb-e0031f9f5945.webp`
const item = (extra = {}) => ({
  id: itemId, title: '특강 할인', pcImagePath, mobileImagePath: null, alt: '특강 할인 안내', href: '/pricing',
  durationSeconds: 5, isActive: true, startsAt: null, endsAt: null, ...extra,
})

test('isMainAdVisibleAt: 시작 정각부터 보이고 끝 정각부터 안 보인다, null 은 바로·계속', () => {
  const window = { startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-02T00:00:00.000Z' }
  assert.equal(ad.isMainAdVisibleAt(window, new Date('2026-11-30T23:59:59.999Z')), false)
  assert.equal(ad.isMainAdVisibleAt(window, new Date('2026-12-01T00:00:00.000Z')), true)
  assert.equal(ad.isMainAdVisibleAt(window, new Date('2026-12-01T23:59:59.999Z')), true)
  assert.equal(ad.isMainAdVisibleAt(window, new Date('2026-12-02T00:00:00.000Z')), false)
  assert.equal(ad.isMainAdVisibleAt({ startsAt: null, endsAt: null }, new Date('2030-01-01T00:00:00Z')), true)
  assert.equal(ad.isMainAdVisibleAt({ startsAt: null, endsAt: '2026-12-02T00:00:00.000Z' }, new Date('2020-01-01T00:00:00Z')), true)
  // 옛 캐시 값(칸 없음)은 늘 보인다
  assert.equal(ad.isMainAdVisibleAt({}, new Date()), true)
  const now = new Date('2026-12-01T12:00:00Z')
  assert.deepEqual(ad.filterVisibleMainAdItems([
    { id: 'a', ...window }, { id: 'b', startsAt: '2026-12-03T00:00:00Z', endsAt: null }, { id: 'c', startsAt: null, endsAt: '2026-12-01T12:00:00Z' },
  ], now).map((entry) => entry.id), ['a'])
})

test('한국 시간 → UTC: 입력 칸 값(YYYY-MM-DDTHH:mm)은 브라우저 시간대와 무관하게 +09:00 으로 읽는다', () => {
  assert.equal(ad.kstLocalToUtcIso('2026-12-01T09:00'), '2026-12-01T00:00:00.000Z')
  assert.equal(ad.kstLocalToUtcIso('2026-12-01T00:30'), '2026-11-30T15:30:00.000Z')
  assert.equal(ad.kstLocalToUtcIso('2026-02-30T09:00'), null)
  assert.equal(ad.kstLocalToUtcIso('2026-12-01 09:00'), null)
  assert.equal(ad.utcIsoToKstLocal('2026-11-30T15:30:00.000Z'), '2026-12-01T00:30')
  assert.equal(ad.utcIsoToKstLocal(null), '')
  // 저장 검사가 서버에서 UTC 로 바꾼다(시간대 없는 값 = 한국 시간)
  const draft = ad.validateMainAdCarouselDraftConfig({ version: 1, items: [item({ startsAt: '2026-12-01T09:00', endsAt: '2026-12-01T18:00:00+09:00' })] })
  assert.equal(draft.items[0].startsAt, '2026-12-01T00:00:00.000Z')
  assert.equal(draft.items[0].endsAt, '2026-12-01T09:00:00.000Z')
})

test('끝 ≤ 시작·형식 틀림은 거절한다', () => {
  for (const schedule of [
    { startsAt: '2026-12-01T09:00', endsAt: '2026-12-01T09:00' },
    { startsAt: '2026-12-02T09:00', endsAt: '2026-12-01T09:00' },
    { startsAt: 'tomorrow', endsAt: null },
    { startsAt: '2026-12-01', endsAt: null },
    { startsAt: 1764547200000, endsAt: null },
  ]) {
    assert.throws(() => ad.validateMainAdCarouselDraftConfig({ version: 1, items: [item(schedule)] }), ad.MainAdCarouselValidationError, JSON.stringify(schedule))
  }
})

test('예약 칸 보존: 저장된 값 읽기·과목 바꾸기·관리 화면 값이 startsAt·endsAt 을 그대로 싣는다(판 2 그대로)', () => {
  const scheduled = item({ startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-02T00:00:00.000Z' })
  const stored = { version: 2, items: { english: [scheduled], korean: [] } }
  const normalized = ad.normalizeMainAdCarouselConfig(stored)
  assert.equal(normalized.version, 2)
  assert.deepEqual(normalized.items.english[0], scheduled)
  const replaced = ad.replaceMainAdCarouselSubjectConfig(normalized, 'korean', { version: 1, items: [] })
  assert.deepEqual(ad.getMainAdCarouselSubjectConfig(replaced, 'english').items[0], scheduled)
  // 캐시 함수는 isActive 만 거르고 기간은 거르지 않는다(기간 거르기는 page 에서)
  const past = item({ endsAt: '2020-01-01T00:00:00.000Z' })
  assert.deepEqual(ad.getActiveMainAdCarouselItems({ version: 2, items: { english: [past], korean: [] } }, 'english'), [past])
})

test('관리 화면 상태: 꺼짐·예약·종료·노출 중, tone 키가 20번 표(banner)와 같다', () => {
  const now = new Date('2026-12-01T12:00:00Z')
  assert.equal(ad.getMainAdScheduleStatus(item({ isActive: false, startsAt: '2026-12-03T00:00:00Z' }), now), 'off')
  assert.equal(ad.getMainAdScheduleStatus(item({ startsAt: '2026-12-03T00:00:00Z' }), now), 'scheduled')
  assert.equal(ad.getMainAdScheduleStatus(item({ endsAt: '2026-12-01T12:00:00Z' }), now), 'ended')
  assert.equal(ad.getMainAdScheduleStatus(item(), now), 'live')
  assert.deepEqual([...ad.MAIN_AD_SCHEDULE_STATUSES].sort(), Object.keys(tone.ADMIN_STATUS_TONES.banner).sort())
  assert.deepEqual(Object.keys(ad.MAIN_AD_SCHEDULE_STATUS_LABELS).sort(), [...ad.MAIN_AD_SCHEDULE_STATUSES].sort())
  assert.equal(tone.adminStatusTone('banner', 'live'), 'success')
  assert.equal(tone.adminStatusTone('banner', 'scheduled'), 'info')
})

test('작업 기록 차이: 배너별 켜기·기간·링크·순서, 제목·대체 글 원문 없음', () => {
  const second = item({ id: '18847a16-f0a8-4ccf-a3a1-d50e5e6e9d20', title: '두 번째 비밀 제목', alt: '비밀 대체 글' })
  const before = [item({ title: '첫 비밀 제목' }), second]
  const after = [
    { ...second, isActive: false },
    item({ title: '바꾼 비밀 제목', startsAt: '2026-12-01T00:00:00.000Z', href: '/search?subject=korean' }),
  ]
  const changes = ad.diffMainAdItems(before, after)
  const text = JSON.stringify(changes)
  for (const raw of ['비밀 제목', '비밀 대체 글']) assert.equal(text.includes(raw), false, raw)
  assert.deepEqual(changes[0].fields, ['position', 'isActive'])
  assert.deepEqual(changes[1].fields, ['position', 'schedule', 'href', 'text'])
  assert.equal(changes[1].startsAt, '2026-12-01T00:00:00.000Z')
  assert.deepEqual(ad.diffMainAdItems([item()], []), [{ id: itemId, change: 'removed' }])
})
