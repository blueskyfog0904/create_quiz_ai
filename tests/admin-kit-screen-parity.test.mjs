import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// 20번 관리자 공통 틀: 화면을 부품으로 옮겨도 동작은 그대로(계획 docs/plan-bundle20-admin-common.md 6-2·9절).
// 대조 단위 = 화면 폴더 + 그 폴더가 import 하는 관리자 파일(src/app/(admin)·src/components/admin, 부품 kit 제외).
// 기대값은 옮기기 전(648e68c) 코드에서 뽑은 목록이다. 화면을 옮길 때마다 여기에 한 묶음을 더한다.
const ROOT = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8')
const isFile = (file) => existsSync(new URL(file, ROOT)) && statSync(new URL(file, ROOT)).isFile()

function walk(dir, files = []) {
  for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(child, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(child)
  }
  return files
}

function resolveImport(fromFile, specifier) {
  let base
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  else return null
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (isFile(base + suffix)) return base + suffix
  return null
}

// 부품으로 나눠 옮긴 코드도 따라가도록 관리자 파일은 import 를 따라간다(부품 kit 은 fetch 등이 없음을 kit 계약 시험이 지킨다).
const FOLLOW = (file) => (file.startsWith('src/app/(admin)/') || file.startsWith('src/components/admin/')) && !file.startsWith('src/components/admin/kit/')

function screenFiles(dir) {
  const seen = new Set()
  const queue = walk(dir)
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of read(file).matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(file, match[1])
      if (resolved && FOLLOW(resolved) && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return [...seen].sort()
}

const squash = (text) => text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/,\)/g, ')').trim()

