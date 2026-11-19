import 'server-only'
import {
  ADMIN_LOGIN_ID_PATTERN,
  ADMIN_PASSWORD_MIN_LENGTH,
  extractAdminLoginId,
  isAdminAccountEmail,
  normalizeAdminLoginId,
  resolveAdminLoginEmail,
} from '@/lib/admin-accounts-shared'
import { ADMIN_PERMISSIONS, ADMIN_PERMISSION_KEYS, validateAdminPermissionGrants, type AdminPermissionKey } from '@/lib/admin-permissions'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Json } from '@/types/supabase'

export class AdminAccountError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminAccountError'
    this.status = status
  }
}

export interface AdminAccountGrant {
  permission: string
  limits: Json
}

export interface AdminAccountSummary {
  userId: string
  loginId: string
  createdAt: string | null
  lastSignInAt: string | null
  isBootstrapAccount: boolean
  // 대표(owner)는 모든 권한, 일반 관리자(staff)는 받은 권한만. 역할이 비어 있으면 staff로 본다(계획 4-1절).
  role: 'owner' | 'staff'
  grants: AdminAccountGrant[]
}

export async function listAdminAccounts(): Promise<AdminAccountSummary[]> {
  const admin = createAdminClient()

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, admin_role')
    .eq('is_admin', true)
  if (profilesError) {
    throw new AdminAccountError(500, `관리자 목록을 불러오지 못했습니다: ${profilesError.message}`)
  }

  const profileIds = (profiles ?? []).map((profile) => profile.id)
  const { data: grantRows, error: grantsError } = profileIds.length > 0
    ? await admin.from('admin_permission_grants').select('user_id, permission, limits').in('user_id', profileIds)
    : { data: [], error: null }
  if (grantsError) {
    throw new AdminAccountError(500, `관리자 권한을 불러오지 못했습니다: ${grantsError.message}`)
  }

  // 관리자 수는 소수이므로 전체 유저 목록 대신 개별 조회한다 (200명 초과 시 누락 방지)
  const authResults = await Promise.all(
    (profiles ?? []).map((profile) => admin.auth.admin.getUserById(profile.id))
  )
  const usersById = new Map(
    authResults
      .map((result) => result.data?.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
      .map((user) => [user.id, user])
  )

  return (profiles ?? [])
    .map((profile) => {
      const authUser = usersById.get(profile.id)
      const email = authUser?.email ?? ''
      return {
        userId: profile.id,
        loginId: email ? extractAdminLoginId(email) : profile.id,
        createdAt: authUser?.created_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        isBootstrapAccount: !isAdminAccountEmail(email),
        role: profile.admin_role === 'owner' ? 'owner' as const : 'staff' as const,
        grants: (grantRows ?? [])
          .filter((grant) => grant.user_id === profile.id)
          .map((grant) => ({ permission: grant.permission, limits: grant.limits })),
      }
    })
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}

export async function createAdminAccount({
  loginId,
  password,
}: {
  loginId: string
  password: string
}): Promise<AdminAccountSummary> {
  const normalizedLoginId = normalizeAdminLoginId(loginId)
  if (!ADMIN_LOGIN_ID_PATTERN.test(normalizedLoginId)) {
    throw new AdminAccountError(400, '아이디는 영문 소문자·숫자·-·_ 3~30자여야 합니다.')
  }
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new AdminAccountError(400, `비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)
  }

  const admin = createAdminClient()
  const email = resolveAdminLoginEmail(normalizedLoginId)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError) {
    if (createError.code === 'email_exists' || createError.status === 422) {
      throw new AdminAccountError(409, '이미 사용 중인 아이디입니다.')
    }
    throw new AdminAccountError(500, `관리자 계정을 생성하지 못했습니다: ${createError.message}`)
  }

  const userId = created.user.id
  const { error: profileError } = await admin
    .from('profiles')
    // 새 관리자는 권한 0개 일반 관리자로 시작한다. 권한은 대표가 따로 준다.
    .update({ is_admin: true, admin_role: 'staff' })
    .eq('id', userId)
    .select('id')
    .single()
  if (profileError) {
    // 프로필 갱신 실패 시 고아 auth 계정을 남기지 않는다.
    await admin.auth.admin.deleteUser(userId)
    throw new AdminAccountError(500, `관리자 프로필을 설정하지 못했습니다: ${profileError.message}`)
  }

  return {
    userId,
    loginId: normalizedLoginId,
    createdAt: created.user.created_at ?? null,
    lastSignInAt: null,
    isBootstrapAccount: false,
    role: 'staff',
    grants: [],
  }
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireAdminProfile(admin: ReturnType<typeof createAdminClient>, userId: string) {
  // 주소의 [userId]가 uuid 모양이 아니면 DB에 묻지 않고 거부한다(묻으면 형식 오류가 500으로 보인다).
  if (!USER_ID_PATTERN.test(userId)) {
    throw new AdminAccountError(400, '관리자 계정 id가 올바르지 않습니다.')
  }
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, is_admin, admin_role, email')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    throw new AdminAccountError(500, `관리자 정보를 확인하지 못했습니다: ${error.message}`)
  }
  if (!profile?.is_admin) {
    throw new AdminAccountError(404, '관리자 계정을 찾을 수 없습니다.')
  }
  return profile
}

export async function updateAdminAccount({
  userId,
  password,
}: {
  userId: string
  password: string
}) {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new AdminAccountError(400, `비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)
  }

  const admin = createAdminClient()
  const profile = await requireAdminProfile(admin, userId)

  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) {
    throw new AdminAccountError(500, `비밀번호를 변경하지 못했습니다: ${error.message}`)
  }
  // 작업 기록에 쓸 대상 아이디
  return { loginId: profile.email ? extractAdminLoginId(profile.email) : userId }
}

