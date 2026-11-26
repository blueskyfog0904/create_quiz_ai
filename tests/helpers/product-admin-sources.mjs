// 18번 1단계: 상품 관리 화면(market-products-client.tsx)을 역할별 파일로 나눈 뒤, 시험은 이 목록을 이어 붙인 글을 읽는다.
// 순서는 나누기 전 원본에서 그 코드가 처음 나오던 순서다(위치에 기대는 잘라 읽기는 readProductAdminFile 로 파일별로 읽는다).
import { readFileSync } from 'node:fs'

const PRODUCTS_DIR = new URL('../../src/app/(admin)/admin/market/products/', import.meta.url)

export const PRODUCT_ADMIN_FILES = [
  'market-products-client.tsx',
  '_lib/types.ts',
  '_editor/product-editor.tsx',
  '_editor/category-step.tsx',
  '_lib/product-form.ts',
  '_lib/sample-render.ts',
  '_hooks/use-product-form.ts',
  '_list/product-list.tsx',
  '_hooks/use-sample-generation.ts',
  '_hooks/use-subproduct-uploads.ts',
  '_editor/basic-info-section.tsx',
  '_editor/subproduct-table.tsx',
  '_editor/bundle-section.tsx',
  '_editor/sample-section.tsx',
  '_editor/material-info-section.tsx',
  '_settings/category-manager-dialog.tsx',
  // 18번 2단계(기능)에서 더한 파일
  '_editor/publish-summary-panel.tsx',
  '_editor/upload-queue-list.tsx',
  '_editor/after-save-dialog.tsx',
  '_hooks/use-product-duplicate.ts',
  '_lib/focus-field.ts',
  // 19번: 구성·파일 유형 설정 창(_settings/subproduct-category-settings-dialog·file-type-settings-dialog)은 '상품 표시 설정'
  // [구성·파일 유형] 탭(product-settings/taxonomy-tab.tsx)으로 옮겼다. 서브상품 순서 저장 훅을 더했다.
  '_hooks/use-subproduct-order.ts',
]

// 19번: 옮긴 구성·파일 유형 설정(상품 화면 밖). 그 내용을 단언하던 시험은 이 글을 읽는다.
export function readTaxonomySettingsSource() {
  return readFileSync(new URL('../product-settings/taxonomy-tab.tsx', PRODUCTS_DIR), 'utf8')
}

export function readProductAdminFile(relativePath) {
  return readFileSync(new URL(relativePath, PRODUCTS_DIR), 'utf8')
}

export function readProductAdminSource() {
  return PRODUCT_ADMIN_FILES.map(readProductAdminFile).join('\n')
}