// name( … ) 호출 전체(괄호 짝 맞춤)를 공백을 접어 돌려준다.
function callsOf(source, name) {
  const calls = []
  for (const match of source.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1
      else if (source[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    calls.push(squash(source.slice(match.index, end + 1)))
  }
  return calls
}

function parityItems(dir) {
  const sources = screenFiles(dir).map(read)
  const join = (pick) => sources.flatMap(pick).sort()
  return {
    // fetch URL 템플릿·method·body(helper 로 감싼 것 포함)
    fetch: join((source) => callsOf(source, 'fetch')),
    // 서버 액션·*-server 로더 import
    serverImports: join((source) => [...source.matchAll(/from\s*'([^']*(?:-server|actions))'/g)].map((match) => match[1])),
    // 브라우저 직접 조회 .from('표')·.rpc('함수')
    db: join((source) => [...source.matchAll(/\.(from|rpc)\(\s*['"]([^'"]+)['"]/g)].map((match) => `${match[1]}:${match[2]}`)),
    // 가드 호출
    guards: join((source) => [...source.matchAll(/\brequire[A-Z]\w*\([^)]*\)/g)].map((match) => match[0])),
    // 주소 키 이름
    searchParamKeys: [...new Set(sources.flatMap((source) => [
      ...[...source.matchAll(/searchParams\??: Promise<\{([^}]*)\}>/g)].flatMap((match) => [...match[1].matchAll(/(\w+)\?:/g)].map((key) => key[1])),
      ...[...source.matchAll(/[sS]earchParams\??\.get\(\s*['"](\w+)['"]/g)].map((match) => match[1]),
      ...[...source.matchAll(/resolvedSearchParams\??\.(\w+)/g)].map((match) => match[1]),
    ]))].sort(),
    confirm: join((source) => callsOf(source, 'confirm')),
    alert: join((source) => callsOf(source, 'alert')),
    guardHook: join((source) => callsOf(source, 'useUnsavedChangesGuard')),
  }
}

// 저장 바 하나에 저장 함수 하나. 저장 함수 둘을 한 버튼으로 묶지 않는다.
function saveBarsOf(dir) {
  return screenFiles(dir).flatMap((file) => {
    const source = read(file)
    return [...source.matchAll(/<AdminSaveBar\b[\s\S]*?\/>/g)].map((match) => {
      const onSave = match[0].match(/onSave=\{([^}]*)\}/g) ?? []
      return { file, variant: match[0].match(/variant="(\w+)"/)?.[1], onSave }
    })
  })
}

const SAVE_HANDLER = /^onSave=\{(?:\(\) => void (\w+)\(\)|(\w+))\}$/

// ───── 1단계 시범: /admin/review-tags ─────
const REVIEW_TAGS = 'src/app/(admin)/admin/review-tags'

test('/admin/review-tags: 부르는 API·가드·주소 키·이탈 경고 훅은 옮기기 전과 같다', () => {
  const items = parityItems(REVIEW_TAGS)
  assert.deepEqual(items.fetch, [
    "fetch('/api/admin/review-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_subject: workspaceSubject, label, sort_order: Number(newSortOrder) || 0, }), })",
    "fetch(`/api/admin/review-tags/${tag.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: draft.label.trim(), sort_order: Number(draft.sortOrder) || 0 }), })",
    "fetch(`/api/admin/review-tags/${tagId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), })",
    "fetch(withAdminWorkspaceSubject('/api/admin/review-tags', workspaceSubject))",
  ])
  assert.deepEqual(items.serverImports, ['@/lib/admin-permissions-server', '@/lib/admin-sidebar-server'])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ["requireAdminPagePermission('reviews.manage')"])
  assert.deepEqual(items.searchParamKeys, ['subject'])
  assert.deepEqual(items.confirm, [])
  // 이탈 경고 훅은 지금 호출 그대로 1개(5-3).
  assert.deepEqual(items.guardHook, ['useUnsavedChangesGuard(dirtyTags.length > 0)'])
})

test('/admin/review-tags: 브라우저 알림 창 5곳은 같은 자리·같은 문구로 화면 안 오류로 바뀌었다(Q3)', () => {
  const items = parityItems(REVIEW_TAGS)
  // 옮기기 전: alert( 5곳(읽기 실패·빈 문구·추가 실패·줄 저장 실패·모두 저장 실패)
  assert.deepEqual(items.alert, [])
  const client = read(`${REVIEW_TAGS}/review-tags-client.tsx`)
  const setters = [...callsOf(client, 'setLoadError'), ...callsOf(client, 'setActionError'), ...callsOf(client, 'setSaveAllError')]
  for (const expected of [
    "setLoadError(error instanceof Error ? error.message : '태그를 불러오지 못했습니다.')",
    "setActionError('태그 문구를 입력하세요.')",
    "setActionError(error instanceof Error ? error.message : '태그 추가에 실패했습니다.')",
    "setActionError(error instanceof Error ? error.message : '저장에 실패했습니다.')",
    "setSaveAllError(error instanceof Error ? error.message : '저장에 실패했습니다.')",
  ]) {
    assert.ok(setters.includes(expected), expected)
  }
  // 오류는 화면에 보인다: 추가·줄 저장 = 오류 띠, 읽기 = 표 실패 칸(행이 없을 때)·오류 띠(행이 있을 때) + 다시 시도, 모두 저장 = 저장 바.
  assert.match(client, /\{actionError \? <div ref=\{actionErrorRef\}><AdminNotice kind="error">\{actionError\}<\/AdminNotice><\/div> : null\}/)
  // 알림 창은 늘 보였으므로, 위쪽 띠도 오류가 생기면 그 자리로 옮겨 보인다. 모두 저장을 시작하면 앞 오류 띠는 지운다.
  assert.match(client, /if \(actionError\) actionErrorRef\.current\?\.scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(client, /setSavingId\('all'\)\s+setActionError\(null\)\s+setSaveAllError\(null\)/)
  assert.match(client, /loadError && tags\.length === 0 \? \(\s*<AdminTableState kind="error" message=\{loadError\} onRetry=\{\(\) => void loadTags\(\)\} \/>/)
  assert.match(client, /<AdminNotice kind="error" onRetry=\{\(\) => void loadTags\(\)\}>\{loadError\}<\/AdminNotice>/)
  assert.match(client, /errorMessage=\{saveAllError\}/)
})

test('/admin/review-tags: 같은 열·버튼·막힘 조건, 저장 바 하나 = 저장 함수 하나', () => {
  const client = read(`${REVIEW_TAGS}/review-tags-client.tsx`)
  assert.deepEqual([...client.matchAll(/header: '([^']+)'/g)].map((match) => match[1]), ['태그 문구', '정렬 순서', '상태', '작업'])
  for (const condition of [
    "disabled={savingId === tag.id || savingId === 'all' || !isDirty}",
    "disabled={savingId === tag.id || savingId === 'all'}",
    'disabled={savingId !== null} onClick={() => void createTag()}',
    'saveDisabled={savingId !== null}',
    'const isDirty = draft.label !== tag.label || Number(draft.sortOrder) !== tag.sortOrder',
    "{tag.isActive ? '비활성화' : '활성화'}",
    "{savingId === 'new' ? '추가 중…' : '태그 추가'}",
    'onClick={() => void patchTag(tag.id, { is_active: !tag.isActive })}',
    'onClick={() => saveDraft(tag)}',
  ]) {
    assert.ok(client.includes(condition), condition)
  }
  assert.equal(client.match(/disabled=\{savingId === 'all'\}/g)?.length, 2, '문구·순서 입력칸은 모두 저장 중에 막힌다')
  // 표 안 버튼은 adminTable(주황 adminAction 없음).
  assert.equal(client.match(/variant="adminTable"/g)?.length, 2)
  assert.doesNotMatch(client, /adminAction/)

  // 저장 함수가 하나(saveAllDrafts)인 주소 → 아래 고정 저장 바 1개.
  const bars = saveBarsOf(REVIEW_TAGS)
  assert.equal(bars.length, 1)
  assert.equal(bars[0].variant, 'fixed')
  assert.equal(bars[0].onSave.length, 1)
  assert.equal(bars[0].onSave[0].match(SAVE_HANDLER)?.slice(1).find(Boolean), 'saveAllDrafts')
})

// ───── 1단계 시범: /admin/my-password ─────
const MY_PASSWORD = 'src/app/(admin)/admin/my-password'

test('/admin/my-password: 부르는 API·가드·확인 조건은 옮기기 전과 같다', () => {
  const items = parityItems(MY_PASSWORD)
  assert.deepEqual(items.fetch, [
    "fetch('/api/admin/my-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }), })",
  ])
  assert.deepEqual(items.serverImports, [])
  assert.deepEqual(items.db, [])
  assert.deepEqual(items.guards, ['requireAdminPanelUser()'])
  assert.deepEqual(items.searchParamKeys, [])
  assert.deepEqual(items.confirm, [])
  assert.deepEqual(items.alert, [])
  assert.deepEqual(items.guardHook, [])

  const client = read(`${MY_PASSWORD}/my-password-client.tsx`)
  for (const fragment of [
    'if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {',
    'if (newPassword !== confirmPassword) {',
    'disabled={isSaving || !currentPassword || !newPassword || !confirmPassword}',
    "{isSaving ? '변경 중…' : '비밀번호 변경'}",
  ]) {
    assert.ok(client.includes(fragment), fragment)
  }
  // 결과 안내는 오류 띠(role=alert)·정보 띠(role=status)로 같은 문구를 보인다.
  assert.match(client, /<AdminNotice kind=\{message\.tone === 'error' \? 'error' : 'info'\}>\{message\.text\}<\/AdminNotice>/)
  // 비밀번호 변경은 일회성 제출이라 저장 바를 두지 않는다(입력값을 남기지 않음).
  assert.deepEqual(saveBarsOf(MY_PASSWORD), [])
})
