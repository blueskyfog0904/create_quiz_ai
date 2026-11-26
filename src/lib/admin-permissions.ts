// 관리자 계정별 권한의 규칙(계획 4-1절). 권한 항목·의존·한도 키는 여기(규칙),
// 누가 어떤 권한을 받았는지와 한도 숫자는 DB(profiles.admin_role, admin_permission_grants)에 둔다.
// 서버·브라우저·테스트가 같이 쓰므로 순수 함수만 둔다.

interface AdminPermissionDefinition {
  // 할 수 있는 일(부여 화면에 보이는 설명)
  label: string
  // 함께 필요한 권한. 하나라도 빠지면 이 권한은 없는 것으로 판정한다.
  requires: readonly string[]
  // 한도 키 → 설명. 한도가 있는 권한은 부여할 때 한도 입력이 필수다(limitsOptional이면 비워 둘 수 있다).
  limits: Readonly<Record<string, string>>
  // true면 한도 칸을 비워 둘 수 있고, 비우면 DB의 기본 한도를 쓴다(크레딧 지급: system_settings 'admin_credit_grant_limits').
  limitsOptional?: boolean
}

export const ADMIN_PERMISSIONS = {
  'support.manage': { label: '문의 조회·답변·카테고리', requires: [], limits: {} },
  'content.manage': { label: '공지사항·FAQ 게시', requires: [], limits: {} },
  'orders.view': { label: '충전 결제·마켓 구매 조회', requires: [], limits: {} },
  'members.view': { label: '회원 목록·상세 조회', requires: [], limits: {} },
  // 12번 묶음: 메모 보기는 members.view. 로그인 차단과 그 해제·알림 기록은 대표만(DB 함수가 다시 본다).
  'members.memo': { label: '회원 관리자 메모 쓰기·지우기', requires: ['members.view'], limits: {} },
  'members.suspend': { label: '회원 이용 제한·해제', requires: ['members.view'], limits: {} },
  'credits.view': { label: '크레딧 거래 조회', requires: [], limits: {} },
  'credits.grant': {
    label: '크레딧 수동 지급',
    requires: ['members.view', 'credits.view'],
    limits: { per_grant: '1회 지급 한도', per_day: '하루 지급 한도' },
    // 비우면 기본 한도. 한도 판정(1회·하루 합계)은 지급 함수(DB)가 한다(20261118120000).
    limitsOptional: true,
  },
  'credits.limits.manage': {
    label: '크레딧 지급 기본 한도 변경(직원)',
    requires: ['credits.view'],
    limits: {},
  },
  'credits.revoke': {
    label: '크레딧 수동 회수',
    requires: ['members.view', 'credits.view'],
    limits: { per_grant: '1회 회수 한도' },
  },
  'refunds.market': {
    label: '마켓 환불 승인·거부',
    requires: ['orders.view'],
    limits: { per_request: '1건 승인 한도' },
  },
  'refunds.payment': { label: '충전 환불 실행, 결제 수동확인, 경보 해소', requires: ['orders.view'], limits: {} },
  'products.edit': { label: '상품·카테고리·이미지 등록·수정·숨김', requires: [], limits: {} },
  'products.delete': { label: '이력 없는 상품 완전 삭제', requires: ['products.edit'], limits: {} },
  'storefront.edit': { label: '홈 화면 광고·진열', requires: [], limits: {} },
  'reviews.manage': { label: '후기 삭제·태그', requires: [], limits: {} },
  'pricing.manage': { label: '충전 상품(요금제)·결제 고지 문구 포함', requires: [], limits: {} },
  'site.manage': { label: '약관·푸터·로고·메뉴 이름', requires: [], limits: {} },
  'reports.view': { label: '매출 집계·CSV 내보내기', requires: ['orders.view'], limits: {} },
} as const satisfies Record<string, AdminPermissionDefinition>

export type AdminPermissionKey = keyof typeof ADMIN_PERMISSIONS

export const ADMIN_PERMISSION_KEYS = Object.keys(ADMIN_PERMISSIONS) as AdminPermissionKey[]

// 가드에 넘기는 요구 조건. 'owner'는 대표 전용(관리자 계정 관리·권한 부여·작업 기록)으로, 부여할 수 없는 고정 권한이다.
export type AdminPermissionRequirement = AdminPermissionKey | 'owner'

export interface AdminAccess {
  userId: string
  role: 'owner' | 'staff'
  // 받은 권한 → 한도(DB의 limits 그대로). owner는 이 값과 무관하게 모든 권한을 가진다.
  grants: Partial<Record<AdminPermissionKey, Record<string, unknown>>>
}

function isAdminPermissionKey(value: string): value is AdminPermissionKey {
  return Object.prototype.hasOwnProperty.call(ADMIN_PERMISSIONS, value)
}

function requiredPermissions(key: AdminPermissionKey): readonly AdminPermissionKey[] {
  return ADMIN_PERMISSIONS[key].requires
}

