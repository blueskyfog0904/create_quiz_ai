// 일회성: 국어 수능특강 독서·문학 변형문제 아래 depth3·4 칸을 만들고 상품 144개를 제목으로 재배치한다.
// docs/market-category-tree-plan.md 7절(T4). 매핑 표는 이 스크립트에만 둔다(src에는 두지 않음).
//
//   node scripts/market-category-tree-backfill.mjs            # dry-run(읽기만): 예정 노드·칸별 개수·미매칭·중복
//   node scripts/market-category-tree-backfill.mjs --apply    # 백업 → 칸 생성 → 상품 이동(멱등, 실패 시 다시 실행)
//   node scripts/market-category-tree-backfill.mjs --verify   # 실행 후 검증(칸 수·칸별 개수·합계)
//   node scripts/market-category-tree-backfill.mjs --rollback # 첫 실행 백업으로 상품을 되돌리고 만든 칸만 삭제
//
// 백업·생성 칸 기록은 고정 경로 ~/backups/create_quiz_ai/T4/ (backup.json은 첫 실행만, 덮어쓰지 않음)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const SUBJECT = 'korean'
const BACKUP_DIR = join(homedir(), 'backups/create_quiz_ai/T4')
const BACKUP_FILE = join(BACKUP_DIR, 'backup.json')
const CREATED_FILE = join(BACKUP_DIR, 'created-nodes.json')

// depth2(제목으로 찾음) → depth3 → depth4. token은 상품 제목 괄호 앞부분(NFC). 상품은 token이 있는 칸 중 가장 깊은 칸에 연결.
const PLAN = [
  {
    depth2: '수능특강 독서 변형문제',
    children: [
      { title: '1부 개념학습', sortOrder: 1, children: [
        { title: '독서의 방법', sortOrder: 1, token: '(1부 개념학습 독서의 방법', expected: 5 },
        { title: '독서의 본질', sortOrder: 2, token: '(1부 개념학습 독서의 본질', expected: 3 },
        { title: '독서의 분야', sortOrder: 3, token: '(1부 개념학습 독서의 분야', expected: 3 },
        { title: '독서의 태도', sortOrder: 4, token: '(1부 개념학습 독서의 태도', expected: 2 },
      ] },
      { title: '2부 적용학습', sortOrder: 2, children: [
        { title: '인문·예술', sortOrder: 1, token: '(2부 적용학습 인문예술', expected: 13 },
        { title: '사회·문화', sortOrder: 2, token: '(2부 적용학습 사회문화', expected: 13 },
        { title: '과학·기술', sortOrder: 3, token: '(2부 적용학습 과학기술', expected: 13 },
        { title: '주제 통합', sortOrder: 4, token: '(2부 적용학습 주제통합', expected: 12 },
      ] },
      { title: '3부 실전학습', sortOrder: 3, children: [], expected: 0 },
    ],
  },
  {
    depth2: '수능특강 문학 변형문제',
    children: [
      { title: '1부 교과서 개념학습', sortOrder: 1, token: '(1부 교과서 개념학습 ', expected: 9, children: [] },
      { title: '2부 적용학습', sortOrder: 2, children: [
        { title: '고전 시가', sortOrder: 1, token: '(2부 적용학습 고전시가', expected: 11 },
        { title: '현대시', sortOrder: 2, token: '(2부 적용학습 현대시', expected: 11 },
        { title: '고전 산문', sortOrder: 3, token: '(2부 적용학습 고전산문', expected: 11 },
        { title: '극·수필', sortOrder: 4, token: '(2부 적용학습 극수필', expected: 8 },
        { title: '갈래복합', sortOrder: 5, token: '(2부 적용학습 갈래복합', expected: 11 },
        { title: '현대소설', sortOrder: 6, token: '(2부 적용학습 현대소설', expected: 11 },
      ] },
      { title: '3부 실전학습', sortOrder: 3, children: [
        { title: '실전학습 1부', sortOrder: 1, token: '(3부 실전학습 1부)', expected: 4 },
        { title: '실전학습 2부', sortOrder: 2, token: '(3부 실전학습 2부)', expected: 4 },
      ] },
    ],
  },
]

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--rollback') ? 'rollback'
      : 'dry-run'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env.local에 없습니다.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

