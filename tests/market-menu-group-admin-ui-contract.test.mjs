import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const managerPath =
  'src/app/(admin)/admin/menu-management/market-menu-groups-manager.tsx'
const clientPath =
  'src/app/(admin)/admin/menu-management/menu-management-client.tsx'

test('menu management renders the subject-scoped market group manager before leaf CRUD', async () => {
  const [managerSource, clientSource] = await Promise.all([
    readFile(managerPath, 'utf8'),
    readFile(clientPath, 'utf8'),
  ])

  assert.match(clientSource, /<MarketMenuGroupsManager/)
  assert.match(clientSource, /groups=\{marketMenuGroups\}/)
  assert.match(clientSource, /assignments=\{marketMenuEntryGroupAssignments\}/)
  assert.ok(
    clientSource.indexOf('<MarketMenuGroupsManager')
      < clientSource.indexOf('<CardTitle>문제마켓 2단계 메뉴 관리</CardTitle>')
  )
  assert.match(managerSource, /workspaceSubject/)
  assert.match(managerSource, /문제마켓 카테고리 그룹/)
})

test('group manager owns CRUD, ordering, status, and explicit leaf placement actions', async () => {
  const source = await readFile(managerPath, 'utf8')

  for (const actionName of [
    'createMarketMenuGroupAction',
    'updateMarketMenuGroupAction',
    'archiveMarketMenuGroupAction',
    'reorderMarketMenuGroupsAction',
    'assignMarketMenuEntriesToGroupAction',
  ]) {
    assert.match(source, new RegExp(actionName))
  }

  assert.match(source, /그룹 추가/)
  assert.match(source, /그룹 편성 저장/)
  assert.match(source, /기타 \(미배치\)/)
  assert.match(source, /노출/)
  assert.match(source, /활성/)
  assert.match(source, /삭제/)
  assert.match(source, /ArrowUp/)
  assert.match(source, /ArrowDown/)
  assert.match(source, /Checkbox/)
})

test('group manager preserves accessibility and responsive interaction contracts', async () => {
  const source = await readFile(managerPath, 'utf8')

  assert.match(source, /AlertDialog/)
  assert.match(source, /DialogDescription/)
  assert.match(source, /htmlFor=/)
  assert.match(source, /aria-label=/)
  assert.match(source, /min-h-11/)
  assert.match(source, /focus-visible:ring/)
  assert.match(source, /md:grid-cols/)
  assert.match(source, /disabled=/)
})
