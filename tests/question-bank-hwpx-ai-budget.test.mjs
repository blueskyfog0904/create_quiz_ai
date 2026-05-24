import assert from 'node:assert/strict'
import test from 'node:test'
import '../src/components/features/passages/node-test-register.mjs'


const {
  assertHwpxAiTokenBudgetWithinLimit,
  estimateHwpxAiTokenBudget,
  estimateTokenCount,
} = await import('../src/lib/question-bank/hwpx-ai.ts')
const { HWPX_UPLOAD_LIMITS } = await import('../src/lib/question-bank/hwpx-upload-types.ts')

test('estimateTokenCount uses conservative utf8 byte length rather than length divided by three', () => {
  assert.equal(estimateTokenCount('가나다'), Buffer.byteLength('가나다', 'utf8'))
})

test('estimateHwpxAiTokenBudget includes schema and request overhead beyond raw chunk and output tokens', () => {
  const rawMinimum = Buffer.byteLength('short', 'utf8') + HWPX_UPLOAD_LIMITS.maxAiOutputTokens
  const projected = estimateHwpxAiTokenBudget({ chunks: ['short'], problemTypes: [] })

  assert.ok(projected > rawMinimum + HWPX_UPLOAD_LIMITS.chatRequestOverheadTokens)
})

test('assertHwpxAiTokenBudgetWithinLimit rejects projected over-budget calls before OpenAI is called', () => {
  assert.throws(() => assertHwpxAiTokenBudgetWithinLimit({
    chunks: Array.from({ length: HWPX_UPLOAD_LIMITS.maxAiChunks }, () => 'x'.repeat(HWPX_UPLOAD_LIMITS.maxAiChunkChars)),
    problemTypes: [],
  }), /AI 분석 토큰 한도/)
})
