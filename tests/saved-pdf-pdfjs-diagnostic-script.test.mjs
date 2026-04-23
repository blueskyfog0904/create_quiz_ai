import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const diagnosticScriptPath = new URL(
  '../scripts/playwright_diagnose_saved_pdf_pdfjs.cjs',
  import.meta.url
)

test('saved PDF PDF.js diagnostic script exists and uses PDF.js canvas rendering', () => {
  assert.equal(
    existsSync(diagnosticScriptPath),
    true,
    'expected saved PDF diagnostic script to exist'
  )

  const source = readFileSync(diagnosticScriptPath, 'utf8')

  assert.match(source, /pdfjs-dist\/build\/pdf\.mjs/)
  assert.match(source, /pdfjs-dist\/build\/pdf\.worker\.mjs/)
  assert.match(source, /fetch\(location\.href\)/)
  assert.match(source, /canvas\.toDataURL\('image\/png'\)/)
  assert.match(source, /output_saved_pdf_pdfjs_page/)
})
