import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_FOOTER_BRAND_NAME,
  FOOTER_POLICY_DOCUMENT_KEYS,
  getFooterPolicyDocumentBySlug,
  getFooterBrandName,
  getVisibleFooterPolicyLinks,
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

const termsPageSource = readFileSync(
  new URL('../src/app/terms/page.tsx', import.meta.url),
  'utf8'
)

const termsDocumentPageSource = readFileSync(
  new URL('../src/app/terms/[documentSlug]/page.tsx', import.meta.url),
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

test('normalizeFooterContent provides editable default legal policy documents', () => {
  const normalized = normalizeFooterContent({
    policyDocuments: {
      serviceTerms: { label: '서비스 이용약관', title: '서비스 이용약관', slug: 'custom', content: '서비스 본문', enabled: true },
      privacyPolicy: { label: '개인정보처리방침', title: '', slug: 'privacy', content: '', enabled: true },
      refundPolicy: { label: '', title: '취소/환불정책', slug: 'refund', content: '환불 본문', enabled: false },
    },
  })

  assert.deepEqual(FOOTER_POLICY_DOCUMENT_KEYS, ['serviceTerms', 'privacyPolicy', 'refundPolicy'])
  assert.equal(normalized.policyDocuments.serviceTerms.slug, 'service')
  assert.equal(normalized.policyDocuments.serviceTerms.content, '서비스 본문')
  assert.match(normalized.policyDocuments.privacyPolicy.content, /개인정보/)
  assert.equal(normalized.policyDocuments.refundPolicy.label, '취소/환불정책')
  assert.equal(normalized.policyDocuments.refundPolicy.enabled, false)
})

test('footer policy helpers expose enabled links and resolve public document slugs', () => {
  const normalized = normalizeFooterContent({
    policyDocuments: {
      serviceTerms: { label: '서비스 이용약관', title: '서비스 이용약관', slug: 'service', content: '서비스 본문', enabled: true },
      privacyPolicy: { label: '개인정보처리방침', title: '개인정보처리방침', slug: 'privacy', content: '개인정보 본문', enabled: true },
      refundPolicy: { label: '취소/환불정책', title: '취소/환불정책', slug: 'refund', content: '환불 본문', enabled: false },
    },
  })

  assert.deepEqual(
    getVisibleFooterPolicyLinks(normalized).map((link) => [link.label, link.href]),
    [
      ['서비스 이용약관', '/terms/service'],
      ['개인정보처리방침', '/terms/privacy'],
    ]
  )
  assert.equal(getFooterPolicyDocumentBySlug(normalized, 'privacy')?.title, '개인정보처리방침')
  assert.equal(getFooterPolicyDocumentBySlug(normalized, 'refund'), null)
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
  assert.match(footerSource, /getVisibleFooterPolicyLinks/)
  assert.match(footerSource, /href=\{link\.href\}/)
})

test('footer admin page supports fixed fields, notices, and legal policy document editing', () => {
  assert.match(footerClientSource, /기본 사업자 정보/)
  assert.match(footerClientSource, /추가 안내 문구/)
  assert.match(footerClientSource, /약관 및 정책/)
  assert.match(footerClientSource, /policyDocumentEntries/)
  assert.match(footerClientSource, /footer-policy-label/)
  assert.match(footerClientSource, /footer-policy-title/)
  assert.match(footerClientSource, /footer-policy-content/)
  assert.match(footerClientSource, /onCheckedChange/)
  assert.match(footerClientSource, /안내 문구 추가/)
})

test('terms pages render editable policy documents from footer settings', () => {
  assert.match(termsPageSource, /getSiteFooterContent/)
  assert.match(termsPageSource, /getVisibleFooterPolicyLinks/)
  assert.match(termsDocumentPageSource, /getFooterPolicyDocumentBySlug/)
  assert.match(termsDocumentPageSource, /notFound/)
  assert.match(termsDocumentPageSource, /documentSlug/)
})
