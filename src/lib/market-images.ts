// 관리자 상품 이미지 라이브러리 공용 규칙(클라이언트에서도 import 가능한 순수 코드)
// docs/admin-product-image-library-plan.md D3·D4·D5·D6

export const MARKET_IMAGES_BUCKET = 'market-images'
export const MARKET_IMAGE_MIME_TYPE = 'image/webp'
export const MARKET_IMAGE_MAX_INPUT_BYTES = 4 * 1024 * 1024
export const MARKET_IMAGE_MAX_EDGE = 800
export const MARKET_IMAGE_NAME_MAX_LENGTH = 100
export const MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH = 60

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
}

// 저장 경로는 폴더와 무관하게 정규화 결과 해시로 정한다(D2).
export function buildMarketImageStoragePath(contentSha256: string) {
  if (!isSha256Hex(contentSha256)) {
    throw new Error('이미지 해시 형식이 올바르지 않습니다.')
  }
  return `thumbnails/${contentSha256.slice(0, 2)}/${contentSha256}.webp`
}

export interface MarketThumbnailImageRef {
  storage_path: string
}

// PostgREST 임베드 결과 모양
// thumbnail_image:market_images(storage_path), category_item:market_category_items(default_image:market_images(storage_path))
export interface MarketThumbnailSource {
  thumbnail_image?: MarketThumbnailImageRef | null
  category_item?: {
    default_image?: MarketThumbnailImageRef | null
  } | null
}

// 표시 우선순위(D6): 상품 이미지 → 카테고리 항목 기본 이미지 → null(점선 박스). 옛 URL 문자열 컬럼은 읽지 않는다.
export function pickMarketThumbnailUrl(
  source: MarketThumbnailSource,
  toPublicUrl: (storagePath: string) => string,
): string | null {
  const storagePath = source.thumbnail_image?.storage_path || source.category_item?.default_image?.storage_path
  return storagePath ? toPublicUrl(storagePath) : null
}
