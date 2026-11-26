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
  // 22번 예약 노출(UTC ISO, 각각 null 가능). 화면은 한국 시간으로 받고 서버가 UTC 로 바꾼다. 판은 올리지 않는다.
  startsAt: string | null
  endsAt: string | null
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
  // 기간 거르기는 캐시 밖(요청마다)에서 하므로 캐시 값에 기간을 싣는다(22번 3-5).
  startsAt: string | null
  endsAt: string | null
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

// 예약 시각 읽기: null·빈 값 → null, 'YYYY-MM-DDTHH:mm'(시간대 없음)은 한국 시간, 시간대가 있는 ISO 는 그대로. 결과는 UTC ISO.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const KST_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const ZONED_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

// 한국 시간 'YYYY-MM-DDTHH:mm' → UTC ISO. 형식이 틀리거나 없는 날짜면 null(브라우저 시간대와 무관).
export function kstLocalToUtcIso(value: string): string | null {
  const match = KST_LOCAL_PATTERN.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day
    || utc.getUTCHours() !== hour || utc.getUTCMinutes() !== minute) return null
  return new Date(utc.getTime() - KST_OFFSET_MS).toISOString()
}

// UTC ISO → 한국 시간 'YYYY-MM-DDTHH:mm'(datetime-local 입력 칸 값)
export function utcIsoToKstLocal(value: string | null): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + KST_OFFSET_MS).toISOString().slice(0, 16)
}

function validateScheduleValue(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    if (KST_LOCAL_PATTERN.test(value)) {
      const converted = kstLocalToUtcIso(value)
      if (converted) return converted
    } else if (ZONED_ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value))) {
      return new Date(Date.parse(value)).toISOString()
    }
  }
  throw new MainAdCarouselValidationError(`${fieldName} 형식이 올바르지 않습니다.`)
}

function validateSchedule(value: Record<string, unknown>) {
  const startsAt = validateScheduleValue(value.startsAt, '노출 시작 시각')
  const endsAt = validateScheduleValue(value.endsAt, '노출 끝 시각')
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new MainAdCarouselValidationError('노출 끝 시각은 시작 시각보다 뒤여야 합니다.')
  }
  return { startsAt, endsAt }
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
    ...validateSchedule(value),
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

type MainAdSchedule = Pick<MainAdCarouselItem, 'startsAt' | 'endsAt'>

// 지금 기간 안인가(22번 3-5): 시작 정각부터 보이고 끝 정각부터 안 보인다. null 은 '바로'·'계속'.
export function isMainAdVisibleAt(item: MainAdSchedule, now: Date) {
  const time = now.getTime()
  if (item.startsAt && time < Date.parse(item.startsAt)) return false
  if (item.endsAt && time >= Date.parse(item.endsAt)) return false
  return true
}

// 캐시 밖(요청마다)에서 부른다: (solvook)/page.tsx·preview/solvook-concept/page.tsx
export function filterVisibleMainAdItems<T extends MainAdSchedule>(items: T[], now: Date): T[] {
  return items.filter((item) => isMainAdVisibleAt(item, now))
}

// 관리 화면 상태(20번 tone 키와 같은 값): 노출 중·예약·종료·꺼짐
export const MAIN_AD_SCHEDULE_STATUSES = ['live', 'scheduled', 'ended', 'off'] as const
export type MainAdScheduleStatus = (typeof MAIN_AD_SCHEDULE_STATUSES)[number]
export const MAIN_AD_SCHEDULE_STATUS_LABELS: Record<MainAdScheduleStatus, string> = {
  live: '노출 중',
  scheduled: '예약',
  ended: '종료',
  off: '꺼짐',
}

export function getMainAdScheduleStatus(item: MainAdSchedule & Pick<MainAdCarouselItem, 'isActive'>, now: Date): MainAdScheduleStatus {
  if (!item.isActive) return 'off'
  if (item.startsAt && now.getTime() < Date.parse(item.startsAt)) return 'scheduled'
  if (item.endsAt && now.getTime() >= Date.parse(item.endsAt)) return 'ended'
  return 'live'
}

// 작업 기록용 배너별 바뀐 칸(22번 7절: 켜기·기간·링크·순서). 제목·대체 글 원문은 넣지 않는다.
type MainAdAuditValue = string | number | boolean | null | string[]

export function diffMainAdItems(before: MainAdCarouselItem[], after: MainAdCarouselItem[]) {
  const beforeById = new Map(before.map((item, index) => [item.id, { item, index }]))
  const afterIds = new Set(after.map((item) => item.id))
  const changes: Array<Record<string, MainAdAuditValue>> = []
  after.forEach((item, index) => {
    const previous = beforeById.get(item.id)
    if (!previous) {
      changes.push({ id: item.id, change: 'added', position: index, isActive: item.isActive, startsAt: item.startsAt, endsAt: item.endsAt, href: item.href })
      return
    }
    const fields: string[] = []
    if (previous.index !== index) fields.push('position')
    if (previous.item.isActive !== item.isActive) fields.push('isActive')
    if (previous.item.startsAt !== item.startsAt || previous.item.endsAt !== item.endsAt) fields.push('schedule')
    if (previous.item.href !== item.href) fields.push('href')
    if (previous.item.title !== item.title || previous.item.alt !== item.alt) fields.push('text')
    if (previous.item.pcImagePath !== item.pcImagePath || previous.item.mobileImagePath !== item.mobileImagePath) fields.push('image')
    if (previous.item.durationSeconds !== item.durationSeconds) fields.push('durationSeconds')
    if (fields.length === 0) return
    const change: Record<string, MainAdAuditValue> = { id: item.id, change: 'updated', fields, position: index, isActive: item.isActive }
    if (fields.includes('schedule')) {
      change.startsAt = item.startsAt
      change.endsAt = item.endsAt
    }
    if (fields.includes('href')) change.href = item.href
    changes.push(change)
  })
  for (const item of before) {
    if (!afterIds.has(item.id)) changes.push({ id: item.id, change: 'removed' })
  }
  return changes
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
