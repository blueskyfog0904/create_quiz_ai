import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261116100000_admin_event_reminders.sql')
const rollback = read('supabase/rollback/20261116100000_admin_event_reminders_down.sql')
const workSummary = read('src/lib/admin-work-summary-server.ts')

const squash = (sql) => sql.replace(/\s+/g, ' ')
// 주석을 뺀 실행문만 본다.
const code = migration.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
const flat = squash(code)
const fnStart = code.indexOf('CREATE FUNCTION public.remind_unanswered_admin_work()')
const fnTag = '$fn_remind_unanswered_admin_work$'
const fnOpen = code.indexOf(fnTag, fnStart)
const fn = squash(code.slice(fnStart, code.indexOf(fnTag, fnOpen + fnTag.length)))

test('재알림 대상은 관리자 화면의 처리 대기 건수와 같은 조건이다', () => {
  // 화면 쪽 조건(같이 바뀌어야 한다)
  assert.match(workSummary, /\.eq\('status', 'pending'\)\s*\.eq\('is_deleted_by_user', false\)/)
  assert.match(workSummary, /\.eq\('status', 'pending_review'\)/)
  assert.match(workSummary, /\.in\('status', \['retryable_failed', 'manual_review'\]\)/)

  // 문의는 문의 기준 시간, 환불은 환불 기준 시간을 쓴다.
  assert.match(fn, /FROM public\.support_tickets t WHERE t\.status = 'pending' AND t\.is_deleted_by_user = false AND t\.created_at <= v_now - make_interval\(secs => \(v_support_hours \* 3600\)/)
  assert.match(fn, /FROM public\.market_refund_requests r WHERE r\.status = 'pending' AND r\.created_at <= v_now - make_interval\(secs => \(v_refund_hours \* 3600\)/)
  assert.match(fn, /WHERE r\.status IN \('pending_review', 'retryable_failed', 'manual_review'\) AND s\.since <= v_now - make_interval\(secs => \(v_refund_hours \* 3600\)/)
  assert.match(fn, /IF v_support_hours <= 0 OR v_refund_hours <= 0 OR v_from_hour < 0 OR v_until_hour > 24 OR v_from_hour >= v_until_hour THEN/)
  // 확인 필요 상태는 그 상태가 된 뒤로 센다.
  assert.match(fn, /CASE WHEN r\.status = 'pending_review' THEN r\.created_at ELSE COALESCE\(r\.updated_at, r\.created_at\) END AS since/)
})

test('이벤트: 종류·권한·심각도, 같은 건은 한국 날짜 기준 하루 한 번', () => {
  const inserts = fn.split('INSERT INTO public.admin_events').slice(1)
  assert.equal(inserts.length, 3)
  const expected = [
    ['support_unanswered', 'support.manage', 'support_tickets', "'support_unanswered:' || t.id || ':' || v_day"],
    ['refund_unanswered', 'refunds.market', 'market_refund_requests', "'refund_unanswered:' || r.id || ':' || v_day"],
    ['refund_unanswered', 'refunds.payment', 'refund_requests', "'refund_unanswered:' || r.id || ':' || v_day"],
  ]
  inserts.forEach((insert, index) => {
    const [kind, permission, table, key] = expected[index]
    assert.ok(insert.includes(`'${kind}', 'info',`), `${index}: 종류와 심각도`)
    assert.ok(insert.includes(`'${permission}'`), `${index}: 권한`)
    assert.ok(insert.includes(`'${table}'`), `${index}: 참조 표`)
    assert.ok(insert.includes(key), `${index}: 중복 방지 키`)
    assert.ok(insert.includes('ON CONFLICT (dedupe_key) DO NOTHING'), `${index}: 중복은 조용히 넘어간다`)
    // delivery를 적지 않아 기본값 full(슬랙 대상)이다.
    assert.ok(!/\bdelivery\b/.test(insert), `${index}: delivery 기본값`)
  })
  assert.match(fn, /v_kst timestamp := now\(\) AT TIME ZONE 'Asia\/Seoul'/)
  assert.match(fn, /v_day := to_char\(v_kst, 'YYYY-MM-DD'\)/)
})

test('제목·본문에 이메일·전화번호·문의 본문·환불 사유·회원 식별자를 넣지 않는다', () => {
  for (const forbidden of ['email', 'phone', '.message', '.reason', 'admin_note', 'user_id', 'admin_response', 'last_error_message']) {
    assert.ok(!fn.includes(forbidden), `${forbidden} 를 쓰지 않는다`)
  }
  // 문의 제목은 접수 알림과 같이 앞 30자만.
  assert.ok(fn.includes("left(regexp_replace(t.subject, '\\s+', ' ', 'g'), 30)"))
})

test('설정은 데이터: 기준 시간과 보내는 시간대를 설정 행에서 읽고, 없으면 쉬고, 잘못되면 실패한다', () => {
  assert.match(fn, /SELECT s\.value -> 'reminders' INTO v_cfg FROM public\.system_settings s WHERE s\.key = 'admin_alert_settings'/)
  assert.match(fn, /IF v_cfg IS NULL THEN RETURN; END IF;/)
  for (const key of ['support_after_hours', 'refund_after_hours', 'send_from_hour', 'send_until_hour']) {
    assert.ok(fn.includes(`jsonb_typeof(v_cfg -> '${key}') IS DISTINCT FROM 'number'`), `${key} 형식 확인`)
    assert.ok(flat.includes(`"${key}":`), `${key} 초기값`)
  }
  assert.equal(fn.split("RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID'").length - 1, 2)
  assert.match(fn, /IF extract\(hour FROM v_kst\) < v_from_hour OR extract\(hour FROM v_kst\) >= v_until_hour THEN RETURN; END IF;/)
  // 기준 시간을 코드에 박지 않는다.
  assert.ok(!/interval '\d+ hours?'/.test(fn))
  // 시간대 확인이 INSERT보다 앞이다.
  assert.ok(fn.indexOf('v_until_hour THEN RETURN') < fn.indexOf('INSERT INTO public.admin_events'))
})

test('설정 추가는 설정 행이 있고 reminders가 없을 때만 성공한다', () => {
  assert.match(flat, /UPDATE public\.system_settings SET value = value \|\| '\{"reminders": \{"support_after_hours": 4, "refund_after_hours": 24, "send_from_hour": 9, "send_until_hour": 21\}\}'::jsonb/)
  assert.match(flat, /WHERE key = 'admin_alert_settings' AND NOT \(value \? 'reminders'\);/)
  assert.match(flat, /IF v_rows <> 1 THEN RAISE EXCEPTION 'ADMIN_ALERT_SETTINGS_ROW_NOT_READY'/)
})

test('함수는 cron 전용이고, 일정은 5분 주기 결제 작업과 겹치지 않는다', () => {
  assert.match(flat, /REVOKE EXECUTE ON FUNCTION public\.remind_unanswered_admin_work\(\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.ok(!/SECURITY DEFINER/.test(fn))
  assert.match(fn, /SET search_path TO 'public', 'pg_temp'/)
  assert.match(flat, /cron\.schedule\( 'admin-events-remind', '3-59\/10 \* \* \* \*', \$cron_remind\$SELECT public\.remind_unanswered_admin_work\(\);\$cron_remind\$ \)/)
  // 업무 테이블은 읽기만 한다.
  assert.ok(!/UPDATE public\.(support_tickets|market_refund_requests|refund_requests)|DELETE FROM/.test(fn))
})

test('마이그레이션 형식: 시간 제한, 겹치지 않는 달러 태그', () => {
  assert.match(code, /SET LOCAL lock_timeout = '3s';/)
  assert.match(code, /SET LOCAL statement_timeout = '60s';/)
  const tags = [...code.matchAll(/\$[a-z_]+\$/g)].map((m) => m[0])
  const counts = tags.reduce((acc, tag) => ({ ...acc, [tag]: (acc[tag] ?? 0) + 1 }), {})
  for (const [tag, count] of Object.entries(counts)) assert.equal(count, 2, `${tag} 는 한 번 열리고 한 번 닫힌다`)
  assert.ok(!code.includes('$file$'))
})

test('되돌리기: cron을 먼저 끄고, 함수와 설정 키를 없앤다', () => {
  const down = squash(rollback.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n'))
  const unschedule = down.indexOf('cron.unschedule(v_job.jobid)')
  const drop = down.indexOf('DROP FUNCTION public.remind_unanswered_admin_work();')
  const settings = down.indexOf("SET value = value - 'reminders'")
  assert.ok(unschedule > 0 && drop > unschedule && settings > drop)
  assert.match(down, /WHERE jobname = 'admin-events-remind'/)
  assert.match(down, /WHERE key = 'admin_alert_settings'/)
})
