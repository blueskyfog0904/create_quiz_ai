import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// U1-3: 관리자에게 가던 notifications 삽입을 걷어낸다. 관리자 알림은 admin_events 한 곳으로 모은다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const webhook = read('src/lib/payapp-webhook-server.ts')
const balance = read('src/lib/credit-balance.ts')
const migration = read('supabase/migrations/20261113210000_admin_events.sql')

const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${startMarker} 가 있어야 한다`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${endMarker} 가 뒤에 있어야 한다`)
  return source.slice(start, end)
}

test('payapp 웹훅 후속 처리는 관리자에게 notifications를 넣지 않고, 회원 알림만 남긴다', () => {
  const followUps = between(webhook, 'export async function runFollowUps', '\nexport ')

  // 경보는 그대로 기록한다(이 INSERT의 트리거가 admin_events를 만든다).
  assert.match(followUps, /admin\.rpc\('record_payment_alert'/)
  assert.match(migration, /AFTER INSERT ON public\.payment_reconciliation_alerts/)

  // 관리자 목록 조회와 관리자용 삽입은 파일 어디에도 없다.
  assert.doesNotMatch(webhook, /is_admin/)
  assert.doesNotMatch(webhook, /admins\.map/)
  assert.doesNotMatch(webhook, /admin_events/)

  // 16번: 웹훅 파일은 notifications 에 직접 넣지 않는다. 회원 알림 하나만 공용 함수(종류·회원 id)로 보낸다 — 관리자에게 가는 알림은 없다.
  const inserts = [...webhook.matchAll(/\.from\('notifications'\)\s*\.insert\(/g)]
  assert.equal(inserts.length, 0)
  assert.equal([...followUps.matchAll(/sendMemberNotification\(/g)].length, 1)
  assert.match(
    followUps,
    /if \(followUps\.userNotification\) \{\s+const \{ paymentOrderId, \.\.\.request \} = followUps\.userNotification[\s\S]*?await sendMemberNotification\(request\)/
  )
  // 알림 종류는 회원 결과 두 가지뿐(충전 완료·결제사 취소 확인 환불)
  assert.deepEqual([...webhook.matchAll(/kind: '(\w+)' as const/g)].map((match) => match[1]).sort(), ['chargeCompleted', 'chargeRefundProviderFinalized'])
})

test('잔액 불일치는 admin_events 1행으로 남기고 notifications를 쓰지 않는다', () => {
  const report = between(balance, 'export async function reportCreditBalanceMismatch', '\nasync function getClient')

  assert.doesNotMatch(balance, /notifications/)
  assert.doesNotMatch(balance, /is_admin/)

  const inserts = [...report.matchAll(/\.from\('admin_events'\)\s*\.insert\(\{/g)]
  assert.equal(inserts.length, 1)
  assert.match(report, /kind: 'credit_balance_mismatch'/)
  assert.match(report, /severity: 'warning'/)
  assert.match(report, /link: '\/admin\/credits'/)
  assert.match(report, /required_permission: 'refunds\.payment'/)
  assert.match(report, /ref_table: 'profiles'/)
  assert.match(report, /ref_id: userId/)
  // service_role은 SELECT·INSERT만 받았다. UPDATE가 필요한 방식(upsert 병합)을 쓰지 않는다.
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.admin_events TO service_role;/)
  assert.doesNotMatch(report, /\.upsert\(|\.update\(|\.delete\(/)
})

test('dedupe_key는 mismatch:<user_id>:<한국 시간 날짜> 이고, 같은 날 중복(23505)은 조용히 넘어간다', () => {
  const report = between(balance, 'export async function reportCreditBalanceMismatch', '\nasync function getClient')

  assert.match(report, /dedupe_key: `mismatch:\$\{userId\}:\$\{kstDate\}`/)
  const kstLine = report.match(/const kstDate = (.+)/)
  assert.ok(kstLine, 'kstDate 계산이 있어야 한다')
  assert.match(migration, /dedupe_key text UNIQUE/)

  // 같은 식으로 계산해 본다: UTC 15시가 한국 날짜가 바뀌는 경계다.
  const kstDateAt = (iso) => {
    const realNow = Date.now
    Date.now = () => new Date(iso).getTime()
    try {
      return new Function(`return ${kstLine[1]}`)()
    } finally {
      Date.now = realNow
    }
  }
  assert.equal(kstDateAt('2026-11-16T14:59:59Z'), '2026-11-16')
  assert.equal(kstDateAt('2026-11-16T15:00:00Z'), '2026-11-17')

  assert.match(report, /if \(error && error\.code !== '23505'\) \{\s*console\.error\(/)
})

test('잔액 불일치 이벤트의 제목·본문에 회원 식별 정보를 넣지 않고, 실패는 삼킨다', () => {
  const report = between(balance, 'export async function reportCreditBalanceMismatch', '\nasync function getClient')

  const title = report.match(/title: (.+),/)[1]
  const body = report.match(/body: (.+),/)[1]
  for (const text of [title, body]) {
    assert.doesNotMatch(text, /userId|email|phone/i)
  }

  // INSERT가 던지거나 오류를 돌려줘도 호출한 쪽(크레딧 처리)으로 올라가지 않는다.
  assert.match(report, /try \{[\s\S]*\.from\('admin_events'\)[\s\S]*\} catch \(error\) \{\s*console\.error\(/)
  assert.doesNotMatch(report, /throw /)
})
