import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_FOOTER_BRAND_NAME,
  getFooterBrandName,
  getVisibleFooterRows,
  normalizeFooterContent,
} from '../src/lib/footer-content.ts'

const footerSource = readFileSync(
  new URL('../src/components/layout/footer.tsx', import.meta.url),
  'utf8'
)

const footerClientSource = readFileSync(
  new URL('../src/app/(admin)/admin/footer/footer-client.tsx', import.meta.url),
  'utf8'
)

test('normalizeFooterContent keeps fixed fields and strips blank notices', () => {
  const normalized = normalizeFooterContent({
    fixedFields: {
      companyName: { label: '상호명', value: '예시', enabled: true },
    },
    extraNotices: ['  첫 안내  ', '', '   '],
  })

  assert.equal(normalized.fixedFields.companyName.value, '예시')
  assert.equal(normalized.fixedFields.representativeName.label, '대표자명')
  assert.deepEqual(normalized.extraNotices, ['첫 안내'])
})

test('getVisibleFooterRows only includes enabled non-empty fields', () => {
  const rows = getVisibleFooterRows(normalizeFooterContent({
    fixedFields: {
      companyName: { label: '상호명', value: '예시', enabled: true },
      representativeName: { label: '대표자명', value: '', enabled: true },
      businessAddress: { label: '사업장주소', value: '서울시 강남구', enabled: false },
      customerCenter: { label: '고객센터', value: '02-0000-0000', enabled: true },
    },
  }))

  assert.equal(rows[0].length, 1)
  assert.equal(rows[0][0].key, 'companyName')
  assert.equal(rows[1][0].key, 'customerCenter')
})

test('getFooterBrandName falls back when company name is inactive', () => {
  const brandName = getFooterBrandName(normalizeFooterContent({
    fixedFields: {
      companyName: { label: '상호명', value: '주식회사 예시', enabled: false },
    },
  }))

  assert.equal(brandName, DEFAULT_FOOTER_BRAND_NAME)
})

test('footer component reads site footer content from server util', () => {
  assert.match(footerSource, /getSiteFooterContent/)
  assert.match(footerSource, /getVisibleFooterRows/)
})

test('footer admin page supports fixed field toggles and notice list editing', () => {
  assert.match(footerClientSource, /기본 사업자 정보/)
  assert.match(footerClientSource, /추가 안내 문구/)
  assert.match(footerClientSource, /onCheckedChange/)
  assert.match(footerClientSource, /안내 문구 추가/)
})
