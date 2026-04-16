import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBackoffDelayMs,
  getErrorStatusCode,
  isRetryableGeminiError,
  withGeminiRetry,
} from '../src/lib/ocr/gemini-retry.ts'

test('extracts status code from Gemini-style error objects', () => {
  assert.equal(getErrorStatusCode({ status: 503 }), 503)
  assert.equal(getErrorStatusCode({ status: '503' }), null)
  assert.equal(getErrorStatusCode(null), null)
})

test('classifies 429/500/503 as retryable Gemini errors', () => {
  assert.equal(isRetryableGeminiError({ status: 429 }), true)
  assert.equal(isRetryableGeminiError({ status: 500 }), true)
  assert.equal(isRetryableGeminiError({ status: 503 }), true)
  assert.equal(isRetryableGeminiError({ status: 400 }), false)
})

test('backoff delay increases and stays bounded', () => {
  const first = getBackoffDelayMs(0)
  const second = getBackoffDelayMs(1)
  const later = getBackoffDelayMs(10)

  assert.ok(first >= 1000 && first <= 1249)
  assert.ok(second >= 2000 && second <= 2249)
  assert.ok(later >= 8000 && later <= 8249)
})

test('withGeminiRetry retries transient failures and eventually succeeds', async () => {
  let calls = 0
  const delays = []

  const result = await withGeminiRetry(async () => {
    calls += 1
    if (calls < 3) {
      throw { status: 503 }
    }

    return 'ok'
  }, {
    sleep: async () => {},
    getDelayMs: (attempt) => 1000 * (attempt + 1),
    onRetry: (_attempt, delayMs) => {
      delays.push(delayMs)
    },
  })

  assert.equal(result, 'ok')
  assert.equal(calls, 3)
  assert.deepEqual(delays, [1000, 2000])
})

test('withGeminiRetry does not retry non-transient failures', async () => {
  let calls = 0

  await assert.rejects(() => withGeminiRetry(async () => {
    calls += 1
    throw { status: 400 }
  }, {
    sleep: async () => {},
  }))

  assert.equal(calls, 1)
})
