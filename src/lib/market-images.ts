// 관리자 상품 이미지 라이브러리 공용 규칙(클라이언트에서도 import 가능한 순수 코드)
// docs/admin-product-image-library-plan.md D3·D4·D5·D6

export const MARKET_IMAGES_BUCKET = 'market-images'
export const MARKET_IMAGE_MIME_TYPE = 'image/webp'
export const MARKET_IMAGE_MAX_INPUT_BYTES = 4 * 1024 * 1024
export const MARKET_IMAGE_MAX_EDGE = 800
export const MARKET_IMAGE_NAME_MAX_LENGTH = 100
export const MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH = 60
// API 한 요청의 한도. 클라이언트는 이 값으로 나눠 보내고 서버는 넘으면 거절한다.
// 업로드: 파일 합계는 MARKET_IMAGE_MAX_INPUT_BYTES 이하(배포 환경 본문 한도), 파일 수는 아래 값 이하
export const MARKET_IMAGE_MAX_FILES_PER_UPLOAD = 20
// 이동: .in() 필터 URL 길이 한도 때문에 200개까지(약 350개부터 실패)
export const MARKET_IMAGE_MAX_MOVE_IDS = 200
export const MARKET_IMAGE_MAX_CHECK_HASHES = 100
// 상품 이미지 일괄 지정: 이동과 같은 .in() URL 길이 한도
export const MARKET_IMAGE_MAX_BULK_ITEM_IDS = 200

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

export interface MarketImageDto {
  id: string
  folderId: string | null
  displayName: string
  storagePath: string
  width: number
  height: number
  bytes: number
  createdAt: string
  publicUrl: string
}

export interface MarketImageFolderDto {
  id: string
  name: string
  sortOrder: number
  imageCount: number
  createdAt: string
  updatedAt: string
}

export interface MarketImageUsageRef {
  id: string
  title: string
}

export interface MarketImageUsage {
  items: MarketImageUsageRef[]
  categoryItems: MarketImageUsageRef[]
}

// 파일 수·합계 바이트 한도를 넘지 않게 순서대로 묶는다. 한 파일이 합계 한도를 넘으면 혼자 한 묶음이 된다(서버가 거절).
export function chunkMarketImageUploads<T extends { size: number }>(files: T[]): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentBytes = 0
  for (const file of files) {
    if (current.length > 0 && (
      current.length >= MARKET_IMAGE_MAX_FILES_PER_UPLOAD
      || currentBytes + file.size > MARKET_IMAGE_MAX_INPUT_BYTES
    )) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(file)
    currentBytes += file.size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

export function formatMarketImageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 공개 목록·상세가 상품 이미지(1단계)와 카테고리 항목 기본 이미지(2단계)를 select 한 번으로 함께 읽는 임베드
export const MARKET_THUMBNAIL_EMBED = 'thumbnail_image:market_images(storage_path), category_item:market_category_items(default_image:market_images(storage_path))'

// 상품 이미지가 바뀌면 무효화할 공개 목록 데이터 캐시(홈·보드의 unstable_cache) 태그
export const MARKET_PUBLIC_LIST_CACHE_TAG = 'market-public-lists'

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

// Supabase 클라이언트의 공개 URL 생성 부분만 받는다(이 파일은 클라이언트에서도 import하므로 SDK를 들이지 않는다).
export interface MarketPublicUrlClient {
  storage: { from(bucket: string): { getPublicUrl(path: string): { data: { publicUrl: string } } } }
}

export function toMarketThumbnailUrl(client: MarketPublicUrlClient, source: MarketThumbnailSource) {
  return pickMarketThumbnailUrl(source, (storagePath) => client.storage.from(MARKET_IMAGES_BUCKET).getPublicUrl(storagePath).data.publicUrl)
}

// 표시 우선순위(D6): 상품 이미지 → 카테고리 항목 기본 이미지 → null(점선 박스). 옛 URL 문자열 컬럼은 읽지 않는다.
export function pickMarketThumbnailUrl(
  source: MarketThumbnailSource,
  toPublicUrl: (storagePath: string) => string,
): string | null {
  const storagePath = source.thumbnail_image?.storage_path || source.category_item?.default_image?.storage_path
  return storagePath ? toPublicUrl(storagePath) : null
}
