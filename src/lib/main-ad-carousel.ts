export const MAIN_AD_CAROUSEL_SETTING_KEY = 'main_ad_carousel'
export const MAIN_AD_IMAGES_BUCKET = 'main-ad-images'
export const MAIN_AD_DEFAULT_DURATION_SECONDS = 5
export const MAIN_AD_MIN_DURATION_SECONDS = 1
export const MAIN_AD_MAX_DURATION_SECONDS = 60
export const MAIN_AD_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export type MainAdImageRole = 'pc' | 'mobile'
export type MainAdImageExtension = 'jpg' | 'png' | 'webp'
export type MainAdSubject = 'english' | 'korean'

export interface MainAdCarouselItem {
  id: string
  title: string
  pcImagePath: string
  mobileImagePath: string | null
  alt: string
  href: string
  durationSeconds: number
  isActive: boolean
}

export interface MainAdCarouselSubjectConfig {
  version: 1
  items: MainAdCarouselItem[]
}

export interface MainAdCarouselConfig {
  version: 2
  items: Record<MainAdSubject, MainAdCarouselItem[]>
}

export interface PublicMainAdCarouselItem {
  id: string
  title: string
  pcImageUrl: string
  mobileImageUrl: string | null
  alt: string
  href: string
  durationSeconds: number
}

export interface MainAdCleanupWarning {
  path: string
  message: string
}

export interface MainAdSaveResponse {
  config: MainAdCarouselSubjectConfig
  cleanupWarnings: MainAdCleanupWarning[]
  imageUrls: Record<string, {
    pc: string
    mobile: string | null
  }>
}

export interface MainAdUploadCandidate {
  name: string
  size: number
  type: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STORAGE_PATH_PATTERN = /^carousel\/([0-9a-f-]+)\/(pc|mobile)\/([0-9a-f-]+)\.(jpg|jpeg|png|webp)$/i
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/

export class MainAdCarouselValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MainAdCarouselValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateUuid(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new MainAdCarouselValidationError(`${fieldName} 형식이 올바르지 않습니다.`)
  }

  return value.toLowerCase()
}

function validateRequiredText(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MainAdCarouselValidationError(`${fieldName}을(를) 입력해 주세요.`)
  }

  return value.trim()
}

function hasUnsafeTraversal(value: string) {
  const rawPath = value.split(/[?#]/, 1)[0]

  try {
    const decodedPath = decodeURIComponent(rawPath)
    const segments = decodedPath.split('/')

    return CONTROL_CHARACTER_PATTERN.test(decodedPath)
      || decodedPath.includes('\\')
      || decodedPath.startsWith('//')
      || segments.some((segment) => segment === '..' || segment === '.')
  } catch {
    return true
  }
}

export function isAllowedMainAdHref(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes('\\')
  ) {
    return false
  }

  if (value.startsWith('/')) {
    if (value.startsWith('//') || hasUnsafeTraversal(value)) {
      return false
    }

    try {
      const parsed = new URL(value, 'https://main-ad.local')
      return parsed.origin === 'https://main-ad.local'
    } catch {
      return false
    }
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && parsed.username.length === 0
      && parsed.password.length === 0
  } catch {
    return false
  }
}

export function validateMainAdHref(value: unknown) {
  const normalizedValue = typeof value === 'string' ? value.trim() : value

  if (!isAllowedMainAdHref(normalizedValue)) {
    throw new MainAdCarouselValidationError(
      '연결 주소는 /로 시작하는 내부 경로 또는 https:// 외부 주소만 사용할 수 있습니다.'
    )
  }

  return normalizedValue
}

function validateDuration(value: unknown) {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < MAIN_AD_MIN_DURATION_SECONDS
    || value > MAIN_AD_MAX_DURATION_SECONDS
  ) {
    throw new MainAdCarouselValidationError(
      `노출 시간은 ${MAIN_AD_MIN_DURATION_SECONDS}초부터 ${MAIN_AD_MAX_DURATION_SECONDS}초 사이의 정수여야 합니다.`
    )
  }

  return value
}

function validateImageRole(value: unknown): MainAdImageRole {
  if (value !== 'pc' && value !== 'mobile') {
    throw new MainAdCarouselValidationError('이미지 구분이 올바르지 않습니다.')
  }

  return value
}