export async function deleteAdminAccount({ userId, actorId }: { userId: string; actorId: string }) {
  if (userId === actorId) {
    throw new AdminAccountError(400, '본인 계정은 삭제할 수 없습니다.')
  }

  const admin = createAdminClient()
  const profile = await requireAdminProfile(admin, userId)

  const { count, error: countError } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('is_admin', true)
  if (countError) {
    throw new AdminAccountError(500, `관리자 수를 확인하지 못했습니다: ${countError.message}`)
  }
  if ((count ?? 0) < 2) {
    throw new AdminAccountError(400, '마지막 관리자 계정은 삭제할 수 없습니다.')
  }

  // 삭제를 막는 NOT NULL·비연쇄 FK(문의/결제 이력)는 어떤 변형도 하기 전에 먼저 거부한다.
  // (원격 스키마 실측: support_tickets.user_id NO ACTION, checkout_attempts/payment_orders.user_id RESTRICT)
  const blockingSources: Array<{ table: 'support_tickets' | 'checkout_attempts' | 'payment_orders'; label: string }> = [
    { table: 'support_tickets', label: '고객지원 문의' },
    { table: 'checkout_attempts', label: '결제 시도' },
    { table: 'payment_orders', label: '결제 주문' },
  ]
  for (const { table, label } of blockingSources) {
    const { count: refCount, error: refError } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (refError) {
      throw new AdminAccountError(500, `${table} 이력을 확인하지 못했습니다: ${refError.message}`)
    }
    if ((refCount ?? 0) > 0) {
      throw new AdminAccountError(409, `${label} 이력이 있는 계정은 삭제할 수 없습니다. 기록 보존이 필요하면 비밀번호 변경으로 접근만 차단해주세요.`)
    }
  }

  // NO ACTION FK 참조 해제: 삭제 대상 관리자를 가리키는 감사 컬럼을 null로 갱신한다.
  const clearProfileReference = async (
    table: 'generate_listboard_posts' | 'generate_listboard_post_items',
    column: 'created_by' | 'updated_by'
  ) => {
    const payload = column === 'created_by' ? { created_by: null } : { updated_by: null }
    const { error } = await admin
      .from(table)
      .update(payload)
      .eq(column, userId)
    if (error) {
      throw new AdminAccountError(500, `${table}.${column} 참조를 해제하지 못했습니다: ${error.message}`)
    }
  }

  await clearProfileReference('generate_listboard_posts', 'created_by')
  await clearProfileReference('generate_listboard_posts', 'updated_by')
  await clearProfileReference('generate_listboard_post_items', 'created_by')
  await clearProfileReference('generate_listboard_post_items', 'updated_by')

  // generate_menu_entries의 created_by/updated_by와 market_item_sample_pages.created_by FK는
  // 마이그레이션 파일과 달리 원격 스키마에 존재하지 않는 것으로 실측 확인됨(2026-09-01) — 갱신 대상 아님.

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    throw new AdminAccountError(500, `관리자 계정을 삭제하지 못했습니다: ${deleteError.message}`)
  }
  // 작업 기록에 쓸 대상 아이디·역할(계정이 사라진 뒤에도 기록에서 알아볼 수 있게)
  return { loginId: profile.email ? extractAdminLoginId(profile.email) : userId, role: profile.admin_role }
}

