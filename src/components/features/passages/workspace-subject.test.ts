import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPassageLibraryHref, resolvePassageWorkspaceSubject } from './workspace-subject'

test('explicit workspace subject overrides pathname parsing', () => {
  assert.equal(resolvePassageWorkspaceSubject('/english/library/mypassages', 'korean'), 'korean')
})

test('pathname-derived workspace subject is preserved for scoped routes', () => {
  assert.equal(resolvePassageWorkspaceSubject('/korean/library/mypassages'), 'korean')
  assert.equal(buildPassageLibraryHref('/korean/generate'), '/korean/library/mypassages')
})

test('unscoped paths default passage workspace routing to english', () => {
  assert.equal(resolvePassageWorkspaceSubject('/library/mypassages'), 'english')
  assert.equal(buildPassageLibraryHref('/library/mypassages'), '/english/library/mypassages')
})