function fail(message) {
  console.error(`중단: ${message}`)
  process.exit(1)
}

async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await build().range(from, from + 499)
    if (error) fail(error.message)
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

async function loadNodes() {
  return readAll(() => db.from('market_category_items')
    .select('id, parent_id, depth, title, sort_order')
    .eq('workspace_subject', SUBJECT)
    .order('id'))
}

function subtreeIds(nodes, rootId) {
  const ids = [rootId]
  for (let index = 0; index < ids.length; index += 1) {
    for (const node of nodes) if (node.parent_id === ids[index]) ids.push(node.id)
  }
  return ids
}

const findChild = (nodes, parentId, title) => nodes.filter((node) => node.parent_id === parentId && node.title === title)

// 계획 칸을 실제 칸과 맞춘다. 같은 부모 아래 같은 제목이 있으면 그 칸을 쓴다(재실행 멱등).
function resolvePlan(nodes) {
  const resolved = []
  for (const branch of PLAN) {
    const matches = nodes.filter((node) => node.depth === 2 && node.title === branch.depth2)
    if (matches.length !== 1) fail(`depth2 '${branch.depth2}'가 ${matches.length}개입니다(정확히 1개여야 함).`)
    const depth2 = matches[0]
    for (const depth3 of branch.children) {
      const existing3 = findChild(nodes, depth2.id, depth3.title)
      if (existing3.length > 1) fail(`'${branch.depth2} > ${depth3.title}' 칸이 ${existing3.length}개입니다.`)
      const entry3 = { branch, depth2, parentTitle: branch.depth2, plan: depth3, depth: 3, node: existing3[0] ?? null, children: [] }
      resolved.push(entry3)
      for (const depth4 of depth3.children) {
        const existing4 = entry3.node ? findChild(nodes, entry3.node.id, depth4.title) : []
        if (existing4.length > 1) fail(`'${depth3.title} > ${depth4.title}' 칸이 ${existing4.length}개입니다.`)
        entry3.children.push({ branch, depth2, parent: entry3, plan: depth4, depth: 4, node: existing4[0] ?? null })
      }
    }
  }
  return resolved
}

const flatEntries = (resolved) => resolved.flatMap((entry) => [entry, ...entry.children])

async function loadProducts(nodes, resolved) {
  const depth2Ids = [...new Set(resolved.map((entry) => entry.depth2.id))]
  const scope = new Map()
  for (const depth2Id of depth2Ids) for (const id of subtreeIds(nodes, depth2Id)) scope.set(id, depth2Id)
  const products = await readAll(() => db.from('market_items')
    .select('id, title, category_item_id, deleted_at')
    .eq('workspace_subject', SUBJECT)
    .in('category_item_id', [...scope.keys()])
    .order('id'))
  return products.map((product) => ({ ...product, depth2Id: scope.get(product.category_item_id) }))
}

// 상품마다 같은 depth2 범위 안의 규칙 중 정확히 1개가 맞아야 한다.
function matchProducts(products, resolved) {
  const rules = flatEntries(resolved).filter((entry) => entry.plan.token)
  const assignments = []
  const unmatched = []
  const duplicated = []
  for (const product of products) {
    const title = product.title.normalize('NFC')
    const hits = rules.filter((rule) => rule.depth2.id === product.depth2Id && title.includes(rule.plan.token.normalize('NFC')))
    if (hits.length === 0) unmatched.push(product)
    else if (hits.length > 1) duplicated.push({ product, rules: hits.map((rule) => rule.plan.title) })
    else assignments.push({ product, entry: hits[0] })
  }
  return { assignments, unmatched, duplicated }
}

function labelOf(entry) {
  return entry.depth === 3 ? `${entry.parentTitle} > ${entry.plan.title}` : `${entry.parent.parentTitle} > ${entry.parent.plan.title} > ${entry.plan.title}`
}

