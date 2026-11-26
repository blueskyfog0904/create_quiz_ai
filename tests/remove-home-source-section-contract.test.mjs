import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMarketHomeConfig } from '../src/lib/market-home.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return listSourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

test('src 어디에도 홈 "교재와 출처" 섹션의 문구·컴포넌트·설정·조회가 남아 있지 않다', () => {
  const removed = [
    '교재와 출처로 골라보기',
    'TextbookExplorer',
    'sourceExplorer',
    'loadSourceExplorer',
    'MarketHomeSourcePath',
    'MarketHomeSourceConfig',
    'source-explorer',
  ]
  const offenders = listSourceFiles(join(root, 'src')).flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    return removed.filter((token) => source.includes(token)).map((token) => `${relative(root, path)}: ${token}`)
  })
  assert.deepEqual(offenders, [])
})

// 22번: 홈 설정은 판 2(섹션 배열)다. 기본값 상수는 없다(설정은 DB 시드). 옛 sourceExplorer 키는 판 2 에서도 거절한다.
test('홈 설정 검증은 옛 sourceExplorer 키를 거절한다', () => {
  const valid = {
    version: 2,
    revision: 1,
    sections: [{ id: '05cc4d8c-0ec8-40d7-810f-43373d76c7cc', kind: 'recent', isActive: true, title: '최근', emptyText: null, limit: 8 }],
    emptyHomeLink: null,
  }
  assert.deepEqual(validateMarketHomeConfig(valid), valid)
  assert.throws(
    () => validateMarketHomeConfig({ ...valid, sourceExplorer: { isActive: true, sourceTypes: [] } }),
    /config\.sourceExplorer 칸은 쓰지 않습니다/,
  )
})

test('저장 API에 출처 검사가 없고 게시판 교재·출처 필터는 그대로 남아 있다', () => {
  const route = read('src/app/api/admin/market-main-settings/route.ts')
  assert.doesNotMatch(route, /invalidSourceType|출처 유형|sourceTypes/)
  assert.match(read('src/app/preview/solvook-concept/_components/board/board-list-controller.tsx'), /교재·출처/)
})