// ---------------------------------------------------------------------------------------------------------------
// 권한 부여·회수와 권한 해제(계획 U3-4, W4-6). 실제 변경은 DB 함수가 작업 기록과 같은 트랜잭션으로 한다
// (마이그레이션 20261117120000). 함수도 행위자=대표·대상=일반 관리자·본인 아님을 다시 확인한다.
// ---------------------------------------------------------------------------------------------------------------

// DB 함수의 거부 사유 → 화면 문구. 함수가 없으면(마이그레이션 적용 전) 그 밖의 오류로 떨어진다.
const PERMISSION_FUNCTION_ERRORS: Array<[string, number, string]> = [
  ['ADMIN_PERMISSION_SELF_NOT_ALLOWED', 400, '본인 계정의 권한은 바꿀 수 없습니다.'],
  ['ADMIN_PERMISSION_ACTOR_NOT_OWNER', 403, '대표 관리자만 권한을 바꿀 수 있습니다.'],
  ['ADMIN_PERMISSION_TARGET_NOT_STAFF', 409, '일반 관리자 계정만 권한을 바꾸거나 해제할 수 있습니다.'],
  ['ADMIN_PERMISSION_UNKNOWN', 400, '알 수 없는 권한이 들어 있습니다.'],
  ['ADMIN_PERMISSION_INVALID_ARGUMENT', 400, '권한 입력이 올바르지 않습니다.'],
]

function toPermissionFunctionError(error: { message: string }, fallbackMessage: string) {
  const known = PERMISSION_FUNCTION_ERRORS.find(([code]) => error.message.includes(code))
  if (known) return new AdminAccountError(known[1], known[2])
  console.error('[admin-accounts] 권한 함수 호출 실패', { message: error.message })
  return new AdminAccountError(500, fallbackMessage)
}

// 대상이 일반 관리자인지 먼저 본다(함수도 다시 확인한다). 대표·비관리자·본인은 거부.
async function requireStaffTarget(admin: ReturnType<typeof createAdminClient>, userId: string, actorId: string) {
  if (userId === actorId) {
    throw new AdminAccountError(400, '본인 계정의 권한은 바꾸거나 해제할 수 없습니다.')
  }
  const profile = await requireAdminProfile(admin, userId)
  if (profile.admin_role === 'owner') {
    throw new AdminAccountError(409, '대표 관리자 계정은 권한을 따로 주거나 해제하지 않습니다(모든 권한을 가집니다).')
  }
}