// 그 권한의 한도 칸을 비워 둘 수 있는지(비우면 기본 한도).
export function isAdminPermissionLimitOptional(key: AdminPermissionKey): boolean {
  return (ADMIN_PERMISSIONS[key] as AdminPermissionDefinition).limitsOptional === true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// DB에서 읽은 프로필과 권한 행으로 접근 정보를 만든다. 관리자가 아니면 null.
// admin_role이 비어 있는(또는 모르는 값인) 관리자는 권한 0개 staff로 시작한다.
export function buildAdminAccess(
  userId: string,
  profile: { is_admin: boolean | null; admin_role: string | null } | null,
  grantRows: ReadonlyArray<{ permission: string; limits: unknown }>
): AdminAccess | null {
  if (profile?.is_admin !== true) return null

  const grants: AdminAccess['grants'] = {}
  for (const row of grantRows) {
    // 코드 목록에 없는 권한 값은 무시한다(DB는 permission을 CHECK로 묶지 않는다).
    if (isAdminPermissionKey(row.permission)) {
      grants[row.permission] = isPlainObject(row.limits) ? row.limits : {}
    }
  }

  return { userId, role: profile.admin_role === 'owner' ? 'owner' : 'staff', grants }
}

// owner는 전부 통과. staff는 그 권한과 "함께 필요한 권한"을 모두 받았을 때만 통과.
export function hasAdminPermission(access: AdminAccess | null, requirement: AdminPermissionRequirement): boolean {
  if (!access) return false
  // 목록에 없는 요구 조건은 owner에게도 통과시키지 않는다(오타가 "모두 허용"이 되지 않게).
  if (requirement !== 'owner' && !isAdminPermissionKey(requirement)) return false
  if (access.role === 'owner') return true
  if (requirement === 'owner') return false
  return [requirement, ...requiredPermissions(requirement)].every((key) => access.grants[key] !== undefined)
}

// 가드에 넘기는 값. 하나의 요구 조건, "이 중 하나라도"(배열 — 화면이 여러 권한에 걸칠 때), 'admin'(관리자면 누구나 — 대시보드·알림 같은 공통 화면).
export type AdminGuardRequirement = AdminPermissionRequirement | readonly AdminPermissionRequirement[] | 'admin'

// 가드의 통과 판정. 빈 배열은 아무도 통과시키지 않는다.
export function meetsAdminRequirement(access: AdminAccess | null, requirement: AdminGuardRequirement): boolean {
  if (!access) return false
  if (requirement === 'admin') return true
  if (Array.isArray(requirement)) return requirement.some((item) => hasAdminPermission(access, item))
  return hasAdminPermission(access, requirement as AdminPermissionRequirement)
}

// 한 번에 다루는 양이 그 계정의 한도 안인지. owner는 한도가 없다.
// staff는 한도 값이 없거나 양수가 아니면 불가이고, 양(amount)도 양수여야 한다. 하루 합계 같은 누적 판정은 DB 함수가 한다.
export function checkAdminLimit(
  access: AdminAccess | null,
  key: AdminPermissionKey,
  limitKey: string,
  amount: number
): boolean {
  if (!access || !hasAdminPermission(access, key)) return false
  if (!Number.isFinite(amount) || amount <= 0) return false
  if (access.role === 'owner') return true
  const limit = access.grants[key]?.[limitKey]
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 && amount <= limit
}

// 한도 값의 상한. DB의 지급 수량·한도 비교가 integer라 그 최대값과 같다(권한 교체 함수 20261117120000도 같은 값으로 거부한다).
export const ADMIN_PERMISSION_LIMIT_MAX = 2147483647

// 한 계정에 주려는 권한 조합을 검사한다. 돌려주는 값은 오류 문구 목록이고, 비어 있으면 저장해도 된다.
export function validateAdminPermissionGrants(
  grants: ReadonlyArray<{ permission: string; limits?: unknown }>
): string[] {
  const errors: string[] = []
  const granted = new Set(grants.map((grant) => grant.permission))
  if (granted.size !== grants.length) errors.push('같은 권한이 두 번 들어 있습니다.')

  for (const grant of grants) {
    if (!isAdminPermissionKey(grant.permission)) {
      errors.push(`알 수 없는 권한입니다: ${grant.permission}`)
      continue
    }
    for (const required of requiredPermissions(grant.permission)) {
      if (!granted.has(required)) {
        errors.push(`${grant.permission} 권한에는 ${required} 권한이 함께 필요합니다.`)
      }
    }
    const limits = isPlainObject(grant.limits) ? grant.limits : {}
    const optional = isAdminPermissionLimitOptional(grant.permission)
    for (const [limitKey, limitLabel] of Object.entries<string>(ADMIN_PERMISSIONS[grant.permission].limits)) {
      const value = limits[limitKey]
      if (optional && (value === undefined || value === null)) continue
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        errors.push(`${grant.permission} 권한의 ${limitLabel}는 1 이상의 정수로 입력해야 합니다.`)
      } else if (value > ADMIN_PERMISSION_LIMIT_MAX) {
        errors.push(`${grant.permission} 권한의 ${limitLabel}는 ${ADMIN_PERMISSION_LIMIT_MAX.toLocaleString('ko-KR')} 이하로 입력해야 합니다.`)
      }
    }
  }

  return errors
}
