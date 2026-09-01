import 'server-only'
import {
  ADMIN_LOGIN_ID_PATTERN,
  extractAdminLoginId,
  isAdminAccountEmail,
  normalizeAdminLoginId,
  resolveAdminLoginEmail,
} from '@/lib/admin-accounts-shared'
import { createAdminClient } from '@/lib/supabase/bypass'

export class AdminAccountError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminAccountError'
    this.status = status
  }
}

export interface AdminAccountSummary {
  userId: string
  loginId: string
  name: string | null
  createdAt: string | null
  lastSignInAt: string | null
  isBootstrapAccount: boolean
}

export async function listAdminAccounts(): Promise<AdminAccountSummary[]> {
  const admin = createAdminClient()

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, name')
    .eq('is_admin', true)
  if (profilesError) {
    throw new AdminAccountError(500, `관리자 목록을 불러오지 못했습니다: ${profilesError.message}`)
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
        name: profile.name,
        createdAt: authUser?.created_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        isBootstrapAccount: !isAdminAccountEmail(email),
      }
    })
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}

export async function createAdminAccount({
  loginId,
  name,
  password,
}: {
  loginId: string
  name: string
  password: string
}): Promise<AdminAccountSummary> {
  const normalizedLoginId = normalizeAdminLoginId(loginId)
  if (!ADMIN_LOGIN_ID_PATTERN.test(normalizedLoginId)) {
    throw new AdminAccountError(400, '아이디는 영문 소문자·숫자·-·_ 3~30자여야 합니다.')
  }
  if (password.length < 8) {
    throw new AdminAccountError(400, '비밀번호는 8자 이상이어야 합니다.')
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
    .update({ is_admin: true, name })
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
    name,
    createdAt: created.user.created_at ?? null,
    lastSignInAt: null,
    isBootstrapAccount: false,
  }
}

async function requireAdminProfile(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, is_admin')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    throw new AdminAccountError(500, `관리자 정보를 확인하지 못했습니다: ${error.message}`)
  }
  if (!profile?.is_admin) {
    throw new AdminAccountError(404, '관리자 계정을 찾을 수 없습니다.')
  }
}

export async function updateAdminAccount({
  userId,
  name,
  password,
}: {
  userId: string
  name?: string
  password?: string
}) {
  if (name === undefined && password === undefined) {
    throw new AdminAccountError(400, '변경할 내용이 없습니다.')
  }
  if (password !== undefined && password.length < 8) {
    throw new AdminAccountError(400, '비밀번호는 8자 이상이어야 합니다.')
  }

  const admin = createAdminClient()
  await requireAdminProfile(admin, userId)

  if (password !== undefined) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) {
      throw new AdminAccountError(500, `비밀번호를 변경하지 못했습니다: ${error.message}`)
    }
  }

  if (name !== undefined) {
    const { error } = await admin
      .from('profiles')
      .update({ name })
      .eq('id', userId)
    if (error) {
      throw new AdminAccountError(500, `이름을 변경하지 못했습니다: ${error.message}`)
    }
  }
}

export async function deleteAdminAccount({ userId, actorId }: { userId: string; actorId: string }) {
  if (userId === actorId) {
    throw new AdminAccountError(400, '본인 계정은 삭제할 수 없습니다.')
  }

  const admin = createAdminClient()
  await requireAdminProfile(admin, userId)

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
}
