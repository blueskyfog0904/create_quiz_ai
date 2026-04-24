import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const routeSource = readFileSync(
  new URL('../src/app/api/exam-papers/print-pdf/route.ts', import.meta.url),
  'utf8'
)

test('print-pdf route accepts finalized HTML PDF options and renders with Chromium', () => {
  assert.match(routeSource, /html:\s*z\.string\(\)\.min\(1\)\.max\(MAX_PRINT_HTML_BYTES\)/)
  assert.match(routeSource, /fileName:\s*z\.string\(\)\.optional\(\)/)
  assert.match(routeSource, /disposition:\s*z\.enum\(\['attachment', 'inline'\]\)\.optional\(\)/)
  assert.match(routeSource, /preferCSSPageSize:\s*true/)
  assert.match(routeSource, /printBackground:\s*true/)
  assert.match(routeSource, /page\.emulateMedia\(\{ media: 'print' \}\)/)
  assert.doesNotMatch(routeSource, /page\.emulateMedia\(\{ media: 'screen' \}\)/)
  assert.match(routeSource, /filename\*=UTF-8''/)
  assert.match(routeSource, /encodeURIComponent\(sanitizedFileName\)/)
})

test('print-pdf route requires auth and blocks outbound render requests', () => {
  assert.match(routeSource, /createClient/)
  assert.match(routeSource, /auth\.getUser\(\)/)
  assert.match(routeSource, /Please login first/)
  assert.match(routeSource, /page\.route\('\*\*\/\*'/)
  assert.match(routeSource, /url\.startsWith\('data:'\)/)
  assert.match(routeSource, /route\.abort\(\)/)
  assert.match(routeSource, /javaScriptEnabled:\s*false/)
  assert.match(routeSource, /content-length/)
  assert.match(routeSource, /PAYLOAD_TOO_LARGE/)
  assert.match(routeSource, /setDefaultTimeout\(15_000\)/)
})