function validateImageExtension(value: unknown): MainAdImageExtension {
  if (value === 'jpeg') {
    return 'jpg'
  }

  if (value !== 'jpg' && value !== 'png' && value !== 'webp') {
    throw new MainAdCarouselValidationError('지원하지 않는 이미지 확장자입니다.')
  }

  return value
}

export function buildMainAdStoragePath(
  itemIdValue: string,
  roleValue: MainAdImageRole,
  assetIdValue: string,
  extensionValue: MainAdImageExtension | 'jpeg'
) {
  const itemId = validateUuid(itemIdValue, '광고 ID')
  const role = validateImageRole(roleValue)
  const assetId = validateUuid(assetIdValue, '이미지 ID')
  const extension = validateImageExtension(extensionValue)

  return `carousel/${itemId}/${role}/${assetId}.${extension}`
}

export function validateMainAdStoragePath(
  value: unknown,
  itemIdValue: string,
  roleValue: MainAdImageRole
) {
  if (
    typeof value !== 'string'
    || value.includes('\\')
    || value.includes('%')
    || value.includes('?')
    || value.includes('#')
    || value.includes('..')
  ) {
    throw new MainAdCarouselValidationError('이미지 저장 경로가 올바르지 않습니다.')
  }

  const itemId = validateUuid(itemIdValue, '광고 ID')
  const role = validateImageRole(roleValue)
  const match = value.match(STORAGE_PATH_PATTERN)

  if (!match) {
    throw new MainAdCarouselValidationError('이미지 저장 경로가 올바르지 않습니다.')
  }

  const [, pathItemId, pathRole, pathAssetId, pathExtension] = match
  validateUuid(pathAssetId, '이미지 ID')
  validateImageExtension(pathExtension.toLowerCase())

  if (pathItemId.toLowerCase() !== itemId || pathRole !== role) {
    throw new MainAdCarouselValidationError('이미지 저장 경로와 광고 항목이 일치하지 않습니다.')
  }

  return value
}

function validateItem(
  value: unknown,
  allowMissingPcImage: boolean
): MainAdCarouselItem {
  if (!isRecord(value)) {
    throw new MainAdCarouselValidationError('광고 항목 형식이 올바르지 않습니다.')
  }

  const id = validateUuid(value.id, '광고 ID')
  const title = validateRequiredText(value.title, '광고 제목')
  const alt = validateRequiredText(value.alt, '대체 텍스트')
  const href = validateMainAdHref(value.href)
  const durationSeconds = validateDuration(value.durationSeconds)

  if (typeof value.isActive !== 'boolean') {
    throw new MainAdCarouselValidationError('광고 활성화 값이 올바르지 않습니다.')
  }

  let pcImagePath = ''
  if (allowMissingPcImage && value.pcImagePath === '') {
    pcImagePath = ''
  } else {
    pcImagePath = validateMainAdStoragePath(value.pcImagePath, id, 'pc')
  }

  let mobileImagePath: string | null = null
  if (value.mobileImagePath !== null && value.mobileImagePath !== undefined && value.mobileImagePath !== '') {
    mobileImagePath = validateMainAdStoragePath(value.mobileImagePath, id, 'mobile')
  }

  return {
    id,
    title,
    pcImagePath,
    mobileImagePath,
    alt,
    href,
    durationSeconds,
    isActive: value.isActive,
  }
}

function validateSubjectConfig(value: unknown, allowMissingPcImage: boolean): MainAdCarouselSubjectConfig {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) {
    throw new MainAdCarouselValidationError('메인 광고 설정 형식이 올바르지 않습니다.')
  }

  const seenIds = new Set<string>()
  const items = value.items.map((item) => {
    const nextItem = validateItem(item, allowMissingPcImage)

    if (seenIds.has(nextItem.id)) {
      throw new MainAdCarouselValidationError('중복된 광고 ID가 있습니다.')
    }

    seenIds.add(nextItem.id)
    return nextItem
  })

  return { version: 1, items }
}

export function getDefaultMainAdCarouselConfig(): MainAdCarouselConfig {
  return { version: 2, items: { english: [], korean: [] } }
}

export function validateMainAdCarouselDraftConfig(value: unknown) {
  return validateSubjectConfig(value, true)
}

