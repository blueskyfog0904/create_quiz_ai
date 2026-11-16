import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261113210000_admin_events.sql')
const rollback = read('supabase/rollback/20261113210000_admin_events_down.sql')

const squash = (sql) => sql.replace(/\s+/g, ' ')
// 주석을 뺀 실행문만 본다.
const code = migration.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
const flat = squash(code)

const functionNames = [...code.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
const tableNames = [...code.matchAll(/CREATE TABLE public\.(\w+) \(/g)].map((m) => m[1])
const triggers = [...code.matchAll(/CREATE TRIGGER (\w+)\s+(?:BEFORE|AFTER) [A-Z ]+? ON public\.(\w+)/g)]
  .map((m) => ({ name: m[1], table: m[2] }))
const triggerFunctionNames = functionNames.filter((name) => name.startsWith('admin_event_on_'))

// 함수 정의 전체(머리말 + 본문). 본문 태그는 함수마다 $fn_<이름>$ 이다.
const functionSource = (name) => {
  const start = code.indexOf(`CREATE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} 정의가 있어야 한다`)
  const tag = `$fn_${name}$`
  const open = code.indexOf(tag, start)
  const close = code.indexOf(tag, open + tag.length)
  assert.ok(open > start && close > open, `${name} 본문 태그 ${tag} 가 열리고 닫혀야 한다`)
  return code.slice(start, close)
}

test('만드는 것의 목록: 표 4개, 트리거 함수 7개, 전송 함수, 추가 전용 함수', () => {
  assert.deepEqual(tableNames.sort(), [
    'admin_event_deliveries', 'admin_event_dispatch_state', 'admin_event_reads', 'admin_events',
  ])
  assert.equal(triggerFunctionNames.length, 7)
  assert.ok(functionNames.includes('dispatch_admin_events'))
  assert.ok(functionNames.includes('prevent_admin_event_mutation'))
  // 새 객체는 CREATE만 쓴다.
  assert.doesNotMatch(code, /CREATE OR REPLACE/)
  assert.doesNotMatch(code, /CREATE [A-Z ]+IF NOT EXISTS/)
})

test('이벤트 종류 8개가 계획의 권한·심각도와 함께 만들어진다', () => {
  const expected = {
    support_ticket_created: 'support.manage',
    market_refund_requested: 'refunds.market',
    payment_refund_requested: 'refunds.payment',
    payment_external_cancel: 'refunds.payment',
    payment_refund_needs_action: 'refunds.payment',
    payment_manual_review: 'refunds.payment',
    payment_alert: 'refunds.payment',
    sales_switch_changed: 'refunds.payment',
  }
  const all = triggerFunctionNames.map(functionSource).join('\n')
  for (const [kind, permission] of Object.entries(expected)) {
    const source = triggerFunctionNames.map(functionSource).find((sql) => sql.includes(`'${kind}'`))
    assert.ok(source, `${kind} 이벤트를 만드는 트리거 함수가 있어야 한다`)
    assert.ok(source.includes(`'${permission}'`), `${kind} 의 권한은 ${permission}`)
  }
  // 뒤 단위(앱 코드·DB-A2)의 종류는 트리거가 만들지 않는다.
  for (const later of ['refund_over_limit', 'credit_balance_mismatch', 'support_unanswered', 'refund_unanswered', 'notify_gave_up']) {
    assert.ok(!all.includes(`'${later}'`), `${later} 는 트리거가 만들지 않는다`)
  }
  assert.match(squash(functionSource('admin_event_on_payment_refund_inserted')),
    /CASE WHEN NEW\.origin = 'user' THEN 'payment_refund_requested' ELSE 'payment_external_cancel' END, CASE WHEN NEW\.origin = 'user' THEN 'info' ELSE 'warning' END/)
  assert.match(squash(functionSource('admin_event_on_sales_switch_changed')), /'sales_switch_changed', 'critical'/)
})

test('트리거 함수: DEFINER + 고정 search_path, INSERT 한 줄, 실패해도 원래 작업을 막지 않는다', () => {
  for (const name of triggerFunctionNames) {
    const source = functionSource(name)
    const body = source.slice(source.indexOf(`$fn_${name}$`))
    assert.match(source, /RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'\s+AS \$fn_/, name)
    assert.equal(body.match(/INSERT INTO/g)?.length, 1, `${name}: INSERT는 한 번`)
    assert.match(body, /INSERT INTO public\.admin_events \(/, name)
    assert.match(body, /ON CONFLICT \(dedupe_key\) DO NOTHING;/, name)
    // 함수 전체를 감싸는 예외 처리: 마지막 문장이 EXCEPTION WHEN OTHERS … RETURN NULL; END;
    assert.match(squash(body), /RETURN NULL; EXCEPTION WHEN OTHERS THEN RAISE WARNING '[^']+', SQLSTATE, SQLERRM; RETURN NULL; END; $/, name)
    // 잠금·vault·http·전송 함수 호출·다른 표 변경 없음
    assert.doesNotMatch(body, /vault\.|net\.|http_post|http_get|dispatch_admin_events|advisory|FOR UPDATE|LOCK TABLE|\bUPDATE public\.|DELETE FROM/i, name)
    assert.doesNotMatch(body, /RETURN NEW/, `${name}: AFTER 트리거는 NULL을 돌려준다`)
  }
})

test('제목·본문에 이메일·전화번호·문의 본문·환불 사유·회원 식별자를 넣지 않는다', () => {
  for (const name of triggerFunctionNames) {
    const body = functionSource(name)
    assert.doesNotMatch(body, /email|phone|NEW\.reason|NEW\.user_id|NEW\.admin_note|NEW\.details|profiles/i, name)
  }
  const ticket = functionSource('admin_event_on_support_ticket_created')
  assert.doesNotMatch(ticket, /NEW\.message/)
  // 문의 제목은 앞 30자만, 분류 이름은 DB(스냅샷 → 분류 표)에서 가져온다.
  assert.ok(ticket.includes(`left(regexp_replace(NEW.subject, '\\s+', ' ', 'g'), 30)`))
  assert.ok(ticket.includes(`NEW.category_snapshot ->> 'name'`))
  assert.ok(ticket.includes('FROM public.support_ticket_categories c WHERE c.id = NEW.category_id'))
  // 링크는 관리자 화면 경로만
  const links = [...code.matchAll(/'(\/admin\/[a-z/-]*)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(links)].sort(), ['/admin/refunds', '/admin/support'])
})

test('상태 전이 트리거는 값이 실제로 바뀔 때만 함수를 실행한다', () => {
  assert.equal(triggers.filter((t) => t.name.startsWith('trg_admin_event_')).length, 7)
  assert.ok(flat.includes(
    `CREATE TRIGGER trg_admin_event_payment_refund_needs_action AFTER UPDATE ON public.refund_requests FOR EACH ROW WHEN ((OLD.status IS DISTINCT FROM NEW.status OR OLD.origin IS DISTINCT FROM NEW.origin) AND NEW.status IN ('retryable_failed', 'manual_review')) EXECUTE FUNCTION public.admin_event_on_payment_refund_needs_action();`))
  assert.ok(flat.includes(
    `CREATE TRIGGER trg_admin_event_payment_manual_review AFTER UPDATE ON public.payment_orders FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'manual_review') EXECUTE FUNCTION public.admin_event_on_payment_manual_review();`))
  assert.ok(flat.includes(
    `WHEN ( OLD.master_accepts_new_orders IS DISTINCT FROM NEW.master_accepts_new_orders OR OLD.payapp_accepts_new_orders IS DISTINCT FROM NEW.payapp_accepts_new_orders OR OLD.kakaopay_accepts_new_orders IS DISTINCT FROM NEW.kakaopay_accepts_new_orders ) EXECUTE FUNCTION public.admin_event_on_sales_switch_changed();`))
  for (const [trigger, table] of [
    ['trg_admin_event_support_ticket_created', 'support_tickets'],
    ['trg_admin_event_market_refund_requested', 'market_refund_requests'],
    ['trg_admin_event_payment_refund_inserted', 'refund_requests'],
    ['trg_admin_event_payment_alert', 'payment_reconciliation_alerts'],
  ]) {
    assert.match(flat, new RegExp(`CREATE TRIGGER ${trigger} AFTER INSERT ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION`))
  }
  // 다시 울리게 하는 키: 전이 시각(분)
  for (const name of ['admin_event_on_payment_refund_needs_action', 'admin_event_on_payment_manual_review']) {
    assert.ok(functionSource(name).includes(`to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MI')`), name)
  }
})

test('결제 경보: 코드별 통지 방식은 설정 행에서, 읽지 못하면 full', () => {
  const alert = squash(functionSource('admin_event_on_payment_alert'))
  assert.ok(alert.includes(`SELECT s.value -> 'alert_codes' -> NEW.code ->> 'delivery' INTO v_delivery FROM public.system_settings s WHERE s.key = 'admin_alert_settings'; EXCEPTION WHEN OTHERS THEN v_delivery := NULL; END;`))
  assert.ok(alert.includes(`CASE WHEN v_delivery = 'screen' THEN 'screen' ELSE 'full' END`))
  assert.ok(alert.includes(`CASE WHEN NEW.severity = 'critical' THEN 'critical' ELSE 'warning' END`))
  // 경보 코드는 함수에 박지 않는다(데이터).
  assert.doesNotMatch(alert, /'[A-Z]+_[A-Z_]+'/)

  const seed = flat.match(/INSERT INTO public\.system_settings \(key, value, description\) VALUES \( 'admin_alert_settings', '(\{.*?\})'::jsonb,/)
  assert.ok(seed, '설정 행을 만든다')
  const value = JSON.parse(seed[1])
  assert.match(value.site_url, /^https:\/\/[a-z0-9.-]+$/)
  assert.equal(typeof value.alert_codes, 'object')
  for (const setting of Object.values(value.alert_codes)) {
    assert.ok(['screen', 'full'].includes(setting.delivery))
  }
  // 되돌리기가 행을 지우므로, 이미 있는 행을 조용히 넘어가지 않는다.
  assert.doesNotMatch(flat, /'admin_alert_settings'[^;]*ON CONFLICT/)
})

test('권한: 네 표 모두 RLS, anon·authenticated 회수, admin_events만 관리자 조회', () => {
  for (const table of tableNames) {
    assert.ok(code.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`), table)
    assert.ok(code.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated, service_role;`), table)
  }
  const grants = [...code.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.(\w+) TO (\w+);/g)].map((m) => `${m[2]}:${m[3]}:${m[1]}`)
  assert.deepEqual(grants.sort(), [
    'admin_event_deliveries:service_role:SELECT',
    'admin_event_dispatch_state:service_role:SELECT',
    'admin_event_reads:service_role:SELECT, INSERT, UPDATE, DELETE',
    'admin_events:authenticated:SELECT',
    'admin_events:service_role:SELECT, INSERT',
  ])
  assert.doesNotMatch(code, /GRANT [^;]* TO (anon|PUBLIC)\b/)
  assert.ok(flat.includes('CREATE POLICY admin_events_select_admin ON public.admin_events FOR SELECT TO authenticated USING ((SELECT public.is_admin()));'))
  // 그 밖의 정책은 알림 설정 행을 브라우저 세션으로 바꾸지 못하게 하는 제한 정책 하나뿐이다.
  assert.ok(flat.includes(`CREATE POLICY system_settings_admin_alert_settings_no_client_write ON public.system_settings AS RESTRICTIVE FOR UPDATE TO public USING (key <> 'admin_alert_settings') WITH CHECK (key <> 'admin_alert_settings');`))
  assert.equal(code.match(/CREATE POLICY/g).length, 2)
  assert.match(squash(read('supabase/rollback/20261113210000_admin_events_down.sql')), /DROP POLICY system_settings_admin_alert_settings_no_client_write ON public\.system_settings;/)
  // 회수와 부여의 순서: 부여가 회수보다 뒤
  assert.ok(code.lastIndexOf('REVOKE ALL ON TABLE') < code.indexOf('GRANT SELECT ON TABLE public.admin_events TO authenticated;'))
})

test('admin_events는 추가 전용이고 Realtime에는 이 표만 싣는다', () => {
  assert.ok(functionSource('prevent_admin_event_mutation').includes(`RAISE EXCEPTION 'ADMIN_EVENTS_APPEND_ONLY';`))
  assert.match(flat, /CREATE TRIGGER prevent_admin_event_mutation BEFORE UPDATE OR DELETE ON public\.admin_events FOR EACH ROW EXECUTE FUNCTION public\.prevent_admin_event_mutation\(\);/)
  assert.match(flat, /CREATE TRIGGER prevent_admin_event_truncate BEFORE TRUNCATE ON public\.admin_events FOR EACH STATEMENT EXECUTE FUNCTION public\.prevent_admin_event_mutation\(\);/)
  assert.match(flat, /dedupe_key text UNIQUE/)
  assert.match(flat, /CHECK \(severity IN \('info', 'warning', 'critical'\)\)/)
  assert.match(flat, /CHECK \(delivery IN \('full', 'screen'\)\)/)
  assert.match(flat, /IF EXISTS \(SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'\) AND NOT EXISTS \( SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_events' \) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public\.admin_events;/)
  assert.equal(code.match(/ALTER PUBLICATION/g).length, 1)
})

test('전송 함수: cron 전용, 잠금 → 실행 시각 → 웹훅 확인 → 응답 확인 → 전송 순서', () => {
  const dispatch = squash(functionSource('dispatch_admin_events'))
  assert.match(dispatch, /SECURITY DEFINER SET search_path TO 'public', 'pg_temp'/)
  assert.ok(code.includes('REVOKE EXECUTE ON FUNCTION public.dispatch_admin_events() FROM PUBLIC, anon, authenticated, service_role;'))
  assert.doesNotMatch(code, /GRANT EXECUTE/)
  for (const name of functionNames) {
    assert.ok(code.includes(`REVOKE EXECUTE ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated, service_role;`), name)
  }

  const order = [
    'IF NOT pg_try_advisory_xact_lock(',
    'SET last_run_at = now()',
    `WHERE name = 'admin_alert_slack_webhook_url'`,
    `IF v_webhook IS NULL OR NOT starts_with(v_webhook, 'https://hooks.slack.com/services/') THEN UPDATE public.admin_event_dispatch_state SET last_run_error = 'WEBHOOK_NOT_CONFIGURED' WHERE id; RETURN; END IF;`,
    'FROM net._http_response r',
    `last_error = 'NO_RESPONSE_5M'`,
    'SET gave_up_at = now()',
    'SELECT net.http_post(',
    'attempt_count = public.admin_event_deliveries.attempt_count + 1',
    `WHERE name = 'admin_alert_heartbeat_url'`,
    'SET last_success_at = now()',
    'EXCEPTION WHEN OTHERS THEN',
  ]
  let position = -1
  for (const marker of order) {
    const next = dispatch.indexOf(marker, position + 1)
    assert.ok(next > position, `순서가 맞아야 한다: ${marker.slice(0, 50)}`)
    position = next
  }
  // vault 읽기는 기존 cron 선례와 같은 식
  assert.equal(dispatch.match(/SELECT btrim\(decrypted_secret, E' \\t\\r\\n'\) INTO v_\w+ FROM vault\.decrypted_secrets WHERE name = '/g).length, 2)
  // 설정 오류로 끝날 때는 시도 횟수를 올리지 않는다(시도 횟수는 전송 직후 한 곳에서만 바뀐다).
  assert.equal(dispatch.match(/attempt_count = /g).length, 1)
})

test('전송 함수: 대상·재시도·포기·묶음·하트비트', () => {
  const dispatch = squash(functionSource('dispatch_admin_events'))
  assert.ok(dispatch.includes(`WHERE e.delivery = 'full' AND e.created_at > now() - interval '24 hours' AND ( d.event_id IS NULL OR ( d.delivered_at IS NULL AND d.gave_up_at IS NULL AND d.request_id IS NULL AND d.attempt_count < 6 AND d.requested_at + CASE d.attempt_count WHEN 1 THEN interval '15 seconds' WHEN 2 THEN interval '1 minute' WHEN 3 THEN interval '2 minutes' WHEN 4 THEN interval '4 minutes' WHEN 5 THEN interval '8 minutes' ELSE interval '16 minutes' END <= now() ) ) ORDER BY e.created_at, e.id LIMIT 20`))
  assert.ok(dispatch.includes('AND r.status_code BETWEEN 200 AND 299;'))
  assert.ok(dispatch.includes(`AND d.requested_at <= now() - interval '5 minutes';`))
  assert.ok(dispatch.includes(`AND d.request_id IS NULL AND (d.attempt_count >= 6 OR EXISTS (SELECT 1 FROM public.admin_events e WHERE e.id = d.event_id AND e.created_at <= now() - interval '24 hours')) RETURNING d.event_id`))
  // 응답은 요청 뒤에 생긴 것만 대조하고, 응답 없는 묵은 요청은 대기열에서 지운 뒤 재시도한다.
  assert.equal(dispatch.match(/AND r\.created >= d\.requested_at/g).length, 2)
  assert.ok(dispatch.indexOf('DELETE FROM net.http_request_queue q USING public.admin_event_deliveries d') < dispatch.indexOf(`last_error = 'NO_RESPONSE_5M'`))
  // 포기 알림은 화면 전용·critical·owner
  assert.ok(dispatch.includes(`SELECT 'notify_gave_up', 'critical', '슬랙 알림 전송 포기', left(e.title, 150), e.link, 'admin_events', e.id, 'owner', 'screen', 'gaveup:' || e.id`))
  // 한 회차에 요청 1개, 같은 request_id를 묶음의 모든 행에
  assert.equal(dispatch.match(/net\.http_post\(/g).length, 1)
  assert.ok(dispatch.includes(`SELECT unnest(v_ids), 'slack', v_request_id, now(), 1 ON CONFLICT (event_id) DO UPDATE SET request_id = EXCLUDED.request_id`))
  // 길이 제한, 슬랙 특수문자 이스케이프(문의 제목으로 멘션·링크를 만들 수 없게), critical 멘션
  assert.ok(dispatch.includes('left(b.title, 150)') && dispatch.includes('left(b.body, 300)') && dispatch.includes('left(v_text, 15000)'))
  assert.ok(dispatch.includes(`'&', '&amp;'), '<', '&lt;'), '>', '&gt;')`))
  assert.ok(dispatch.includes(`CASE WHEN v_has_critical THEN '<!channel> ' ELSE '' END`))
  // 사이트 주소는 설정 행에서 읽는다(함수에 박지 않는다).
  assert.ok(dispatch.includes(`SELECT rtrim(s.value ->> 'site_url', '/') INTO v_site_url FROM public.system_settings s WHERE s.key = 'admin_alert_settings';`))
  assert.ok(dispatch.includes(`|| E'\\n' || v_site_url || b.link`))
  for (const name of functionNames) {
    assert.doesNotMatch(functionSource(name), /https?:\/\/(?!hooks\.slack\.com\/services\/')[a-z]/, `${name}: 주소를 박지 않는다`)
  }
  // 하트비트: 포기 건이 없고 5분이 지났을 때만, https 주소일 때만
  assert.ok(dispatch.includes(`IF NOT EXISTS (SELECT 1 FROM public.admin_event_deliveries WHERE gave_up_at > now() - interval '24 hours') AND EXISTS ( SELECT 1 FROM public.admin_event_dispatch_state WHERE id AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= now() - interval '5 minutes') ) THEN`))
  assert.ok(dispatch.includes(`IF v_heartbeat IS NOT NULL AND starts_with(v_heartbeat, 'https://') THEN PERFORM net.http_get(url := v_heartbeat, timeout_milliseconds := 10000); UPDATE public.admin_event_dispatch_state SET last_heartbeat_at = now() WHERE id; END IF; EXCEPTION WHEN OTHERS THEN`))
  // 하트비트 실패는 슬랙 전송을 취소하지 않고, 주소가 든 예외 메시지 대신 고정 문구만 남긴다.
  assert.ok(dispatch.includes(`v_heartbeat_error := 'HEARTBEAT_FAILED';`))
  assert.match(flat, /last_heartbeat_at timestamptz/)
})

test('슬랙·하트비트 주소는 오류 기록에 남지 않는다', () => {
  const dispatch = squash(functionSource('dispatch_admin_events'))
  const runErrors = [...dispatch.matchAll(/last_run_error = ([^;]+?)(?: WHERE id)?;/g)].map((m) => m[1].trim())
  assert.deepEqual([...new Set(runErrors)].sort(), [`'WEBHOOK_NOT_CONFIGURED'`, 'v_heartbeat_error', 'v_run_error'])
  // 예외 메시지는 두 주소를 가린 뒤에만 기록한다.
  assert.ok(dispatch.includes(`v_run_error := left( replace(replace(SQLSTATE || ': ' || SQLERRM, COALESCE(v_webhook, ''), '[redacted]'), COALESCE(v_heartbeat, ''), '[redacted]'), 300 );`))
  assert.equal(dispatch.match(/v_run_error :=/g).length, 1)

  const deliveryErrors = [...dispatch.matchAll(/last_error = (.+?)(?= FROM | WHERE )/g)].map((m) => m[1])
  assert.equal(deliveryErrors.length, 3)
  for (const expression of deliveryErrors) {
    assert.doesNotMatch(expression, /v_webhook|v_heartbeat|decrypted_secret|error_msg|content|url|SQLERRM/i, expression)
  }
  // 주소 변수는 요청을 보내는 곳과 형식 검사·가리기에만 쓴다.
  assert.equal(dispatch.match(/url := v_webhook/g).length, 1)
  assert.equal(dispatch.match(/url := v_heartbeat/g).length, 1)
  assert.doesNotMatch(dispatch, /RAISE/)
})

test('cron: 이름으로 등록하고, 실행 기록 정리는 이 작업의 것만', () => {
  assert.ok(flat.includes(`PERFORM cron.schedule( 'admin-events-dispatch', '15 seconds', $cron_dispatch$SELECT public.dispatch_admin_events();$cron_dispatch$ );`))
  assert.ok(flat.includes(`PERFORM cron.schedule( 'admin-events-cron-history-cleanup', '17 18 * * *', $cron_cleanup$ DELETE FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'admin-events-dispatch') AND (end_time < now() - interval '7 days' OR (end_time IS NULL AND runid < ( SELECT min(runid) FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'admin-events-dispatch') AND end_time >= now() - interval '7 days'))); $cron_cleanup$ );`))
  assert.equal(code.match(/cron\.schedule\(/g).length, 2)
})

test('마이그레이션 형식: 시간 제한, 겹치지 않는 달러 태그, 스키마 새로고침', () => {
  assert.ok(code.startsWith(`SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';`))
  assert.ok(code.trimEnd().endsWith(`NOTIFY pgrst, 'reload schema';`))
  for (const sql of [migration, rollback]) {
    assert.ok(!sql.includes('$file$'))
    assert.doesNotMatch(sql, /\$\$/)
    // 태그마다 정확히 한 번 열리고 한 번 닫힌다.
    const counts = {}
    for (const [tag] of sql.matchAll(/\$[a-z_]+\$/g)) counts[tag] = (counts[tag] ?? 0) + 1
    for (const [tag, count] of Object.entries(counts)) assert.equal(count, 2, tag)
  }
  assert.match(migration, /^-- /)
  assert.ok(migration.includes('supabase/rollback/20261113210000_admin_events_down.sql'))
})

test('되돌리기: cron을 먼저 끄고, 만든 것을 모두 없앤다', () => {
  const down = squash(rollback.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n'))
  const jobs = [...code.matchAll(/cron\.schedule\(\s*'([a-z-]+)'/g)].map((m) => m[1])
  assert.equal(jobs.length, 2)
  for (const job of jobs) assert.ok(down.includes(`'${job}'`), job)
  assert.match(down, /SELECT jobid FROM cron\.job WHERE jobname IN \([^)]+\) LOOP DELETE FROM cron\.job_run_details WHERE jobid = v_job\.jobid; PERFORM cron\.unschedule\(v_job\.jobid\);/)
  assert.ok(down.indexOf('cron.unschedule(') < down.indexOf('DROP TRIGGER'))

  for (const { name, table } of triggers) {
    // 표와 함께 사라지는 트리거(새 표에 건 것)는 따로 지우지 않아도 된다.
    if (tableNames.includes(table)) continue
    assert.ok(down.includes(`DROP TRIGGER ${name} ON public.${table};`), name)
  }
  for (const name of functionNames) {
    assert.ok(down.includes(`DROP FUNCTION public.${name}();`), name)
  }
  for (const table of tableNames) {
    assert.ok(down.includes(`DROP TABLE public.${table};`), table)
  }
  // 순서: 트리거 → 함수, 표 → 추가 전용 함수, 참조하는 표 → admin_events
  assert.ok(down.lastIndexOf('DROP TRIGGER') < down.indexOf('DROP FUNCTION'))
  assert.ok(down.indexOf('DROP TABLE public.admin_event_deliveries;') < down.lastIndexOf('DROP TABLE public.admin_events;'))
  assert.ok(down.lastIndexOf('DROP TABLE public.admin_events;') < down.indexOf('DROP FUNCTION public.prevent_admin_event_mutation();'))
  assert.match(down, /IF EXISTS \( SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_events' \) THEN ALTER PUBLICATION supabase_realtime DROP TABLE public\.admin_events;/)
  assert.ok(down.includes(`DELETE FROM public.system_settings WHERE key = 'admin_alert_settings';`))
  assert.doesNotMatch(down, /CASCADE/)
  assert.ok(down.trimEnd().endsWith(`NOTIFY pgrst, 'reload schema';`))
  assert.ok(rollback.includes(`SET LOCAL lock_timeout = '3s';`) && rollback.includes(`SET LOCAL statement_timeout = '60s';`))
})
