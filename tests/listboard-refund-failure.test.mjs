import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const runRoute = readFileSync(new URL('../src/app/api/generate/listboard-jobs/[jobId]/run/route.ts', import.meta.url), 'utf8')
const retryRoute = readFileSync(new URL('../src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts', import.meta.url), 'utf8')

// 환불 호출 하나가 try 안에 있고, catch 뒤에 job 최종 상태 UPDATE가 이어지는지 본다.
function assertRefundCaughtBeforeFinalUpdate(source) {
  const refundCalls = source.match(/CreditService\.refundCredits\(/g) ?? []
  assert.equal(refundCalls.length, 1)

  const refundAt = source.indexOf('CreditService.refundCredits(')
  const tryAt = source.lastIndexOf('try {', refundAt)
  const catchAt = source.indexOf('} catch (error) {', refundAt)
  const finalUpdateAt = source.indexOf('status: finalStatus', refundAt)

  assert.ok(tryAt !== -1 && tryAt < refundAt)
  // try와 환불 호출 사이에 다른 블록이 끼지 않는다.
  assert.doesNotMatch(source.slice(tryAt, refundAt), /\}/)
  assert.ok(catchAt > refundAt)
  assert.ok(finalUpdateAt > catchAt)

  const catchBody = source.slice(catchAt, source.indexOf('\n    }\n', catchAt))
  assert.match(catchBody, /console\.error\(/)
  assert.doesNotMatch(catchBody, /throw|return/)
}

test('the listboard run route keeps closing the job when the failed-generation refund throws', () => {
  assertRefundCaughtBeforeFinalUpdate(runRoute)
  // 실패하면 잔액은 차감 결과 그대로 둔다.
  assert.match(runRoute, /let finalBalance = deductionResult\.newBalance[\s\S]*?try \{\s*finalBalance = await CreditService\.refundCredits\(/)
})

test('the listboard retry route keeps closing the job when the retry refund throws', () => {
  assertRefundCaughtBeforeFinalUpdate(retryRoute)
})
