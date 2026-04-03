import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWorkspaceLandingFeatureGridClassName,
  getWorkspaceLandingWorkflowGridClassName,
} from '../src/lib/workspace-landing-layout.ts'

test('three-card Korean sections use three-column layouts on large screens', () => {
  assert.match(getWorkspaceLandingFeatureGridClassName(3), /xl:grid-cols-3/)
  assert.match(getWorkspaceLandingWorkflowGridClassName(3), /lg:grid-cols-3/)
})

test('four-card English sections keep four-column layouts on large screens', () => {
  assert.match(getWorkspaceLandingFeatureGridClassName(4), /xl:grid-cols-4/)
  assert.match(getWorkspaceLandingWorkflowGridClassName(4), /lg:grid-cols-4/)
})