function report(resolved, matched) {
  const entries = flatEntries(resolved)
  const toCreate = entries.filter((entry) => !entry.node)
  console.log(`\n[칸] 생성 예정 depth3 ${toCreate.filter((e) => e.depth === 3).length}, depth4 ${toCreate.filter((e) => e.depth === 4).length} / 이미 있음 ${entries.length - toCreate.length}`)
  let ok = true
  for (const entry of entries) {
    const count = matched.assignments.filter((assignment) => assignment.entry === entry).length
    const already = matched.assignments.filter((assignment) => assignment.entry === entry && entry.node && assignment.product.category_item_id === entry.node.id).length
    const expected = entry.plan.expected
    const mark = expected === undefined ? '' : count === expected ? ' ✓' : ` ✗ 기대 ${expected}`
    if (expected !== undefined && count !== expected) ok = false
    console.log(`  depth${entry.depth} ${labelOf(entry)}: ${entry.node ? '이미 있음' : '생성 예정'}, 상품 ${count}(이미 배치 ${already})${mark}`)
  }
  for (const branch of PLAN) {
    const total = matched.assignments.filter((assignment) => assignment.entry.branch === branch).length
    console.log(`  합계 ${branch.depth2}: ${total}`)
  }
  console.log(`\n[상품] 대상 ${matched.assignments.length + matched.unmatched.length + matched.duplicated.length}, 매칭 ${matched.assignments.length}, 미매칭 ${matched.unmatched.length}, 중복 ${matched.duplicated.length}`)
  for (const product of matched.unmatched) console.log(`  미매칭 ${product.id} ${product.title}`)
  for (const { product, rules } of matched.duplicated) console.log(`  중복 ${product.id} ${product.title} → ${rules.join(', ')}`)
  return ok && matched.unmatched.length === 0 && matched.duplicated.length === 0
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}

async function apply(nodes, resolved, matched) {
  if (matched.unmatched.length || matched.duplicated.length) fail('미매칭·중복이 있어 --apply를 거부합니다.')
  mkdirSync(BACKUP_DIR, { recursive: true })
  const backup = matched.assignments.map(({ product }) => ({ id: product.id, category_item_id: product.category_item_id }))
  const backupPath = existsSync(BACKUP_FILE) ? join(BACKUP_DIR, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) : BACKUP_FILE
  writeFileSync(backupPath, JSON.stringify(backup, null, 1))
  console.log(`백업: ${backupPath} (${backup.length}행)${backupPath === BACKUP_FILE ? '' : ' — 롤백에는 첫 실행 backup.json만 씀'}`)

  const record = readJson(CREATED_FILE, { created: [], reused: [] })
  let createdCount = 0
  for (const entry of flatEntries(resolved)) {
    const parentId = entry.depth === 3 ? entry.depth2.id : entry.parent.node.id
    if (entry.node) {
      if (!record.created.some((node) => node.id === entry.node.id) && !record.reused.some((node) => node.id === entry.node.id)) {
        record.reused.push({ id: entry.node.id, parent_id: parentId, depth: entry.depth, title: entry.plan.title })
        writeFileSync(CREATED_FILE, JSON.stringify(record, null, 1))
      }
      continue
    }
    const { data, error } = await db.from('market_category_items')
      .insert({ workspace_subject: SUBJECT, parent_id: parentId, depth: entry.depth, title: entry.plan.title, sort_order: entry.plan.sortOrder })
      .select('id, parent_id, depth, title, sort_order')
      .single()
    if (error) fail(`칸 생성 실패(${labelOf(entry)}): ${error.message} — 같은 --apply를 다시 실행하세요.`)
    entry.node = data
    record.created.push({ id: data.id, parent_id: parentId, depth: entry.depth, title: entry.plan.title })
    writeFileSync(CREATED_FILE, JSON.stringify(record, null, 1))
    createdCount += 1
  }

  let updatedCount = 0
  for (const entry of flatEntries(resolved)) {
    const ids = matched.assignments
      .filter((assignment) => assignment.entry === entry && assignment.product.category_item_id !== entry.node.id)
      .map((assignment) => assignment.product.id)
    if (ids.length === 0) continue
    const { data, error } = await db.from('market_items').update({ category_item_id: entry.node.id }).in('id', ids).select('id')
    if (error) fail(`상품 이동 실패(${labelOf(entry)}): ${error.message} — 같은 --apply를 다시 실행하세요.`)
    updatedCount += data.length
  }
  console.log(`\n완료: 칸 생성 ${createdCount}, 상품 갱신 ${updatedCount}. 공개 화면 개수는 캐시 때문에 최대 60초 뒤 반영됩니다.`)
}

