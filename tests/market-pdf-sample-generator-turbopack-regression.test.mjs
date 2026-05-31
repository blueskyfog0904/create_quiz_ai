import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const sampleGenerator = readFileSync(
  new URL('../src/lib/market-pdf-sample-generator.ts', import.meta.url),
  'utf8'
)

function containsDynamicImport(node) {
  let found = false

  function visit(current) {
    if (found) {
      return
    }

    if (
      ts.isCallExpression(current) &&
      current.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      found = true
      return
    }

    ts.forEachChild(current, visit)
  }

  visit(node)
  return found
}

test('pdf sample generator no longer depends on Playwright page evaluate callbacks', () => {
  const sourceFile = ts.createSourceFile(
    'market-pdf-sample-generator.ts',
    sampleGenerator,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const offenders = []

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'evaluate'
    ) {
      const callback = node.arguments[0]
      if (
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        containsDynamicImport(callback)
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(callback.getStart(sourceFile))
        offenders.push(`${position.line + 1}:${position.character + 1}`)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  assert.doesNotMatch(sampleGenerator, /playwright/)
  assert.doesNotMatch(sampleGenerator, /chromium\.launch/)
  assert.doesNotMatch(sampleGenerator, /page\.evaluate/)
  assert.deepEqual(
    offenders,
    [],
    `Playwright page.evaluate callbacks must not contain dynamic import(): ${offenders.join(', ')}`
  )
})
