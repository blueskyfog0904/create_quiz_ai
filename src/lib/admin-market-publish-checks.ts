// 18번 7절(B-10): 상품 편집 화면의 공개 전 점검(순수). 화면만 막는다(서버 공개 검사 B-02 는 범위 밖).
// 1단계까지 편집 부품 안에 있던 publishChecks 식을 그대로 옮기고(필수 조건은 같음), 아래를 더했다.
//   level: required(빨강 칩, 공개를 막음)·warning(노랑 칩, 막지 않음) / targetId: 칩을 누르면 이동해 초점을 줄 입력칸 id
//   비활성 카테고리: 공개 전 상품은 필수, 이미 공개된 상품은 경고(Q6 — 공개 상품의 오타 수정까지 막지 않게)
//   17번 원저작물 이용 근거 미입력: 경고(공개를 막지 않음). 근거 여부는 17번 근거 모듈(관리자 route)이 알려 준 값만 받는다.

export type PublishCheckLevel = 'required' | 'warning'

export interface PublishCheck {
  key: string
  label: string
  done: boolean
  required: boolean
  level: PublishCheckLevel
  targetId: string
}

export interface PublishCheckSubproduct {
  id: string
  isActive: boolean
  priceCredits: number
}

export interface PublishCheckInput {
  categorySelected: boolean
  // 고른 칸이나 그 조상 가운데 비활성이 있음(회원 메뉴에서 안 보임)
  categoryInactive: boolean
  title: string
  subproducts: PublishCheckSubproduct[]
  // 서브상품 id → 사용 중인 판매 파일 수
  fileCounts: ReadonlyMap<string, number>
  bundleEnabled: boolean
  bundlePriceCredits: number
  // 상품 이미지 또는 카테고리 기본 이미지
  hasImage: boolean
  samplePageCount: number
  isPublishedItem: boolean
  hasUsageBasis: boolean
}

// 칩이 이동할 입력칸 id(화면의 같은 id — 계약 시험이 대조)
export const PUBLISH_CHECK_TARGET_IDS = {
  category: 'product-category-search',
  title: 'product-title-input',
  subproducts: 'product-subproducts',
  bundlePrice: 'product-bundle-price',
  image: 'product-image-field',
  sample: 'product-sample-pages',
  usageBasis: 'market-item-basis-card',
} as const

export function buildPublishChecks(input: PublishCheckInput): PublishCheck[] {
  const activeSubproducts = input.subproducts.filter((subproduct) => subproduct.isActive)
  const ids = PUBLISH_CHECK_TARGET_IDS
  const checks: Omit<PublishCheck, 'level'>[] = [
    { key: 'category', label: '카테고리 선택', done: input.categorySelected, required: true, targetId: ids.category },
    {
      key: 'category_active',
      label: input.isPublishedItem ? '활성 카테고리(비활성 칸의 상품은 회원 메뉴에서 안 보임)' : '활성 카테고리 선택(비활성 칸은 공개 불가)',
      done: !input.categorySelected || !input.categoryInactive,
      required: !input.isPublishedItem,
      targetId: ids.category,
    },
    { key: 'title', label: '제목 입력', done: Boolean(input.title.trim()), required: true, targetId: ids.title },
    { key: 'subproduct', label: '판매할 서브상품 1개 이상', done: activeSubproducts.length > 0, required: true, targetId: ids.subproducts },
    {
      key: 'files',
      label: '모든 서브상품에 파일 업로드',
      done: activeSubproducts.length > 0 && activeSubproducts.every((subproduct) => (input.fileCounts.get(subproduct.id) ?? 0) > 0),
      required: true,
      targetId: ids.subproducts,
    },
    ...(input.bundleEnabled
      ? [{ key: 'bundle', label: '전체구매 가격 입력', done: input.bundlePriceCredits > 0, required: true, targetId: ids.bundlePrice }]
      : []),
    { key: 'price', label: '서브상품 가격 입력(0 크레딧 없음)', done: activeSubproducts.length > 0 && activeSubproducts.every((subproduct) => subproduct.priceCredits > 0), required: false, targetId: ids.subproducts },
    { key: 'image', label: '상품 이미지(없으면 카테고리 기본 이미지)', done: input.hasImage, required: false, targetId: ids.image },
    { key: 'sample', label: '샘플 이미지', done: input.samplePageCount > 0, required: false, targetId: ids.sample },
    { key: 'origin_basis', label: '원저작물 이용 근거 입력(내부)', done: input.hasUsageBasis, required: false, targetId: ids.usageBasis },
  ]
  return checks.map((check) => ({ ...check, level: check.required ? 'required' : 'warning' }))
}

// 빠진 항목(칩): 필수 먼저, 그다음 경고. 같은 무리 안은 점검 순서.
export function missingPublishChecks(checks: PublishCheck[]) {
  return [
    ...checks.filter((check) => !check.done && check.level === 'required'),
    ...checks.filter((check) => !check.done && check.level === 'warning'),
  ]
}

export function isPublishBlockedByChecks(checks: PublishCheck[]) {
  return checks.some((check) => check.required && !check.done)
}