async function verify(nodes, resolved, matched) {
  const entries = flatEntries(resolved)
  const missing = entries.filter((entry) => !entry.node)
  const misplaced = matched.assignments.filter(({ product, entry }) => !entry.node || product.category_item_id !== entry.node.id)
  const depthCounts = nodes.reduce((counts, node) => ({ ...counts, [node.depth]: (counts[node.depth] ?? 0) + 1 }), {})
  const { count: linked, error } = await db.from('market_items').select('id', { count: 'exact', head: true })
    .eq('workspace_subject', SUBJECT).not('category_item_id', 'is', null)
  if (error) fail(error.message)
  console.log(`\n[검증] 국어 칸 depth별 ${JSON.stringify(depthCounts)}, 카테고리 연결 상품 ${linked}, 계획 칸 없음 ${missing.length}, 목표 칸이 아닌 상품 ${misplaced.length}`)
  for (const branch of PLAN) {
    const depth2 = resolved.find((entry) => entry.branch === branch).depth2
    const under = subtreeIds(nodes, depth2.id)
    console.log(`  ${branch.depth2}: depth3 ${nodes.filter((n) => n.depth === 3 && under.includes(n.id)).length}, depth4 ${nodes.filter((n) => n.depth === 4 && under.includes(n.id)).length}, 하위 상품 ${matched.assignments.filter((a) => a.entry.branch === branch).length}`)
  }
  return missing.length === 0 && misplaced.length === 0
}

async function rollback() {
  if (!existsSync(BACKUP_FILE)) fail(`첫 실행 백업이 없습니다: ${BACKUP_FILE}`)
  const backup = JSON.parse(readFileSync(BACKUP_FILE, 'utf8'))
  const byTarget = new Map()
  for (const row of backup) byTarget.set(row.category_item_id, [...(byTarget.get(row.category_item_id) ?? []), row.id])
  let restored = 0
  for (const [categoryItemId, ids] of byTarget) {
    const { data, error } = await db.from('market_items').update({ category_item_id: categoryItemId }).in('id', ids).select('id')
    if (error) fail(`상품 되돌리기 실패: ${error.message} — 같은 --rollback을 다시 실행하세요.`)
    restored += data.length
  }
  const record = readJson(CREATED_FILE, { created: [], reused: [] })
  let deleted = 0
  for (const depth of [4, 3]) {
    for (const node of record.created.filter((created) => created.depth === depth)) {
      const { data, error } = await db.from('market_category_items').delete().eq('id', node.id).select('id')
      if (error) fail(`칸 삭제 실패(${node.title}): ${error.message} — 같은 --rollback을 다시 실행하세요.`)
      deleted += data.length
    }
  }
  console.log(`롤백 완료: 상품 ${restored}행을 백업 값으로, 만든 칸 ${deleted}개 삭제(이미 지워진 칸은 0으로 셈). reused 칸은 남김.`)
}

console.log(`모드: ${mode}`)
if (mode === 'rollback') {
  await rollback()
} else {
  const nodes = await loadNodes()
  const resolved = resolvePlan(nodes)
  const products = await loadProducts(nodes, resolved)
  const matched = matchProducts(products, resolved)
  const ready = report(resolved, matched)
  if (mode === 'apply') await apply(nodes, resolved, matched)
  if (mode === 'verify') {
    const ok = await verify(nodes, resolved, matched)
    console.log(ok ? '\n검증 통과' : '\n검증 실패')
    if (!ok) process.exit(1)
  }
  if (mode === 'dry-run') console.log(ready ? '\ndry-run: 기대값과 일치, --apply 가능' : '\ndry-run: 기대값과 다름 — --apply 전에 확인 필요')
}
