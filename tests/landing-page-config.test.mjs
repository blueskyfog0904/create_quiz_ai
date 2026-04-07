import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getDefaultMainLandingConfig,
  getDefaultWorkspaceLandingConfig,
  normalizeMainLandingConfig,
  normalizeWorkspaceLandingConfig,
  validateMainLandingConfig,
  validateWorkspaceLandingConfig,
} from '../src/lib/landing-page.ts'

test('normalizeMainLandingConfig falls back to defaults when input is missing', () => {
  const config = normalizeMainLandingConfig(null)

  assert.equal(config.workspaceCards.length, 2)
  assert.equal(config.valuePoints.length, 3)
  assert.equal(config.hero.chips.length, 3)
})

test('normalizeWorkspaceLandingConfig falls back to subject defaults when input is invalid', () => {
  const config = normalizeWorkspaceLandingConfig('korean', { title: 'broken' })
  const defaults = getDefaultWorkspaceLandingConfig('korean')

  assert.equal(config.title, defaults.title)
  assert.equal(config.features.length, defaults.features.length)
  assert.equal(config.steps.length, defaults.steps.length)
  assert.equal(config.workflowHeading, defaults.workflowHeading)
})

test('legacy landing configs without fontSteps normalize with default zero font steps', () => {
  const config = normalizeWorkspaceLandingConfig('english', {
    eyebrow: 'English Workspace',
    title: 'Title',
    description: 'Desc',
    heroSummary: 'Summary',
    featureHeading: 'Features',
    featureIntro: 'Intro',
    workflowBadge: 'Workflow',
    workflowHeading: 'Heading',
    workflowIntro: 'Workflow intro',
    ctaHeadline: 'CTA Headline',
    ctaBody: 'CTA Body',
    ctaHint: 'CTA Hint',
    guide: {
      label: '사용방법 가이드',
      url: 'https://wind-rat-0db.notion.site/33bfb91711e780a3b4cfdd6dbe47f942',
    },
    quickPills: ['One'],
    features: [{ title: 'Feature', description: 'Feature desc', icon: 'sparkles' }],
    steps: [{ title: 'Step', description: 'Step desc', icon: 'sparkles' }],
    theme: 'indigo',
  })

  assert.equal(config.fontSteps.hero.title, 0)
  assert.equal(config.fontSteps.featureSection.description, 0)
  assert.equal(config.fontSteps.cta.body, 0)
  assert.equal(config.guide.label, '사용방법 가이드')
})

test('legacy landing configs without guide keep customized content and receive default guide', () => {
  const config = normalizeWorkspaceLandingConfig('english', {
    eyebrow: 'English Workspace',
    title: 'Custom Title',
    description: 'Custom Desc',
    heroSummary: 'Summary',
    featureHeading: 'Features',
    featureIntro: 'Intro',
    workflowBadge: 'Workflow',
    workflowHeading: 'Heading',
    workflowIntro: 'Workflow intro',
    ctaHeadline: 'CTA Headline',
    ctaBody: 'CTA Body',
    ctaHint: 'CTA Hint',
    quickPills: ['One'],
    features: [{ title: 'Feature', description: 'Feature desc', icon: 'sparkles' }],
    steps: [{ title: 'Step', description: 'Step desc', icon: 'sparkles' }],
    theme: 'indigo',
  })

  assert.equal(config.title, 'Custom Title')
  assert.equal(config.guide.label, '사용방법 가이드')
  assert.equal(config.guide.url, 'https://wind-rat-0db.notion.site/33bfb91711e780a3b4cfdd6dbe47f942')
})

test('validateMainLandingConfig rejects invalid chip counts', () => {
  const next = getDefaultMainLandingConfig()
  next.hero.chips = ['one', 'two']

  assert.throws(() => validateMainLandingConfig(next))
})

test('validateWorkspaceLandingConfig rejects missing workflow fields', () => {
  const next = getDefaultWorkspaceLandingConfig('english')
  next.workflowHeading = ''

  assert.throws(() => validateWorkspaceLandingConfig(next))
})

test('validateWorkspaceLandingConfig normalizes duplicated guide URLs before saving', () => {
  const next = getDefaultWorkspaceLandingConfig('english')
  next.guide.url = 'https://wind-rat-0db.notion.site/33bfb91711e780a3b4cfdd6dbe47f942https://wind-rat-0db.notion.site/33bfb91711e780a3b4cfdd6dbe47f942'

  const config = validateWorkspaceLandingConfig(next)

  assert.equal(config.guide.url, 'https://wind-rat-0db.notion.site/33bfb91711e780a3b4cfdd6dbe47f942')
})

test('validateMainLandingConfig allows more than three workspace-card highlight chips', () => {
  const next = getDefaultMainLandingConfig()
  next.workspaceCards[0].highlightChips = ['AI 문제생성', '문제은행', '문제지 제작', '라이브러리']

  assert.doesNotThrow(() => validateMainLandingConfig(next))
})
