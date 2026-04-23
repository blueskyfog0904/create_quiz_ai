import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const diagnosticScriptPath = new URL(
  '../scripts/playwright_diagnose_saved_pdf_pdfjs.cjs',
  import.meta.url
)
const fileRenderScriptPath = new URL(
  '../scripts/render_pdf_file_with_pdfjs.cjs',
  import.meta.url
)
const routeVerifyScriptPath = new URL(
  '../scripts/playwright_verify_pdf_workspace_route_profile.cjs',
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

test('local PDF render script exists and supports file-path driven PDF.js rendering', () => {
  assert.equal(
    existsSync(fileRenderScriptPath),
    true,
    'expected local PDF render script to exist'
  )

  const source = readFileSync(fileRenderScriptPath, 'utf8')

  assert.match(source, /readFileSync\(pdfFilePath\)/)
  assert.match(source, /pdfjs-dist\/build\/pdf\.mjs/)
  assert.match(source, /canvas\.toDataURL\('image\/png'\)/)
  assert.match(source, /output_saved_pdf_file_page/)
})

test('route verification script exists and audits all workspace mode/layout combinations', () => {
  assert.equal(
    existsSync(routeVerifyScriptPath),
    true,
    'expected route verification script to exist'
  )

  const source = readFileSync(routeVerifyScriptPath, 'utf8')

  assert.match(source, /connectOverCDP/)
  assert.match(source, /시험지\+답안|시험지\+답안/)
  assert.match(source, /시험지/)
  assert.match(source, /답안/)
  assert.match(source, /1단/)
  assert.match(source, /2단/)
  assert.match(source, /output_route_verify_/)
})
