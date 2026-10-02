import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MARKET_HOME_CONFIG, validateMarketHomeConfig } from '../src/lib/market-home.ts'

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

test('홈 설정 검증은 옛 sourceExplorer 키를 거절하고 기본값에도 그 키가 없다', () => {
  assert.equal('sourceExplorer' in DEFAULT_MARKET_HOME_CONFIG, false)
  const valid = {
    version: 1,
    popular: { isActive: true, limit: 12, rankingWindowDays: 30 },
    categories: { isActive: true, menuEntryIds: [] },
    recent: { isActive: true, limit: 8 },
  }
  assert.deepEqual(validateMarketHomeConfig(valid), valid)
  assert.throws(
    () => validateMarketHomeConfig({ ...valid, sourceExplorer: { isActive: true, sourceTypes: [] } }),
    /config\.sourceExplorer is not supported/,
  )
})

test('저장 API에 출처 검사가 없고 게시판 교재·출처 필터는 그대로 남아 있다', () => {
  const route = read('src/app/api/admin/market-main-settings/route.ts')
  assert.doesNotMatch(route, /invalidSourceType|출처 유형|sourceTypes/)
  assert.match(read('src/app/preview/solvook-concept/_components/board/board-list-controller.tsx'), /교재·출처/)
})
