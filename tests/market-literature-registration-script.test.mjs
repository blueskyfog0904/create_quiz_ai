import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('literature market registration dry-run discovers the expected candidates', () => {
  const result = spawnSync('node', [
    'scripts/register_literature_market.mjs',
    '--dry-run',
    '--no-render',
  ], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const output = JSON.parse(result.stdout)

  assert.equal(output.mode, 'dry-run')
  assert.equal(output.candidateCount, 80)
  assert.equal(output.hwpxAsHwpCount, 1)
  assert.equal(output.excludedPdfCount, 8)
  assert.equal(output.samplePagesPerItem, 3)
  assert.equal(output.subproductsPerItem, 2)
  assert.equal(output.bundleOptionsPerItem, 0)
  assert.equal(output.bundlePriceCredits, null)
  assert.equal(output.subproductPlan.questionPdf.priceCredits, 2500)
  assert.equal(output.subproductPlan.questionHwp.priceCredits, 3000)
})
