import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const client = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('상품 등록 폼은 기본 정보 → 판매 구성 → 샘플 → 상세 정보 → 공개 전 점검 순서다', () => {
  const ids = ['product-step-basic', 'product-step-sales', 'product-step-sample', 'product-step-detail', 'product-step-publish']
  const positions = ids.map((id) => client.indexOf(`<section id="${id}"`))
  positions.forEach((position, index) => assert.notEqual(position, -1, `${ids[index]} section should exist`))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  // 샘플은 파일을 올리는 판매 구성 뒤에, 서브상품 구성은 판매 구성 안에 있다
  const subproductTitle = client.indexOf('>서브상품 구성</p>')
  const sampleTitle = client.indexOf('>샘플 생성</p>')
  assert.ok(subproductTitle > positions[1] && subproductTitle < positions[2])
  assert.ok(sampleTitle > positions[2] && sampleTitle < positions[3])
  assert.match(client, /productSteps\.map\(\(step, index\) =>/)
  assert.match(client, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/)
})

test('공개는 필수 점검 항목이 다 채워져야 가능하고, 저장은 handleSave 하나로 상태를 정한다', () => {
  for (const key of ['category', 'title', 'subproduct', 'files', 'bundle']) {
    assert.match(client, new RegExp(`key: '${key}'[^\\n]*required: true|key: '${key}',\\n[\\s\\S]*?required: true`))
  }
  assert.match(client, /const isPublishBlocked = missingRequiredChecks\.length > 0/)
  assert.match(client, /onClick=\{\(\) => void handleSave\('published'\)\}\n\s+disabled=\{isSaving \|\| isPublishBlocked\}/)
  assert.match(client, /onClick=\{\(\) => void handleSave\('draft'\)\}/)
  assert.match(client, /onSelect=\{\(\) => void handleSave\('hidden'\)\}/)
  assert.match(client, /onSelect=\{\(\) => void handleSave\('archived'\)\}/)
  // 새 상품에서 상태만 바꾸고 저장하지 않던 버튼은 없앴다
  assert.doesNotMatch(client, /handleStatusAction/)
  assert.doesNotMatch(client, /저장하면 반영됩니다/)
  assert.doesNotMatch(client, /판매 구성 안내/)
})

test('서브상품 추가 폼은 서브상품이 없거나 [서브상품 추가]를 눌렀을 때만 열리고, 구매 안내는 고급 설정에 접힌다', () => {
  assert.match(client, /\{subproducts\.length === 0 \|\| isSubproductFormOpen \? \(/)
  assert.match(client, /onClick=\{\(\) => setIsSubproductFormOpen\(true\)\}/)
  assert.equal((client.match(/고급 설정 \(구매 안내 문구\)/g) ?? []).length, 2)
  // 추가한 서브상품에는 바로 업로드 칸을 열어 둔다
  assert.match(client, /setIsSubproductFormOpen\(false\)\n\s+\/\/[^\n]*\n\s+if \(payload\.data\?\.id\) \{\n\s+handleAddSubproductFileDraft\(payload\.data\.id\)/)
})