// 대상 계정의 권한을 통째로 바꾼다. 빈 목록이면 권한을 모두 회수한다(관리자 자격은 유지).
export async function replaceAdminPermissionGrants({
  actorId,
  userId,
  grants,
}: {
  actorId: string
  userId: string
  grants: ReadonlyArray<{ permission: string; limits?: Record<string, unknown> }>
}) {
  const errors = validateAdminPermissionGrants(grants)
  if (errors.length > 0) {
    throw new AdminAccountError(400, errors[0])
  }

  const admin = createAdminClient()
  await requireStaffTarget(admin, userId, actorId)

  // 검증을 지났으므로 모두 아는 권한이다. 한도 칸은 그 권한에 정의된 키만 남긴다(모르는 키를 저장하지 않는다).
  // 비워 둔 한도(비울 수 있는 권한만 검증을 지난다)는 저장하지 않는다 — 없으면 기본 한도를 쓴다.
  const payload = grants.map((grant) => {
    const definedLimits: Readonly<Record<string, string>> = ADMIN_PERMISSIONS[grant.permission as AdminPermissionKey].limits
    const limits = Object.fromEntries(Object.entries(grant.limits ?? {}).filter(([key, value]) => key in definedLimits && value !== null && value !== undefined))
    return { permission: grant.permission, limits }
  })

  const { data, error } = await admin.rpc('replace_admin_permission_grants', {
    p_actor_id: actorId,
    p_user_id: userId,
    p_grants: payload as Json,
  })
  if (error) {
    throw toPermissionFunctionError(error, '권한을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return data
}

// 일반 관리자의 관리자 자격을 해제한다(is_admin=false, 역할·권한 삭제, 작업 기록). 계정과 그 계정의 이력은 남는다.
export async function revokeAdminAccount({ actorId, userId }: { actorId: string; userId: string }) {
  const admin = createAdminClient()
  await requireStaffTarget(admin, userId, actorId)

  const { error } = await admin.rpc('revoke_admin_account', { p_actor_id: actorId, p_user_id: userId })
  if (error) {
    throw toPermissionFunctionError(error, '권한을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

// 권한 부여 화면의 "묶음" 버튼 구성(system_settings 'admin_permission_presets'). 체크만 채우는 데이터라
// 코드 목록에 없는 권한 이름은 뺀다. 설정이 없거나 읽지 못하면 빈 목록(버튼을 그리지 않는다).
export async function readAdminPermissionPresets(): Promise<Array<{ name: string; permissions: AdminPermissionKey[] }>> {
  const { data, error } = await createAdminClient()
    .from('system_settings')
    .select('value')
    .eq('key', 'admin_permission_presets')
    .maybeSingle()
  if (error) {
    console.error('[admin-accounts] 권한 묶음 설정을 읽지 못했습니다.', { message: error.message })
    return []
  }
  const presets = (data?.value as { presets?: unknown } | null)?.presets
  if (!Array.isArray(presets)) return []
  return presets.flatMap((preset) => {
    if (!preset || typeof preset !== 'object') return []
    const { name, permissions } = preset as { name?: unknown; permissions?: unknown }
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(permissions)) return []
    return [{
      name: name.trim(),
      permissions: permissions.filter((key): key is AdminPermissionKey => ADMIN_PERMISSION_KEYS.includes(key as AdminPermissionKey)),
    }]
  })
}

// 로그인한 관리자 본인의 비밀번호 변경. 현재 비밀번호를 확인한 뒤 바꾼다(대표의 비밀번호 재설정과 같은 service role 경로).
export async function changeOwnAdminPassword({
  userId,
  currentPassword,
  newPassword,
}: {
  userId: string
  currentPassword: string
  newPassword: string
}) {
  if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new AdminAccountError(400, `비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)
  }
  if (newPassword === currentPassword) {
    throw new AdminAccountError(400, '새 비밀번호가 현재 비밀번호와 같습니다.')
  }

  const admin = createAdminClient()
  const profile = await requireAdminProfile(admin, userId)
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId)
  const email = authUser?.user?.email
  if (authUserError || !email) {
    throw new AdminAccountError(500, '계정 정보를 확인하지 못했습니다.')
  }

  // 현재 비밀번호 확인: 쿠키를 쓰지 않는 별도 클라이언트로 로그인해 본다(지금 세션은 건드리지 않는다).
  const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email, password: currentPassword })
  if (verifyError) {
    throw new AdminAccountError(400, '현재 비밀번호가 맞지 않습니다.')
  }
  // 확인용으로 만든 세션만 닫는다(scope: 'local' — 다른 기기·지금 세션은 그대로).
  await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined)

  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) {
    throw new AdminAccountError(500, `비밀번호를 변경하지 못했습니다: ${error.message}`)
  }
  return { loginId: profile.email ? extractAdminLoginId(profile.email) : userId }
}
