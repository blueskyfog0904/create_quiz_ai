import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const helperSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf-workspace-drag.ts', import.meta.url),
  'utf8'
)
const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-pdf-workspace-drag-'))
const runtimeModulePath = join(tempDir, 'exam-paper-pdf-workspace-drag.runtime.mjs')
const runtimeSource = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

writeFileSync(runtimeModulePath, runtimeSource)

const dragModule = await import(`${pathToFileURL(runtimeModulePath).href}?t=${Date.now()}`)

const {
  isNoopQuestionInsertion,
  resolveInsertionIndexFromPointer,
  resolveQuestionMoveIndex,
} = dragModule

test('resolves insertion boundary from pointer position within a row', () => {
  assert.equal(
    resolveInsertionIndexFromPointer({ clientY: 118, itemTop: 100, itemHeight: 40, itemIndex: 2 }),
    2,
    'top half should insert before the hovered item'
  )

  assert.equal(
    resolveInsertionIndexFromPointer({ clientY: 121, itemTop: 100, itemHeight: 40, itemIndex: 2 }),
    3,
    'bottom half should insert after the hovered item'
  )

  assert.equal(
    resolveInsertionIndexFromPointer({ clientY: 120, itemTop: 100, itemHeight: 40, itemIndex: 2 }),
    2,
    'exact midpoint stays before so the boundary does not flicker when the pointer is centered'
  )
})

test('converts insertion boundary to move index for upward, downward, and end moves', () => {
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 3, insertionIndex: 1, totalCount: 6 }), 1)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 1, insertionIndex: 4, totalCount: 6 }), 3)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 0, insertionIndex: 6, totalCount: 6 }), 5)
})

test('treats self boundaries and invalid indexes as no-op moves', () => {
  assert.equal(isNoopQuestionInsertion(2, null), true)
  assert.equal(isNoopQuestionInsertion(2, 2), true)
  assert.equal(isNoopQuestionInsertion(2, 3), true)
  assert.equal(isNoopQuestionInsertion(2, 1), false)
  assert.equal(isNoopQuestionInsertion(2, 4), false)

  assert.equal(resolveQuestionMoveIndex({ fromIndex: 2, insertionIndex: 2, totalCount: 6 }), null)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 2, insertionIndex: 3, totalCount: 6 }), null)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: -1, insertionIndex: 2, totalCount: 6 }), null)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 2, insertionIndex: null, totalCount: 6 }), null)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 2, insertionIndex: -1, totalCount: 6 }), null)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 2, insertionIndex: 7, totalCount: 6 }), null)
  assert.equal(resolveQuestionMoveIndex({ fromIndex: 0, insertionIndex: 1, totalCount: 0 }), null)
})