export function validateMainAdCarouselConfig(value: unknown) {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.items)
    || !Array.isArray(value.items.english) || !Array.isArray(value.items.korean)) {
    throw new MainAdCarouselValidationError('메인 광고 설정 형식이 올바르지 않습니다.')
  }

  const english = validateSubjectConfig({ version: 1, items: value.items.english }, false).items
  const korean = validateSubjectConfig({ version: 1, items: value.items.korean }, false).items
  const seenIds = new Set<string>()
  for (const item of [...english, ...korean]) {
    if (seenIds.has(item.id)) {
      throw new MainAdCarouselValidationError('과목 간 중복된 광고 ID가 있습니다.')
    }
    seenIds.add(item.id)
  }
  return { version: 2, items: { english, korean } } satisfies MainAdCarouselConfig
}

function normalizeItems(items: unknown[]) {
  return items.map((item) => {
          if (!isRecord(item)) {
            return item
          }

          const durationSeconds = (
            typeof item.durationSeconds === 'number'
            && Number.isInteger(item.durationSeconds)
            && item.durationSeconds >= MAIN_AD_MIN_DURATION_SECONDS
            && item.durationSeconds <= MAIN_AD_MAX_DURATION_SECONDS
          )
            ? item.durationSeconds
            : MAIN_AD_DEFAULT_DURATION_SECONDS

          return {
            ...item,
            durationSeconds,
          }
        })
}

function applyMainAdCarouselNormalizationDefaults(value: unknown) {
  if (!isRecord(value)) return value
  if (value.version === 1 && Array.isArray(value.items)) {
    return { version: 2, items: { english: normalizeItems(value.items), korean: [] } }
  }
  if (value.version === 2 && isRecord(value.items)
    && Array.isArray(value.items.english) && Array.isArray(value.items.korean)) {
    return {
      version: 2,
      items: {
        english: normalizeItems(value.items.english),
        korean: normalizeItems(value.items.korean),
      },
    }
  }
  return value
}

export function validateStoredMainAdCarouselConfig(value: unknown) {
  return validateMainAdCarouselConfig(
    applyMainAdCarouselNormalizationDefaults(value)
  )
}

export function normalizeMainAdCarouselConfig(value: unknown): MainAdCarouselConfig {
  try {
    return validateStoredMainAdCarouselConfig(value)
  } catch {
    return getDefaultMainAdCarouselConfig()
  }
}

export function resolveMainAdCarouselConfigForUpdate(
  value: unknown,
  rowExists: boolean
) {
  if (!rowExists) {
    return getDefaultMainAdCarouselConfig()
  }

  return validateStoredMainAdCarouselConfig(value)
}

export function getActiveMainAdCarouselItems(config: MainAdCarouselConfig, subject: MainAdSubject) {
  return config.items[subject].filter((item) => item.isActive)
}

export function getReferencedMainAdImagePaths(config: MainAdCarouselConfig) {
  const paths = new Set<string>()

  const items = [...config.items.english, ...config.items.korean]
  items.forEach((item) => {
    paths.add(item.pcImagePath)
    if (item.mobileImagePath) {
      paths.add(item.mobileImagePath)
    }
  })

  return paths
}

export function getMainAdCarouselSubjectConfig(
  config: MainAdCarouselConfig,
  subject: MainAdSubject
): MainAdCarouselSubjectConfig {
  return { version: 1, items: config.items[subject].map((item) => ({ ...item })) }
}

export function replaceMainAdCarouselSubjectConfig(
  config: MainAdCarouselConfig,
  subject: MainAdSubject,
  subjectConfig: MainAdCarouselSubjectConfig
) {
  return validateMainAdCarouselConfig({
    version: 2,
    items: {
      english: subject === 'english' ? subjectConfig.items : config.items.english,
      korean: subject === 'korean' ? subjectConfig.items : config.items.korean,
    },
  })
}

export function getMainAdImageExtension(
  file: MainAdUploadCandidate
): MainAdImageExtension {
  if (file.size <= 0 || file.size > MAIN_AD_MAX_FILE_SIZE_BYTES) {
    throw new MainAdCarouselValidationError('이미지는 10MB 이하의 파일만 업로드할 수 있습니다.')
  }

  const fileExtension = file.name.split('.').pop()?.toLowerCase()
  const expectedExtensions: Record<string, readonly string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
  }
  const allowedExtensions = expectedExtensions[file.type]

  if (!fileExtension || !allowedExtensions?.includes(fileExtension)) {
    throw new MainAdCarouselValidationError('JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.')
  }

  if (file.type === 'image/jpeg') {
    return 'jpg'
  }

  return validateImageExtension(fileExtension)
}
