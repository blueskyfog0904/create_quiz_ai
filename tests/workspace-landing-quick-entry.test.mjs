import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWorkspaceLandingQuickEntryTargets } from '../src/lib/workspace-landing-quick-entry.ts'

test('english landing targets first visible generate and market children', () => {
  const result = resolveWorkspaceLandingQuickEntryTargets('english', [
    {
      id: 'generate',
      title: '영어문제생성',
      href: '/generate',
      isActive: true,
      children: [
        { id: 'mock-exams', title: '모의고사', href: '/generate/boards/mock-exams', isActive: true },
        { id: 'personal', title: '개인지문', href: '/generate/personal', isActive: true },
      ],
    },
    {
      id: 'market',
      title: '영어문제마켓',
      href: '/market',
      isActive: true,
      children: [
        { id: 'market-mock', title: '모의고사', href: '/market/mock-exams', isActive: true },
      ],
    },
  ])

  assert.equal(result.primaryLabel, '영어문제생성 서비스 들어가기')
  assert.equal(result.primaryHref, '/english/generate/boards/mock-exams')
  assert.equal(result.secondaryLabel, '영어문제마켓 서비스 들어가기')
  assert.equal(result.secondaryHref, '/english/market/mock-exams')
})

test('korean landing keeps only the market CTA and targets its first visible child', () => {
  const result = resolveWorkspaceLandingQuickEntryTargets('korean', [
    {
      id: 'market',
      title: '국어문제마켓',
      href: '/market',
      isActive: true,
      children: [
        { id: 'market-mock', title: '모의고사', href: '/market/mock-exams', isActive: true },
      ],
    },
    {
      id: 'library',
      title: '국어 라이브러리',
      href: '/library',
      isActive: true,
      children: [
        { id: 'library-market', title: '국어문제마켓 관리', href: '/library/market', isActive: true },
      ],
    },
  ])

  assert.equal(result.primaryLabel, '국어문제마켓 서비스 들어가기')
  assert.equal(result.primaryHref, '/korean/market/mock-exams')
  assert.equal(result.secondaryLabel, null)
  assert.equal(result.secondaryHref, null)
})
