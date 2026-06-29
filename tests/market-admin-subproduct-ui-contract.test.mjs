import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const adminProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('admin product form uses v2 subproduct upload state and item detail payload', () => {
  assert.match(adminProductsClient, /MarketSubproductCategory/)
  assert.match(adminProductsClient, /MarketFileType/)
  assert.match(adminProductsClient, /MarketItemSubproduct/)
  assert.match(adminProductsClient, /MarketSubproductFile/)
  assert.match(adminProductsClient, /MarketItemBundleOption/)
  assert.match(adminProductsClient, /subproducts/)
  assert.match(adminProductsClient, /subproductFiles/)
  assert.match(adminProductsClient, /bundleOption/)
})

test('admin product form loads configurable categories and file types for the selected workspace', () => {
  assert.match(adminProductsClient, /\/api\/admin\/market\/subproduct-categories/)
  assert.match(adminProductsClient, /\/api\/admin\/market\/file-types/)
  assert.match(adminProductsClient, /withAdminWorkspaceSubject/)
  assert.match(adminProductsClient, /MANAGE_SUBPRODUCT_CATEGORIES_VALUE/)
  assert.match(adminProductsClient, /MANAGE_FILE_TYPES_VALUE/)
  assert.match(adminProductsClient, /설정하기/)
  assert.match(adminProductsClient, /서브상품 카테고리 설정/)
  assert.match(adminProductsClient, /파일 유형 설정/)
})

test('admin product form renders subproduct, file-add, bundle, and arbitrary sample page controls', () => {
  assert.match(adminProductsClient, /서브상품 추가/)
  assert.match(adminProductsClient, /파일 추가\+/)
  assert.match(adminProductsClient, /전체 한번에 구매하기/)
  assert.match(adminProductsClient, /enabled: true/)
  assert.match(adminProductsClient, /기본값은 사용/)
  assert.match(adminProductsClient, /persistBundleOption/)
  assert.doesNotMatch(adminProductsClient, /handleSaveBundleOption/)
  assert.match(adminProductsClient, /샘플 페이지/)
  assert.match(adminProductsClient, /samplePageSelection/)
  assert.match(adminProductsClient, /renderSamplePdfPages\(selectedSampleSourceFile, samplePageSelection\)/)
  assert.doesNotMatch(adminProductsClient, /모두 업로드/)
  assert.doesNotMatch(adminProductsClient, /PDF 가격/)
  assert.doesNotMatch(adminProductsClient, /HWP 가격/)
  assert.doesNotMatch(adminProductsClient, /ZIP 가격/)
})

test('admin product form uses the selected subproduct category as the display name', () => {
  assert.match(adminProductsClient, /서브상품 카테고리/)
  assert.doesNotMatch(adminProductsClient, /서브상품명/)
  assert.doesNotMatch(adminProductsClient, /subproductDraft\.title/)
  assert.doesNotMatch(adminProductsClient, /title: subproductDraft\.title/)
  assert.match(adminProductsClient, /getSubproductCategoryName\(subproduct\.category_id\)/)
})

test('admin product form can create and edit subproduct purchase notice copy', () => {
  assert.match(adminProductsClient, /purchaseNoticeLabel: string/)
  assert.match(adminProductsClient, /purchaseNoticeText: string/)
  assert.match(adminProductsClient, /구매 안내 라벨/)
  assert.match(adminProductsClient, /구매 안내 문구/)
  assert.match(adminProductsClient, /예: PDF 포함/)
  assert.match(adminProductsClient, /예: 편집 가능한 HWP와 문제\(PDF\)를 함께 제공합니다\. PDF는 따로 구매하지 않아도 됩니다\./)
  assert.match(adminProductsClient, /maxLength=\{24\}/)
  assert.match(adminProductsClient, /maxLength=\{160\}/)
  assert.match(adminProductsClient, /사용자 상세 페이지의 구매 옵션 행에 표시됩니다/)
  assert.match(adminProductsClient, /purchaseNoticeLabel: subproductDraft\.purchaseNoticeLabel/)
  assert.match(adminProductsClient, /purchaseNoticeText: subproductDraft\.purchaseNoticeText/)

  assert.match(adminProductsClient, /SubproductEditState/)
  assert.match(adminProductsClient, /editingSubproductId/)
  assert.match(adminProductsClient, /subproductEditDraft/)
  assert.match(adminProductsClient, /handleEditSubproduct/)
  assert.match(adminProductsClient, /handleSaveSubproduct/)
  assert.match(adminProductsClient, /method: 'PATCH'/)
  assert.match(adminProductsClient, /purchaseNoticeLabel: subproductEditDraft\.purchaseNoticeLabel/)
  assert.match(adminProductsClient, /purchaseNoticeText: subproductEditDraft\.purchaseNoticeText/)
  assert.match(adminProductsClient, /refreshEditingFiles\(form\.id\)/)
  assert.match(adminProductsClient, />\s*수정\s*</)
  assert.match(adminProductsClient, /서브상품을 수정했습니다\./)
  assert.match(adminProductsClient, />\s*취소\s*</)
})

test('admin product form defaults new items to published and blocks enabled bundle without a price', () => {
  assert.match(adminProductsClient, /function buildEmptyForm[\s\S]+status: 'published'/)
  assert.match(adminProductsClient, /전체구매 가격을 설정해주세요/)
  assert.match(adminProductsClient, /nextStatus === 'published'[\s\S]+options\.draftSource !== 'auto_upload'[\s\S]+bundleForm\.enabled[\s\S]+parseCreditInputValue\(bundleForm\.priceCredits\) <= 0/)
})

test('admin product form adds paid file draft rows before upload instead of auto-rendering every file type', () => {
  assert.match(adminProductsClient, /SubproductFileDraftState/)
  assert.match(adminProductsClient, /subproductFileDrafts/)
  assert.match(adminProductsClient, /handleAddSubproductFileDraft/)
  assert.match(adminProductsClient, /handleUpdateSubproductFileDraft/)
  assert.match(adminProductsClient, /handleRemoveSubproductFileDraft/)
  assert.match(adminProductsClient, /getAvailableFileTypesForSubproduct\(subproduct\.id, draft\.id\)/)
  assert.match(adminProductsClient, /draft\.fileTypeId/)
  assert.doesNotMatch(adminProductsClient, /activeFileTypes\.map\(\(fileType\) => \(\s*<div key=\{fileType\.id\}/)
})

test('admin product form uploads paid files through subproduct file API from the selected draft file type', () => {
  assert.match(adminProductsClient, /\/subproducts\/\$\{subproductId\}\/files/)
  assert.match(adminProductsClient, /formData\.append\('fileTypeId', fileTypeId\)/)
  assert.match(adminProductsClient, /handleSubproductFileUpload\(subproduct\.id, draft\.fileTypeId/)
  assert.match(adminProductsClient, /handleDeleteSubproductFile/)
})
