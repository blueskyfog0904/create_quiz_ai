import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 관리자 정리 Phase 1a 계약(docs/admin-phase1a-plan.md). 단위(U1~U5)별로 test를 추가한다.
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('U1: 메뉴관리에서 "문제마켓 그룹" 카드와 그 데이터·액션·전용 lib가 없다(미적용 마이그레이션은 보관)', () => {
  const client = read('src/app/(admin)/admin/menu-management/menu-management-client.tsx')
  for (const name of ['MarketMenuGroupsManager', 'marketMenuGroups', 'marketMenuEntryGroupAssignments']) {
    assert.doesNotMatch(client, new RegExp(name), name)
  }

  const actions = read('src/app/(admin)/admin/menu-management/actions.ts')
  assert.doesNotMatch(actions, /market-menu-groups-server/)
  for (const name of [
    'createMarketMenuGroupAction',
    'updateMarketMenuGroupAction',
    'archiveMarketMenuGroupAction',
    'reorderMarketMenuGroupsAction',
    'assignMarketMenuEntriesToGroupAction',
  ]) {
    assert.doesNotMatch(actions, new RegExp(name), name)
  }
  // 남은 메뉴 액션은 두 과목 프리뷰(홈·게시판)를 계속 갱신한다(삭제한 그룹 액션 테스트에서 옮겨 온 검사).
  assert.match(actions, /revalidatePath\('\/preview\/solvook-concept'\)/)
  assert.match(actions, /revalidatePath\('\/preview\/solvook-concept\/boards\/\[slug\]', 'page'\)/)

  assert.equal(existsSync(join(root, 'src/app/(admin)/admin/menu-management/market-menu-groups-manager.tsx')), false)
  assert.equal(existsSync(join(root, 'src/lib/market-menu-groups-server.ts')), false)
  assert.equal(existsSync(join(root, 'supabase/migrations/20260730010000_create_market_menu_groups.sql')), true)
})

test('U2: 결제 성공 화면과 홈 광고 빈 상태 버튼이 과거 /{과목}/market 화면으로 보내지 않는다', () => {
  const success = read('src/app/checkout/success/page.tsx')
  assert.doesNotMatch(success, /'\/market'/)
  assert.match(success, /href=\{isSuccess \? '\/' : '\/mypage\/support'\}/)

  const carousel = read('src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx')
  assert.doesNotMatch(carousel, /\/\$\{subject\}\/market/)
  assert.match(carousel, /\/search\?subject=\$\{subject\}/)
  assert.doesNotMatch(carousel, /categories/, 'categories prop is no longer used')

  for (const source of [success, carousel]) {
    assert.doesNotMatch(source, /\/(english|korean)\/market/)
  }

  for (const path of ['src/app/(solvook)/_components/solvook-home-view.tsx', 'src/app/preview/solvook-concept/page.tsx']) {
    assert.doesNotMatch(read(path), /<MainAdCarousel[^>]*categories=/, path)
  }
})
