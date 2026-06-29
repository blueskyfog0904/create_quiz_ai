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

test('default service terms cover this service-specific credits, AI, and copyright risks', () => {
  const serviceTerms = normalizeFooterContent().policyDocuments.serviceTerms.content

  assert.match(serviceTerms, /크레딧/)
  assert.match(serviceTerms, /AI 생성 결과물/)
  assert.match(serviceTerms, /지문|문항/)
  assert.match(serviceTerms, /저작권/)
  assert.match(serviceTerms, /이용제한/)
  assert.match(serviceTerms, /소명/)
  assert.doesNotMatch(serviceTerms, /쏠북|SOLVOOK|북아이피스|캐시 이용약관/)
})

test('default privacy policy covers this service-specific data processing', () => {
  const privacyPolicy = normalizeFooterContent().policyDocuments.privacyPolicy.content

  assert.match(privacyPolicy, /카카오/)
  assert.match(privacyPolicy, /Supabase/)
  assert.match(privacyPolicy, /토스페이먼츠/)
  assert.match(privacyPolicy, /OpenAI|Gemini|Claude/)
  assert.match(privacyPolicy, /지문|문항/)
  assert.match(privacyPolicy, /크레딧|결제/)
  assert.match(privacyPolicy, /IP|User-Agent|접속 로그/)
  assert.match(privacyPolicy, /쿠키/)
  assert.match(privacyPolicy, /열람|정정|삭제|처리정지/)
  assert.match(privacyPolicy, /파기/)
  assert.match(privacyPolicy, /개인정보 보호책임자/)
  assert.doesNotMatch(privacyPolicy, /쏠북|SOLVOOK|북아이피스|Goodnotes/)
})

test('default refund policy covers this service-specific credit and digital content rules', () => {
  const refundPolicy = normalizeFooterContent().policyDocuments.refundPolicy.content

  assert.match(refundPolicy, /7일/)
  assert.match(refundPolicy, /미사용 크레딧/)
  assert.match(refundPolicy, /AI 생성/)
  assert.match(refundPolicy, /다운로드/)
  assert.match(refundPolicy, /오류|장애/)
  assert.match(refundPolicy, /부분 환불/)
  assert.match(refundPolicy, /토스페이먼츠/)
  assert.match(refundPolicy, /영업일 기준 2~5일/)
  assert.match(refundPolicy, /원 결제수단|결제한 수단/)
  assert.match(refundPolicy, /회원 간/)
  assert.match(refundPolicy, /양도|이전/)
  assert.doesNotMatch(refundPolicy, /쏠북|SOLVOOK|북아이피스|Goodnotes|쏠북패스/)
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
