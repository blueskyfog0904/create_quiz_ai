import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// docs/market-category-tree-plan.md 8.10(S4): 예전 게시판 화면을 지우고 공용 컴포넌트만 src/components/market에 남긴다.
// 메뉴관리 카드 부재는 S4-3, 상품 API menuEntryId 부재는 S4-7에서 이 파일에 더한다.
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const exists = (path) => existsSync(join(root, path))

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return listSourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

test('예전 market 라우트 폴더와 게시판 page·사이드바·layout이 없다', () => {
  for (const path of [
    'src/app/(dashboard)/market',
    'src/app/[workspaceSubject]/market',
    'src/app/(dashboard)/market/layout.tsx',
    'src/app/(dashboard)/market/market-sidebar.tsx',
    'src/app/[workspaceSubject]/market/layout.tsx',
    'src/app/(dashboard)/market/[slug]/page.tsx',
    'src/app/(dashboard)/market/[slug]/board-preview/page.tsx',
    'src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx',
    'src/app/[workspaceSubject]/market/[slug]/page.tsx',
    'src/app/[workspaceSubject]/market/[slug]/board-preview/page.tsx',
    'src/app/[workspaceSubject]/market/[slug]/items/[itemId]/page.tsx',
    'src/app/preview/solvook-concept/boards/[slug]/page.tsx',
    'src/app/preview/solvook-concept/boards/[slug]/items/[itemId]/page.tsx',
  ]) {
    assert.equal(exists(path), false, `${path} should be removed`)
  }
  // 게시판 DB와 무관한 샘플 데모는 남긴다.
  assert.equal(exists('src/app/preview/solvook-concept/boards/[slug]/posts/[postId]/page.tsx'), true)
})

test('상세 구매 영역·샘플 미리보기 팝업은 src/components/market에만 있다', () => {
  for (const name of ['market-item-actions.tsx', 'market-sample-preview-dialog.tsx']) {
    assert.equal(exists(`src/components/market/${name}`), true, name)
    assert.equal(exists(`src/app/(dashboard)/market/[slug]/items/[itemId]/${name}`), false, name)
  }
})

test('src 어디에서도 예전 market 라우트 폴더를 import하거나 게시판 목록 링크를 조립하지 않는다', () => {
  // 샘플 데모(posts/[postId])용 material-detail.tsx는 게시판 DB와 무관해 검사에서 뺀다.
  const demo = join('src', 'app', 'preview', 'solvook-concept', '_components', 'detail', 'material-detail.tsx')
  const offenders = listSourceFiles(join(root, 'src')).flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    const name = relative(root, path)
    const found = []
    if (source.includes('@/app/(dashboard)/market')) found.push(`${name}: @/app/(dashboard)/market import`)
    if (name !== demo && /solvook-concept\/boards\/\$\{/.test(source)) found.push(`${name}: 게시판 목록 링크 조립`)
    return found
  })
  assert.deepEqual(offenders, [])
})

test('예전 게시판 목록 주소는 next.config에서 홈으로 307 redirect한다', () => {
  const config = read('next.config.ts')
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const [source, destination] of [
    ['/:subject(english|korean)/market', '/?subject=:subject'],
    ['/:subject(english|korean)/market/:slug', '/?subject=:subject'],
    ['/:subject(english|korean)/market/:slug/board-preview', '/?subject=:subject'],
    ['/market', '/'],
    ['/market/:slug', '/'],
    ['/market/:slug/board-preview', '/'],
    ['/preview/solvook-concept/boards/:slug', '/'],
  ]) {
    assert.match(
      config,
      new RegExp(`source: "${escape(source)}",\\s+destination: "${escape(destination)}",\\s+permanent: false,`),
      source
    )
  }
})
