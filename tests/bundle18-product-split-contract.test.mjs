import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCallInventory } from '../scripts/product-admin-call-inventory.mjs'
import { PRODUCT_ADMIN_FILES, readProductAdminFile } from './helpers/product-admin-sources.mjs'

// 18번 1단계: 상품 관리 화면 나누기는 '옮기기만'이다(같은 요청·같은 순서·같은 문구).
const PRODUCTS_DIR = fileURLToPath(new URL('../src/app/(admin)/admin/market/products/', import.meta.url))
const SPLIT_DIRS = ['_list', '_editor', '_settings', '_hooks', '_lib']

function listSplitFiles() {
  const files = ['market-products-client.tsx']
  for (const dir of SPLIT_DIRS) {
    const walk = (relative) => {
      for (const name of readdirSync(join(PRODUCTS_DIR, relative)).sort()) {
        const path = `${relative}/${name}`
        if (statSync(join(PRODUCTS_DIR, path)).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name)) files.push(path)
      }
    }
    walk(dir)
  }
  return files
}

// 1단계 커밋에서는 기준(77b7511)과 같았다(fetch 31·uploadToSignedUrl 2·router.refresh 7). 2단계는 아래 세 가지만 바꾸고 기준을 다시 저장했다:
//   판매 파일 올리기 prepare·complete fetch 가 handleSubproductFileUpload → runUploadEntry 로, 그 사이 uploadToSignedUrl → uploadFileToSignedUrl(진행률),
//   복제 route 호출 fetch 1개(requestDuplicate), 관리 화면 저장 뒤 창 [빈 새 상품]의 router.push 1개(등록 화면으로).
//   그 밖의 호출이 바뀌면 이 시험이 실패한다.
test('호출 목록(fetch·Storage 업로드·router)이 저장된 기준과 같다(둘러싼 함수·순서·인자·주소 변수까지)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/product-admin-call-inventory.json', import.meta.url), 'utf8'))
  const inventory = buildCallInventory(PRODUCT_ADMIN_FILES.map((path) => ({ path, text: readProductAdminFile(path) })))
  assert.deepEqual(fixture.counts, { fetch: 32, 'router.refresh': 7, uploadToSignedUrl: 1, 'router.push': 1, uploadFileToSignedUrl: 1 })
  assert.deepEqual(inventory.counts, fixture.counts)
  assert.deepEqual(inventory.calls, fixture.calls)
})

test('시험 도우미의 파일 목록은 나눈 파일과 빠짐없이 같다(page.tsx·new·미리보기 창·정리 안내는 뺀다)', () => {
  assert.deepEqual([...PRODUCT_ADMIN_FILES].sort(), listSplitFiles().sort())
  for (const excluded of ['page.tsx', 'new/page.tsx', 'admin-market-sample-preview-dialog.tsx', 'storage-cleanup-notice.tsx']) {
    assert.equal(PRODUCT_ADMIN_FILES.includes(excluded), false, excluded)
  }
})

test('껍데기는 700줄 안을 목표로 한다(넘으면 경고만)', (t) => {
  const lines = readProductAdminFile('market-products-client.tsx').split('\n').length
  if (lines > 700) t.diagnostic(`market-products-client.tsx ${lines}줄 — 700줄을 넘었다. 까닭은 output/ 검증 근거에 적는다.`)
  assert.ok(lines > 0)
})

test('화면 부품(_editor·_list·_settings)은 서버 전용 모듈을 가져오지 않는다', () => {
  for (const path of PRODUCT_ADMIN_FILES.filter((file) => /^_(editor|list|settings)\//.test(file))) {
    const source = readProductAdminFile(path)
    assert.doesNotMatch(source, /from 'server-only'|import 'server-only'/, path)
    assert.doesNotMatch(source, /bypass/i, path)
    assert.doesNotMatch(source, /from '@\/lib\/supabase\/(server|admin)'/, path)
  }
})

test('나눈 파일의 컴포넌트·훅 안 함수는 2칸 들여쓰기 그대로다(시험이 \\n  }\\n 로 본문을 자름)', () => {
  const shell = readProductAdminFile('market-products-client.tsx')
  for (const name of ['toggleFilteredSelection', 'changeFilterCategory', 'changeListPage', 'refreshItems']) {
    assert.match(shell, new RegExp(`\\n {2}const ${name} = `), name)
  }
  const productForm = readProductAdminFile('_hooks/use-product-form.ts')
  for (const name of ['persistForm', 'buildRequestBody', 'ensureDraftItemForUpload', 'handleSave', 'resetForm']) {
    assert.match(productForm, new RegExp(`\\n {2}const ${name} = `), name)
  }
})
