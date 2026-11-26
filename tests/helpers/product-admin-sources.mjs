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
  '_settings/subproduct-category-settings-dialog.tsx',
  '_settings/file-type-settings-dialog.tsx',
  '_hooks/use-subproduct-uploads.ts',
  '_editor/basic-info-section.tsx',
  '_editor/subproduct-table.tsx',
  '_editor/bundle-section.tsx',
  '_editor/sample-section.tsx',
  '_editor/material-info-section.tsx',
  '_settings/category-manager-dialog.tsx',
]

export function readProductAdminFile(relativePath) {
  return readFileSync(new URL(relativePath, PRODUCTS_DIR), 'utf8')
}

export function readProductAdminSource() {
  return PRODUCT_ADMIN_FILES.map(readProductAdminFile).join('\n')
}
