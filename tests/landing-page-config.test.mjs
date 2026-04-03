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

test('validateMainLandingConfig allows more than three workspace-card highlight chips', () => {
  const next = getDefaultMainLandingConfig()
  next.workspaceCards[0].highlightChips = ['AI 문제생성', '문제은행', '문제지 제작', '라이브러리']

  assert.doesNotThrow(() => validateMainLandingConfig(next))
})
